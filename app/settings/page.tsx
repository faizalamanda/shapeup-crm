"use client"
import { useState } from 'react'

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    // Simulasi simpan data ke Environment atau Database
    setTimeout(() => {
      setLoading(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }, 1500)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pengaturan Integrasi</h1>
        <p className="text-sm text-slate-500">Hubungkan ShapeUp CRM dengan platform toko online Anda.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center text-2xl">🛍️</div>
          <div>
            <h3 className="font-bold text-slate-800">WooCommerce</h3>
            <p className="text-xs text-slate-400">Hubungkan data produk, pelanggan, dan pesanan.</p>
          </div>
          <div className="ml-auto">
            <span className="px-2.5 py-1 bg-green-50 text-green-600 text-[10px] font-bold uppercase rounded-full border border-green-100">Aktif</span>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">URL Toko (WordPress)</label>
            <input 
              type="url" 
              placeholder="https://tokoanda.com"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Consumer Key</label>
              <input 
                type="text" 
                placeholder="ck_xxxxxxxx..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Consumer Secret</label>
              <input 
                type="password" 
                placeholder="cs_xxxxxxxx..."
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="pt-4 flex items-center justify-between">
            <p className="text-xs text-slate-400 max-w-[300px]">
              Dapatkan kunci API di menu <b>WooCommerce &gt; Settings &gt; Advanced &gt; REST API</b> pada WordPress Anda.
            </p>
            <button 
              type="submit"
              disabled={loading}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                saved ? 'bg-green-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-200'
              }`}
            >
              {loading ? 'Menyimpan...' : saved ? '✅ Tersimpan' : 'Simpan Koneksi'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-slate-100/50 p-6 rounded-2xl border border-dashed border-slate-300 flex items-center justify-center gap-4 group cursor-not-allowed">
          <span className="text-2xl grayscale group-hover:grayscale-0 transition-all">📦</span>
          <span className="text-sm font-medium text-slate-500">Integrasi Shopify (Coming Soon)</span>
      </div>
    </div>
  )
}