import type { AppDefinition, GenerationProgress, ValidationResult } from '../types'
import { ClaudeService } from './claude'
import { CczBuilder } from './cczBuilder'
import { CliValidator } from './cliValidator'
import { AppExporter } from './appExporter'
import { GENERATOR_PROMPT } from '../prompts/generator'
import { FIXER_PROMPT } from '../prompts/fixer'

export class AppGenerator {
  private claudeService: ClaudeService
  private cczBuilder: CczBuilder
  private cliValidator: CliValidator
  private appExporter: AppExporter
  private maxRetries: number

  constructor(claudeService: ClaudeService, maxRetries: number = 5) {
    this.claudeService = claudeService
    this.cczBuilder = new CczBuilder()
    this.cliValidator = new CliValidator()
    this.appExporter = new AppExporter()
    this.maxRetries = maxRetries
  }

  async generate(
    conversationContext: string,
    onProgress?: (progress: GenerationProgress) => void
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; exportPath?: string; errors?: string[] }> {
    const report = (status: GenerationProgress['status'], message: string, attempt: number, filesDetected?: string[]) => {
      if (onProgress) {
        onProgress({ status, message, attempt, maxAttempts: this.maxRetries, filesDetected })
      }
    }

    // Step 1: Generate with streaming progress and file detection
    let streamBuffer = ''
    const filesDetected: string[] = []
    report('generating', 'Generating app definition...', 0)

    const message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, generate the complete CommCare app files.`
    const response = await this.claudeService.sendOneShot(GENERATOR_PROMPT, message, (chunk) => {
      streamBuffer += chunk
      // Detect file names as they appear in the JSON stream (e.g. "profile.xml":)
      const filePattern = /"([^"]+\.xml)":/g
      let match
      while ((match = filePattern.exec(streamBuffer)) !== null) {
        const fileName = match[1]
        if (!filesDetected.includes(fileName)) {
          filesDetected.push(fileName)
          report('generating', `Generating ${fileName}...`, 0, filesDetected)
        }
      }
    })

    const files = this.parseFilesFromResponse(response)
    if (!files) {
      report('failed', 'Failed to parse generated app files from Claude response', 0)
      return { success: false, errors: ['Failed to parse app files. Claude may not have returned valid JSON.'] }
    }

    const fileCount = Object.keys(files).length
    report('generating', `Parsed ${fileCount} files, packaging...`, 0)

    const appName = this.inferAppName(conversationContext)

    // Step 2: Validate and fix loop
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      report('validating', `Validating with CommCare engine (attempt ${attempt}/${this.maxRetries})...`, attempt)

      let cczPath: string
      try {
        cczPath = await this.cczBuilder.build(files, appName)
      } catch (err: any) {
        report('failed', `Failed to build .ccz: ${err.message}`, attempt)
        return { success: false, errors: [`CCZ build error: ${err.message}`] }
      }

      const result = await this.cliValidator.validate(cczPath)

      if (result.skipped) {
        const msg = `App generated successfully (${fileCount} files). Validation skipped — install Java 17+ and commcare-cli.jar to enable.`
        report('success', msg, attempt)
        const exportPath = await this.appExporter.exportCcz(cczPath, appName)
        return {
          success: true,
          appDefinition: { name: appName, files },
          cczPath: exportPath,
          exportPath
        }
      }

      if (result.success) {
        report('success', 'App validated successfully!', attempt)
        const exportPath = await this.appExporter.exportCcz(cczPath, appName)
        return {
          success: true,
          appDefinition: { name: appName, files },
          cczPath: exportPath,
          exportPath
        }
      }

      if (attempt >= this.maxRetries) {
        const exportPath = await this.appExporter.exportCcz(cczPath, appName)
        report('failed', `Validation failed after ${this.maxRetries} attempts. App saved with issues.`, attempt)
        return {
          success: false,
          appDefinition: { name: appName, files },
          cczPath: exportPath,
          exportPath,
          errors: result.errors
        }
      }

      // Fix attempt with streaming
      charCount = 0
      report('fixing', `Found ${result.errors.length} issue(s), fixing...`, attempt)

      const filesStr = Object.entries(files)
        .map(([path, content]) => `--- ${path} ---\n${content}`)
        .join('\n\n')
      const errorsStr = result.errors.join('\n')
      const fixMessage = `## Validation Errors\n${errorsStr}\n\n## CLI stdout\n${result.stdout}\n\n## CLI stderr\n${result.stderr}\n\n## Current App Files\n${filesStr}`

      const fixResponse = await this.claudeService.sendOneShot(FIXER_PROMPT, fixMessage, () => {
        charCount++
        if (charCount % 200 === 0) {
          report('fixing', `Fixing issues... (${Math.round(charCount / 1000)}k chars received)`, attempt)
        }
      })

      const fixedFiles = this.parseFilesFromResponse(fixResponse)
      if (!fixedFiles) {
        const exportPath = await this.appExporter.exportCcz(cczPath, appName)
        report('failed', 'Failed to parse fixed app files from Claude response', attempt)
        return {
          success: false,
          appDefinition: { name: appName, files },
          cczPath: exportPath,
          exportPath,
          errors: ['Failed to parse fixed files from Claude']
        }
      }

      Object.assign(files, fixedFiles)
    }

    return { success: false, errors: ['Exceeded max retry attempts'] }
  }

  private parseFilesFromResponse(response: string): Record<string, string> | null {
    // Strategy 1: Find JSON in a ```json code block (greedy match for largest block)
    const jsonBlocks = [...response.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
    for (const match of jsonBlocks.reverse()) { // try largest/last match first
      try {
        const parsed = JSON.parse(match[1])
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          return parsed
        }
      } catch {
        // try next
      }
    }

    // Strategy 2: Find any ``` code block that looks like JSON
    const codeBlocks = [...response.matchAll(/```\w*\s*\n([\s\S]*?)\n```/g)]
    for (const match of codeBlocks.reverse()) {
      const content = match[1].trim()
      if (content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content)
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed
          }
        } catch {
          // try next
        }
      }
    }

    // Strategy 3: Find the outermost { ... } in the response
    let depth = 0
    let start = -1
    for (let i = 0; i < response.length; i++) {
      if (response[i] === '{') {
        if (depth === 0) start = i
        depth++
      } else if (response[i] === '}') {
        depth--
        if (depth === 0 && start !== -1) {
          const candidate = response.substring(start, i + 1)
          try {
            const parsed = JSON.parse(candidate)
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              // Check it looks like file paths -> content
              const keys = Object.keys(parsed)
              if (keys.some(k => k.endsWith('.xml'))) {
                return parsed
              }
            }
          } catch {
            // continue scanning
          }
        }
      }
    }

    // Strategy 4: Last resort — find largest { ... } substring
    const braceStart = response.indexOf('{')
    const braceEnd = response.lastIndexOf('}')
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        const parsed = JSON.parse(response.substring(braceStart, braceEnd + 1))
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed
        }
      } catch {
        return null
      }
    }

    return null
  }

  private inferAppName(context: string): string {
    const firstLine = context.split('\n').find(l => l.startsWith('User:'))
    if (firstLine) {
      const desc = firstLine.replace('User:', '').trim()
      const words = desc.split(/\s+/).slice(0, 5).join(' ')
      if (words.length > 3) {
        return words.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'CommCare App'
      }
    }
    return 'CommCare App'
  }
}
