"use client"

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import type { KirimDevConversation, KirimDevMessage } from '../types'

// ============================================================
// Utility helpers
// ============================================================

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Baru saja'
  if (mins < 60) return `${mins} mnt`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} jam`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days} hr`
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')
}

function getAvatarColor(name: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f97316',
    '#14b8a6', '#0ea5e9', '#22c55e', '#eab308',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

// ============================================================
// Sub-components
// ============================================================

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const color = getAvatarColor(name)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.38,
        fontWeight: 700,
        color: '#fff',
        flexShrink: 0,
        letterSpacing: '-0.02em',
      }}
    >
      {getInitials(name)}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    sent:      { label: 'Terkirim', color: '#6b7280', bg: '#f3f4f6' },
    delivered: { label: 'Diterima', color: '#0ea5e9', bg: '#e0f2fe' },
    read:      { label: 'Dibaca',   color: '#22c55e', bg: '#dcfce7' },
    failed:    { label: 'Gagal',    color: '#ef4444', bg: '#fee2e2' },
    received:  { label: 'Masuk',    color: '#8b5cf6', bg: '#ede9fe' },
  }
  const s = map[status] ?? { label: status, color: '#6b7280', bg: '#f3f4f6' }
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 20,
      color: s.color, background: s.bg, letterSpacing: '0.02em',
    }}>
      {s.label}
    </span>
  )
}

function MessageBubble({ msg }: { msg: KirimDevMessage }) {
  const isOut = msg.direction === 'outgoing'
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isOut ? 'flex-end' : 'flex-start',
      marginBottom: 4,
    }}>
      <div style={{
        maxWidth: '72%',
        padding: '9px 14px',
        borderRadius: isOut ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: isOut ? '#2563EB' : '#ffffff',
        color: isOut ? '#ffffff' : '#1C1C1A',
        fontSize: 14,
        lineHeight: 1.5,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        wordBreak: 'break-word',
        border: isOut ? 'none' : '1px solid #E2E2DC',
      }}>
        {msg.text_body || (
          <span style={{ fontStyle: 'italic', opacity: 0.7 }}>
            [{msg.message_type}]
          </span>
        )}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginTop: 3,
        paddingRight: isOut ? 2 : 0,
        paddingLeft: isOut ? 0 : 2,
      }}>
        <span style={{ fontSize: 11, color: '#A8A89E' }}>
          {formatMessageTime(msg.created_at)}
        </span>
        {isOut && <StatusBadge status={msg.status} />}
      </div>
    </div>
  )
}

function DateDivider({ date }: { date: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      margin: '12px 0', padding: '0 8px',
    }}>
      <div style={{ flex: 1, height: 1, background: '#E2E2DC' }} />
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#A8A89E',
        whiteSpace: 'nowrap', letterSpacing: '0.04em',
      }}>
        {date}
      </span>
      <div style={{ flex: 1, height: 1, background: '#E2E2DC' }} />
    </div>
  )
}

// ============================================================
// Main Inbox Component
// ============================================================

interface KirimDevInboxProps {
  initialConfigured?: boolean
  initialActive?: boolean
}

