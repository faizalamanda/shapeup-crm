"use client"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import SettingsLayout from '@/components/SettingsLayout'
import { INTEGRATION_PLUGINS, IntegrationPlugin } from '@/lib/integrations/registry'

export default function IntegrationsSettingsPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [activeBusinessName, setActiveBusinessName] = useState<string>('')
  const [loadingActiveBusiness, setLoadingActiveBusiness] = useState(true)

  // Integrations data state
  const [integrationsData, setIntegrationsData] = useState<Record<string, any>>({})
  const [loadingIntegrations, setLoadingIntegrations] = useState(false)

  // Selected plugin drawer / modal for editing
  const [selectedPlugin, setSelectedPlugin] = useState<IntegrationPlugin | null>(null)

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selectedPlugin) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [selectedPlugin])

  // WooCommerce Form State
  const [wooForm, setWooForm] = useState({
    store_url: '',
    consumer_key: '',
    consumer_secret: '',
    is_active: true,
  })

  // YCloud Form State
  const [ycloudForm, setYcloudForm] = useState({
    api_key: '',
    whatsapp_number: '',
    is_active: true,
  })

  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [showYcloudKey, setShowYcloudKey] = useState(false)

  // Fetch active business profile
  const checkActiveBusiness = useCallback(async () => {
    setLoadingActiveBusiness(true)
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
    setLoadingActiveBusiness(false)
  }, [supabase])

  // Fetch saved integrations from API
  const fetchIntegrations = useCallback(async () => {
    if (!activeBusinessId) return
    setLoadingIntegrations(true)
    try {
      const res = await fetch('/api/integrations')
      const json = await res.json()
      if (json.success && Array.isArray(json.integrations)) {
        const map: Record<string, any> = {}
        json.integrations.forEach((item: any) => {
          map[item.platform_name] = item
        })
        setIntegrationsData(map)

        // Populate WooCommerce form if exists
        const woo = map['woocommerce']
        if (woo) {
          const creds = woo.api_credentials || {}
          setWooForm({
            store_url: woo.store_url || '',
            consumer_key: creds.consumer_key || '',
            consumer_secret: creds.consumer_secret || '',
            is_active: woo.is_active ?? true,
          })
        }

        // Populate YCloud form if exists
        const ycloud = map['ycloud']
        if (ycloud) {
          const creds = ycloud.api_credentials || {}
          setYcloudForm({
            api_key: creds.api_key || '',
            whatsapp_number: creds.whatsapp_number || '',
            is_active: ycloud.is_active ?? true,
          })
        }
      }
    } catch (err) {
      console.error('Failed to load integrations:', err)
    } finally {
      setLoadingIntegrations(false)
    }
  }, [activeBusinessId])

  useEffect(() => {
    checkActiveBusiness()
  }, [checkActiveBusiness])

  useEffect(() => {
    if (activeBusinessId) {
      fetchIntegrations()
    }
  }, [activeBusinessId, fetchIntegrations])

  // Handle Save WooCommerce Integration
  const handleSaveWooCommerce = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'woocommerce',
          store_url: wooForm.store_url,
          consumer_key: wooForm.consumer_key,
          consumer_secret: wooForm.consumer_secret,
          is_active: wooForm.is_active,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan pengaturan')
      }

      setSaveSuccess(true)
      await fetchIntegrations()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Terjadi kesalahan saat menyimpan.'))
    } finally {
      setSaving(false)
    }
  }

  // Handle Save YCloud Integration
  const handleSaveYCloud = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'ycloud',
          api_key: ycloudForm.api_key,
          whatsapp_number: ycloudForm.whatsapp_number,
          is_active: ycloudForm.is_active,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan pengaturan YCloud')
      }

      setSaveSuccess(true)
      await fetchIntegrations()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Terjadi kesalahan saat menyimpan YCloud.'))
    } finally {
      setSaving(false)
    }
  }

  // Handle Test WooCommerce Connection
  const handleTestConnection = async () => {
    if (!wooForm.store_url || !wooForm.consumer_key || !wooForm.consumer_secret) {
      return alert('Harap isi URL Toko, Consumer Key, dan Consumer Secret terlebih dahulu!')
    }

    setTestingConnection(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations/woocommerce/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_url: wooForm.store_url,
          consumer_key: wooForm.consumer_key,
          consumer_secret: wooForm.consumer_secret,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success) {
        setTestResult({
          success: true,
          message: '✅ Berhasil terhubung ke REST API WooCommerce toko Anda!',
        })
      } else {
        setTestResult({
          success: false,
          message: json.error || 'Gagal terhubung ke REST API WooCommerce.',
        })
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: '⚠️ ' + (err.message || 'Terjadi kesalahan jaringan.'),
      })
    } finally {
      setTestingConnection(false)
    }
  }

  // Handle Test YCloud Connection
  const handleTestYCloudConnection = async () => {
    if (!ycloudForm.api_key.trim()) {
      return alert('Harap masukkan YCloud API Key terlebih dahulu!')
    }

    setTestingConnection(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations/ycloud/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: ycloudForm.api_key,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success) {
        setTestResult({
          success: true,
          message: json.message || '✅ Berhasil terhubung ke API YCloud!',
        })
      } else {
        setTestResult({
          success: false,
          message: '⚠️ ' + (json.error || 'Gagal terhubung ke YCloud API.'),
        })
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: '⚠️ ' + (err.message || 'Terjadi kesalahan jaringan.'),
      })
    } finally {
      setTestingConnection(false)
    }
  }

  // Handle Copy Webhook URL
  const handleCopyWebhook = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedWebhook(true)
    setTimeout(() => setCopiedWebhook(false), 2000)
  }

  if (loadingActiveBusiness) {
    return (
      <SettingsLayout title="Integrasi & Plugin" subtitle="Hubungkan WooCommerce, YCloud WhatsApp, dan API pihak ketiga.">
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
          <div className="w-8 h-8 border-3 border-[#E2E2DC] border-t-blue-600 rounded-full animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-[#A8A89E]">Memeriksa Unit Bisnis Aktif...</p>
        </div>
      </SettingsLayout>
    )
  }

  if (!activeBusinessId) {
    return (
      <SettingsLayout title="Integrasi & Plugin" subtitle="Hubungkan WooCommerce, YCloud WhatsApp, dan API pihak ketiga.">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-8 text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center text-xl mx-auto">
            ⚠️
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1A]">Unit Bisnis Aktif Belum Dipilih</h2>
          <p className="text-xs text-[#6B6B63]">
            Anda harus memilih atau mengaktifkan salah satu unit bisnis terlebih dahulu untuk mengelola Pengaturan Integrasi.
          </p>
          <div className="pt-2">
            <Link 
              href="/settings/business" 
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs"
            >
              Pilih Unit Bisnis &rarr;
            </Link>
          </div>
        </div>
      </SettingsLayout>
    )
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  
  // Plugin references
  const wooPlugin = INTEGRATION_PLUGINS.find(p => p.id === 'woocommerce')!
  const wooWebhookUrl = wooPlugin?.getWebhookUrl ? wooPlugin.getWebhookUrl(activeBusinessId, origin) : ''
  const wooSaved = integrationsData['woocommerce']
  const isWooConfigured = Boolean(wooSaved && wooSaved.store_url)

  const ycloudPlugin = INTEGRATION_PLUGINS.find(p => p.id === 'ycloud')!
  const ycloudWebhookUrl = ycloudPlugin?.getWebhookUrl ? ycloudPlugin.getWebhookUrl(activeBusinessId, origin) : ''
  const ycloudSaved = integrationsData['ycloud']
  const isYcloudConfigured = Boolean(ycloudSaved && ycloudSaved.api_credentials?.api_key)

  return (
    <SettingsLayout title="Integrasi & Plugin" subtitle="Hubungkan WooCommerce, YCloud WhatsApp, dan API pihak ketiga.">

      {/* Active Business Badge */}
      <div className="bg-white border border-[#E2E2DC] rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 font-extrabold flex items-center justify-center text-base">
            🏢
          </div>
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#A8A89E] block">Unit Bisnis Aktif</span>
            <span className="text-base font-bold text-[#1C1C1A]">{activeBusinessName || 'Bisnis Utama'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-ping" />
          <span className="text-xs font-bold text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-200">
            Siap Menerima Integrasi API & Webhook
          </span>
        </div>
      </div>

      {/* Section Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#1C1C1A]">Katalog Plugin Integrasi</h2>
          <p className="text-xs text-[#6B6B63]">
            Pilih dan atur integrasi platform toko online & layanan pesan Anda di bawah ini.
          </p>
        </div>
      </div>

      {/* Plugins Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 1. WOOCOMMERCE PLUGIN CARD */}
        <div className="bg-white rounded-xl border border-[#E2E2DC] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 font-extrabold flex items-center justify-center text-2xl">
                🛍️
              </div>
              <div>
                {isWooConfigured ? (
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                    wooSaved.is_active 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {wooSaved.is_active ? '✓ Terhubung & Aktif' : '⏸️ Dinonaktifkan'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full border border-slate-200">
                    Belum Dikonfigurasi
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-base font-bold text-[#1C1C1A]">WooCommerce</h3>
            <p className="text-xs text-[#6B6B63] mt-1.5 leading-relaxed">
              Hubungkan toko WordPress/WooCommerce Anda untuk mencatat pesanan, pelanggan, dan pembukuan jurnal secara otomatis.
            </p>
          </div>

          <div className="pt-4 border-t border-[#E2E2DC] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A89E]">Platform E-Commerce</span>
            <button
              onClick={() => {
                setSelectedPlugin(wooPlugin)
                setTestResult(null)
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isWooConfigured ? 'Kelola Integrasi ⚙️' : 'Atur Integrasi 🔌'}</span>
            </button>
          </div>
        </div>

        {/* 2. YCLOUD (WHATSAPP) PLUGIN CARD */}
        <div className="bg-white rounded-xl border border-[#E2E2DC] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 font-extrabold flex items-center justify-center text-2xl">
                💬
              </div>
              <div>
                {isYcloudConfigured ? (
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                    ycloudSaved.is_active 
                      ? 'bg-green-50 text-green-700 border-green-200' 
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {ycloudSaved.is_active ? '✓ Terhubung & Aktif' : '⏸️ Dinonaktifkan'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full border border-slate-200">
                    Belum Dikonfigurasi
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-base font-bold text-[#1C1C1A]">YCloud (WhatsApp)</h3>
            <p className="text-xs text-[#6B6B63] mt-1.5 leading-relaxed">
              Hubungkan YCloud WhatsApp Business API untuk pengiriman pesan otomatis, notifikasi pesanan, dan otomatisasi WhatsApp.
            </p>
          </div>

          <div className="pt-4 border-t border-[#E2E2DC] flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A89E]">Layanan Messaging</span>
            <button
              onClick={() => {
                setSelectedPlugin(ycloudPlugin)
                setTestResult(null)
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isYcloudConfigured ? 'Kelola YCloud ⚙️' : 'Atur YCloud 🔌'}</span>
            </button>
          </div>
        </div>

        {/* OTHER COMING SOON PLUGINS */}
        {INTEGRATION_PLUGINS.filter(p => p.status === 'coming_soon').map((plugin) => (
          <div 
            key={plugin.id}
            className="bg-[#F7F7F5] rounded-xl border border-[#E2E2DC] p-6 opacity-80 flex flex-col justify-between space-y-6 cursor-not-allowed"
          >
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-slate-200 border border-slate-300 text-slate-500 font-extrabold flex items-center justify-center text-2xl grayscale">
                  {plugin.icon}
                </div>
                <span className="text-[10px] font-bold uppercase bg-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full border border-slate-300">
                  {plugin.badge}
                </span>
              </div>

              <h3 className="text-base font-bold text-slate-700">{plugin.name}</h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {plugin.description}
              </p>
            </div>

            <div className="pt-4 border-t border-[#E2E2DC] flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Plugin Modular</span>
              <span className="text-xs font-bold text-slate-400 italic">Segera Hadir</span>
            </div>
          </div>
        ))}

      </div>

      {/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'woocommerce' && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-xl p-6 md:p-8 max-w-2xl w-full shadow-xl my-8 space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#E2E2DC] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 font-extrabold flex items-center justify-center text-xl">
                  🛍️
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#1C1C1A]">Integrasi WooCommerce</h2>
                  <p className="text-xs text-[#6B6B63]">
                    Unit Bisnis: <span className="font-bold text-blue-600">{activeBusinessName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedPlugin(null)
                  setTestResult(null)
                }}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Webhook Notice Section */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">⚡</span>
                <h4 className="font-bold text-xs text-amber-900 uppercase tracking-wider">
                  URL Webhook Otomatis (WordPress &gt; WooCommerce &gt; Settings &gt; Webhooks)
                </h4>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                Salin URL di bawah ini lalu masukkan saat membuat Webhook baru pada toko WooCommerce Anda (topik: <b>Order Created</b>).
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  readOnly
                  value={wooWebhookUrl}
                  className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg font-mono text-xs text-[#1C1C1A] select-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopyWebhook(wooWebhookUrl)}
                  className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold px-4 py-2 transition-all shrink-0 cursor-pointer"
                >
                  {copiedWebhook ? '✅ Tersalin!' : '📋 Salin'}
                </button>
              </div>
            </div>

            {/* Form Settings */}
            <form onSubmit={handleSaveWooCommerce} className="space-y-4">

              {/* Switch Active Integration */}
              <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg flex items-center justify-between">
                <div>
                  <label className="font-bold text-xs text-[#1C1C1A] block">
                    Status Integrasi Webhook
                  </label>
                  <span className="text-[10px] text-[#6B6B63]">
                    {wooForm.is_active 
                      ? 'Aktif — Webhook pesanan diproses oleh CRM' 
                      : 'Nonaktif — Webhook sementara diabaikan oleh CRM'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setWooForm({ ...wooForm, is_active: !wooForm.is_active })}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                    wooForm.is_active ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {wooForm.is_active ? '✓ AKTIF' : '⏸️ NONAKTIF'}
                </button>
              </div>

              {/* Store URL */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  URL Toko WordPress / WooCommerce <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://tokoanda.com"
                  value={wooForm.store_url}
                  onChange={(e) => setWooForm({ ...wooForm, store_url: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Domain utama website WooCommerce Anda.
                </span>
              </div>

              {/* Consumer Key & Consumer Secret */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Consumer Key (REST API) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ck_xxxxxxxx..."
                    value={wooForm.consumer_key}
                    onChange={(e) => setWooForm({ ...wooForm, consumer_key: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Consumer Secret (REST API) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="cs_xxxxxxxx..."
                    value={wooForm.consumer_secret}
                    onChange={(e) => setWooForm({ ...wooForm, consumer_secret: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Test Connection Banner Result */}
              {testResult && (
                <div className={`p-3 rounded-lg text-xs font-semibold ${
                  testResult.success 
                    ? 'bg-green-50 border border-green-200 text-green-700' 
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {testResult.message}
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs font-semibold text-green-700">
                  ✅ Pengaturan WooCommerce berhasil disimpan ke database!
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-[#E2E2DC] flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  disabled={testingConnection}
                  onClick={handleTestConnection}
                  className="flex-1 px-4 py-2.5 border border-[#E2E2DC] hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                >
                  {testingConnection ? '🔄 Menguji REST API...' : '🧪 Uji Koneksi REST API'}
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Menyimpan...' : '💾 Simpan Pengaturan'}
                </button>
              </div>

            </form>

          </div>
        </div>,
        document.body
      )}

      {/* YCLOUD (WHATSAPP) CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'ycloud' && mounted && createPortal(
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] overflow-y-auto overscroll-contain">
          <div className="bg-white border border-[#E2E2DC] rounded-xl p-6 md:p-8 max-w-2xl w-full shadow-xl my-8 space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#E2E2DC] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 font-extrabold flex items-center justify-center text-xl">
                  💬
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#1C1C1A]">Integrasi YCloud WhatsApp API</h2>
                  <p className="text-xs text-[#6B6B63]">
                    Unit Bisnis: <span className="font-bold text-emerald-600">{activeBusinessName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedPlugin(null)
                  setTestResult(null)
                }}
                className="text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Webhook Notice Section */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">⚡</span>
                <h4 className="font-bold text-xs text-emerald-900 uppercase tracking-wider">
                  URL Webhook Inbound Message / Status (YCloud Dashboard &gt; Webhooks)
                </h4>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Gunakan URL di bawah ini untuk menerima pesan masuk atau pembaruan status pesan WhatsApp di dashboard YCloud Anda.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  readOnly
                  value={ycloudWebhookUrl}
                  className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-lg font-mono text-xs text-[#1C1C1A] select-all outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopyWebhook(ycloudWebhookUrl)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold px-4 py-2 transition-all shrink-0 cursor-pointer"
                >
                  {copiedWebhook ? '✅ Tersalin!' : '📋 Salin'}
                </button>
              </div>
            </div>

            {/* Form Settings */}
            <form onSubmit={handleSaveYCloud} className="space-y-4">

              {/* Switch Active Integration */}
              <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-lg flex items-center justify-between">
                <div>
                  <label className="font-bold text-xs text-[#1C1C1A] block">
                    Status Integrasi YCloud
                  </label>
                  <span className="text-[10px] text-[#6B6B63]">
                    {ycloudForm.is_active 
                      ? 'Aktif — Pengiriman pesan & automation YCloud diizinkan' 
                      : 'Nonaktif — Pengiriman pesan sementara dihentikan'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setYcloudForm({ ...ycloudForm, is_active: !ycloudForm.is_active })}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                    ycloudForm.is_active ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {ycloudForm.is_active ? '✓ AKTIF' : '⏸️ NONAKTIF'}
                </button>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  YCloud API Key <span className="text-red-500">*</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showYcloudKey ? 'text' : 'password'}
                    required
                    placeholder="yc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={ycloudForm.api_key}
                    onChange={(e) => setYcloudForm({ ...ycloudForm, api_key: e.target.value })}
                    className="w-full px-3.5 py-2.5 pr-12 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowYcloudKey(!showYcloudKey)}
                    className="absolute right-3 text-sm text-[#A8A89E] hover:text-[#1C1C1A] transition-colors p-1 cursor-pointer"
                    title={showYcloudKey ? 'Sembunyikan API Key' : 'Tampilkan API Key'}
                  >
                    {showYcloudKey ? '🙈 Sembunyikan' : '👁️ Tampilkan'}
                  </button>
                </div>
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Dapatkan API Key dari Dashboard YCloud &gt; Settings &gt; API Keys.
                </span>
              </div>

              {/* WhatsApp Sender Phone Number */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Nomor WhatsApp Pengirim (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="6281234567890"
                  value={ycloudForm.whatsapp_number}
                  onChange={(e) => setYcloudForm({ ...ycloudForm, whatsapp_number: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                />
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Nomor WhatsApp terverifikasi di YCloud yang Anda gunakan sebagai pengirim (Format: Kode negara tanpa tanda +, cth: 62812...).
                </span>
              </div>

              {/* Test Connection Banner Result */}
              {testResult && (
                <div className={`p-3 rounded-lg text-xs font-semibold ${
                  testResult.success 
                    ? 'bg-green-50 border border-green-200 text-green-700' 
                    : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                  {testResult.message}
                </div>
              )}

              {saveSuccess && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs font-semibold text-green-700">
                  ✅ Pengaturan YCloud (WhatsApp) berhasil disimpan untuk unit bisnis {activeBusinessName}!
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-[#E2E2DC] flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  disabled={testingConnection}
                  onClick={handleTestYCloudConnection}
                  className="flex-1 px-4 py-2.5 border border-[#E2E2DC] hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-lg text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                >
                  {testingConnection ? '🔄 Menguji API YCloud...' : '🧪 Uji Koneksi YCloud API'}
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Menyimpan...' : '💾 Simpan Pengaturan YCloud'}
                </button>
              </div>

            </form>

          </div>
        </div>,
        document.body
      )}

    </SettingsLayout>
  )
}
