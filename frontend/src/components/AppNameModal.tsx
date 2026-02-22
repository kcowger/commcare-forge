import React, { useState, useRef, useEffect } from 'react'

interface AppNameModalProps {
  isOpen: boolean
  defaultName: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

export default function AppNameModal({ isOpen, defaultName, onConfirm, onCancel }: AppNameModalProps) {
  const [name, setName] = useState(defaultName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setName(defaultName)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 50)
    }
  }, [isOpen, defaultName])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) {
      onConfirm(trimmed)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="bg-[#141414] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-white mb-1">Name your app</h2>
        <p className="text-sm text-white/50 mb-4">This name will be used for exported files.</p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 text-sm"
          placeholder="e.g. ANC Tracking App"
        />
        <div className="flex justify-end gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-light text-white text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Build App
          </button>
        </div>
      </form>
    </div>
  )
}
