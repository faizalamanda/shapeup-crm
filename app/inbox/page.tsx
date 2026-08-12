"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'

interface CustomerInfo {
  id: string
  name: string
  phone: string
  email?: string
  category?: string
  address_data?: any
}

interface Conversation {
  id: string
  business_id: string
  customer_id?: string
  wa_id: string
  contact_name: string
  last_message_text: string
  last_message_at: string
  unread_count: number
  status: string
  metadata?: any
  created_at: string
  customers?: CustomerInfo
}

interface Message {
  id: string
  business_id: string
  conversation_id: string
  wamid?: string
  direction: 'incoming' | 'outgoing'
  sender_phone: string
  recipient_phone: string
  message_type: string
  text_body: string
  media_url?: string
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed'
  error_message?: string
  created_at: string
}

export default function InboxPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [activeBusinessName, setActiveBusinessName] = useState<string>('')
  const [loadingBiz, setLoadingBiz] = useState(true)

  // Integration state
  const [isConfigured, setIsConfigured] = useState(true)
  const [isActive, setIsActive] = useState(true)

  // Conversations & messages state
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'all' | 'unread'>('all')

  // Active chat state
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  // Composer state
  const [textInput, setTextInput] = useState('')
  const [sending, setSending] = useState(false)

  // UI Drawer State
  const [showCustomerDrawer, setShowCustomerDrawer] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Check active business profile
  const checkActiveBusiness = useCallback(async () => {
    setLoadingBiz(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBusinessId(profile.active_business_id)
        const { data: biz } = await supabase
          .from('businesses')
          .select('name')
          .eq('id', profile.active_business_id)
          .single()
        if (biz) setActiveBusinessName(biz.name)
      }
    }
    setLoadingBiz(false)
  }, [supabase])

  // Fetch Conversations list
  const fetchConversations = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoadingConversations(true)
    try {
      const res = await fetch('/api/waba/conversations')
      const json = await res.json()

      if (json.success) {
        setIsConfigured(json.configured ?? true)
        setIsActive(json.active ?? true)
        const list: Conversation[] = json.conversations || []
        setConversations(list)

        // If no conversation is selected and list exists, select first
        if (!selectedConvId && list.length > 0) {
          setSelectedConvId(list[0].id)
          setActiveConv(list[0])
        }
      }
    } catch (err) {
      console.error('Fetch Conversations error:', err)
    } finally {
      if (!isSilent) setLoadingConversations(false)
    }
  }, [selectedConvId])

  // Fetch Messages for selected conversation
  const fetchMessages = useCallback(async (convId: string, isSilent = false) => {
    if (!isSilent) setLoadingMessages(true)
    try {
      const res = await fetch(`/api/waba/messages?conversation_id=${convId}`)
      const json = await res.json()

      if (json.success) {
        setMessages(json.messages || [])
        if (json.conversation) {
          setActiveConv(json.conversation)
        }
      }
    } catch (err) {
      console.error('Fetch Messages error:', err)
    } finally {
      if (!isSilent) setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    checkActiveBusiness()
  }, [checkActiveBusiness])

  useEffect(() => {
    if (activeBusinessId) {
      fetchConversations()
    }
  }, [activeBusinessId, fetchConversations])

  useEffect(() => {
    if (selectedConvId) {
      fetchMessages(selectedConvId)
      // Update selected conversation in list to clear unread
      setConversations(prev => prev.map(c => c.id === selectedConvId ? { ...c, unread_count: 0 } : c))
    }
  }, [selectedConvId, fetchMessages])

  // Auto-scroll to bottom of messages container
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Auto polling every 4 seconds for real-time update
  useEffect(() => {
    if (!activeBusinessId || !isConfigured || !isActive) return

    const interval = setInterval(() => {
      fetchConversations(true)
      if (selectedConvId) {
        fetchMessages(selectedConvId, true)
      }
    }, 4000)

    return () => clearInterval(interval)
  }, [activeBusinessId, isConfigured, isActive, selectedConvId, fetchConversations, fetchMessages])

  // Handle Send Message
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!textInput.trim() || !selectedConvId || sending) return

    const currentConv = conversations.find(c => c.id === selectedConvId) || activeConv
    if (!currentConv) return

    const toPhone = currentConv.wa_id
    const messageText = textInput.trim()

    setTextInput('')
    setSending(true)

    // Optimistic UI message addition
    const tempId = 'temp-' + Date.now()
    const tempMsg: Message = {
      id: tempId,
      business_id: activeBusinessId || '',
      conversation_id: selectedConvId,
      direction: 'outgoing',
      sender_phone: 'me',
      recipient_phone: toPhone,
      message_type: 'text',
      text_body: messageText,
      status: 'sent',
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tempMsg])

    try {
      const res = await fetch('/api/waba/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedConvId,
          to: toPhone,
          text: messageText,
        }),
      })

      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengirim pesan')
      }

      // Refresh thread
      await fetchMessages(selectedConvId, true)
      await fetchConversations(true)

    } catch (err: any) {
      alert('Gagal mengirim pesan: ' + (err.message || 'Terjadi kesalahan.'))
      // Mark optimistic message as failed
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'failed', error_message: err.message } : m))
    } finally {
      setSending(false)
    }
  }

  // Filter conversations
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      const nameMatch = c.contact_name.toLowerCase().includes(searchQuery.toLowerCase())
      const phoneMatch = c.wa_id.includes(searchQuery.replace(/\D/g, ''))
      const msgMatch = (c.last_message_text || '').toLowerCase().includes(searchQuery.toLowerCase())

      const matchesSearch = nameMatch || phoneMatch || msgMatch
      if (filterTab === 'unread') {
        return matchesSearch && c.unread_count > 0
      }
      return matchesSearch
    })
  }, [conversations, searchQuery, filterTab])

  // Helper for message status icon
  const renderStatusIcon = (status: Message['status']) => {
    switch (status) {
      case 'received':
        return null
      case 'sent':
        return <span className="text-slate-400 text-xs font-bold" title="Terkirim ke Server Meta">✓</span>
      case 'delivered':
        return <span className="text-slate-400 text-xs font-bold" title="Tersampaikan ke Penerima">✓✓</span>
      case 'read':
        return <span className="text-blue-500 text-xs font-bold" title="Dibaca oleh Penerima">✓✓</span>
      case 'failed':
        return <span className="text-red-500 text-xs font-bold" title="Gagal Mengirim">⚠️</span>
      default:
        return null
    }
  }

  // Format timestamp helper
  const formatTime = (isoString?: string) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return date.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  if (loadingBiz) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <div className="w-8 h-8 border-3 border-[#E2E2DC] border-t-green-600 rounded-full animate-spin" />
        <p className="text-xs font-bold uppercase tracking-widest text-[#A8A89E]">Memuat Inbox WhatsApp...</p>
      </div>
    )
  }

  // State: Integration Not Configured or Inactive
  if (!isConfigured || !isActive) {
    return (
      <div className="bg-white border border-[#E2E2DC] rounded-xl p-8 max-w-2xl mx-auto my-12 text-center space-y-6 shadow-sm">
        <div className="w-16 h-16 bg-green-50 border border-green-200 text-green-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-xs">
          📱
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-black text-[#1C1C1A]">Integrasi WABA Official Belum Aktif</h2>
          <p className="text-xs text-[#6B6B63] leading-relaxed max-w-md mx-auto">
            Untuk menggunakan Inbox CRM, silakan aktifkan dan masukkan <b>Meta Access Token</b> & <b>Phone Number ID</b> unit bisnis <b>{activeBusinessName}</b> pada halaman Pengaturan Integrasi.
          </p>
        </div>

        <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg text-left text-xs space-y-2 max-w-md mx-auto">
          <div className="font-bold text-[#1C1C1A] flex items-center gap-1.5">
            <span>💡</span> Panduan Singkat Setup WABA:
          </div>
          <ol className="list-decimal list-inside text-[#6B6B63] space-y-1 pl-1">
            <li>Buka <b>Settings &gt; Integrations &gt; WABA Official (Meta)</b></li>
            <li>Salin Access Token & Phone Number ID dari Dashboard Meta</li>
            <li>Salin URL Webhook ke Meta Developer Portal</li>
            <li>Aktifkan sakelar integrasi dan simpan</li>
          </ol>
        </div>

        <div className="pt-2">
          <Link
            href="/settings/integrations"
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-all shadow-md hover:shadow-none cursor-pointer"
          >
            ⚙️ Pengaturan Integrasi WABA &rarr;
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2E2DC] rounded-xl p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-200 text-green-600 font-black flex items-center justify-center text-xl">
            💬
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-[#1C1C1A]">Inbox WhatsApp WABA Official</h1>
              <span className="text-[10px] font-extrabold uppercase bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                ✓ Live Connected
              </span>
            </div>
            <p className="text-xs text-[#6B6B63]">
              Kelola percakapan pelanggan untuk unit bisnis: <span className="font-bold text-green-700">{activeBusinessName}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchConversations()}
            disabled={loadingConversations}
            className="px-3 py-1.5 border border-[#E2E2DC] hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh Pesan"
          >
            <span>🔄</span>
            <span className="hidden sm:inline">Segarkan</span>
          </button>
          <Link
            href="/settings/integrations"
            className="px-3 py-1.5 border border-[#E2E2DC] hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <span>⚙️</span>
            <span className="hidden sm:inline">Settings WABA</span>
          </Link>
        </div>
      </div>

      {/* Main Inbox Container */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl shadow-sm grid grid-cols-1 md:grid-cols-12 min-h-[640px] max-h-[780px] overflow-hidden">
        
        {/* ── LEFT PANE: CONVERSATION LIST (4 cols) ────────────────────── */}
        <div className="md:col-span-4 border-r border-[#E2E2DC] flex flex-col bg-[#FAFAFA]">
          
          {/* Search & Tabs Header */}
          <div className="p-3 border-b border-[#E2E2DC] space-y-2 bg-white">
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="Cari kontak / pesan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500 font-medium"
              />
              <span className="absolute left-3 text-xs text-[#A8A89E]">🔍</span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterTab('all')}
                className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${
                  filterTab === 'all'
                    ? 'bg-green-600 text-white shadow-xs'
                    : 'text-[#6B6B63] hover:bg-[#F7F7F5]'
                }`}
              >
                Semua ({conversations.length})
              </button>
              <button
                onClick={() => setFilterTab('unread')}
                className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${
                  filterTab === 'unread'
                    ? 'bg-green-600 text-white shadow-xs'
                    : 'text-[#6B6B63] hover:bg-[#F7F7F5]'
                }`}
              >
                Belum Dibaca ({conversations.filter(c => c.unread_count > 0).length})
              </button>
            </div>
          </div>

          {/* Conversation List Scrollable */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#E2E2DC]/60">
            {loadingConversations ? (
              <div className="p-8 text-center text-xs font-bold text-[#A8A89E] space-y-2">
                <div className="w-6 h-6 border-2 border-[#E2E2DC] border-t-green-600 rounded-full animate-spin mx-auto" />
                <span>Memuat Percakapan...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#A8A89E] space-y-2">
                <span className="text-2xl block">📭</span>
                <span>Belum ada percakapan WhatsApp yang cocok.</span>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = selectedConvId === conv.id
                const hasUnread = conv.unread_count > 0

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setSelectedConvId(conv.id)
                      setActiveConv(conv)
                    }}
                    className={`w-full p-3.5 text-left transition-all flex items-start gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-green-50/80 border-l-4 border-green-600'
                        : 'hover:bg-white'
                    }`}
                  >
                    {/* Avatar Initials */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 text-white font-bold flex items-center justify-center text-sm shrink-0 shadow-xs">
                      {(conv.contact_name || conv.wa_id).charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`text-xs font-bold truncate ${hasUnread ? 'text-[#1C1C1A] font-black' : 'text-[#1C1C1A]'}`}>
                          {conv.contact_name || conv.wa_id}
                        </span>
                        <span className="text-[10px] text-[#A8A89E] shrink-0">
                          {formatTime(conv.last_message_at)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs truncate ${hasUnread ? 'font-bold text-[#1C1C1A]' : 'text-[#6B6B63]'}`}>
                          {conv.last_message_text || 'Tidak ada pesan'}
                        </p>
                        {hasUnread && (
                          <span className="bg-green-600 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full shrink-0">
                            {conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>

        </div>

        {/* ── RIGHT PANE: CHAT THREAD & COMPOSER (8 cols) ───────────────── */}
        <div className="md:col-span-8 flex flex-col h-full bg-[#F4F4F0] relative">
          
          {selectedConvId && activeConv ? (
            <>
              {/* Active Chat Header */}
              <div className="p-3 bg-white border-b border-[#E2E2DC] flex items-center justify-between gap-3 shrink-0 shadow-xs z-10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 text-white font-bold flex items-center justify-center text-sm shrink-0">
                    {(activeConv.contact_name || activeConv.wa_id).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-[#1C1C1A]">
                      {activeConv.contact_name || activeConv.wa_id}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[#6B6B63]">+{activeConv.wa_id}</span>
                      {activeConv.customers && (
                        <span className="text-[9px] font-extrabold uppercase bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full">
                          Pelanggan Terhubung
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCustomerDrawer(!showCustomerDrawer)}
                    className="p-1.5 border border-[#E2E2DC] hover:bg-[#F7F7F5] rounded-lg text-xs font-bold text-[#1C1C1A] transition-all cursor-pointer"
                    title="Info Pelanggan"
                  >
                    👤 {showCustomerDrawer ? 'Sembunyikan Info' : 'Info Pelanggan'}
                  </button>
                </div>
              </div>

              {/* Chat Thread Scrollable Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gradient-to-b from-[#F4F4F0] to-[#EBEBE5]">
                {loadingMessages ? (
                  <div className="p-8 text-center text-xs font-bold text-[#A8A89E] space-y-2">
                    <div className="w-6 h-6 border-2 border-[#E2E2DC] border-t-green-600 rounded-full animate-spin mx-auto" />
                    <span>Memuat pesan...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#A8A89E] space-y-2">
                    <span className="text-3xl block">💬</span>
                    <span>Belum ada pesan dalam percakapan ini. Silakan ketik pesan di bawah untuk memulai chat.</span>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOutgoing = msg.direction === 'outgoing'

                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] sm:max-w-[70%] rounded-xl p-3 shadow-xs space-y-1 relative ${
                            isOutgoing
                              ? 'bg-green-700 text-white rounded-tr-none'
                              : 'bg-white text-[#1C1C1A] border border-[#E2E2DC] rounded-tl-none'
                          }`}
                        >
                          {/* Text Body */}
                          <p className="text-xs leading-relaxed whitespace-pre-wrap break-words font-medium">
                            {msg.text_body}
                          </p>

                          {/* Error Banner if Failed */}
                          {msg.status === 'failed' && (
                            <div className="mt-1 p-1.5 bg-red-800 text-white rounded text-[10px] font-bold">
                              ⚠️ Gagal: {msg.error_message || 'Pesan tidak terkirim'}
                            </div>
                          )}

                          {/* Footer: Time & Status */}
                          <div className={`flex items-center justify-end gap-1.5 text-[9px] pt-0.5 ${
                            isOutgoing ? 'text-green-200' : 'text-[#A8A89E]'
                          }`}>
                            <span>{formatTime(msg.created_at)}</span>
                            {isOutgoing && renderStatusIcon(msg.status)}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Composer Bar */}
              <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-[#E2E2DC] shrink-0 flex items-center gap-2">
                <textarea
                  rows={1}
                  placeholder="Ketik pesan WhatsApp... (Enter untuk kirim, Shift+Enter untuk baris baru)"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  className="flex-1 px-3.5 py-2.5 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-500 resize-none max-h-24 font-medium"
                />

                <button
                  type="submit"
                  disabled={!textInput.trim() || sending}
                  className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-40 cursor-pointer shrink-0 flex items-center gap-1"
                >
                  {sending ? 'Mengirim...' : 'Kirim 📤'}
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-slate-200/60 text-slate-500 flex items-center justify-center text-3xl">
                💬
              </div>
              <h3 className="text-base font-bold text-[#1C1C1A]">Pilih Percakapan</h3>
              <p className="text-xs text-[#6B6B63] max-w-sm">
                Pilih salah satu percakapan di daftar sebelah kiri untuk membaca dan membalas pesan WhatsApp pelanggan.
              </p>
            </div>
          )}

          {/* ── RIGHT CUSTOMER DRAWER OVERLAY ──────────────────────────── */}
          {showCustomerDrawer && activeConv && (
            <div className="absolute inset-y-0 right-0 w-80 bg-white border-l border-[#E2E2DC] shadow-xl p-5 z-20 overflow-y-auto space-y-6">
              <div className="flex items-center justify-between border-b border-[#E2E2DC] pb-3">
                <h4 className="font-extrabold text-xs text-[#1C1C1A] uppercase tracking-wider">
                  Profil Pelanggan
                </h4>
                <button
                  onClick={() => setShowCustomerDrawer(false)}
                  className="text-xs font-bold text-[#A8A89E] hover:text-[#1C1C1A]"
                >
                  ✕
                </button>
              </div>

              <div className="text-center space-y-2">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-700 text-white font-bold flex items-center justify-center text-2xl mx-auto shadow-sm">
                  {(activeConv.contact_name || activeConv.wa_id).charAt(0).toUpperCase()}
                </div>
                <h3 className="text-sm font-black text-[#1C1C1A]">{activeConv.contact_name || activeConv.wa_id}</h3>
                <span className="text-xs font-mono text-[#6B6B63] block">+{activeConv.wa_id}</span>
              </div>

              {activeConv.customers ? (
                <div className="space-y-4 pt-2">
                  <div className="p-3 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg space-y-2 text-xs">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase text-[#A8A89E] block">Nama di CRM</span>
                      <span className="font-bold text-[#1C1C1A]">{activeConv.customers.name}</span>
                    </div>

                    {activeConv.customers.email && (
                      <div>
                        <span className="text-[10px] font-extrabold uppercase text-[#A8A89E] block">Email</span>
                        <span className="font-medium text-[#1C1C1A]">{activeConv.customers.email}</span>
                      </div>
                    )}

                    {activeConv.customers.category && (
                      <div>
                        <span className="text-[10px] font-extrabold uppercase text-[#A8A89E] block">Kategori</span>
                        <span className="font-bold text-green-700">{activeConv.customers.category}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2">
                    <Link
                      href={`/customers?search=${encodeURIComponent(activeConv.wa_id)}`}
                      className="block w-full text-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
                    >
                      Buka Profil Pelanggan di CRM &rarr;
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
                  <p>Nomor HP ini belum terhubung dengan data Pelanggan lengkap di CRM.</p>
                  <Link
                    href={`/customers?new_phone=${encodeURIComponent(activeConv.wa_id)}&new_name=${encodeURIComponent(activeConv.contact_name)}`}
                    className="inline-block px-3 py-1.5 bg-amber-600 text-white font-bold rounded text-[11px]"
                  >
                    + Buat Data Pelanggan Baru
                  </Link>
                </div>
              )}
            </div>
          )}

        </div>

      </div>
    </div>
  )
}
