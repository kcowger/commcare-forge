import archiver from 'archiver'
import { createWriteStream, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

export class CczBuilder {
  async build(files: Record<string, string>, appName?: string): Promise<string> {
    const outputDir = join(tmpdir(), 'commcare-forge', randomUUID())
    mkdirSync(outputDir, { recursive: true })

    const cczFileName = `${(appName || 'app').replace(/[^a-zA-Z0-9-_]/g, '_')}.ccz`
    const cczPath = join(outputDir, cczFileName)

    return new Promise((resolve, reject) => {
      const output = createWriteStream(cczPath)
      const archive = archiver('zip', { zlib: { level: 9 } })

      output.on('close', () => resolve(cczPath))
      archive.on('error', (err) => reject(err))

      archive.pipe(output)

      for (const [filePath, content] of Object.entries(files)) {
        archive.append(content, { name: filePath })
      }

      archive.finalize()
    })
  }
}
