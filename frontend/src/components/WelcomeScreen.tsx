import React, { useState } from 'react'

const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (Recommended)' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Slowest, most capable)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast, least capable)' },
]

interface WelcomeScreenProps {
  onComplete: () => void
}

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-5-20250929')
  const [hqServer, setHqServer] = useState('www.commcarehq.org')
  const [hqDomain, setHqDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) return

    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.setApiKey(apiKey.trim())
      await window.electronAPI.setSettings({
        model,
        hqServer,
        hqDomain
      })
      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0a0a]" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="w-full max-w-sm px-6" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* App icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 512 512" fill="none">
              <circle cx="256" cy="256" r="240" fill="#1a2332"/>
              <path d="M136 360 L160 320 L352 320 L376 360 Z" fill="#2d3a4a" stroke="#4a5f78" strokeWidth="2"/>
              <rect x="200" y="240" width="112" height="80" rx="4" fill="#2d3a4a" stroke="#4a5f78" strokeWidth="2"/>
              <path d="M120 240 Q120 208 152 208 L360 208 Q384 208 384 228 L384 240 Z" fill="#4a5f78" stroke="#5a7a96" strokeWidth="2"/>
              <circle cx="256" cy="168" r="12" fill="#0ea5e9" opacity="0.95"/>
              <line x1="256" y1="144" x2="256" y2="132" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" opacity="0.9"/>
              <line x1="276" y1="152" x2="286" y2="142" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" opacity="0.8"/>
              <line x1="236" y1="152" x2="226" y2="142" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" opacity="0.8"/>
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold text-white text-center mb-1">CommCare Forge</h1>
        <p className="text-sm text-white/50 text-center mb-6">AI-powered CommCare app builder</p>

        {/* Setup form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1">Anthropic API Key <span className="text-red-400">*</span></label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              autoFocus
              autoComplete="off"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 transition-colors"
            />
            <p className="text-xs text-white/30 mt-1">
              Get one at{' '}
              <span className="text-accent/70">console.anthropic.com</span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1">AI Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/50 appearance-none cursor-pointer"
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-[#111] text-white">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1">CommCare HQ Server</label>
            <input
              type="text"
              value={hqServer}
              onChange={e => setHqServer(e.target.value)}
              placeholder="www.commcarehq.org"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1">Project Space</label>
            <input
              type="text"
              value={hqDomain}
              onChange={e => setHqDomain(e.target.value)}
              placeholder="my-project"
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={!apiKey.trim() || saving}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-accent hover:bg-accent-light text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Setting up...' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  )
}
