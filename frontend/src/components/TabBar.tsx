import React from 'react'
import type { Conversation } from '../types'

interface TabBarProps {
  conversations: Conversation[]
  activeId: string
  onSwitch: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  isLoading: boolean
}

export default function TabBar({ conversations, activeId, onSwitch, onClose, onNew, isLoading }: TabBarProps) {
  return (
    <div className="flex items-center border-b border-white/10 bg-[#0a0a0a] overflow-x-auto scrollbar-hide">
      <div className="flex items-center min-w-0">
        {conversations.map(conv => (
          <button
            key={conv.id}
            onClick={() => { if (!isLoading && conv.id !== activeId) onSwitch(conv.id) }}
            className={`group relative flex items-center gap-1.5 px-3 py-2 text-xs min-w-0 max-w-[180px] border-r border-white/5 transition-colors ${
              conv.id === activeId
                ? 'bg-white/[0.04] text-white/90'
                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.02]'
            } ${isLoading && conv.id !== activeId ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {conv.id === activeId && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
            )}
            <span className="truncate">{conv.title || 'New Chat'}</span>
            {conversations.length > 1 && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isLoading) onClose(conv.id)
                }}
                className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all ${
                  isLoading ? 'pointer-events-none' : ''
                }`}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={onNew}
        disabled={isLoading}
        className="flex-shrink-0 px-2.5 py-2 text-white/30 hover:text-white/60 hover:bg-white/[0.02] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="New chat"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  )
}
