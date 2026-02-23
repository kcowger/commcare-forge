import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { FileAttachment, ChatMessage } from '../types'
import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

interface ChatInterfaceProps {
  messages: ChatMessage[]
  isLoading: boolean
  onSendMessage: (content: string, attachments?: FileAttachment[]) => void
  onUploadExisting?: () => void
}

export default function ChatInterface({ messages, isLoading, onSendMessage, onUploadExisting }: ChatInterfaceProps) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && attachments.length === 0) || isLoading) return
    onSendMessage(input, attachments.length > 0 ? attachments : undefined)
    setInput('')
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, attachments, isLoading, onSendMessage])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }, [handleSubmit])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newAttachments: FileAttachment[] = []
    for (const file of Array.from(files)) {
      const data = await fileToBase64(file)
      newAttachments.push({
        name: file.name,
        type: file.type,
        data,
        size: file.size
      })
    }
    setAttachments(prev => [...prev, ...newAttachments])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (!files.length) return

    const newAttachments: FileAttachment[] = []
    for (const file of Array.from(files)) {
      const data = await fileToBase64(file)
      newAttachments.push({
        name: file.name,
        type: file.type,
        data,
        size: file.size
      })
    }
    setAttachments(prev => [...prev, ...newAttachments])
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }, [])

  const isEmpty = messages.length === 0

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full px-6">
            <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">Build a CommCare App</h2>
            <p className="text-white/50 text-center max-w-md leading-relaxed">
              Describe the app you want to build, or upload existing paper forms, protocols, or templates. I'll help you design and generate a working CommCare application.
            </p>
            <div className="flex gap-3 mt-8">
              <SuggestionChip onClick={() => setInput('I need a registration form for community health workers to register pregnant women with fields for name, age, LMP date, phone number, and village.')}>
                Registration form
              </SuggestionChip>
              <SuggestionChip onClick={() => setInput('Create a multi-module app for tracking antenatal care visits with risk scoring based on age, blood pressure, and complications.')}>
                ANC tracking app
              </SuggestionChip>
              <SuggestionChip onClick={() => setInput('Build a simple survey with 10 multiple choice questions about household water and sanitation practices.')}>
                WASH survey
              </SuggestionChip>
            </div>
            {onUploadExisting && (
              <>
                <div className="flex items-center gap-3 mt-6">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs text-white/30">or</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <button
                  onClick={onUploadExisting}
                  className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 text-sm text-white/40 hover:text-white/70 hover:border-white/20 hover:bg-white/5 transition-all"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Upload existing app
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} message={msg} animate={i >= messages.length - 2} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-white/10 bg-[#0a0a0a]/80 backdrop-blur-sm px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white/70">
                  <FileIcon type={att.type} />
                  <span className="truncate max-w-[150px]">{att.name}</span>
                  <button onClick={() => removeAttachment(i)} className="text-white/40 hover:text-white/80 ml-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex items-end gap-3">
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv"
              multiple
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white/70 transition-colors shrink-0"
              title="Attach files"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the CommCare app you want to build..."
              rows={1}
              className="flex-1 resize-none rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 transition-all text-sm leading-relaxed"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && attachments.length === 0)}
              className="p-2.5 rounded-lg bg-accent hover:bg-accent-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {isLoading ? (
                <svg width="20" height="20" viewBox="0 0 24 24" className="animate-spin text-white">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message, animate }: { message: ChatMessage; animate: boolean }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${animate ? 'animate-fade-in' : ''}`}>
      <div className={`max-w-[85%] ${isUser ? 'order-2' : ''}`}>
        {/* Role label */}
        <div className={`flex items-center gap-1.5 mb-1 ${isUser ? 'justify-end' : ''}`}>
          {!isUser && (
            <div className="w-4 h-4 rounded bg-accent/20 flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-accent">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
              </svg>
            </div>
          )}
          <span className="text-[11px] font-medium text-white/30">
            {isUser ? 'You' : 'CommCare Forge'}
          </span>
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {message.attachments.map((att, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 text-xs text-white/50">
                <FileIcon type={att.type} />
                {att.name}
              </span>
            ))}
          </div>
        )}

        {/* Message content */}
        <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-accent text-white rounded-tr-md'
            : 'bg-white/[0.03] text-white/90 rounded-tl-md border border-white/[0.06]'
        }`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="cc-markdown">
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{message.content || (message.isStreaming ? '...' : '')}</ReactMarkdown>
            </div>
          )}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
          )}
        </div>
      </div>
    </div>
  )
}

function SuggestionChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-full border border-white/10 text-sm text-white/50 hover:text-white/80 hover:border-white/20 hover:bg-white/5 transition-all"
    >
      {children}
    </button>
  )
}

function FileIcon({ type }: { type: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] || result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
