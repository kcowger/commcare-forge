import { spawn } from 'child_process'
import { join } from 'path'
import type { ValidationResult } from '../types'

const CLI_TIMEOUT = 30_000 // 30 seconds

export class CliValidator {
  private jarPath: string

  constructor(jarPath?: string) {
    this.jarPath = jarPath || join(__dirname, '../../lib/commcare-cli.jar')
  }

  async validate(cczPath: string): Promise<ValidationResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      const proc = spawn('java', ['-jar', this.jarPath, 'play', cczPath], {
        timeout: CLI_TIMEOUT
      })

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const errors = this.parseErrors(stdout, stderr)
        resolve({
          success: errors.length === 0 && code === 0,
          errors,
          stdout,
          stderr
        })
      })

      proc.on('error', (err) => {
        resolve({
          success: false,
          errors: [`Failed to run CLI: ${err.message}`],
          stdout,
          stderr
        })
      })
    })
  }

  private parseErrors(stdout: string, stderr: string): string[] {
    const errors: string[] = []
    const combined = stdout + '\n' + stderr

    // Look for common error patterns in CLI output
    const errorPatterns = [
      /error:/gi,
      /exception:/gi,
      /fatal:/gi,
      /malformed/gi,
      /invalid/gi,
      /missing/gi,
      /failed to/gi
    ]

    const lines = combined.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      for (const pattern of errorPatterns) {
        if (pattern.test(trimmed)) {
          errors.push(trimmed)
          break
        }
      }
    }

    return errors
  }
}
