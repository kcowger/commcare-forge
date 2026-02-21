const OPEN_TAG = '<app-spec>'
const CLOSE_TAG = '</app-spec>'

export interface ParseResult {
  chatContent: string
  specContent: string | null
  isInsideSpec: boolean
}

/**
 * Streaming parser that separates <app-spec>...</app-spec> blocks from chat text.
 * Handles delimiters split across multiple streaming chunks.
 */
export class SpecStreamParser {
  private chatBuffer = ''
  private specBuffer = ''
  private pendingBuffer = ''
  private insideSpec = false
  private hasSpec = false

  processChunk(chunk: string): ParseResult {
    this.pendingBuffer += chunk
    this.drain()
    return {
      chatContent: this.chatBuffer,
      specContent: this.hasSpec || this.insideSpec ? this.specBuffer : null,
      isInsideSpec: this.insideSpec,
    }
  }

  reset(): void {
    this.chatBuffer = ''
    this.specBuffer = ''
    this.pendingBuffer = ''
    this.insideSpec = false
    this.hasSpec = false
  }

  private drain(): void {
    while (this.pendingBuffer.length > 0) {
      if (!this.insideSpec) {
        const idx = this.pendingBuffer.indexOf(OPEN_TAG)
        if (idx !== -1) {
          // Found opening tag — flush text before it to chat, switch to spec mode
          this.chatBuffer += this.pendingBuffer.slice(0, idx)
          this.pendingBuffer = this.pendingBuffer.slice(idx + OPEN_TAG.length)
          this.insideSpec = true
          // New spec block replaces previous content
          this.specBuffer = ''
          continue
        }
        // No complete tag found — check if buffer ends with a partial prefix
        const held = longestPrefixMatchAtEnd(this.pendingBuffer, OPEN_TAG)
        if (held > 0) {
          this.chatBuffer += this.pendingBuffer.slice(0, -held)
          this.pendingBuffer = this.pendingBuffer.slice(-held)
          return // wait for more data
        }
        // No partial match — flush everything to chat
        this.chatBuffer += this.pendingBuffer
        this.pendingBuffer = ''
        return
      } else {
        const idx = this.pendingBuffer.indexOf(CLOSE_TAG)
        if (idx !== -1) {
          // Found closing tag — flush text before it to spec, switch to chat mode
          this.specBuffer += this.pendingBuffer.slice(0, idx)
          this.pendingBuffer = this.pendingBuffer.slice(idx + CLOSE_TAG.length)
          this.insideSpec = false
          this.hasSpec = true
          continue
        }
        // Check for partial close tag at end
        const held = longestPrefixMatchAtEnd(this.pendingBuffer, CLOSE_TAG)
        if (held > 0) {
          this.specBuffer += this.pendingBuffer.slice(0, -held)
          this.pendingBuffer = this.pendingBuffer.slice(-held)
          return
        }
        // Flush everything to spec
        this.specBuffer += this.pendingBuffer
        this.pendingBuffer = ''
        return
      }
    }
  }
}

/**
 * Returns the length of the longest suffix of `text` that is a prefix of `delimiter`.
 */
function longestPrefixMatchAtEnd(text: string, delimiter: string): number {
  const maxCheck = Math.min(text.length, delimiter.length - 1)
  for (let len = maxCheck; len > 0; len--) {
    if (text.endsWith(delimiter.substring(0, len))) {
      return len
    }
  }
  return 0
}

/**
 * Strip <app-spec>...</app-spec> tags from a complete response.
 * Used on the final response text to clean up chat content.
 */
export function stripSpecTags(text: string): { chat: string; spec: string | null } {
  let spec: string | null = null
  const chat = text.replace(/<app-spec>([\s\S]*?)<\/app-spec>/g, (_, content) => {
    spec = content.trim()
    return ''
  })
  return { chat: chat.trim(), spec }
}