export default function KirimDevInbox({
  initialConfigured = true,
  initialActive = true,
}: KirimDevInboxProps) {
  // Using singleton supabase client from @/lib/supabase

  // ── State ───────────────────────────────────────────────────
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [isConfigured, setIsConfigured] = useState(initialConfigured)
  const [isActive, setIsActive] = useState(initialActive)
  const [loadingBiz, setLoadingBiz] = useState(true)

  const [conversations, setConversations] = useState<KirimDevConversation[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'all' | 'unread' | 'resolved'>('all')

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)
  const [activeConv, setActiveConv] = useState<KirimDevConversation | null>(null)
  const [messages, setMessages] = useState<KirimDevMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const [textInput, setTextInput] = useState('')
  const [sending, setSending] = useState(false)

  const [showContactPanel, setShowContactPanel] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Business check ──────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      setLoadingBiz(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id')
          .eq('id', user.id)
          .single()
        setActiveBusinessId(profile?.active_business_id ?? null)
      }
      setLoadingBiz(false)
    })()
  }, [supabase])

  // ── Load conversations ──────────────────────────────────────
  const loadConversations = useCallback(async () => {
    setLoadingConvs(true)
    try {
      const res = await fetch('/api/plugin/kirimdev/conversations')
      const data = await res.json()
      if (data.success) {
        setConversations(data.conversations ?? [])
        setIsConfigured(data.configured ?? true)
        setIsActive(data.active ?? true)
      }
    } catch (err) {
      console.error('Failed to load kirimdev conversations', err)
    } finally {
      setLoadingConvs(false)
    }
  }, [])

  useEffect(() => {
    if (!loadingBiz) loadConversations()
  }, [loadingBiz, loadConversations])

  // ── Load messages ───────────────────────────────────────────
  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true)
    try {
      const res = await fetch(`/api/plugin/kirimdev/messages?conversation_id=${convId}`)
      const data = await res.json()
      if (data.success) {
        setMessages(data.messages ?? [])
        setActiveConv(data.conversation)
        // Reset unread in local state
        setConversations(prev =>
          prev.map(c => c.id === convId ? { ...c, unread_count: 0 } : c)
        )
      }
    } catch (err) {
      console.error('Failed to load messages', err)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  useEffect(() => {
    if (selectedConvId) loadMessages(selectedConvId)
  }, [selectedConvId, loadMessages])

  // ── Auto-scroll to bottom ───────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Realtime subscriptions ──────────────────────────────────
  useEffect(() => {
    if (!activeBusinessId) return

    const convChannel = supabase
      .channel('kirimdev_convs')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kirimdev_conversations',
        filter: `business_id=eq.${activeBusinessId}`,
      }, () => loadConversations())
      .subscribe()

    return () => { supabase.removeChannel(convChannel) }
  }, [activeBusinessId, supabase, loadConversations])

  useEffect(() => {
    if (!selectedConvId) return

    const msgChannel = supabase
      .channel(`kirimdev_msgs_${selectedConvId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'kirimdev_messages',
        filter: `conversation_id=eq.${selectedConvId}`,
      }, payload => {
        setMessages(prev => {
          const already = prev.some(m => m.id === payload.new.id)
          return already ? prev : [...prev, payload.new as KirimDevMessage]
        })
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'kirimdev_messages',
        filter: `conversation_id=eq.${selectedConvId}`,
      }, payload => {
        setMessages(prev =>
          prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m)
        )
      })
      .subscribe()

    return () => { supabase.removeChannel(msgChannel) }
  }, [selectedConvId, supabase])

  // ── Send message ────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!textInput.trim() || !activeConv || sending) return
    const text = textInput.trim()
    setTextInput('')
    setSending(true)

    try {
      const res = await fetch('/api/plugin/kirimdev/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConv.id,
          to: activeConv.wa_id,
          text,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
    } catch (err: any) {
      alert('Gagal mengirim pesan: ' + err.message)
      setTextInput(text) // restore
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }, [textInput, activeConv, sending])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Filter conversations ─────────────────────────────────────
  const filteredConvs = useMemo(() => {
    return conversations.filter(c => {
      const matchSearch =
        !searchQuery ||
        c.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.wa_id.includes(searchQuery) ||
        c.last_message_text?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchTab =
        filterTab === 'all' ? true :
        filterTab === 'unread' ? c.unread_count > 0 :
        c.status === 'resolved'
      return matchSearch && matchTab
    })
  }, [conversations, searchQuery, filterTab])

  // ── Group messages by date ───────────────────────────────────
  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: KirimDevMessage[] }[] = []
    messages.forEach(msg => {
      const d = new Date(msg.created_at)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)

      let dateLabel: string
      if (d.toDateString() === today.toDateString()) dateLabel = 'Hari ini'
      else if (d.toDateString() === yesterday.toDateString()) dateLabel = 'Kemarin'
      else dateLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

      const last = groups[groups.length - 1]
      if (last?.date === dateLabel) {
        last.messages.push(msg)
      } else {
        groups.push({ date: dateLabel, messages: [msg] })
      }
    })
    return groups
  }, [messages])

  // ── Render: Loading ──────────────────────────────────────────
  if (loadingBiz) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#A8A89E' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
          <p>Memuat...</p>
        </div>
      </div>
    )
  }

  // ── Render: Not Configured ───────────────────────────────────
  if (!isConfigured || !isActive) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', padding: 32,
      }}>
        <div style={{
          maxWidth: 440, textAlign: 'center', padding: '40px 32px',
          background: '#fff', borderRadius: 16, border: '1px solid #E2E2DC',
          boxShadow: '0 4px 16px rgba(28,28,26,0.06)',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, margin: '0 auto 20px',
          }}>💬</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1C1C1A', marginBottom: 10 }}>
            Plugin kirim.dev Belum Aktif
          </h2>
          <p style={{ fontSize: 14, color: '#6B6B63', lineHeight: 1.6, marginBottom: 24 }}>
            {!isConfigured
              ? 'Hubungkan akun kirim.dev Anda untuk mulai menerima dan mengirim pesan WhatsApp langsung dari ShapeUp CRM.'
              : 'Plugin kirim.dev sedang dinonaktifkan. Aktifkan kembali di Pengaturan Integrasi.'}
          </p>
          <Link
            href="/settings/integrations"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', borderRadius: 8, background: '#2563EB',
              color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'none',
              transition: 'background 0.15s',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path d="M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            Buka Pengaturan Integrasi
          </Link>
          <p style={{ fontSize: 12, color: '#A8A89E', marginTop: 16 }}>
            Butuh panduan?{' '}
            <a href="https://kirim.dev/docs/" target="_blank" rel="noopener noreferrer"
              style={{ color: '#2563EB', textDecoration: 'none' }}>
              Lihat dokumentasi kirim.dev →
            </a>
          </p>
        </div>
      </div>
    )
  }

  // ── Render: Main Inbox ───────────────────────────────────────
  return (
    <div style={{
      display: 'flex', height: '100%', background: '#F7F7F5', overflow: 'hidden',
      '--mobile-display-left': selectedConvId ? 'none' : 'flex',
      '--mobile-display-right': selectedConvId ? 'flex' : 'none',
    } as any}>
      {/* ── LEFT: Conversation List ──────────────────────────── */}
      <div 
        className="kirimdev-inbox-left"
        style={{
        width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: '#ffffff', borderRight: '1px solid #E2E2DC',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #E2E2DC' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'linear-gradient(135deg, #25D366, #128C7E)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}>💬</div>
              <h1 style={{ fontSize: 15, fontWeight: 700, color: '#1C1C1A' }}>
                kirim.dev Inbox
              </h1>
            </div>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: '#22c55e',
              boxShadow: '0 0 0 3px #dcfce7',
            }} title="Terhubung" />
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <svg
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#A8A89E' }}
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Cari percakapan..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px 8px 32px',
                border: '1px solid #E2E2DC', borderRadius: 8, fontSize: 13,
                color: '#1C1C1A', background: '#F7F7F5', outline: 'none',
              }}
            />
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
            {(['all', 'unread', 'resolved'] as const).map(tab => {
              const labels = { all: 'Semua', unread: 'Belum Dibaca', resolved: 'Selesai' }
              const isActive = filterTab === tab
              const unreadCount = tab === 'unread' ? conversations.filter(c => c.unread_count > 0).length : null
              return (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  style={{
                    flex: 1, padding: '5px 4px', borderRadius: 6, border: 'none',
                    fontSize: 11.5, fontWeight: isActive ? 700 : 500, cursor: 'pointer',
                    background: isActive ? '#2563EB' : 'transparent',
                    color: isActive ? '#fff' : '#6B6B63',
                    transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >
                  {labels[tab]}
                  {unreadCount ? (
                    <span style={{
                      background: isActive ? 'rgba(255,255,255,0.3)' : '#ef4444',
                      color: '#fff', fontSize: 10, fontWeight: 700,
                      padding: '1px 5px', borderRadius: 20, lineHeight: 1.4,
                    }}>
                      {unreadCount}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingConvs ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#A8A89E' }}>
              <div style={{ marginBottom: 8, fontSize: 22 }}>⏳</div>
              <p style={{ fontSize: 13 }}>Memuat percakapan...</p>
            </div>
          ) : filteredConvs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#A8A89E' }}>
              <div style={{ marginBottom: 8, fontSize: 28 }}>💬</div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1C1C1A' }}>Belum ada percakapan</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>
                {searchQuery ? 'Tidak ada hasil pencarian.' : 'Pesan masuk akan muncul di sini.'}
              </p>
            </div>
          ) : (
            filteredConvs.map(conv => {
              const isSelected = selectedConvId === conv.id
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                    padding: '13px 16px', border: 'none', cursor: 'pointer',
                    background: isSelected ? '#EFF6FF' : 'transparent',
                    borderLeft: isSelected ? '3px solid #2563EB' : '3px solid transparent',
                    textAlign: 'left', transition: 'background 0.1s',
                  }}
                >
                  <Avatar name={conv.contact_name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                      <span style={{
                        fontSize: 13.5, fontWeight: conv.unread_count > 0 ? 700 : 500,
                        color: '#1C1C1A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        maxWidth: 160,
                      }}>
                        {conv.contact_name}
                      </span>
                      <span style={{ fontSize: 11, color: '#A8A89E', flexShrink: 0 }}>
                        {conv.last_message_at ? formatRelativeTime(conv.last_message_at) : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <p style={{
                        fontSize: 12.5, color: conv.unread_count > 0 ? '#1C1C1A' : '#6B6B63',
                        fontWeight: conv.unread_count > 0 ? 600 : 400,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        maxWidth: 170,
                      }}>
                        {conv.last_message_text ?? 'Belum ada pesan'}
                      </p>
                      {conv.unread_count > 0 && (
                        <span style={{
                          background: '#2563EB', color: '#fff', fontSize: 10, fontWeight: 700,
                          padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                        }}>
                          {conv.unread_count > 99 ? '99+' : conv.unread_count}
                        </span>
                      )}
                    </div>
                    <div style={{ marginTop: 3 }}>
                      <span style={{
                        fontSize: 10.5, color: '#A8A89E',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.11 6.11l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                        </svg>
                        +{conv.wa_id}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── RIGHT: Chat Panel ───────────────────────────────────── */}
      {selectedConvId && activeConv ? (
        <div className="kirimdev-inbox-right" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Chat header */}
          <div style={{
            padding: '12px 20px', background: '#ffffff', borderBottom: '1px solid #E2E2DC',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(28,28,26,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                className="kirimdev-back-btn"
                onClick={() => setSelectedConvId(null)}
                style={{
                  background: 'none', border: 'none', padding: '4px', cursor: 'pointer',
                  marginRight: -4, display: 'none', color: '#6B6B63'
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              <Avatar name={activeConv.contact_name} size={38} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#1C1C1A' }}>
                  {activeConv.contact_name}
                </div>
                <div style={{ fontSize: 12, color: '#6B6B63', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>+{activeConv.wa_id}</span>
                  {activeConv.customers && (
                    <>
                      <span style={{ color: '#E2E2DC' }}>·</span>
                      <span style={{ color: '#2563EB', fontWeight: 600 }}>
                        {activeConv.customers.name}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Status badge */}
              <span style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                background: activeConv.status === 'open' ? '#dcfce7' : activeConv.status === 'resolved' ? '#f3f4f6' : '#fef9c3',
                color: activeConv.status === 'open' ? '#16a34a' : activeConv.status === 'resolved' ? '#6b7280' : '#ca8a04',
              }}>
                {activeConv.status === 'open' ? 'Aktif' : activeConv.status === 'resolved' ? 'Selesai' : 'Menunggu'}
              </span>
              {/* Toggle contact panel */}
              <button
                onClick={() => setShowContactPanel(p => !p)}
                title="Info Kontak"
                style={{
                  width: 34, height: 34, borderRadius: 8, border: '1px solid #E2E2DC',
                  background: showContactPanel ? '#EFF6FF' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: showContactPanel ? '#2563EB' : '#6B6B63',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </button>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {/* Message thread */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '16px 20px',
              display: 'flex', flexDirection: 'column', gap: 2,
              background: '#F7F7F5',
            }}>
              {loadingMessages ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: '#A8A89E', fontSize: 13 }}>
                  Memuat pesan...
                </div>
              ) : groupedMessages.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#A8A89E' }}>
                  <div style={{ fontSize: 40 }}>💬</div>
                  <p style={{ fontSize: 14 }}>Belum ada pesan. Mulai percakapan!</p>
                </div>
              ) : (
                groupedMessages.map(group => (
                  <div key={group.date}>
                    <DateDivider date={group.date} />
                    {group.messages.map(msg => (
                      <MessageBubble key={msg.id} msg={msg} />
                    ))}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Contact info panel */}
            {showContactPanel && (
              <div style={{
                width: 260, flexShrink: 0, background: '#ffffff',
                borderLeft: '1px solid #E2E2DC', padding: '20px 16px',
                overflowY: 'auto',
              }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: '#1C1C1A', marginBottom: 16, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Info Kontak
                </h3>
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                  <Avatar name={activeConv.contact_name} size={56} />
                  <div style={{ marginTop: 10, fontWeight: 700, fontSize: 15, color: '#1C1C1A' }}>
                    {activeConv.contact_name}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B6B63', marginTop: 2 }}>
                    +{activeConv.wa_id}
                  </div>
                </div>
                {activeConv.customers ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <InfoRow label="Nama" value={activeConv.customers.name} />
                    <InfoRow label="Telepon" value={activeConv.customers.phone} />
                    {activeConv.customers.email && (
                      <InfoRow label="Email" value={activeConv.customers.email} />
                    )}
                    {activeConv.customers.category && (
                      <InfoRow label="Kategori" value={activeConv.customers.category} />
                    )}
                    <Link
                      href={`/customers?id=${activeConv.customer_id}`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        marginTop: 8, padding: '8px 16px', borderRadius: 8, background: '#EFF6FF',
                        color: '#2563EB', fontWeight: 600, fontSize: 13, textDecoration: 'none',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      Lihat Profil Customer
                    </Link>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: '#A8A89E', fontSize: 13 }}>
                    <p>Nomor ini belum terhubung ke data customer.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div style={{
            padding: '12px 20px', background: '#ffffff', borderTop: '1px solid #E2E2DC',
            display: 'flex', alignItems: 'flex-end', gap: 10,
          }}>
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ketik pesan... (Enter untuk kirim)"
              rows={1}
              style={{
                flex: 1, padding: '10px 14px', border: '1px solid #E2E2DC', borderRadius: 24,
                fontSize: 14, resize: 'none', outline: 'none', lineHeight: 1.5,
                maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit',
                color: '#1C1C1A', background: '#F7F7F5',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = '#2563EB'}
              onBlur={e => e.target.style.borderColor = '#E2E2DC'}
            />
            <button
              onClick={handleSend}
              disabled={!textInput.trim() || sending}
              style={{
                width: 42, height: 42, borderRadius: '50%', border: 'none',
                background: textInput.trim() && !sending ? '#2563EB' : '#E2E2DC',
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: textInput.trim() && !sending ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s', flexShrink: 0,
              }}
              title="Kirim pesan"
            >
              {sending ? (
                <div style={{
                  width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                }} />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Empty chat panel */
        <div className="kirimdev-inbox-right" style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 14, color: '#A8A89E',
          background: '#F7F7F5',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34,
          }}>
            💬
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontWeight: 700, fontSize: 16, color: '#1C1C1A' }}>
              Pilih percakapan
            </p>
            <p style={{ fontSize: 13, marginTop: 4 }}>
              Klik percakapan di kiri untuk mulai membalas pesan WhatsApp.
            </p>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .kirimdev-inbox-left {
            width: 100% !important;
            display: var(--mobile-display-left) !important;
            border-right: none !important;
          }
          .kirimdev-inbox-right {
            display: var(--mobile-display-right) !important;
          }
          .kirimdev-back-btn {
            display: block !important;
          }
        }
      `}</style>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: '#A8A89E', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: '#1C1C1A', wordBreak: 'break-all' }}>
        {value}
      </div>
    </div>
  )
}
