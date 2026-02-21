import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

// TODO: The exact HQ JSON import format needs to be reverse-engineered by downloading
// an app source from HQ at /a/{domain}/apps/source/{app_id}/ and examining the structure.
// For now, this exports a basic JSON structure that will need to be updated once the
// HQ format is investigated.

export class AppExporter {
  private exportDir: string

  constructor() {
    this.exportDir = join(homedir(), 'Documents', 'CommCare Forge', 'exports')
    mkdirSync(this.exportDir, { recursive: true })
  }

  async exportForHQ(appName: string, files: Record<string, string>): Promise<string> {
    const sanitizedName = appName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
    const exportPath = join(this.exportDir, `${sanitizedName}.json`)

    // TODO: Convert to proper HQ import format
    // For now, export a placeholder structure
    const hqFormat = {
      _note: 'This format needs to be updated to match HQ app source format',
      name: appName,
      files
    }

    writeFileSync(exportPath, JSON.stringify(hqFormat, null, 2), 'utf-8')
    return exportPath
  }

  async exportCcz(cczSourcePath: string, appName: string): Promise<string> {
    const { copyFileSync } = await import('fs')
    const sanitizedName = appName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
    const exportPath = join(this.exportDir, `${sanitizedName}.ccz`)
    copyFileSync(cczSourcePath, exportPath)
    return exportPath
  }

  getExportDir(): string {
    return this.exportDir
  }
}
