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
  const [wooForm, setWooForm] = useState<{
    store_url: string
    consumer_key: string
    consumer_secret: string
    is_active: boolean
    use_global_settings: boolean
    stock_reduction_status: string[]
    journal_hpp_status: string[]
  }>({
    store_url: '',
    consumer_key: '',
    consumer_secret: '',
    is_active: true,
    use_global_settings: true,
    stock_reduction_status: ['shipped', 'completed'],
    journal_hpp_status: ['shipped', 'completed']
  })

  // YCloud Form State
  const [ycloudForm, setYcloudForm] = useState({
    api_key: '',
    whatsapp_number: '',
    is_active: true,
  })

  // WABA Official Form State
  const [wabaForm, setWabaForm] = useState({
    access_token: '',
    phone_number_id: '',
    waba_id: '',
    webhook_verify_token: '',
    is_active: true,
  })

  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [showYcloudKey, setShowYcloudKey] = useState(false)
  const [showWabaToken, setShowWabaToken] = useState(false)

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
          let stockStatuses = creds.stock_reduction_status
          if (!Array.isArray(stockStatuses)) {
            stockStatuses = creds.stock_reduction_status ? [creds.stock_reduction_status] : ['shipped', 'completed']
          }
          let journalStatuses = creds.journal_hpp_status
          if (!Array.isArray(journalStatuses)) {
            journalStatuses = creds.journal_hpp_status ? [creds.journal_hpp_status] : ['shipped', 'completed']
          }
          setWooForm({
            store_url: woo.store_url || '',
            consumer_key: creds.consumer_key || '',
            consumer_secret: creds.consumer_secret || '',
            is_active: woo.is_active ?? true,
            use_global_settings: creds.use_global_settings ?? true,
            stock_reduction_status: stockStatuses,
            journal_hpp_status: journalStatuses
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

        // Populate WABA Official form if exists
        const waba = map['waba_official']
        if (waba) {
          const creds = waba.api_credentials || {}
          setWabaForm({
            access_token: creds.access_token || '',
            phone_number_id: creds.phone_number_id || '',
            waba_id: creds.waba_id || '',
            webhook_verify_token: creds.webhook_verify_token || '',
            is_active: waba.is_active ?? true,
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
          use_global_settings: wooForm.use_global_settings,
          stock_reduction_status: wooForm.stock_reduction_status,
          journal_hpp_status: wooForm.journal_hpp_status,
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

  // Handle Save WABA Official Integration
  const handleSaveWaba = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'waba_official',
          access_token: wabaForm.access_token,
          phone_number_id: wabaForm.phone_number_id,
          waba_id: wabaForm.waba_id,
          webhook_verify_token: wabaForm.webhook_verify_token,
          is_active: wabaForm.is_active,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan pengaturan WABA Official')
      }

      setSaveSuccess(true)
      await fetchIntegrations()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Terjadi kesalahan saat menyimpan WABA Official.'))
    } finally {
      setSaving(false)
    }
  }

  // Handle Test WABA Connection
  const handleTestWabaConnection = async () => {
    if (!wabaForm.access_token.trim() || !wabaForm.phone_number_id.trim()) {
      return alert('Harap masukkan Meta Access Token dan Phone Number ID terlebih dahulu!')
    }

    setTestingConnection(true)
    setTestResult(null)

    try {
      const res = await fetch('/api/integrations/waba/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: wabaForm.access_token,
          phone_number_id: wabaForm.phone_number_id,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success) {
        setTestResult({
          success: true,
          message: json.message || '✅ Berhasil terhubung ke Meta WABA Graph API!',
        })
      } else {
        setTestResult({
          success: false,
          message: '⚠️ ' + (json.error || 'Gagal terhubung ke Meta WABA Graph API.'),
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

  // Handle One-Click Toggle Activation for WABA Official
  const handleToggleWabaActivation = async (newActiveState: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'waba_official',
          access_token: wabaForm.access_token,
          phone_number_id: wabaForm.phone_number_id,
          waba_id: wabaForm.waba_id,
          webhook_verify_token: wabaForm.webhook_verify_token,
          is_active: newActiveState,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mengubah status integrasi WABA Official')
      }

      setWabaForm(prev => ({ ...prev, is_active: newActiveState }))
      await fetchIntegrations()
      window.location.reload()
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Terjadi kesalahan saat mengubah status plugin WABA.'))
    } finally {
      setSaving(false)
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

  const wabaPlugin = INTEGRATION_PLUGINS.find(p => p.id === 'waba_official')!
  const wabaWebhookUrl = wabaPlugin?.getWebhookUrl ? wabaPlugin.getWebhookUrl(activeBusinessId, origin) : ''
  const wabaSaved = integrationsData['waba_official']
  const isWabaConfigured = Boolean(wabaSaved && wabaSaved.api_credentials?.access_token && wabaSaved.api_credentials?.phone_number_id)

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

        {/* 3. WABA OFFICIAL (META) PLUGIN CARD */}
        <div className="bg-white rounded-xl border border-[#E2E2DC] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-green-50 border border-green-100 text-green-600 font-extrabold flex items-center justify-center text-2xl">
                📱
              </div>
              <div className="flex flex-col items-end gap-1">
                {wabaSaved?.is_active ? (
                  <span className="text-[10px] font-bold uppercase bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 rounded-full">
                    ✓ Plugin Aktif
                  </span>
                ) : (
                  <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200 px-2.5 py-0.5 rounded-full">
                    ⏸️ Belum Diaktifkan
                  </span>
                )}
                {!isWabaConfigured && wabaSaved?.is_active && (
                  <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    ⚠️ Belum Dikonfigurasi
                  </span>
                )}
              </div>
            </div>

            <h3 className="text-base font-bold text-[#1C1C1A]">WABA Official (Meta)</h3>
            <p className="text-xs text-[#6B6B63] mt-1.5 leading-relaxed">
              Plugin modul pesan resmi WhatsApp Business API dari Meta. Saat diaktifkan, menu Inbox / Chat akan muncul di sidebar navigasi.
            </p>
          </div>

          <div className="pt-4 border-t border-[#E2E2DC] flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A8A89E]">Plugin Messaging</span>

            <div className="flex items-center gap-2">
              {wabaSaved?.is_active ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleToggleWabaActivation(false)}
                    disabled={saving}
                    className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    Nonaktifkan ⏸️
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPlugin(wabaPlugin)
                      setTestResult(null)
                    }}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Kelola WABA ⚙️</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handleToggleWabaActivation(true)}
                  disabled={saving}
                  className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-black transition-all shadow-md hover:shadow-none flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <span>{saving ? 'Mengaktifkan...' : 'Aktifkan Plugin ⚡'}</span>
                </button>
              )}
            </div>
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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 z-[9999]">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
            
            {/* Modal Header (Fixed Top) */}
            <div className="px-6 py-4 border-b border-[#E2E2DC] flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 font-extrabold flex items-center justify-center text-xl shrink-0">
                  🛍️
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#1C1C1A]">Integrasi WooCommerce</h2>
                  <p className="text-xs text-[#6B6B63]">
                    Unit Bisnis: <span className="font-bold text-blue-600">{activeBusinessName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlugin(null)
                  setTestResult(null)
                }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <form id="wooFormEl" onSubmit={handleSaveWooCommerce} className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Webhook Notice Section */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
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

              {/* Switch Active Integration */}
              <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl flex items-center justify-between">
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
                    wooForm.is_active ? 'bg-green-600 text-white shadow-xs' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {wooForm.is_active ? '✓ AKTIF' : '⏸️ NONAKTIF'}
                </button>
              </div>

              {/* Store URL */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  URL Toko WordPress / WooCommerce <span className="text-slate-400 font-normal text-[10px] lowercase">(opsional)</span>
                </label>
                <input
                  type="url"
                  placeholder="https://tokoanda.com"
                  value={wooForm.store_url}
                  onChange={(e) => setWooForm({ ...wooForm, store_url: e.target.value })}
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Domain utama website WooCommerce Anda (diperlukan jika menggunakan sinkronisasi REST API).
                </span>
              </div>

              {/* Consumer Key & Consumer Secret */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Consumer Key (REST API) <span className="text-slate-400 font-normal text-[10px] lowercase">(opsional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ck_xxxxxxxx..."
                    value={wooForm.consumer_key}
                    onChange={(e) => setWooForm({ ...wooForm, consumer_key: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Consumer Secret (REST API) <span className="text-slate-400 font-normal text-[10px] lowercase">(opsional)</span>
                  </label>
                  <input
                    type="password"
                    placeholder="cs_xxxxxxxx..."
                    value={wooForm.consumer_secret}
                    onChange={(e) => setWooForm({ ...wooForm, consumer_secret: e.target.value })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-mono"
                  />
                </div>
              </div>

              {/* SECTION: TRIGGER PENGURANGAN STOK & JURNAL HPP */}
              <div className="p-4 bg-purple-50/60 border border-purple-200 rounded-xl space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">📦</span>
                    <h4 className="font-bold text-xs text-purple-900 uppercase tracking-wider">
                      Pengaturan Trigger Stok & Jurnal HPP
                    </h4>
                  </div>
                  <p className="text-[11px] text-purple-800 mt-1 leading-relaxed">
                    Tentukan apakah WooCommerce mengikuti aturan terpusat dari <b>Settings &gt; Stok & Jurnal Global</b> atau menggunakan status khusus.
                  </p>
                </div>

                {/* Mode Selector Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWooForm({ ...wooForm, use_global_settings: true })}
                    className={`p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer ${
                      wooForm.use_global_settings
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>🌐 Gunakan Default Global</span>
                      {wooForm.use_global_settings && <span>✓</span>}
                    </div>
                    <p className={`text-[10px] mt-1 font-normal ${wooForm.use_global_settings ? 'text-purple-100' : 'text-slate-500'}`}>
                      Mengikuti aturan otomatis terpusat dari menu Settings &gt; Stok & Jurnal Global.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWooForm({ ...wooForm, use_global_settings: false })}
                    className={`p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer ${
                      !wooForm.use_global_settings
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>⚙️ Custom Status Khusus WooCommerce</span>
                      {!wooForm.use_global_settings && <span>✓</span>}
                    </div>
                    <p className={`text-[10px] mt-1 font-normal ${!wooForm.use_global_settings ? 'text-purple-100' : 'text-slate-500'}`}>
                      Menentukan status khusus WooCommerce yang berbeda dari default global.
                    </p>
                  </button>
                </div>

                {wooForm.use_global_settings ? (
                  <div className="p-3 bg-purple-100/70 border border-purple-200 rounded-lg text-xs text-purple-900 leading-relaxed font-medium">
                    ✨ WooCommerce saat ini diset menggunakan <b>Default Global</b>. Anda tidak perlu mengatur ulang status di sini. Jika Anda ingin mengubah aturan global untuk seluruh toko & POS, buka menu <a href="/settings/inventory" target="_blank" className="font-bold underline text-purple-950">Settings &gt; Stok & Jurnal Global</a>.
                  </div>
                ) : (
                  <div className="space-y-4 pt-2 border-t border-purple-200">
                    {/* Status Pengurangan Stok */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Pengurangan Stok Produk Saat Status Pesanan:
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'shipped', label: 'Shipped (Dikirim)' },
                          { id: 'completed', label: 'Completed (Selesai)' },
                          { id: 'processing', label: 'Processing (Diproses)' },
                          { id: 'on-hold', label: 'On-Hold (Ditahan)' }
                        ].map((st) => {
                          const isChecked = wooForm.stock_reduction_status.includes(st.id)
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => {
                                const current = wooForm.stock_reduction_status
                                const updated = isChecked
                                  ? current.filter(s => s !== st.id)
                                  : [...current, st.id]
                                setWooForm({ ...wooForm, stock_reduction_status: updated.length ? updated : ['shipped', 'completed'] })
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                                isChecked
                                  ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {isChecked ? '✓ ' : ''}{st.label}
                            </button>
                          )
                        })}
                      </div>
                      <span className="text-[10px] text-slate-500 block">
                        Pilih status WooCommerce khusus yang memicu pengurangan stok fisik produk di database CRM.
                      </span>
                    </div>

                    {/* Status Pembaruan Jurnal Item HPP & Persediaan */}
                    <div className="space-y-1.5 pt-2 border-t border-purple-200/60">
                      <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Pembaruan Jurnal Item (HPP & Persediaan) Saat Status Pesanan:
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'shipped', label: 'Shipped (Dikirim)' },
                          { id: 'completed', label: 'Completed (Selesai)' },
                          { id: 'processing', label: 'Processing (Diproses)' },
                          { id: 'on-hold', label: 'On-Hold (Ditahan)' }
                        ].map((st) => {
                          const isChecked = wooForm.journal_hpp_status.includes(st.id)
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onClick={() => {
                                const current = wooForm.journal_hpp_status
                                const updated = isChecked
                                  ? current.filter(s => s !== st.id)
                                  : [...current, st.id]
                                setWooForm({ ...wooForm, journal_hpp_status: updated.length ? updated : ['shipped', 'completed'] })
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                                isChecked
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              {isChecked ? '✓ ' : ''}{st.label}
                            </button>
                          )
                        })}
                      </div>
                      <span className="text-[10px] text-slate-500 block">
                        Pencatatan rincian HPP line item terpisah (Debit HPP & Kredit Persediaan per produk) akan terbit saat status khusus ini terpenuhi.
                      </span>
                    </div>
                  </div>
                )}
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

              <button type="submit" className="hidden" />
            </form>

            {/* Modal Footer (Fixed Bottom) */}
            <div className="px-6 py-4 border-t border-[#E2E2DC] bg-[#F9F9F8] flex flex-col sm:flex-row gap-3 shrink-0">
              <button
                type="button"
                disabled={testingConnection}
                onClick={handleTestConnection}
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] bg-white hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {testingConnection ? '🔄 Menguji REST API...' : '🧪 Uji Koneksi REST API'}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const formEl = document.getElementById('wooFormEl') as HTMLFormElement
                  if (formEl) formEl.requestSubmit()
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : '💾 Simpan Pengaturan'}
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* YCLOUD (WHATSAPP) CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'ycloud' && mounted && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 z-[9999]">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
            
            {/* Modal Header (Fixed Top) */}
            <div className="px-6 py-4 border-b border-[#E2E2DC] flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 font-extrabold flex items-center justify-center text-xl shrink-0">
                  💬
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#1C1C1A]">Integrasi YCloud WhatsApp API</h2>
                  <p className="text-xs text-[#6B6B63]">
                    Unit Bisnis: <span className="font-bold text-emerald-600">{activeBusinessName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlugin(null)
                  setTestResult(null)
                }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <form id="ycloudFormEl" onSubmit={handleSaveYCloud} className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Webhook Notice Section */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
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

              {/* Switch Active Integration */}
              <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl flex items-center justify-between">
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
                    ycloudForm.is_active ? 'bg-green-600 text-white shadow-xs' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {ycloudForm.is_active ? '✓ AKTIF' : '⏸️ NONAKTIF'}
                </button>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  YCloud API Key {ycloudForm.is_active && <span className="text-red-500">*</span>}
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showYcloudKey ? 'text' : 'password'}
                    required={ycloudForm.is_active}
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

              <button type="submit" className="hidden" />
            </form>

            {/* Modal Footer (Fixed Bottom) */}
            <div className="px-6 py-4 border-t border-[#E2E2DC] bg-[#F9F9F8] flex flex-col sm:flex-row gap-3 shrink-0">
              <button
                type="button"
                disabled={testingConnection}
                onClick={handleTestYCloudConnection}
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] bg-white hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {testingConnection ? '🔄 Menguji API YCloud...' : '🧪 Uji Koneksi YCloud API'}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const formEl = document.getElementById('ycloudFormEl') as HTMLFormElement
                  if (formEl) formEl.requestSubmit()
                }}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : '💾 Simpan Pengaturan YCloud'}
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

      {/* WABA OFFICIAL CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'waba_official' && mounted && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 z-[9999]">
          <div className="bg-white border border-[#E2E2DC] rounded-2xl max-w-2xl w-full max-h-[90vh] shadow-2xl flex flex-col overflow-hidden">
            
            {/* Modal Header (Fixed Top) */}
            <div className="px-6 py-4 border-b border-[#E2E2DC] flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 text-green-600 font-extrabold flex items-center justify-center text-xl shrink-0">
                  📱
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#1C1C1A]">Integrasi WABA Official (Meta)</h2>
                  <p className="text-xs text-[#6B6B63]">
                    Unit Bisnis: <span className="font-bold text-green-600">{activeBusinessName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlugin(null)
                  setTestResult(null)
                }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-[#A8A89E] hover:text-[#1C1C1A] text-lg font-bold transition-all cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Modal Body */}
            <form id="wabaFormEl" onSubmit={handleSaveWaba} className="flex-1 overflow-y-auto p-6 space-y-5">
              
              {/* Webhook Notice Section */}
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">⚡</span>
                  <h4 className="font-bold text-xs text-green-900 uppercase tracking-wider">
                    URL Webhook Callback (Meta Developer Portal &gt; WhatsApp &gt; Configuration)
                  </h4>
                </div>
                <p className="text-xs text-green-800 leading-relaxed">
                  Masukkan Webhook Callback URL dan Verify Token di bawah ini pada Meta App Dashboard Anda untuk menerima pesan masuk.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    readOnly
                    value={wabaWebhookUrl}
                    className="w-full px-3 py-2 bg-white border border-green-300 rounded-lg font-mono text-xs text-[#1C1C1A] select-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyWebhook(wabaWebhookUrl)}
                    className="bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold px-4 py-2 transition-all shrink-0 cursor-pointer"
                  >
                    {copiedWebhook ? '✅ Tersalin!' : '📋 Salin'}
                  </button>
                </div>
              </div>

              {/* Switch Active Integration */}
              <div className="p-4 bg-[#F7F7F5] border border-[#E2E2DC] rounded-xl flex items-center justify-between">
                <div>
                  <label className="font-bold text-xs text-[#1C1C1A] block">
                    Status Integrasi WABA Official
                  </label>
                  <span className="text-[10px] text-[#6B6B63]">
                    {wabaForm.is_active 
                      ? 'Aktif — Inbox & Pengiriman pesan WABA diizinkan' 
                      : 'Nonaktif — Fitur Inbox & Webhook sementara dihentikan'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setWabaForm({ ...wabaForm, is_active: !wabaForm.is_active })}
                  className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                    wabaForm.is_active ? 'bg-green-600 text-white shadow-xs' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {wabaForm.is_active ? '✓ AKTIF' : '⏸️ NONAKTIF'}
                </button>
              </div>

              {/* Meta Access Token */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Meta Access Token (System User Permanent Token) {wabaForm.is_active && <span className="text-red-500">*</span>}
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showWabaToken ? 'text' : 'password'}
                    required={wabaForm.is_active}
                    placeholder="EAAGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={wabaForm.access_token}
                    onChange={(e) => setWabaForm({ ...wabaForm, access_token: e.target.value })}
                    className="w-full px-3.5 py-2.5 pr-12 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowWabaToken(!showWabaToken)}
                    className="absolute right-3 text-sm text-[#A8A89E] hover:text-[#1C1C1A] transition-colors p-1 cursor-pointer"
                    title={showWabaToken ? 'Sembunyikan Token' : 'Tampilkan Token'}
                  >
                    {showWabaToken ? '🙈 Sembunyikan' : '👁️ Tampilkan'}
                  </button>
                </div>
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Dapatkan Permanent Access Token dari Meta Business Manager &gt; System Users &gt; Generate Token (Permission: whatsapp_business_messaging, whatsapp_business_management).
                </span>
              </div>

              {/* Phone Number ID & WABA ID */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    Phone Number ID {wabaForm.is_active && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="text"
                    required={wabaForm.is_active}
                    placeholder="123456789012345"
                    value={wabaForm.phone_number_id}
                    onChange={(e) => setWabaForm({ ...wabaForm, phone_number_id: e.target.value.trim() })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white font-mono"
                  />
                  <span className="text-[10px] text-[#6B6B63] mt-1 block">
                    Dapatkan dari Meta Developer Portal &gt; WhatsApp &gt; API Setup.
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                    WABA Account ID (Opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="109876543210987"
                    value={wabaForm.waba_id}
                    onChange={(e) => setWabaForm({ ...wabaForm, waba_id: e.target.value.trim() })}
                    className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white font-mono"
                  />
                  <span className="text-[10px] text-[#6B6B63] mt-1 block">
                    ID Akun Bisnis WhatsApp di Meta Manager.
                  </span>
                </div>
              </div>

              {/* Webhook Verify Token */}
              <div>
                <label className="block text-xs font-bold text-[#1C1C1A] uppercase tracking-wider mb-1.5">
                  Webhook Verify Token {wabaForm.is_active && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="text"
                  required={wabaForm.is_active}
                  placeholder="shapeup_waba_verify_token_123"
                  value={wabaForm.webhook_verify_token}
                  onChange={(e) => setWabaForm({ ...wabaForm, webhook_verify_token: e.target.value.trim() })}
                  className="w-full px-3.5 py-2.5 border border-[#E2E2DC] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white font-mono"
                />
                <span className="text-[10px] text-[#6B6B63] mt-1 block">
                  Token rahasia bebas pilihan Anda yang harus sama dengan yang dimasukkan di Callback Verification Meta Webhook.
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
                  ✅ Pengaturan WABA Official (Meta) berhasil disimpan untuk unit bisnis {activeBusinessName}!
                </div>
              )}

              <button type="submit" className="hidden" />
            </form>

            {/* Modal Footer (Fixed Bottom) */}
            <div className="px-6 py-4 border-t border-[#E2E2DC] bg-[#F9F9F8] flex flex-col sm:flex-row gap-3 shrink-0">
              <button
                type="button"
                disabled={testingConnection}
                onClick={handleTestWabaConnection}
                className="flex-1 px-4 py-2.5 border border-[#E2E2DC] bg-white hover:bg-[#F7F7F5] text-[#1C1C1A] rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {testingConnection ? '🔄 Menguji Meta Graph API...' : '🧪 Uji Koneksi Meta API'}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const formEl = document.getElementById('wabaFormEl') as HTMLFormElement
                  if (formEl) formEl.requestSubmit()
                }}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Menyimpan...' : '💾 Simpan Pengaturan WABA'}
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

    </SettingsLayout>
  )
}
