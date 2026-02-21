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
    const report = (status: GenerationProgress['status'], message: string, attempt: number) => {
      if (onProgress) {
        onProgress({ status, message, attempt, maxAttempts: this.maxRetries })
      }
    }

    // Step 1: Generate
    report('generating', 'Generating app definition...', 0)
    let files = await this.callGenerate(conversationContext)
    if (!files) {
      report('failed', 'Failed to parse generated app files from Claude response', 0)
      return { success: false, errors: ['Failed to parse generated app files from Claude response'] }
    }

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

      if (result.success) {
        report('success', 'App validated successfully!', attempt)

        // Save exports
        const exportPath = await this.appExporter.exportCcz(cczPath, appName)

        return {
          success: true,
          appDefinition: { name: appName, files },
          cczPath: exportPath,
          exportPath
        }
      }

      if (attempt >= this.maxRetries) {
        // Save the .ccz even though validation failed — it may still be partially useful
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

      report('fixing', `Found ${result.errors.length} issue(s), fixing...`, attempt)
      const fixedFiles = await this.callFix(files, result)
      if (!fixedFiles) {
        // Can't parse the fix response — save what we have and bail
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

      files = fixedFiles
    }

    return { success: false, errors: ['Exceeded max retry attempts'] }
  }

  private async callGenerate(conversationContext: string): Promise<Record<string, string> | null> {
    const message = `Here is the full conversation with the user about the app they want:\n\n${conversationContext}\n\nBased on this conversation, generate the complete CommCare app files.`
    const response = await this.claudeService.sendOneShot(GENERATOR_PROMPT, message)
    return this.parseFilesFromResponse(response)
  }

  private async callFix(
    currentFiles: Record<string, string>,
    validationResult: ValidationResult
  ): Promise<Record<string, string> | null> {
    const filesStr = Object.entries(currentFiles)
      .map(([path, content]) => `--- ${path} ---\n${content}`)
      .join('\n\n')

    const errorsStr = validationResult.errors.join('\n')

    const message = `## Validation Errors\n${errorsStr}\n\n## CLI stdout\n${validationResult.stdout}\n\n## CLI stderr\n${validationResult.stderr}\n\n## Current App Files\n${filesStr}`

    const response = await this.claudeService.sendOneShot(FIXER_PROMPT, message)
    return this.parseFilesFromResponse(response)
  }

  private parseFilesFromResponse(response: string): Record<string, string> | null {
    // Look for JSON code block
    const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1])
      } catch {
        // fall through
      }
    }

    // Try to find raw JSON object
    const braceStart = response.indexOf('{')
    const braceEnd = response.lastIndexOf('}')
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(response.substring(braceStart, braceEnd + 1))
      } catch {
        return null
      }
    }

    return null
  }

  private inferAppName(context: string): string {
    // Try to extract a reasonable app name from the conversation
    const firstLine = context.split('\n').find(l => l.startsWith('User:'))
    if (firstLine) {
      const desc = firstLine.replace('User:', '').trim()
      // Take first few words
      const words = desc.split(/\s+/).slice(0, 5).join(' ')
      if (words.length > 3) {
        return words.replace(/[^a-zA-Z0-9\s-]/g, '').trim() || 'CommCare App'
      }
    }
    return 'CommCare App'
  }
}
