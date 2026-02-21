import { shell, clipboard } from 'electron'

const FAKE_HQ_URL = 'https://india.commcarehq.org/a/forge/apps/view/00000000000000000000000000000000/'

export class HqImportService {
  async initiateImport(hqServer: string, hqDomain: string, exportedFilePath: string): Promise<{
    importUrl: string
    fakeAppUrl: string
    filePath: string
    instructions: string
  }> {
    const importUrl = `https://${hqServer}/a/${hqDomain}/settings/project/import_app/`

    // Copy fake URL to clipboard
    clipboard.writeText(FAKE_HQ_URL)

    // Open HQ import page in default browser
    await shell.openExternal(importUrl)

    const instructions = [
      'Your app has been saved. To import it to CommCare HQ:',
      '',
      '1. Paste the URL from your clipboard into the App URL field and click Next',
      '2. On the next page, enter an application name',
      `3. Click Choose File and select: ${exportedFilePath}`,
      '4. Click Import Application'
    ].join('\n')

    return {
      importUrl,
      fakeAppUrl: FAKE_HQ_URL,
      filePath: exportedFilePath,
      instructions
    }
  }
}
