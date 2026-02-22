import { spawn } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import type { ValidationResult } from '../types'

const CLI_TIMEOUT = 60_000 // 60 seconds

// Common Java install locations on Windows
const JAVA_SEARCH_PATHS = [
  'java',
  'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.18.8-hotspot\\bin\\java.exe',
  'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.18.8-hotspot\\bin\\java',
  'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
  'C:\\Program Files\\Java\\jdk-17\\bin\\java',
]

function findJava(): string | null {
  // Check JAVA_HOME first
  const javaHome = process.env.JAVA_HOME
  if (javaHome) {
    const javaExe = join(javaHome, 'bin', 'java.exe')
    if (existsSync(javaExe)) return javaExe
    const java = join(javaHome, 'bin', 'java')
    if (existsSync(java)) return java
  }

  // Check known paths
  for (const p of JAVA_SEARCH_PATHS) {
    if (p === 'java') continue
    if (existsSync(p)) return p
  }

  // Fall back to 'java' on PATH
  return 'java'
}

export class CliValidator {
  private jarPath: string

  constructor(jarPath?: string) {
    this.jarPath = jarPath || join(__dirname, '../../lib/commcare-cli.jar')
  }

  async validate(cczPath: string): Promise<ValidationResult> {
    if (!existsSync(this.jarPath)) {
      return {
        success: true,
        skipped: true,
        skipReason: 'commcare-cli.jar not found. Place commcare-cli.jar in the lib/ directory.',
        errors: [],
        stdout: '',
        stderr: ''
      }
    }

    const javaCmd = findJava()

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      const proc = spawn(javaCmd, ['-jar', this.jarPath, 'validate', cczPath], {
        timeout: CLI_TIMEOUT,
        windowsHide: true
      })

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        // Trust the exit code as the primary signal
        // code === 0 means the CLI validated successfully
        if (code === 0) {
          resolve({
            success: true,
            skipped: false,
            errors: [],
            stdout,
            stderr
          })
          return
        }

        // Non-zero exit code means validation failed — extract useful errors
        const errors = this.parseErrors(stdout, stderr, code)
        resolve({
          success: false,
          skipped: false,
          errors,
          stdout,
          stderr
        })
      })

      proc.on('error', (err) => {
        if (err.message.includes('ENOENT') || err.message.includes('not found')) {
          resolve({
            success: true,
            skipped: true,
            skipReason: 'Java not found. Install Java 17+ to enable validation.',
            errors: [],
            stdout: '',
            stderr: ''
          })
        } else {
          resolve({
            success: false,
            skipped: false,
            errors: [`Failed to run CLI: ${err.message}`],
            stdout,
            stderr
          })
        }
      })
    })
  }

  private parseErrors(stdout: string, stderr: string, exitCode: number | null): string[] {
    const errors: string[] = []
    const combined = stdout + '\n' + stderr

    const lines = combined.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Skip stack trace lines
      if (/^at\s/.test(trimmed)) continue
      if (/^\.{3}\s\d+\smore/.test(trimmed)) continue

      // Capture actual error/exception messages
      if (/\b(error|exception|fatal)\b/i.test(trimmed) &&
          // Skip lines that are just class names or package paths
          !/^[a-z]+(\.[a-z]+)+$/i.test(trimmed)) {
        errors.push(trimmed)
      }
    }

    // If we didn't extract any specific errors but exit code was non-zero,
    // include the raw output so the user can see what happened
    if (errors.length === 0 && exitCode !== 0) {
      const meaningful = combined.trim()
      if (meaningful) {
        errors.push(`CLI exited with code ${exitCode}. Output:\n${meaningful.substring(0, 1000)}`)
      } else {
        errors.push(`CLI validation failed with exit code ${exitCode} (no output)`)
      }
    }

    return errors
  }
}
