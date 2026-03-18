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
import { CliValidator, checkJavaAvailable } from './cliValidator'
import { BuildLogger } from './buildLogger'
import { GENERATOR_TOOL_USE_PROMPT } from '../prompts/generatorToolUse'
import { FIXER_TOOL_USE_PROMPT } from '../prompts/fixerToolUse'
import { getCompactAppJsonSchema } from '../schemas/compactApp'
import { expandToHqJson, validateCompact } from './hqJsonExpander'
import { parseXml } from '../utils/xmlBuilder'
import { RESERVED_CASE_PROPERTIES } from '../constants/reservedCaseProperties'
import type { CompactApp } from '../schemas/compactApp'
import { app } from 'electron'

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
  private lastCompact: CompactApp | null = null

  constructor(claudeService: ClaudeService) {
    this.claudeService = claudeService
    this.cczCompiler = new CczCompiler()
    this.appExporter = new AppExporter()
  }

  /** Get the last successfully generated compact JSON (for inline editing). */
  getLastCompact(): CompactApp | null {
    return this.lastCompact
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

    // If we have a previous build, pass it to Claude so it can edit rather than regenerate from scratch.
    // This makes small changes much more reliable — Claude modifies the existing structure instead of
    // re-inventing it from the conversation history.
    let message: string
    if (this.lastCompact) {
      const prevJson = JSON.stringify(this.lastCompact, null, 2)
      message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nHere is the CURRENT app definition that was previously generated:\n\`\`\`json\n${prevJson}\n\`\`\`\n\nBased on the conversation (especially the most recent messages), update the app definition. Preserve everything that doesn't need to change. App name: "${resolvedAppName}".`
      logger.log('Using previous compact JSON as starting point for edit')
    } else {
      message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, generate the compact app definition. App name: "${resolvedAppName}".`
    }

    let compact: CompactApp
    try {
      // Parse streaming JSON to show real-time progress as Claude builds each module/form
      let streamBuffer = ''
      const seenNames = new Set<string>()
      const onStreamChunk = (chunk: string) => {
        streamBuffer += chunk
        // Extract "name": "..." patterns from the stream to show what's being built
        const nameMatches = streamBuffer.match(/"name"\s*:\s*"([^"]+)"/g)
        if (nameMatches) {
          const latest = nameMatches[nameMatches.length - 1].match(/"name"\s*:\s*"([^"]+)"/)
          if (latest && !seenNames.has(latest[1])) {
            seenNames.add(latest[1])
            report('generating', `Building: ${latest[1]}...`, 0)
          }
        }
      }

      compact = await this.claudeService.sendOneShotWithTool<CompactApp>(
        GENERATOR_TOOL_USE_PROMPT, message, SUBMIT_TOOL,
        onStreamChunk,
        { maxTokens: 64000 }
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
    // Every validation error (compact, expansion, HQ JSON, CLI) routes through
    // this loop. Claude gets the errors and returns a fixed compact JSON.
    // We track error signatures to detect when the fixer is stuck.
    const recentErrorSignatures: string[] = []
    const MAX_STUCK_REPEATS = 3
    let attempt = 0

    while (true) {
      attempt++
      logger.logSection(`VALIDATION ATTEMPT ${attempt}`)
      report('validating', `Validating app definition (attempt ${attempt})...`, attempt)

      // Phase 1: Compact format validation
      const errors = validateCompact(compact)
      logger.log(`Compact validation: ${errors.length} error(s)`)
      for (const err of errors) logger.log(`  ERROR: ${err}`)

      // Phase 2: Expansion + HQ JSON validation (only if compact is clean)
      if (errors.length === 0) {
        report('generating', 'Expanding to HQ format...', attempt)

        // Wrap expansion in try/catch — malformed compact can crash the expander
        let hqJson: Record<string, any>
        try {
          hqJson = expandToHqJson(compact)
        } catch (expandErr: any) {
          const msg = expandErr.message?.substring(0, 200) || 'expansion crash'
          logger.log(`Expansion failed: ${msg}`)
          errors.push(`Expansion error: ${msg}`)
          // Fall through to fix loop
          hqJson = null as any
        }

        if (hqJson && errors.length === 0) {
          // Run HQ JSON validation (XML well-formedness, reserved words, structure)
          const hqErrors = this.validateHqJson(hqJson)
          if (hqErrors.length > 0) {
            logger.log(`HQ validation found ${hqErrors.length} issue(s):`)
            for (const err of hqErrors) logger.log(`  HQ ERROR: ${err}`)
            errors.push(...hqErrors)
          }
        }

        // Phase 3: CLI validation (only if everything else passed)
        if (hqJson && errors.length === 0) {
          report('validating', 'Running CommCare CLI validation...', attempt)
          const cliErrors = await this.runCliValidation(hqJson, resolvedAppName, logger)
          if (cliErrors.length > 0) {
            logger.log(`CLI validation found ${cliErrors.length} issue(s):`)
            for (const err of cliErrors) logger.log(`  CLI ERROR: ${err}`)
            errors.push(...cliErrors)
          }
        }

        // All validations passed — export
        if (hqJson && errors.length === 0) {
          logger.log('RESULT: SUCCESS — all validations passed')
          // Store the validated compact JSON for future inline editing
          this.lastCompact = compact
          report('success', 'App generated and validated!', attempt)
          return await this.exportResults(hqJson, resolvedAppName, logger)
        }
      }

      // Stuck detection: hash errors into a signature, keep a sliding window of
      // the last N signatures. If all N are identical, the fixer isn't making progress.
      const sig = errors.slice().sort().join('|||')
      recentErrorSignatures.push(sig)
      if (recentErrorSignatures.length > MAX_STUCK_REPEATS) recentErrorSignatures.shift()
      if (recentErrorSignatures.length === MAX_STUCK_REPEATS && recentErrorSignatures.every(s => s === sig)) {
        logger.log(`RESULT: FAILED — same errors repeated ${MAX_STUCK_REPEATS} times`)
        report('failed', `Unable to resolve: ${errors[0]?.substring(0, 200)}`, attempt)
        // Still try to export what we have so user can inspect
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
          { model: 'claude-haiku-4-5-20251001', maxTokens: 32768 }
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

  /**
   * Validate HQ JSON using the same checks CommCare HQ runs on "Make New Version".
   * Source: commcare-hq/corehq/apps/app_manager/validators.py
   *
   * Checks: XML well-formedness, reserved words, property name format,
   * case_name required, subcase types, preload values, form structure.
   */
  private validateHqJson(json: any): string[] {
    const errors: string[] = []

    // HQ property name validation regex (from validators.py validate_property)
    const VALID_PROPERTY = /^[a-zA-Z][\w_-]*$/

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
        errors.push(`"${modName}" uses cases but doesn't have a case_type defined`)
      }

      // HQ rejects modules with no forms and no case list
      if (forms.length === 0 && !mod.case_type) {
        errors.push(`"${modName}" has no forms or case list — add forms or set a case_type`)
      }
      if (forms.length === 0 && mod.case_type && !mod.case_list?.show) {
        errors.push(`"${modName}" has no forms and case list is not enabled — case-list-only modules need show: true`)
      }

      for (let fIdx = 0; fIdx < forms.length; fIdx++) {
        const form = forms[fIdx]
        const formName = form.name?.en || `Form ${fIdx}`

        // --- Form structure checks ---
        if (!form.unique_id) {
          errors.push(`"${formName}" in "${modName}" has no unique_id`)
        } else {
          const attachKey = `${form.unique_id}.xml`
          if (!attachments[attachKey]) {
            errors.push(`"${formName}" in "${modName}": no _attachment for unique_id "${form.unique_id}"`)
          } else {
            const xform = attachments[attachKey]

            // Parse XForm XML — same as HQ's _parse_xml()
            try {
              parseXml(xform)
            } catch (e: any) {
              errors.push(`"${formName}" Error parsing XML: ${e.message?.substring(0, 150) || 'parse error'}`)
            }

            // Check for double XML declaration (causes CLI and HQ parse failures)
            if (/^(<\?xml[^?]*\?>\s*){2,}/.test(xform)) {
              errors.push(`"${formName}" XForm has duplicate XML declaration`)
            }

            if (!/<itext>/.test(xform)) {
              errors.push(`"${formName}" XForm is missing <itext> block`)
            }

            if (/<label>[^<]+<\/label>/.test(xform)) {
              errors.push(`"${formName}" XForm has inline labels — must use jr:itext() references`)
            }

            // Check for unescaped < > in XML attributes (breaks HQ XML parser)
            const badAttrs = xform.match(/(?:id|ref)="[^"]*[<>][^"]*"/g)
            if (badAttrs) {
              errors.push(`"${formName}" XForm has unescaped < > in attribute: ${badAttrs[0]}`)
            }
          }
        }

        if (!form.xmlns) {
          errors.push(`"${formName}" in "${modName}" has no xmlns`)
        }

        // --- Case action checks (from HQ's check_actions + check_case_properties) ---
        const actions = form.actions || {}

        // HQ check: open_case must have name_update.question_path
        if (actions.open_case?.condition?.type === 'always') {
          if (!actions.open_case.name_update?.question_path) {
            errors.push(`"${formName}" opens a case but has no case name question path`)
          }
        }

        // Collect ALL property names for reserved word + format check
        // (mirrors HQ's form.actions.all_property_names())
        const allPropertyNames: string[] = []

        // update_case properties
        if (actions.update_case?.condition?.type === 'always' && actions.update_case?.update) {
          allPropertyNames.push(...Object.keys(actions.update_case.update))
        }

        // open_case properties (if any custom properties beyond name)
        if (actions.open_case?.condition?.type === 'always' && actions.open_case?.update) {
          allPropertyNames.push(...Object.keys(actions.open_case.update))
        }

        // Check each property name: reserved words + format validation
        for (const prop of allPropertyNames) {
          if (RESERVED_CASE_PROPERTIES.has(prop)) {
            errors.push(`Case Update uses reserved word "${prop}" in "${formName}" Form in the "${modName}" Menu`)
          }
          if (!VALID_PROPERTY.test(prop)) {
            errors.push(`Case Update uses illegal property name "${prop}" in "${formName}" — must start with letter, only letters/digits/underscores/hyphens`)
          }
        }

        // Preload values — HQ rejects case_name, case_type, case_id as preload sources
        if (actions.case_preload?.condition?.type === 'always' && actions.case_preload?.preload) {
          for (const caseProp of Object.values(actions.case_preload.preload) as string[]) {
            if (caseProp === 'case_name' || caseProp === 'case_type' || caseProp === 'case_id') {
              errors.push(`"${formName}" case preload uses "${caseProp}" — use "${caseProp === 'case_name' ? 'name' : caseProp === 'case_id' ? '@case_id' : caseProp}" instead`)
            }
          }
        }

        // Subcase checks (from HQ's check_actions for subcases)
        if (actions.subcases) {
          for (let sIdx = 0; sIdx < actions.subcases.length; sIdx++) {
            const sc = actions.subcases[sIdx]
            if (!sc.case_type) {
              errors.push(`"${formName}" subcase ${sIdx} has no case type`)
            }
            if (sc.case_properties) {
              for (const prop of Object.keys(sc.case_properties)) {
                if (RESERVED_CASE_PROPERTIES.has(prop)) {
                  errors.push(`"${formName}" subcase uses reserved word "${prop}"`)
                }
                if (!VALID_PROPERTY.test(prop)) {
                  errors.push(`"${formName}" subcase uses illegal property name "${prop}"`)
                }
              }
            }
          }
        }
      }
    }

    // --- App-level checks ---

    // No modules
    if (modules.length === 0) {
      errors.push('Application has no modules')
    }

    // Empty language codes
    const langs = json.langs || []
    for (const lang of langs) {
      if (!lang || !lang.trim()) {
        errors.push('Application has an empty language code')
      }
    }

    // Duplicate XMLNS across forms
    const allXmlns = new Set<string>()
    for (const mod of modules) {
      for (const form of mod.forms || []) {
        if (form.xmlns) {
          if (allXmlns.has(form.xmlns)) {
            errors.push(`Duplicate xmlns "${form.xmlns}" found across forms — each form must have a unique xmlns`)
          }
          allXmlns.add(form.xmlns)
        }
      }
    }

    // Case type consistency: every case_type used in followup forms must have
    // a registration form somewhere in the app
    const registeredCaseTypes = new Set<string>()
    const followupCaseTypes = new Map<string, string>() // case_type → first form name that uses it
    for (const mod of modules) {
      const ct = mod.case_type || ''
      for (const form of mod.forms || []) {
        const fname = form.name?.en || 'Unknown'
        const actions = form.actions || {}
        if (actions.open_case?.condition?.type === 'always' && ct) {
          registeredCaseTypes.add(ct)
        }
        if (form.requires === 'case' && ct && !followupCaseTypes.has(ct)) {
          followupCaseTypes.set(ct, fname)
        }
      }
    }
    // Also count subcases as registered types
    for (const mod of modules) {
      for (const form of mod.forms || []) {
        for (const sc of form.actions?.subcases || []) {
          if (sc.case_type && sc.condition?.type === 'always') {
            registeredCaseTypes.add(sc.case_type)
          }
        }
      }
    }
    for (const [ct, fname] of followupCaseTypes) {
      if (!registeredCaseTypes.has(ct)) {
        errors.push(`Case type "${ct}" for form "${fname}" does not exist — no registration form creates this case type`)
      }
    }

    return errors
  }

  /** Run CommCare CLI validator on the compiled CCZ. Returns errors (empty = pass). */
  private async runCliValidation(hqJson: any, appName: string, logger: BuildLogger): Promise<string[]> {
    try {
      const javaCheck = await checkJavaAvailable()
      if (!javaCheck.available) {
        logger.log('CLI validation skipped — Java not available')
        return []
      }

      // Compile a temporary CCZ for validation
      const cczResult = await this.cczCompiler.compile(hqJson, appName)
      const userDataDir = app?.getPath?.('userData') || ''
      const validator = new CliValidator(userDataDir)
      const result = await validator.validate(cczResult.cczPath)

      if (result.skipped) {
        logger.log(`CLI validation skipped: ${result.skipReason}`)
        return []
      }

      if (result.success) {
        logger.log('CLI validation passed')
        return []
      }

      return result.errors
    } catch (err: any) {
      logger.log(`CLI validation error: ${err.message}`)
      // Don't fail the build if CLI itself crashes — it's an extra safety net
      return []
    }
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
      const cczResult = await this.cczCompiler.compile(hqJson, appName)
      exportPath = await this.appExporter.exportCcz(cczResult.cczPath, appName)
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
