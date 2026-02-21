import React, { useState, useEffect } from 'react'
import Header from './components/Header'
import ChatInterface from './components/ChatInterface'
import SettingsModal from './components/SettingsModal'
import { useChat } from './hooks/useChat'

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const { messages, isLoading, sendMessage, clearMessages } = useChat()

  useEffect(() => {
    // Check if API key is set on launch
    if (window.electronAPI) {
      window.electronAPI.getApiKey().then(key => {
        if (!key) {
          setNeedsApiKey(true)
          setSettingsOpen(true)
        }
      })
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex-1 overflow-hidden">
        <ChatInterface
          messages={messages}
          isLoading={isLoading}
          onSendMessage={sendMessage}
        />
      </main>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => {
          setSettingsOpen(false)
          if (needsApiKey && window.electronAPI) {
            window.electronAPI.getApiKey().then(key => {
              if (key) setNeedsApiKey(false)
            })
          }
        }}
      />
    </div>
  )
}
