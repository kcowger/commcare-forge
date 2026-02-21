import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChatMessage, FileAttachment } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const streamingRef = useRef('')

  useEffect(() => {
    if (!window.electronAPI) return

    const cleanup = window.electronAPI.onStreamChunk((chunk: string) => {
      streamingRef.current += chunk
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: streamingRef.current }
          ]
        }
        return prev
      })
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

    try {
      const response = await window.electronAPI.streamMessage(content, attachments)
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.role === 'assistant' && last.isStreaming) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: response, isStreaming: false }
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
    }
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, isLoading, sendMessage, clearMessages }
}
