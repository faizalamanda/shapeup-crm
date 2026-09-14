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
  const [accurateAccessToken, setAccurateAccessToken] = useState('')
  const [accurateDbId, setAccurateDbId] = useState('')
  const [isTestingConnection, setIsTestingConnection] = useState(false)
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
            access_token: accurateAccessToken,
            db_id: accurateDbId
          },
          is_active: true
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan')
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

  const handleTestConnection = async () => {
    if (!accurateAccessToken || !accurateDbId) {
      alert('Access Token dan Database ID wajib diisi untuk test koneksi.')
      return
    }
    setIsTestingConnection(true)
    try {
      const res = await fetch('/api/integrations/accurate/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accurateAccessToken,
          db_id: accurateDbId
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Gagal test koneksi')
      alert('Koneksi berhasil! Kredensial valid.')
    } catch (err: any) {
      alert('Error: ' + err.message)
    } finally {
      setIsTestingConnection(false)
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
                API Token
              </label>
              <input
                type="password"
                value={accurateAccessToken}
                onChange={(e) => setAccurateAccessToken(e.target.value)}
                placeholder="Masukkan API Token Accurate Anda"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E6F4F1] focus:border-[#008A70]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                Database ID
              </label>
              <input
                type="text"
                value={accurateDbId}
                onChange={(e) => setAccurateDbId(e.target.value)}
                placeholder="Misal: 96400 (opsional)"
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E6F4F1] focus:border-[#008A70]"
              />
            </div>
          </div>

          {accurateSaved?.is_active && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
              <div className="flex justify-between items-center mb-2">
                <p className="text-xs text-slate-500 font-semibold">Tarik pesanan terbaru dari Accurate secara manual:</p>
                {(accurateSaved?.config?.last_sync_time_str || accurateSaved?.config?.last_sync_date) && (
                  <p className="text-[11px] text-slate-400 font-medium">
                    Sinkronisasi Terakhir: {accurateSaved.config.last_sync_time_str || accurateSaved.config.last_sync_date}
                  </p>
                )}
              </div>
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

          {accurateSaved?.is_active && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
              <p className="text-xs text-slate-500 font-semibold mb-1">URL Webhook Otomatis (Real-time):</p>
              <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                Salin URL di bawah ini dan tempelkan ke menu Webhook di aplikasi Accurate Online Anda agar pesanan masuk secara otomatis tanpa perlu menekan tombol sinkronisasi.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`https://shapeup-crm.vercel.app/api/webhook/accurate?business_id=${businessId}`}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`https://shapeup-crm.vercel.app/api/webhook/accurate?business_id=${businessId}`)
                    alert('URL disalin!')
                  }}
                  className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex-shrink-0"
                  title="Salin URL"
                >
                  📋
                </button>
              </div>
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
              type="button"
              onClick={handleTestConnection}
              disabled={isTestingConnection || saving}
              className="px-5 py-2.5 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTestingConnection ? 'Testing...' : 'Test Koneksi'}
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
