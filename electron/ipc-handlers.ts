import { IpcMain, BrowserWindow } from 'electron'
import { ClaudeService } from '@backend/services/claude'
import { AppGenerator } from '@backend/services/appGenerator'
import type { FileAttachment, AppSettings } from './preload'
import Store from 'electron-store'

const store = new Store<AppSettings>({
  defaults: {
    apiKey: null,
    hqServer: 'www.commcarehq.org',
    hqDomain: '',
    maxValidationRetries: 5
  },
  encryptionKey: 'commcare-forge-encryption-key'
})

let claudeService: ClaudeService | null = null

function getClaudeService(): ClaudeService {
  if (!claudeService) {
    const apiKey = store.get('apiKey')
    if (!apiKey) {
      throw new Error('API key not configured. Please set your Anthropic API key in Settings.')
    }
    claudeService = new ClaudeService(apiKey)
  }
  return claudeService
}

export function registerIpcHandlers(ipcMain: IpcMain) {
  ipcMain.handle('chat:send-message', async (_event, message: string, attachments?: FileAttachment[]) => {
    try {
      const service = getClaudeService()
      const response = await service.sendMessage(message, attachments)
      return response
    } catch (error: any) {
      throw new Error(error.message || 'Failed to send message')
    }
  })

  ipcMain.handle('chat:stream-message', async (event, message: string, attachments?: FileAttachment[]) => {
    try {
      const service = getClaudeService()
      const window = BrowserWindow.fromWebContents(event.sender)
      let fullResponse = ''

      await service.streamMessage(message, attachments, (chunk: string) => {
        fullResponse += chunk
        if (window && !window.isDestroyed()) {
          window.webContents.send('chat:stream-chunk', chunk)
        }
      })

      return fullResponse
    } catch (error: any) {
      throw new Error(error.message || 'Failed to stream message')
    }
  })

  ipcMain.handle('app:generate', async (event) => {
    try {
      const service = getClaudeService()
      const window = BrowserWindow.fromWebContents(event.sender)
      const maxRetries = store.get('maxValidationRetries') || 5

      const generator = new AppGenerator(service, maxRetries)
      const conversationContext = service.getConversationSummary()

      const result = await generator.generate(conversationContext, (progress) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send('app:generation-progress', progress)
        }
      })

      return {
        success: result.success,
        cczPath: result.cczPath,
        exportPath: result.exportPath,
        errors: result.errors
      }
    } catch (error: any) {
      throw new Error(error.message || 'Failed to generate app')
    }
  })

  ipcMain.handle('settings:get-api-key', async () => {
    return store.get('apiKey') || null
  })

  ipcMain.handle('settings:set-api-key', async (_event, key: string) => {
    store.set('apiKey', key)
    claudeService = null
  })

  ipcMain.handle('settings:get', async () => {
    return {
      apiKey: store.get('apiKey') || null,
      hqServer: store.get('hqServer'),
      hqDomain: store.get('hqDomain'),
      maxValidationRetries: store.get('maxValidationRetries')
    }
  })

  ipcMain.handle('settings:set', async (_event, settings: Partial<AppSettings>) => {
    if (settings.apiKey !== undefined) {
      store.set('apiKey', settings.apiKey)
      claudeService = null
    }
    if (settings.hqServer !== undefined) store.set('hqServer', settings.hqServer)
    if (settings.hqDomain !== undefined) store.set('hqDomain', settings.hqDomain)
    if (settings.maxValidationRetries !== undefined) store.set('maxValidationRetries', settings.maxValidationRetries)
  })
}
