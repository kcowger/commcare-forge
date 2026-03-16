/**
 * Orchestrates the full app generation pipeline:
 *
 *   1. Ask Claude to generate a compact JSON app definition (via tool use)
 *   2. Validate the compact JSON against CommCare rules
 *   3. If validation fails, ask Claude (Haiku) to fix errors — loop until clean or stuck
 *   4. Expand compact JSON into full HQ import JSON (with XForm XML, suite.xml, etc.)
 *   5. Export the HQ JSON and compile it into a .ccz file
 *
 * Both generation (step 1) and fixing (step 3) use `sendOneShotWithTool` to force
 * structured output. This eliminates the old regex-based JSON extraction from
 * markdown code blocks and the truncated-JSON repair logic that came with it.
 */
import type { AppDefinition, GenerationProgress } from '../types'
import { ClaudeService } from './claude'
import { CczCompiler } from './cczCompiler'
import { AppExporter } from './appExporter'
import { BuildLogger } from './buildLogger'
import { GENERATOR_TOOL_USE_PROMPT } from '../prompts/generatorToolUse'
import { FIXER_TOOL_USE_PROMPT } from '../prompts/fixerToolUse'
import { getCompactAppJsonSchema, compactAppSchema } from '../schemas/compactApp'
import { expandToHqJson, validateCompact } from './hqJsonExpander'
import type { CompactApp } from '../schemas/compactApp'

/**
 * Tool definition passed to Claude's API via sendOneShotWithTool().
 * The input_schema is the full JSON Schema generated from our Zod schema,
 * so Claude sees every field, its type, and its description when deciding
 * what to output. `tool_choice` forces Claude to call this tool rather
 * than responding with plain text.
 */
const SUBMIT_TOOL = {
  name: 'submit_app_definition',
  description: 'Submit the complete CommCare app definition in compact JSON format.',
  input_schema: getCompactAppJsonSchema() as Record<string, unknown>
}

export class AppGenerator {
  private claudeService: ClaudeService
  private cczCompiler: CczCompiler
  private appExporter: AppExporter

  constructor(claudeService: ClaudeService) {
    this.claudeService = claudeService
    this.cczCompiler = new CczCompiler()
    this.appExporter = new AppExporter()
  }

  async generate(
    conversationContext: string,
    onProgress?: (progress: GenerationProgress) => void,
    appName?: string
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string; errors?: string[] }> {
    const report = (status: GenerationProgress['status'], message: string, attempt: number, filesDetected?: string[]) => {
      if (onProgress) {
        onProgress({ status, message, attempt, filesDetected })
      }
    }

    const resolvedAppName = appName || this.inferAppName(conversationContext)
    const logger = new BuildLogger(resolvedAppName)

    try {
      return await this.doGenerate(conversationContext, report, resolvedAppName, logger)
    } finally {
      const logPath = logger.save()
      console.log(`Build log saved: ${logPath}`)
    }
  }

