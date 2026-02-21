import Anthropic from '@anthropic-ai/sdk'
import { SYSTEM_PROMPT } from '../prompts/system'
import type { FileAttachment, ConversationMessage } from '../types'

export class ClaudeService {
  private client: Anthropic
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: any }> = []

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async sendMessage(message: string, attachments?: FileAttachment[]): Promise<string> {
    const userContent = this.buildUserContent(message, attachments)
    this.conversationHistory.push({ role: 'user', content: userContent })

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
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
    const userContent = this.buildUserContent(message, attachments)
    this.conversationHistory.push({ role: 'user', content: userContent })

    const stream = this.client.messages.stream({
      model: 'claude-sonnet-4-5-20250929',
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

  resetConversation(): void {
    this.conversationHistory = []
  }

  private buildUserContent(message: string, attachments?: FileAttachment[]): any {
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
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: attachment.data
          }
        })
      } else {
        // For text-based files (DOCX text, XLSX parsed to text), include as text
        content.push({
          type: 'text',
          text: `[Attached file: ${attachment.name}]\n${attachment.data}`
        })
      }
    }

    content.push({
      type: 'text',
      text: message
    })

    return content
  }
}
