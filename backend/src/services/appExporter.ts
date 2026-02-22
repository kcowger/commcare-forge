import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

export class AppExporter {
  private exportDir: string

  constructor() {
    this.exportDir = join(homedir(), 'Documents', 'CommCare Forge', 'exports')
    mkdirSync(this.exportDir, { recursive: true })
  }

  async exportForHQ(appName: string, hqJson: Record<string, any>): Promise<string> {
    return this.exportForHQSync(appName, hqJson)
  }

  exportForHQSync(appName: string, hqJson: Record<string, any>): string {
    const sanitizedName = appName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim()
    const exportPath = join(this.exportDir, `${sanitizedName}.json`)
    writeFileSync(exportPath, JSON.stringify(hqJson, null, 2), 'utf-8')
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
