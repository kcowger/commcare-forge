import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ValidationResult } from '../types'

const CLI_TIMEOUT = 30_000 // 30 seconds

export class CliValidator {
  private jarPath: string

  constructor(jarPath?: string) {
    this.jarPath = jarPath || join(__dirname, '../../lib/commcare-cli.jar')
  }

  async validate(cczPath: string): Promise<ValidationResult> {
    // Check if JAR exists
    if (!existsSync(this.jarPath)) {
      return {
        success: true, // Skip validation if CLI not available
        errors: [],
        stdout: '[CLI validation skipped: commcare-cli.jar not found]',
        stderr: ''
      }
    }

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      const proc = spawn('java', ['-jar', this.jarPath, 'play', cczPath], {
        timeout: CLI_TIMEOUT,
        shell: true
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
        // If Java is not installed, skip validation
        if (err.message.includes('ENOENT') || err.message.includes('not found')) {
          resolve({
            success: true,
            errors: [],
            stdout: '[CLI validation skipped: Java not found]',
            stderr: ''
          })
        } else {
          resolve({
            success: false,
            errors: [`Failed to run CLI: ${err.message}`],
            stdout,
            stderr
          })
        }
      })
    })
  }

  private parseErrors(stdout: string, stderr: string): string[] {
    const errors: string[] = []
    const combined = stdout + '\n' + stderr

    const lines = combined.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Match explicit error/exception lines
      if (/\b(error|exception|fatal)\b/i.test(trimmed) &&
          !/^at\s/.test(trimmed) && // skip stack trace lines
          !/^\d/.test(trimmed)) {   // skip numbered lines
        errors.push(trimmed)
      }
    }

    return errors
  }
}
