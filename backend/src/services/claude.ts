import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import { SYSTEM_PROMPT } from '../prompts/system'
import type { FileAttachment, ConversationMessage } from '../types'

export class ClaudeService {
  private client: Anthropic
  private model: string
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: any }> = []

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model || 'claude-sonnet-4-5-20250929'
  }

  async sendMessage(message: string, attachments?: FileAttachment[]): Promise<string> {
    const userContent = await this.buildUserContent(message, attachments)
    this.conversationHistory.push({ role: 'user', content: userContent })

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: this.conversationHistory
    })

    const assistantText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')

    this.conversationHistory.push({ role: 'assistant', content: assistantText })

    return assistantText
  }

  async streamMessage(
    message: string,
    attachments?: FileAttachment[],
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const userContent = await this.buildUserContent(message, attachments)
    this.conversationHistory.push({ role: 'user', content: userContent })

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: this.conversationHistory
    })

    let fullText = ''

    stream.on('text', (text) => {
      fullText += text
      if (onChunk) onChunk(text)
    })

    await stream.finalMessage()

    this.conversationHistory.push({ role: 'assistant', content: fullText })

    return fullText
  }

  async sendOneShot(
    systemPrompt: string,
    message: string,
    onChunk?: (chunk: string) => void,
    options?: { model?: string; maxTokens?: number }
  ): Promise<string> {
    const stream = this.client.messages.stream({
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }]
    })

    let fullText = ''

    stream.on('text', (text) => {
      fullText += text
      if (onChunk) onChunk(text)
    })

    await stream.finalMessage()

    return fullText
  }

  getConversationSummary(): string {
    return this.conversationHistory
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${typeof msg.content === 'string' ? msg.content : '[complex content]'}`)
      .join('\n\n')
  }

  injectContext(userMessage: string, assistantMessage: string): void {
    this.conversationHistory.push({ role: 'user', content: userMessage })
    this.conversationHistory.push({ role: 'assistant', content: assistantMessage })
  }

  resetConversation(): void {
    this.conversationHistory = []
  }

  getHistory(): Array<{ role: 'user' | 'assistant'; content: any }> {
    return this.conversationHistory
  }

  setHistory(history: Array<{ role: 'user' | 'assistant'; content: any }>): void {
    this.conversationHistory = history
  }

  private async buildUserContent(message: string, attachments?: FileAttachment[]): Promise<any> {
    if (!attachments || attachments.length === 0) {
      return message
    }

    const content: any[] = []

    for (const attachment of attachments) {
      if (attachment.type.startsWith('image/')) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.type,
            data: attachment.data
          }
        })
      } else if (attachment.type === 'application/pdf') {
        // Split large PDFs into ≤100 page chunks (API limit)
        const pdfChunks = await this.splitPdfIfNeeded(attachment.data)
        for (let i = 0; i < pdfChunks.length; i++) {
          if (pdfChunks.length > 1) {
            content.push({
              type: 'text',
              text: `[${attachment.name} — part ${i + 1} of ${pdfChunks.length}]`
            })
          }
          content.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfChunks[i]
            }
          })
        }
      } else {
        // For text-based files (DOCX text, XLSX parsed to text), include as text
        content.push({
          type: 'text',
          text: `[Attached file: ${attachment.name}]\n${attachment.data}`
        })
      }
    }

    if (message && message.trim()) {
      content.push({
        type: 'text',
        text: message
      })
    }

    // Ensure at least one text block exists (API requires non-empty content)
    if (content.length === 0) {
      content.push({
        type: 'text',
        text: 'See attached file.'
      })
    }

    return content
  }

  /** Split a PDF into ≤100 page chunks. Returns array of base64 strings. */
  private async splitPdfIfNeeded(base64Data: string): Promise<string[]> {
    const MAX_PAGES = 100
    try {
      const pdfBytes = Buffer.from(base64Data, 'base64')
      const pdf = await PDFDocument.load(pdfBytes)
      const totalPages = pdf.getPageCount()

      if (totalPages <= MAX_PAGES) {
        return [base64Data]
      }

      console.log(`PDF has ${totalPages} pages, splitting into ${Math.ceil(totalPages / MAX_PAGES)} chunks of ≤${MAX_PAGES} pages`)

      const chunks: string[] = []
      for (let start = 0; start < totalPages; start += MAX_PAGES) {
        const end = Math.min(start + MAX_PAGES, totalPages)
        const chunkPdf = await PDFDocument.create()
        const pages = await chunkPdf.copyPages(pdf, Array.from({ length: end - start }, (_, i) => start + i))
        for (const page of pages) {
          chunkPdf.addPage(page)
        }
        const chunkBytes = await chunkPdf.save()
        chunks.push(Buffer.from(chunkBytes).toString('base64'))
      }

      return chunks
    } catch (err) {
      console.warn('Failed to split PDF, sending as-is:', err)
      return [base64Data]
    }
  }
}
