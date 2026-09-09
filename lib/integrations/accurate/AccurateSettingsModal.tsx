import React, { useState, useEffect } from 'react'

type AccurateSettingsModalProps = {
  selectedPlugin: any
  setSelectedPlugin: (val: any) => void
  activeBusinessId: string
  onSaveSuccess?: () => void
}

export default function AccurateSettingsModal({
  selectedPlugin,
  setSelectedPlugin,
  activeBusinessId,
  onSaveSuccess
}: AccurateSettingsModalProps) {
  const [accurateClientId, setAccurateClientId] = useState('')
  const [accurateClientSecret, setAccurateClientSecret] = useState('')
  const [accurateAccessToken, setAccurateAccessToken] = useState('')
  const [accurateDbId, setAccurateDbId] = useState('')
  const [isSyncingAccurate, setIsSyncingAccurate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [accurateSaved, setAccurateSaved] = useState<any>(null)

  useEffect(() => {
    // Fetch initial config
    if (activeBusinessId) {
      fetch(`/api/integrations?bid=${activeBusinessId}`)
        .then(res => res.json())
        .then(data => {
          if (data.integrations) {
            const accurate = data.integrations.find((i: any) => i.provider === 'accurate')
            if (accurate?.config) {
              setAccurateSaved(accurate)
              setAccurateClientId(accurate.config.client_id || '')
              setAccurateClientSecret(accurate.config.client_secret || '')
              setAccurateAccessToken(accurate.config.access_token || '')
              setAccurateDbId(accurate.config.db_id || '')
            }
          }
        })
        .catch(err => console.error('Failed to fetch config', err))
    }
  }, [activeBusinessId])

  const handleSaveAccurate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: activeBusinessId,
          provider: 'accurate',
          name: 'Accurate Online',
          config: {
            client_id: accurateClientId,
            client_secret: accurateClientSecret,
            access_token: accurateAccessToken,
            db_id: accurateDbId
          },
          is_active: true
        })
      })
      if (!res.ok) throw new Error('Gagal menyimpan')
      alert('Pengaturan Accurate berhasil disimpan!')
      setAccurateSaved({ is_active: true })
      if (onSaveSuccess) onSaveSuccess()
      setSelectedPlugin(null)
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Gagal menyimpan pengaturan Accurate.'))
    } finally {
      setSaving(false)
    }
  }

  const handleSyncAccurate = async () => {
    setIsSyncingAccurate(true)
    try {
      let currentPage = 1
      let hasNextPage = true
      let totalProcessed = 0
      let totalNew = 0

      while (hasNextPage) {
        const res = await fetch('/api/integrations/accurate/sync-orders', { 
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: currentPage })
        })
        const json = await res.json()
        
        if (!res.ok) throw new Error(json.error)
        
        totalProcessed += (json.processedOrders || 0)
        totalNew += (json.newProducts || 0)
        
        hasNextPage = json.hasNextPage
        if (hasNextPage) {
          currentPage++
        }
      }
      alert(`Sinkronisasi selesai! ${totalProcessed} pesanan ditarik, ${totalNew} produk ditambahkan.`)
    } catch (err: any) {
      alert('Error: ' + (err.message || 'Gagal sinkronisasi.'))
    } finally {
      setIsSyncingAccurate(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
        onClick={() => !saving && setSelectedPlugin(null)}
      ></div>
      
      <div className="relative w-full sm:w-[500px] h-[90vh] sm:h-auto sm:max-h-[85vh] bg-white sm:rounded-2xl shadow-2xl flex flex-col transform transition-all animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95">
        
        {/* Header */}
        <div className="flex-none px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white sm:rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-xl border border-slate-100">
              {selectedPlugin.icon}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1C1C1A]">Integrasi {selectedPlugin.name}</h2>
              <p className="text-xs text-slate-500">Konfigurasi API Credentials</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => !saving && setSelectedPlugin(null)}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSaveAccurate} className="flex-1 overflow-y-auto p-6 space-y-5">
          
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-xl">ℹ️</span>
              <div>
                <h4 className="text-sm font-bold text-blue-900">Petunjuk</h4>
                <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                  Dapatkan kredensial ini dari Accurate Developer Portal. Pastikan aplikasi telah mendapatkan akses (Otorisasi) untuk database Anda.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                Client ID (OAuth)
              </label>
              <input
                type="text"
                required
                value={accurateClientId}
                onChange={(e) => setAccurateClientId(e.target.value)}
                placeholder="Masukkan Client ID"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                Client Secret (OAuth)
              </label>
              <input
                type="password"
                required
                value={accurateClientSecret}
                onChange={(e) => setAccurateClientSecret(e.target.value)}
                placeholder="Masukkan Client Secret"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                Access Token
              </label>
              <input
                type="password"
                required
                value={accurateAccessToken}
                onChange={(e) => setAccurateAccessToken(e.target.value)}
                placeholder="Bearer token"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                Database ID (X-Session-ID)
              </label>
              <input
                type="text"
                required
                value={accurateDbId}
                onChange={(e) => setAccurateDbId(e.target.value)}
                placeholder="ID Session Accurate"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
              />
            </div>
          </div>

          {accurateSaved?.is_active && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
              <p className="text-xs text-slate-500 mb-2">Tarik pesanan terbaru dari Accurate secara manual:</p>
              <button
                type="button"
                onClick={handleSyncAccurate}
                disabled={isSyncingAccurate}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isSyncingAccurate ? 'Menarik Data...' : '🔄 Sinkronisasi Data Order & HPP Sekarang'}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-end gap-3 pb-safe">
            <button
              type="button"
              onClick={() => !saving && setSelectedPlugin(null)}
              className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-black rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
