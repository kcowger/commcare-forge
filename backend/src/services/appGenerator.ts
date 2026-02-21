import type { AppDefinition, GenerationProgress, ValidationResult } from '../types'
import { ClaudeService } from './claude'
import { CczBuilder } from './cczBuilder'
import { CliValidator } from './cliValidator'
import { GENERATOR_PROMPT } from '../prompts/generator'
import { FIXER_PROMPT } from '../prompts/fixer'

export class AppGenerator {
  private claudeService: ClaudeService
  private cczBuilder: CczBuilder
  private cliValidator: CliValidator
  private maxRetries: number

  constructor(claudeService: ClaudeService, maxRetries: number = 5) {
    this.claudeService = claudeService
    this.cczBuilder = new CczBuilder()
    this.cliValidator = new CliValidator()
    this.maxRetries = maxRetries
  }

  async generate(
    appSummary: string,
    onProgress?: (progress: GenerationProgress) => void
  ): Promise<{ success: boolean; appDefinition?: AppDefinition; cczPath?: string; errors?: string[] }> {
    const report = (status: GenerationProgress['status'], message: string, attempt: number) => {
      if (onProgress) {
        onProgress({ status, message, attempt, maxAttempts: this.maxRetries })
      }
    }

    // Step 1: Generate
    report('generating', 'Generating app definition...', 1)
    let files = await this.callGenerate(appSummary)
    if (!files) {
      return { success: false, errors: ['Failed to parse generated app files from Claude response'] }
    }

    // Step 2: Validate and fix loop
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      report('validating', `Validating with CommCare engine (attempt ${attempt})...`, attempt)

      const cczPath = await this.cczBuilder.build(files, 'generated-app')
      const result = await this.cliValidator.validate(cczPath)

      if (result.success) {
        report('success', 'App validated successfully!', attempt)
        return {
          success: true,
          appDefinition: { name: 'Generated App', files },
          cczPath
        }
      }

      if (attempt >= this.maxRetries) {
        report('failed', `Validation failed after ${this.maxRetries} attempts`, attempt)
        return { success: false, errors: result.errors }
      }

      report('fixing', `Found ${result.errors.length} issues, fixing...`, attempt)
      const fixedFiles = await this.callFix(files, result)
      if (!fixedFiles) {
        report('failed', 'Failed to parse fixed app files from Claude response', attempt)
        return { success: false, errors: ['Failed to parse fixed files'] }
      }

      files = fixedFiles
    }

    return { success: false, errors: ['Exceeded max retry attempts'] }
  }

  private async callGenerate(appSummary: string): Promise<Record<string, string> | null> {
    const prompt = `${GENERATOR_PROMPT}\n\nApp specification:\n${appSummary}`
    const response = await this.claudeService.sendMessage(prompt)
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

    const prompt = `${FIXER_PROMPT}\n\n## Validation Errors\n${errorsStr}\n\n## CLI stdout\n${validationResult.stdout}\n\n## CLI stderr\n${validationResult.stderr}\n\n## Current App Files\n${filesStr}`

    const response = await this.claudeService.sendMessage(prompt)
    return this.parseFilesFromResponse(response)
  }

  private parseFilesFromResponse(response: string): Record<string, string> | null {
    // Look for JSON code block
    const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/)
    if (!jsonMatch) {
      // Try to find raw JSON
      const braceMatch = response.match(/\{[\s\S]*\}/)
      if (!braceMatch) return null
      try {
        return JSON.parse(braceMatch[0])
      } catch {
        return null
      }
    }

    try {
      return JSON.parse(jsonMatch[1])
    } catch {
      return null
    }
  }
}
