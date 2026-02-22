import AdmZip from 'adm-zip'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export class CczBuilder {
  async build(files: Record<string, string>, appName?: string): Promise<string> {
    const outputDir = join(tmpdir(), 'commcare-forge', randomUUID())
    mkdirSync(outputDir, { recursive: true })

    const cczFileName = `${(appName || 'app').replace(/[^a-zA-Z0-9-_]/g, '_')}.ccz`
    const cczPath = join(outputDir, cczFileName)

    const zip = new AdmZip()
    for (const [filePath, content] of Object.entries(files)) {
      zip.addFile(filePath, Buffer.from(content, 'utf-8'))
    }
    zip.writeZip(cczPath)

    return cczPath
  }
}
