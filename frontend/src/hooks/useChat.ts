import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage, FileAttachment } from '../types'
import { SpecStreamParser, stripSpecTags } from '../utils/specParser'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [architectureSpec, setArchitectureSpec] = useState<string | null>(null)
  const [isSpecStreaming, setIsSpecStreaming] = useState(false)
  const streamingRef = useRef('')
  const parserRef = useRef(new SpecStreamParser())

  useEffect(() => {
    if (!window.electronAPI) return

    const cleanup = window.electronAPI.onStreamChunk((chunk: string) => {
      streamingRef.current += chunk
      const result = parserRef.current.processChunk(chunk)

      // Update the assistant message with chat-only content
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: result.chatContent }
          ]
        }
        return prev
      })

      // Update architecture spec if present
      if (result.specContent !== null) {
        setArchitectureSpec(result.specContent)
      }
      setIsSpecStreaming(result.isInsideSpec)
    })

    return cleanup
  }, [])

  const sendMessage = useCallback(async (content: string, attachments?: FileAttachment[]) => {
    if (!content.trim() && (!attachments || attachments.length === 0)) return
    if (!window.electronAPI) {
      console.error('Electron API not available')
      return
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      attachments,
      timestamp: Date.now()
    }

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setIsLoading(true)
    streamingRef.current = ''
    parserRef.current.reset()

    try {
      const response = await window.electronAPI.streamMessage(content, attachments)

      // Final cleanup: strip spec tags from the complete response
      const { chat, spec } = stripSpecTags(response)
      if (spec !== null) {
        setArchitectureSpec(spec)
      }

      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: chat, isStreaming: false }
          ]
        }
        return prev
      })
    } catch (error: any) {
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: `Error: ${error.message}`, isStreaming: false }
          ]
        }
        return prev
      })
    } finally {
      setIsLoading(false)
      setIsSpecStreaming(false)
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
    setArchitectureSpec(null)
    setIsSpecStreaming(false)
  }, [])

  return { messages, isLoading, sendMessage, clearMessages, architectureSpec, isSpecStreaming }
}
