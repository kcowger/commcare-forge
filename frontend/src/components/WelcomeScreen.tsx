import React, { useState } from 'react'

interface WelcomeScreenProps {
  onComplete: () => void
}

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) return

    setSaving(true)
    setError(null)
    try {
      await window.electronAPI.setApiKey(apiKey.trim())
      onComplete()
    } catch (err: any) {
      setError(err.message || 'Failed to save API key')
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
        <p className="text-sm text-white/50 text-center mb-8">AI-powered CommCare app builder</p>

        {/* API key form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1.5">Anthropic API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              autoFocus
              className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-accent/50 transition-colors"
            />
            <p className="text-xs text-white/30 mt-1.5">
              Get one at{' '}
              <span className="text-accent/70">console.anthropic.com</span>
            </p>
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
