import fs from 'fs'
import path from 'path'
import { Writable } from 'stream'

const GITHUB_API_URL = 'https://api.github.com/repos/dimagi/commcare-core/releases/latest'
const JAR_FILENAME = 'commcare-cli.jar'
const TMP_FILENAME = '.commcare-cli.jar.tmp'
const API_TIMEOUT = 15_000
const DOWNLOAD_TIMEOUT = 120_000

export class CliJarUpdater {
  constructor(
    private targetDir: string,
    private getCurrentVersion: () => string,
    private setVersion: (version: string) => void
  ) {}

  async checkAndUpdate(): Promise<void> {
    try {
      const release = await this.fetchLatestRelease()
      if (!release) return

      const currentVersion = this.getCurrentVersion()
      if (release.tagName === currentVersion) return

      const downloadUrl = release.jarDownloadUrl
      if (!downloadUrl) return

      fs.mkdirSync(this.targetDir, { recursive: true })

      const tmpPath = path.join(this.targetDir, TMP_FILENAME)
      const finalPath = path.join(this.targetDir, JAR_FILENAME)

      await this.downloadFile(downloadUrl, tmpPath)

      // Verify the download is a reasonable size (> 1MB)
      const stat = fs.statSync(tmpPath)
      if (stat.size < 1_000_000) {
        fs.unlinkSync(tmpPath)
        return
      }

      // Atomic rename
      fs.renameSync(tmpPath, finalPath)
      this.setVersion(release.tagName)
    } catch {
      // Silent failure — never crash the app over a jar update
    }
  }

  private async fetchLatestRelease(): Promise<{ tagName: string; jarDownloadUrl: string | null } | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT)

    try {
      const resp = await fetch(GITHUB_API_URL, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        signal: controller.signal,
        redirect: 'follow'
      })

      if (!resp.ok) return null

      const data = await resp.json()
      const tagName: string = data.tag_name
      if (!tagName) return null

      const assets: any[] = data.assets || []
      const jarAsset = assets.find((a: any) => a.name === JAR_FILENAME)
      const jarDownloadUrl: string | null = jarAsset?.browser_download_url || null

      return { tagName, jarDownloadUrl }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow'
      })

      if (!resp.ok || !resp.body) {
        throw new Error('Download failed')
      }

      // Stream response body to file
      const fileStream = fs.createWriteStream(destPath)
      const reader = resp.body.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          fileStream.write(value)
        }
        fileStream.end()
        await new Promise<void>((resolve, reject) => {
          fileStream.on('finish', resolve)
          fileStream.on('error', reject)
        })
      } catch (err) {
        fileStream.destroy()
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        throw err
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
