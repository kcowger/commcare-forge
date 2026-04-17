import Anthropic from '@anthropic-ai/sdk'
import { PDFDocument } from 'pdf-lib'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import { SYSTEM_PROMPT } from '../prompts/system'
import type { FileAttachment, ConversationMessage } from '../types'

/**
 * Wrapper around the Anthropic SDK that manages conversation history and
 * provides convenience methods for the different ways we talk to Claude:
 *
 * - `sendMessage` / `streamMessage` — multi-turn conversation (chat UI)
 * - `sendOneShot` — single-turn text generation (no tool use)
 * - `sendOneShotWithTool` — single-turn with forced tool use for structured output
 *
 * The Electron app creates one instance per conversation. The app generator
 * uses `sendOneShotWithTool` for both initial generation and fix attempts,
 * which guarantees Claude returns valid JSON matching the tool's input_schema
 * instead of freeform text that needs regex parsing.
 */
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
    this.stripPdfsIfOverPageLimit()
    await this.estimateAndTrimIfNeeded()

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
    this.stripPdfsIfOverPageLimit()
    await this.estimateAndTrimIfNeeded()

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

  /**
   * Single-turn request that forces Claude to respond by calling a specific tool,
   * guaranteeing structured JSON output matching the tool's input_schema.
   *
   * This replaces the old pattern of sendOneShot() + regex-parsing JSON from
   * markdown code blocks. With `tool_choice: { type: 'tool', name }`, Claude
   * MUST call the named tool — it can't respond with plain text instead.
   *
   * The `onChunk` callback fires with `inputJson` deltas (partial JSON fragments)
   * as they stream in. The UI doesn't display these directly (it shows a spinner),
   * but the callback keeps the progress reporting alive.
   *
   * @param tool - The tool definition with a JSON Schema input_schema (from getCompactAppJsonSchema())
   * @returns The parsed tool input, typed as T (e.g. CompactApp)
   */
  async sendOneShotWithTool<T>(
    systemPrompt: string,
    message: string,
    tool: { name: string; description: string; input_schema: Record<string, unknown> },
    onChunk?: (chunk: string) => void,
    options?: { model?: string; maxTokens?: number }
  ): Promise<T> {
    const stream = this.client.messages.stream({
      model: options?.model || this.model,
      max_tokens: options?.maxTokens || 16384,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: [{
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool['input_schema']
      }],
      // Force Claude to call this specific tool — no text-only responses allowed
      tool_choice: { type: 'tool', name: tool.name }
    })

    // inputJson fires with each JSON fragment as the tool input streams in
    stream.on('inputJson', (delta: string, _snapshot: unknown) => {
      if (onChunk) onChunk(delta)
    })

    const finalMessage = await stream.finalMessage()

    const toolUse = finalMessage.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (!toolUse) {
      throw new Error('Claude did not return a tool_use block')
    }

    return toolUse.input as T
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
        const MAX_CHUNKS = 1 // Only send 1 chunk (≤80 pages) — API limit is 100 total
        if (pdfChunks.length > MAX_CHUNKS) {
          content.push({
            type: 'text',
            text: `[Note: ${attachment.name} has more than 80 pages. ` +
                  `Only the first 80 pages are included. ` +
                  `Please upload remaining pages separately if needed.]`
          })
          pdfChunks.splice(MAX_CHUNKS)
        }
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
      } else if (attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || attachment.name.endsWith('.docx')) {
        try {
          const buffer = Buffer.from(attachment.data, 'base64')
          const result = await mammoth.extractRawText({ buffer })
          content.push({
            type: 'text',
            text: `[Attached document: ${attachment.name}]\n${result.value}`
          })
        } catch {
          content.push({
            type: 'text',
            text: `[Attached file: ${attachment.name}]\n(Failed to parse DOCX content)`
          })
        }
      } else if (attachment.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || attachment.name.endsWith('.xlsx')) {
        try {
          const buffer = Buffer.from(attachment.data, 'base64')
          const workbook = new ExcelJS.Workbook()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await workbook.xlsx.load(buffer as any)
          const sheets: string[] = []
          for (const worksheet of workbook.worksheets) {
            const rows: string[] = []
            worksheet.eachRow({ includeEmpty: true }, (row) => {
              const cells: string[] = []
              row.eachCell({ includeEmpty: true }, (cell) => {
                const val = cell.text ?? ''
                if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                  cells.push('"' + val.replace(/"/g, '""') + '"')
                } else {
                  cells.push(val)
                }
              })
              rows.push(cells.join(','))
            })
            sheets.push(`--- Sheet: ${worksheet.name} ---\n${rows.join('\n')}`)
          }
          content.push({
            type: 'text',
            text: `[Attached spreadsheet: ${attachment.name}]\n${sheets.join('\n\n')}`
          })
        } catch {
          content.push({
            type: 'text',
            text: `[Attached file: ${attachment.name}]\n(Failed to parse XLSX content)`
          })
        }
      } else {
        // For other text-based files, include as text
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

  /**
   * Strip old PDF documents from conversation history to stay under the 100-page API limit.
   * The Anthropic API enforces a hard 100-page limit across ALL PDFs in a single request.
   */
  private stripPdfsIfOverPageLimit(): void {
    const MAX_PDF_PAGES = 95 // leave some headroom under the 100-page hard limit

    // Count total PDF pages by estimating from base64 size (rough: ~3KB base64 per page)
    // We can't parse every PDF in history efficiently, so use a conservative estimate.
    // Better: track page counts when PDFs are added and strip oldest when over limit.
    let pdfBlockCount = 0
    for (const msg of this.conversationHistory) {
      if (!Array.isArray(msg.content)) continue
      for (const block of msg.content) {
        if (block.type === 'document' && block.source?.type === 'base64' && block.source?.media_type === 'application/pdf') {
          pdfBlockCount++
        }
      }
    }

    // If more than one PDF document block in history, strip older ones to keep only the latest
    // This is aggressive but safe — the API will reject if total pages > 100
    if (pdfBlockCount > 1) {
      let kept = 0
      // Walk backwards to keep the newest PDF, strip the rest
      for (let mIdx = this.conversationHistory.length - 1; mIdx >= 0; mIdx--) {
        const msg = this.conversationHistory[mIdx]
        if (!Array.isArray(msg.content)) continue
        for (let i = 0; i < msg.content.length; i++) {
          const block = msg.content[i]
          if (block.type === 'document' && block.source?.type === 'base64' && block.source?.media_type === 'application/pdf') {
            if (kept > 0) {
              // Strip this older PDF
              msg.content[i] = { type: 'text', text: '[Previously uploaded PDF — removed to stay under page limit]' }
            }
            kept++
          }
        }
      }
    }
  }

  /** Check token count and trim conversation history if needed before sending to API. */
  private async estimateAndTrimIfNeeded(): Promise<void> {
    const TOKEN_LIMIT = 190_000 // leave headroom for response
    const MAX_TRIM_ATTEMPTS = 10

    for (let attempt = 0; attempt < MAX_TRIM_ATTEMPTS; attempt++) {
      try {
        const result = await this.client.messages.countTokens({
          model: this.model,
          system: SYSTEM_PROMPT,
          messages: this.conversationHistory
        })

        if (result.input_tokens <= TOKEN_LIMIT) return

        // If only the current message exists, the attachments themselves are too large
        if (this.conversationHistory.length <= 1) {
          throw new Error(
            `The attached files are too large for a single request ` +
            `(${result.input_tokens.toLocaleString()} tokens, limit is ${TOKEN_LIMIT.toLocaleString()}). ` +
            `Try sending fewer or smaller files.`
          )
        }

        // Try stripping binary content from old messages first, then remove old messages
        const stripped = this.stripOldBinaryContent()
        if (!stripped) {
          // No more binary content to strip — remove oldest user+assistant pair
          this.conversationHistory.splice(0, 2)
        }
      } catch (err: any) {
        if (err.message?.includes('too large')) throw err
        // countTokens API failed — let the main API call handle it
        console.warn('Token counting failed, proceeding without trim:', err)
        return
      }
    }
  }

  /** Replace the oldest base64 image/document block in history with a text placeholder. */
  private stripOldBinaryContent(): boolean {
    for (const msg of this.conversationHistory) {
      if (!Array.isArray(msg.content)) continue
      for (let i = 0; i < msg.content.length; i++) {
        const block = msg.content[i]
        if (block.type === 'image' && block.source?.type === 'base64') {
          msg.content[i] = { type: 'text', text: '[Previously uploaded image — removed to save space]' }
          return true
        }
        if (block.type === 'document' && block.source?.type === 'base64') {
          msg.content[i] = { type: 'text', text: '[Previously uploaded PDF — removed to save space]' }
          return true
        }
      }
    }
    return false
  }

  /** Split a PDF into ≤80 page chunks. API limit is 100 pages total per request. */
  private async splitPdfIfNeeded(base64Data: string): Promise<string[]> {
    const MAX_PAGES = 80
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
      // If we can't parse the PDF, check size to decide whether it's safe to send unsplit
      const pdfBytes = Buffer.from(base64Data, 'base64')
      const sizeMB = pdfBytes.length / (1024 * 1024)
      if (sizeMB > 10) {
        throw new Error(
          `This PDF is too large (${sizeMB.toFixed(0)}MB) and could not be processed for splitting. ` +
          `Try re-saving the PDF without encryption or DRM, or split it into smaller files manually.`
        )
      }
      // Small PDF — likely under 100 pages, safe to send as-is
      console.warn('Could not parse PDF for splitting, but file is small enough to send as-is:', err)
      return [base64Data]
    }
  }
}
