import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LOG_DIR = join(homedir(), 'Documents', 'CommCare Forge', 'logs')

export class BuildLogger {
  private lines: string[] = []
  private appName: string
  private startTime: Date

  constructor(appName: string) {
    this.appName = appName
    this.startTime = new Date()
    this.log(`=== Build started: ${appName} ===`)
    this.log(`Time: ${this.startTime.toISOString()}`)
  }

  log(message: string): void {
    const elapsed = ((Date.now() - this.startTime.getTime()) / 1000).toFixed(1)
    this.lines.push(`[${elapsed}s] ${message}`)
  }

  logSection(title: string): void {
    this.lines.push('')
    this.lines.push(`--- ${title} ---`)
  }

  logErrors(source: string, errors: string[]): void {
    if (errors.length === 0) {
      this.log(`${source}: No errors`)
      return
    }
    this.log(`${source}: ${errors.length} error(s)`)
    for (const err of errors) {
      this.lines.push(`  ERROR: ${err}`)
    }
  }

  logFiles(files: Record<string, string>): void {
    const entries = Object.entries(files)
    this.log(`Files (${entries.length}):`)
    for (const [path, content] of entries) {
      this.lines.push(`  ${path} (${content.length} chars)`)
    }
  }

  logFileContents(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      this.lines.push('')
      this.lines.push(`=== FILE: ${path} ===`)
      this.lines.push(content)
    }
  }

  logAutoFixes(fixes: string[]): void {
    if (fixes.length === 0) {
      this.log('Auto-fixer: No fixes needed')
      return
    }
    this.log(`Auto-fixer: ${fixes.length} fix(es) applied`)
    for (const fix of fixes) {
      this.lines.push(`  FIX: ${fix}`)
    }
  }

  logCliResult(result: { success: boolean; skipped?: boolean; errors: string[]; stdout: string; stderr: string }): void {
    if (result.skipped) {
      this.log('CLI validation: SKIPPED')
      return
    }
    this.log(`CLI validation: ${result.success ? 'PASSED' : 'FAILED'}`)
    if (result.stdout.trim()) {
      this.lines.push(`  stdout: ${result.stdout.trim().substring(0, 2000)}`)
    }
    if (result.stderr.trim()) {
      this.lines.push(`  stderr: ${result.stderr.trim().substring(0, 2000)}`)
    }
    if (!result.success) {
      this.logErrors('CLI', result.errors)
    }
  }

  logHqResult(result: { success: boolean; errors: string[] }): void {
    this.log(`HQ validation: ${result.success ? 'PASSED' : 'FAILED'}`)
    if (!result.success) {
      this.logErrors('HQ', result.errors)
    }
  }

  /** Write the log to disk. Returns the file path. */
  save(): string {
    mkdirSync(LOG_DIR, { recursive: true })

    const endTime = new Date()
    const elapsed = ((endTime.getTime() - this.startTime.getTime()) / 1000).toFixed(1)
    this.lines.push('')
    this.log(`=== Build finished (${elapsed}s) ===`)

    // Filename: YYYY-MM-DD_HH-MM-SS_appname.txt
    const ts = this.startTime.toISOString().replace(/:/g, '-').replace(/\.\d+Z/, '').replace('T', '_')
    const safeName = this.appName.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 40)
    const filename = `${ts}_${safeName}.txt`
    const filePath = join(LOG_DIR, filename)

    writeFileSync(filePath, this.lines.join('\n'), 'utf8')
    return filePath
  }
}
