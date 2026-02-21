import React from 'react'

interface HeaderProps {
  onOpenSettings: () => void
  onNewChat?: () => void
  showNewChat?: boolean
}

export default function Header({ onOpenSettings, onNewChat, showNewChat }: HeaderProps) {
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
