"use client"

import { useState, useCallback, useEffect } from 'react'

interface KirimDevSettingsModalProps {
  businessId: string
  onClose: () => void
  onSaved: () => void
  initialData?: {
    api_key?: string
    phone_number_id?: string
    webhook_secret?: string
    is_active?: boolean
  }
}

export default function KirimDevSettingsModal({
  businessId,
  onClose,
  onSaved,
  initialData,
}: KirimDevSettingsModalProps) {
  const [form, setForm] = useState({
    api_key: initialData?.api_key ?? '',
    phone_number_id: initialData?.phone_number_id ?? '',
    webhook_secret: initialData?.webhook_secret ?? '',
    is_active: initialData?.is_active ?? true,
  })

  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)

  const [copied, setCopied] = useState(false)

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/plugin/kirimdev/webhook?bid=${businessId}`
      : ''

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleChange = (key: keyof typeof form, value: string | boolean) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setTestResult(null)
    setSaveOk(false)
  }

  const handleTest = useCallback(async () => {
    if (!form.api_key || !form.phone_number_id) {
      setTestResult({ success: false, message: 'Isi API Key dan Phone Number ID terlebih dahulu.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/plugin/kirimdev/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: form.api_key, phone_number_id: form.phone_number_id }),
      })
      const data = await res.json()
      if (data.success) {
        setTestResult({ success: true, message: data.message ?? 'Koneksi berhasil! API Key valid.' })
      } else {
        setTestResult({ success: false, message: data.error ?? 'Koneksi gagal.' })
      }
    } catch {
      setTestResult({ success: false, message: 'Gagal menghubungi server.' })
    } finally {
      setTesting(false)
    }
  }, [form.api_key, form.phone_number_id])

  const handleSave = useCallback(async () => {
    if (!form.api_key || !form.phone_number_id) {
      setTestResult({ success: false, message: 'API Key dan Phone Number ID wajib diisi.' })
      return
    }
    setSaving(true)
    setSaveOk(false)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'kirimdev',
          name: 'kirim.dev',
          is_active: form.is_active,
          config: {
            api_key: form.api_key.trim(),
            phone_number_id: form.phone_number_id.trim(),
            webhook_secret: form.webhook_secret.trim(),
          },
        }),
      })
      const data = await res.json()
      if (data.success) {
        setSaveOk(true)
        onSaved()
        setTimeout(onClose, 1200)
      } else {
        setTestResult({ success: false, message: data.error ?? 'Gagal menyimpan konfigurasi.' })
      }
    } catch {
      setTestResult({ success: false, message: 'Gagal menyimpan ke server.' })
    } finally {
      setSaving(false)
    }
  }, [form, onSaved, onClose])

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(28,28,26,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16, backdropFilter: 'blur(4px)',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(28,28,26,0.18), 0 4px 16px rgba(28,28,26,0.08)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #E2E2DC',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: '#fff', zIndex: 1, borderRadius: '16px 16px 0 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'linear-gradient(135deg, #25D366, #128C7E)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>💬</div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1C1C1A', margin: 0 }}>
                kirim.dev
              </h2>
              <p style={{ fontSize: 12.5, color: '#6B6B63', margin: '2px 0 0' }}>
                WhatsApp Business API
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid #E2E2DC',
              background: 'transparent', cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#6B6B63',
              fontSize: 18, fontWeight: 300,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {/* Info banner */}
          <div style={{
            padding: '12px 14px', borderRadius: 10, background: '#EFF6FF',
            border: '1px solid #BFDBFE', marginBottom: 20,
            display: 'flex', gap: 10,
          }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
            <div>
              <p style={{ fontSize: 12.5, color: '#1e40af', lineHeight: 1.5, margin: 0 }}>
                kirim.dev meneruskan permintaan ke Meta Cloud API menggunakan API Key Anda.
                Tidak perlu memasukkan Meta token — token disimpan aman di vault kirim.dev.
              </p>
              <a
                href="https://kirim.dev/docs/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: '#2563EB', textDecoration: 'none', fontWeight: 600, display: 'inline-block', marginTop: 4 }}
              >
                Buka dokumentasi kirim.dev →
              </a>
            </div>
          </div>

          {/* Active toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', background: '#F7F7F5', borderRadius: 10,
            border: '1px solid #E2E2DC', marginBottom: 20,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1C1C1A' }}>Plugin Aktif</div>
              <div style={{ fontSize: 12, color: '#6B6B63', marginTop: 1 }}>
                {form.is_active ? 'Inbox dan pengiriman pesan aktif.' : 'Plugin dinonaktifkan sementara.'}
              </div>
            </div>
            <button
              onClick={() => handleChange('is_active', !form.is_active)}
              style={{
                width: 46, height: 26, borderRadius: 13, border: 'none',
                background: form.is_active ? '#2563EB' : '#D1D5DB',
                cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: form.is_active ? 22 : 3,
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', display: 'block',
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>

          {/* Form fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FormField
              label="kirim.dev API Key"
              required
              description="Dapatkan dari dashboard kirim.dev › API Keys. Format: kd_live_... atau kd_test_..."
            >
              <div style={{ position: 'relative' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={form.api_key}
                  onChange={e => handleChange('api_key', e.target.value)}
                  placeholder="kd_live_a1B2c3D4..."
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(p => !p)}
                  style={eyeBtnStyle}
                >
                  {showApiKey ? '🙈' : '👁️'}
                </button>
              </div>
            </FormField>

            <FormField
              label="Phone Number ID"
              required
              description="ID nomor WhatsApp yang terhubung di dashboard kirim.dev."
            >
              <input
                type="text"
                value={form.phone_number_id}
                onChange={e => handleChange('phone_number_id', e.target.value)}
                placeholder="123456789012345"
                style={inputStyle}
              />
            </FormField>

            <FormField
              label="Webhook Signing Secret"
              description="Secret dari halaman Webhooks kirim.dev. Digunakan untuk verifikasi signature."
            >
              <div style={{ position: 'relative' }}>
                <input
                  type={showSecret ? 'text' : 'password'}
                  value={form.webhook_secret}
                  onChange={e => handleChange('webhook_secret', e.target.value)}
                  placeholder="Signing secret dari kirim.dev"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(p => !p)}
                  style={eyeBtnStyle}
                >
                  {showSecret ? '🙈' : '👁️'}
                </button>
              </div>
            </FormField>
          </div>

          {/* Webhook URL */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6B6B63', marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              URL Webhook untuk kirim.dev
            </div>
            <div style={{
              display: 'flex', gap: 8, padding: '10px 14px', background: '#F7F7F5',
              border: '1px solid #E2E2DC', borderRadius: 8,
            }}>
              <code style={{ flex: 1, fontSize: 11.5, color: '#1C1C1A', wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5 }}>
                {webhookUrl || '(URL akan tersedia setelah disimpan)'}
              </code>
              <button
                onClick={handleCopyWebhook}
                disabled={!webhookUrl}
                style={{
                  flexShrink: 0, padding: '4px 12px', borderRadius: 6, border: '1px solid #E2E2DC',
                  background: copied ? '#dcfce7' : '#fff', color: copied ? '#16a34a' : '#6B6B63',
                  fontSize: 12, fontWeight: 600, cursor: webhookUrl ? 'pointer' : 'not-allowed',
                  whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
              >
                {copied ? '✓ Disalin' : 'Salin'}
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: '#A8A89E', marginTop: 6, lineHeight: 1.5 }}>
              Daftarkan URL ini di dashboard kirim.dev › Webhooks. Subscribe ke field <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 3 }}>messages</code> dan <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 3 }}>statuses</code>.
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 8,
              background: testResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${testResult.success ? '#bbf7d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'flex-start', gap: 8,
            }}>
              <span style={{ flexShrink: 0 }}>{testResult.success ? '✅' : '❌'}</span>
              <p style={{ fontSize: 13, color: testResult.success ? '#15803d' : '#dc2626', margin: 0, lineHeight: 1.5 }}>
                {testResult.message}
              </p>
            </div>
          )}
          {saveOk && (
            <div style={{
              marginTop: 16, padding: '10px 14px', borderRadius: 8,
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✅</span>
              <p style={{ fontSize: 13, color: '#15803d', margin: 0 }}>Konfigurasi berhasil disimpan!</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid #E2E2DC',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          position: 'sticky', bottom: 0, background: '#fff',
          borderRadius: '0 0 16px 16px',
        }}>
          <button
            onClick={handleTest}
            disabled={testing || !form.api_key || !form.phone_number_id}
            style={{
              padding: '9px 18px', borderRadius: 8, border: '1px solid #E2E2DC',
              background: '#fff', color: '#1C1C1A', fontWeight: 600, fontSize: 13.5,
              cursor: testing || !form.api_key || !form.phone_number_id ? 'not-allowed' : 'pointer',
              opacity: testing || !form.api_key || !form.phone_number_id ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {testing ? (
              <>
                <span style={{
                  width: 13, height: 13, border: '2px solid #ccc',
                  borderTopColor: '#2563EB', borderRadius: '50%',
                  display: 'inline-block', animation: 'spin 0.7s linear infinite',
                }} />
                Menguji...
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Test Koneksi
              </>
            )}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px', borderRadius: 8, border: '1px solid #E2E2DC',
              background: '#fff', color: '#6B6B63', fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
            }}
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '9px 20px', borderRadius: 8, border: 'none',
              background: saving ? '#93c5fd' : '#2563EB',
              color: '#fff', fontWeight: 600, fontSize: 13.5,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving ? (
              <>
                <span style={{
                  width: 13, height: 13, border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  display: 'inline-block', animation: 'spin 0.7s linear infinite',
                }} />
                Menyimpan...
              </>
            ) : 'Simpan Konfigurasi'}
          </button>
        </div>
      </div>

      <style>{`
        input:focus { outline: none; border-color: #2563EB !important; box-shadow: 0 0 0 3px #dbeafe; }
      `}</style>
    </div>
  )
}

// ── Helper components ──

function FormField({
  label,
  required,
  description,
  children,
}: {
  label: string
  required?: boolean
  description?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#1C1C1A', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: '#ef4444', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {description && (
        <p style={{ fontSize: 11.5, color: '#A8A89E', marginTop: 5, lineHeight: 1.5 }}>{description}</p>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 40px 9px 12px',
  border: '1px solid #E2E2DC',
  borderRadius: 8,
  fontSize: 13.5,
  color: '#1C1C1A',
  background: '#fff',
  fontFamily: 'monospace',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 4px',
}
