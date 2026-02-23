import React, { useState, useRef, useEffect } from 'react'

interface HeaderProps {
  onOpenSettings: () => void
  onNewChat?: () => void
  showNewChat?: boolean
  hqDomain: string
  hqServer: string
  onDomainChange: (domain: string) => void
}

export default function Header({ onOpenSettings, onNewChat, showNewChat, hqDomain, hqServer, onDomainChange }: HeaderProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEditing() {
    setEditValue(hqDomain)
    setEditing(true)
  }

  function commitEdit() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== hqDomain) {
      onDomainChange(trimmed)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#0a0a0a]/80 backdrop-blur-sm" style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-white tracking-tight">CommCare Forge</h1>

        {/* Project space indicator */}
        <div style={{ WebkitAppRegion: 'no-drag' } as any}>
          {editing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              placeholder="project-space"
              className="px-2.5 py-0.5 rounded-md bg-white/10 border border-accent/40 text-xs text-white font-mono outline-none w-36"
            />
          ) : (
            <button
              onClick={startEditing}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition-colors group"
              title={hqDomain ? `Project space: ${hqDomain} on ${hqServer}` : 'Click to set project space'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/40 group-hover:text-white/60">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span className="text-xs font-mono text-white/50 group-hover:text-white/70">
                {hqDomain || 'no project space'}
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
        {showNewChat && onNewChat && (
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5 text-white/50 hover:text-white/80 transition-colors text-sm"
            title="New chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors"
          title="Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 hover:text-white/90">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </header>
  )
}