  private async doGenerate(
    conversationContext: string,
    report: (status: GenerationProgress['status'], message: string, attempt: number, filesDetected?: string[]) => void,
    resolvedAppName: string,
    logger: BuildLogger
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string; errors?: string[] }> {

    // Step 1: Generate compact app definition via tool use
    report('generating', 'Generating app...', 0)
    logger.logSection('GENERATION')
    logger.log('Sending generation request to Claude (tool use)...')

    const message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, generate the compact app definition. App name: "${resolvedAppName}".`

    let compact: CompactApp
    try {
      compact = await this.claudeService.sendOneShotWithTool<CompactApp>(
        GENERATOR_TOOL_USE_PROMPT, message, SUBMIT_TOOL,
        () => { /* streaming progress — UI shows spinner */ },
        { maxTokens: 64000, zodSchema: compactAppSchema }
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.log(`FATAL: Tool use generation failed: ${errMsg}`)
      report('failed', 'Failed to generate app definition from Claude', 0)
      return { success: false, errors: [`Generation failed: ${errMsg}`] }
    }

    // Override app name if provided
    compact.app_name = resolvedAppName

    logger.log(`Parsed compact: ${compact.modules?.length || 0} modules, ${compact.modules?.reduce((sum: number, m: any) => sum + (m.forms?.length || 0), 0) || 0} forms`)

    // Step 2: Validate → fix loop
    // If the compact JSON has validation errors, we send it to Haiku for fixing.
    // We track recent error signatures to detect when we're stuck in a loop
    // (same errors repeating). After MAX_STUCK_REPEATS identical error sets,
    // we give up and export whatever we have.
    const recentErrorSignatures: string[] = []
    const MAX_STUCK_REPEATS = 3
    let attempt = 0

    while (true) {
      attempt++
      logger.logSection(`VALIDATION ATTEMPT ${attempt}`)
      report('validating', `Validating app definition (attempt ${attempt})...`, attempt)

      // Validate compact format
      const errors = validateCompact(compact)
      logger.log(`Compact validation: ${errors.length} error(s)`)
      for (const err of errors) {
        logger.log(`  ERROR: ${err}`)
      }

      if (errors.length === 0) {
        logger.log('RESULT: SUCCESS — compact validated')
        report('generating', 'Expanding to HQ format...', attempt)

        // Expand to full HQ JSON
        const hqJson = expandToHqJson(compact)

        // Run HQ JSON validation as a safety check
        const hqErrors = this.validateHqJson(hqJson)
        if (hqErrors.length > 0) {
          logger.log(`WARNING: HQ JSON validation found ${hqErrors.length} issue(s) after expansion:`)
          for (const err of hqErrors) {
            logger.log(`  HQ ERROR: ${err}`)
          }
          // These shouldn't happen if the expander is correct, but log them
        }

        report('success', 'App generated and validated!', attempt)
        return await this.exportResults(hqJson, resolvedAppName, logger)
      }

      // Stuck detection: hash errors into a signature, keep a sliding window of
      // the last N signatures. If all N are identical, the fixer isn't making progress.
      const sig = errors.slice().sort().join('|||')
      recentErrorSignatures.push(sig)
      if (recentErrorSignatures.length > MAX_STUCK_REPEATS) recentErrorSignatures.shift()
      if (recentErrorSignatures.length === MAX_STUCK_REPEATS && recentErrorSignatures.every(s => s === sig)) {
        logger.log(`RESULT: FAILED — same errors repeated ${MAX_STUCK_REPEATS} times`)
        report('failed', `Unable to resolve: ${errors[0]?.substring(0, 200)}`, attempt)
        // Still try to export what we have
        try {
          const hqJson = expandToHqJson(compact)
          const result = await this.exportResults(hqJson, resolvedAppName, logger)
          return { ...result, success: false, errors }
        } catch {
          return { success: false, errors }
        }
      }

      // Fix with Claude via tool use
      logger.logSection(`FIX ATTEMPT ${attempt}`)
      const errorPreview = errors.slice(0, 3).join('; ').substring(0, 150)
      report('fixing', `Fixing: ${errorPreview}`, attempt)

      const compactStr = JSON.stringify(compact, null, 2)
      const fixMessage = `## Validation Errors\n${errors.join('\n')}\n\n## Current App Definition\n${compactStr}`

      logger.log(`Sending fix request to Claude (Haiku, tool use)... (${fixMessage.length} chars)`)

      let fixedCompact: CompactApp
      try {
        fixedCompact = await this.claudeService.sendOneShotWithTool<CompactApp>(
          FIXER_TOOL_USE_PROMPT, fixMessage, SUBMIT_TOOL,
          () => { /* streaming progress */ },
          { model: 'claude-haiku-4-5-20251001', maxTokens: 32768, zodSchema: compactAppSchema }
        )
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.log(`FATAL: Tool use fix failed: ${errMsg}`)
        report('failed', 'Failed to parse fixed app definition from Claude', attempt)
        try {
          const hqJson = expandToHqJson(compact)
          const result = await this.exportResults(hqJson, resolvedAppName, logger)
          return { ...result, success: false, errors: [`Fix failed: ${errMsg}`] }
        } catch {
          return { success: false, errors: [`Fix failed: ${errMsg}`] }
        }
      }

      compact = fixedCompact
      compact.app_name = resolvedAppName
    }
  }

  /** Validate HQ JSON structure after expansion. Safety net for expander bugs. */
  private validateHqJson(json: any): string[] {
    const errors: string[] = []

    if (json.doc_type !== 'Application') {
      errors.push('Missing or invalid doc_type (expected "Application")')
    }

    const modules = json.modules || []
    const attachments = json._attachments || {}

    for (let mIdx = 0; mIdx < modules.length; mIdx++) {
      const mod = modules[mIdx]
      const modName = mod.name?.en || `Module ${mIdx}`
      const forms = mod.forms || []

      const usesCases = forms.some((f: any) => {
        const a = f.actions || {}
        return (a.open_case?.condition?.type === 'always') ||
               (a.update_case?.condition?.type === 'always')
      })

      if (usesCases && !mod.case_type) {
        errors.push(`${modName} uses cases but doesn't have a case_type defined`)
      }

      for (let fIdx = 0; fIdx < forms.length; fIdx++) {
        const form = forms[fIdx]
        const formName = form.name?.en || `Form ${fIdx}`

        if (!form.unique_id) {
          errors.push(`${formName} in ${modName} has no unique_id`)
        } else {
          const attachKey = `${form.unique_id}.xml`
          if (!attachments[attachKey]) {
            errors.push(`${formName} in ${modName}: no _attachment for unique_id "${form.unique_id}"`)
          } else {
            const xform = attachments[attachKey]

            if (!/<(input|select1?|group|repeat|trigger|upload)\s/.test(xform)) {
              errors.push(`"${formName}" has no question elements in its XForm`)
            }

            if (!/<itext>/.test(xform)) {
              errors.push(`${formName} XForm is missing <itext> block`)
            }

            if (/<label>[^<]+<\/label>/.test(xform)) {
              errors.push(`${formName} XForm has inline labels — must use jr:itext() references`)
            }
          }
        }

        if (!form.xmlns) {
          errors.push(`${formName} in ${modName} has no xmlns`)
        }
      }
    }

    return errors
  }

  /** Export HQ JSON + compile CCZ. */
  private async exportResults(
    hqJson: any,
    appName: string,
    logger: BuildLogger
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; hqJsonPath?: string }> {
    // Export HQ JSON
    const hqJsonPath = this.appExporter.exportForHQSync(appName, hqJson)
    logger.log(`HQ JSON exported: ${hqJsonPath}`)

    // Compile CCZ from HQ JSON
    let exportPath: string | undefined
    try {
      const cczPath = await this.cczCompiler.compile(hqJson, appName)
      exportPath = await this.appExporter.exportCcz(cczPath, appName)
      logger.log(`CCZ exported: ${exportPath}`)
    } catch (err: any) {
      logger.log(`WARNING: CCZ compilation failed: ${err.message}`)
    }

    return {
      success: true,
      appDefinition: { name: appName, files: {} },
      cczPath: exportPath,
      exportPath,
      hqJsonPath
    }
  }

  /** Best-effort app name extraction from the first user message in the conversation. */
  private inferAppName(context: string): string {
    const firstLine = context.split('\n').find(l => l.startsWith('User:'))
    if (firstLine) {
      let desc = firstLine.replace('User:', '').trim()
      desc = desc.replace(
        /^(I need|I want|Create|Build|Make|Generate|Design|Develop|Help me build|Help me create|Can you build|Can you create|Please create|Please build)\s+(a|an|the|me a|me an)?\s*/i,
        ''
      )
      const words = desc.split(/\s+/).slice(0, 5).join(' ')
      if (words.length > 3) {
        return words.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'CommCare App'
      }
    }
    return 'CommCare App'
  }
}
