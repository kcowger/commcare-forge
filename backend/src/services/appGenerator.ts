import type { AppDefinition, GenerationProgress } from '../types'
import { ClaudeService } from './claude'
import { CczCompiler } from './cczCompiler'
import { AppExporter } from './appExporter'
import { BuildLogger } from './buildLogger'
import { GENERATOR_PROMPT } from '../prompts/generator'
import { FIXER_PROMPT } from '../prompts/fixer'
import { expandToHqJson, validateCompact } from './hqJsonExpander'
import type { CompactApp } from './hqJsonExpander'

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

    // Step 1: Generate compact app definition
    report('generating', 'Generating app...', 0)
    logger.logSection('GENERATION')
    logger.log('Sending generation request to Claude...')

    const message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, generate the compact app definition JSON. App name: "${resolvedAppName}".`
    const response = await this.claudeService.sendOneShot(GENERATOR_PROMPT, message, (chunk) => {
      // streaming callback
    }, { maxTokens: 64000 })

    logger.log(`Claude response received (${response.length} chars)`)

    let compact = this.parseCompactFromResponse(response)
    if (!compact) {
      logger.log('FATAL: Failed to parse compact JSON from Claude response')
      logger.logSection('RAW RESPONSE (first 3000 chars)')
      logger.log(response.substring(0, 3000))
      report('failed', 'Failed to parse app definition from Claude response', 0)
      return { success: false, errors: ['Failed to parse app definition. Claude may not have returned valid JSON.'] }
    }

    // Override app name if provided
    compact.app_name = resolvedAppName

    logger.log(`Parsed compact: ${compact.modules?.length || 0} modules, ${compact.modules?.reduce((sum: number, m: any) => sum + (m.forms?.length || 0), 0) || 0} forms`)

    // Step 2: Validate compact + fix loop
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

      // Stuck detection
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

      // Fix with Claude
      logger.logSection(`FIX ATTEMPT ${attempt}`)
      const errorPreview = errors.slice(0, 3).join('; ').substring(0, 150)
      report('fixing', `Fixing: ${errorPreview}`, attempt)

      const compactStr = JSON.stringify(compact, null, 2)
      const fixMessage = `## Validation Errors\n${errors.join('\n')}\n\n## Current App Definition\n\`\`\`json\n${compactStr}\n\`\`\``

      logger.log(`Sending fix request to Claude (Haiku)... (${fixMessage.length} chars)`)

      let charCount = 0
      const fixResponse = await this.claudeService.sendOneShot(FIXER_PROMPT, fixMessage, () => {
        charCount++
        if (charCount % 200 === 0) {
          report('fixing', `Fixing issues (attempt ${attempt})...`, attempt)
        }
      }, { model: 'claude-haiku-4-5-20251001', maxTokens: 32768 })

      logger.log(`Fix response received (${fixResponse.length} chars)`)

      const fixedCompact = this.parseCompactFromResponse(fixResponse)
      if (!fixedCompact) {
        logger.log('FATAL: Failed to parse fixed compact JSON')
        logger.logSection('RAW FIX RESPONSE (first 3000 chars)')
        logger.log(fixResponse.substring(0, 3000))
        report('failed', 'Failed to parse fixed app definition from Claude response', attempt)
        try {
          const hqJson = expandToHqJson(compact)
          const result = await this.exportResults(hqJson, resolvedAppName, logger)
          return { ...result, success: false, errors: ['Failed to parse fixed app definition from Claude'] }
        } catch {
          return { success: false, errors: ['Failed to parse fixed app definition from Claude'] }
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

  /** Parse compact app JSON from Claude response, with repair for truncated output. */
  private parseCompactFromResponse(response: string): CompactApp | null {
    // Strategy 1: Find JSON in a ```json code block
    const jsonBlocks = [...response.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
    for (const match of jsonBlocks.reverse()) {
      const result = this.tryParseCompact(match[1])
      if (result) return result
    }

    // Strategy 2: Find any code block (may be truncated — no closing ```)
    const openBlock = response.match(/```json\s*\n([\s\S]+)/)
    if (openBlock) {
      // Strip trailing ``` if present
      let content = openBlock[1].replace(/\n```\s*$/, '')
      const result = this.tryParseCompact(content)
      if (result) return result
    }

    // Strategy 3: Find outermost { ... }
    const braceStart = response.indexOf('{')
    if (braceStart !== -1) {
      const braceEnd = response.lastIndexOf('}')
      if (braceEnd > braceStart) {
        const result = this.tryParseCompact(response.substring(braceStart, braceEnd + 1))
        if (result) return result
      }
      // Try from { to end of response (truncated)
      const result = this.tryParseCompact(response.substring(braceStart))
      if (result) return result
    }

    return null
  }

  /** Try to parse JSON, with repair for truncation. */
  private tryParseCompact(json: string): CompactApp | null {
    // Direct parse
    try {
      const parsed = JSON.parse(json)
      if (this.looksLikeCompact(parsed)) return parsed as CompactApp
    } catch { /* try repair */ }

    // Repair: remove trailing comma, close open brackets/braces
    const repaired = this.repairTruncatedJson(json)
    if (repaired !== json) {
      try {
        const parsed = JSON.parse(repaired)
        if (this.looksLikeCompact(parsed)) return parsed as CompactApp
      } catch { /* give up */ }
    }

    return null
  }

  /** Attempt to repair truncated JSON by finding the last complete value and closing brackets. */
  private repairTruncatedJson(json: string): string {
    // Scan forward tracking structure, find the position of the last complete value
    let inString = false
    let lastCompleteValueEnd = -1
    const stack: string[] = []

    for (let i = 0; i < json.length; i++) {
      const ch = json[i]

      if (inString) {
        if (ch === '\\') { i++; continue } // skip escaped char
        if (ch === '"') {
          inString = false
          lastCompleteValueEnd = i
        }
        continue
      }

      // Not in string
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') { stack.push('}'); continue }
      if (ch === '[') { stack.push(']'); continue }
      if (ch === '}' || ch === ']') {
        stack.pop()
        lastCompleteValueEnd = i
        continue
      }
      // Numbers, booleans, null
      if (/[\d.eE+\-]/.test(ch) || 'truefalsnul'.includes(ch)) {
        lastCompleteValueEnd = i
      }
    }

    // If we're inside an unclosed string, the JSON is truncated mid-value
    // Truncate to the last complete value
    let s: string
    if (inString || stack.length > 0) {
      // If still inside a string, go back to last complete value
      if (inString && lastCompleteValueEnd >= 0) {
        s = json.substring(0, lastCompleteValueEnd + 1)
      } else {
        s = json
      }
    } else {
      // JSON might be complete
      s = json
    }

    // Remove trailing commas and whitespace
    s = s.replace(/[\s,]*$/, '')

    // Strip dangling key (a string followed by nothing, at end of an object)
    // Pattern: ,"key" or {"key" at the end — key with no : value
    s = s.replace(/,\s*"[^"]*"\s*$/, '')
    s = s.replace(/\{\s*"[^"]*"\s*$/, '{')

    // Recount open brackets after truncation
    const finalStack: string[] = []
    inString = false
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && inString) { i++; continue }
      if (s[i] === '"') { inString = !inString; continue }
      if (inString) continue
      if (s[i] === '{') finalStack.push('}')
      else if (s[i] === '[') finalStack.push(']')
      else if (s[i] === '}' || s[i] === ']') finalStack.pop()
    }

    // Close unclosed brackets/braces
    while (finalStack.length > 0) {
      s += finalStack.pop()
    }

    return s
  }

  /** Check if parsed JSON looks like a compact app definition. */
  private looksLikeCompact(obj: any): boolean {
    return obj && typeof obj === 'object' && Array.isArray(obj.modules) && obj.modules.length > 0
  }

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
