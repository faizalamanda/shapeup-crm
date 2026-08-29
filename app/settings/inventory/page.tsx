"use client"

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import SettingsLayout from '@/components/SettingsLayout'

export default function GlobalInventorySettingsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null)
  const [activeBusinessName, setActiveBusinessName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [globalForm, setGlobalForm] = useState<{
    global_stock_reduction_status: string[]
    global_journal_hpp_status: string[]
  }>({
    global_stock_reduction_status: ['shipped', 'completed'],
    global_journal_hpp_status: ['shipped', 'completed'],
  })

  // Fetch Active Business Profile
  const fetchActiveBusiness = useCallback(async () => {
    setLoading(true)
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

        // Fetch saved global settings
        try {
          const res = await fetch('/api/settings/inventory')
          const json = await res.json()
          if (json.success && json.settings) {
            setGlobalForm({
              global_stock_reduction_status: Array.isArray(json.settings.global_stock_reduction_status)
                ? json.settings.global_stock_reduction_status
                : ['shipped', 'completed'],
              global_journal_hpp_status: Array.isArray(json.settings.global_journal_hpp_status)
                ? json.settings.global_journal_hpp_status
                : ['shipped', 'completed'],
            })
          }
        } catch (err) {
          console.error('Failed to load global inventory settings:', err)
        }
      }
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchActiveBusiness()
  }, [fetchActiveBusiness])

  // Save Settings Form
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/settings/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(globalForm)
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan pengaturan global')
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3500)
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan saat menyimpan')
    } finally {
      setSaving(false)
    }
  }

  const STATUS_OPTIONS = [
    { id: 'shipped', label: 'Shipped (Dikirim)' },
    { id: 'completed', label: 'Completed (Selesai)' },
    { id: 'processing', label: 'Processing (Diproses)' },
    { id: 'on-hold', label: 'On-Hold (Ditahan)' }
  ]

  return (
    <SettingsLayout
      title="Pengaturan Stok & Jurnal Global"
      subtitle={`Konfigurasi default aturan pemotongan stok & jurnal HPP terpusat untuk unit bisnis ${activeBusinessName || '...'}`}
    >
      <div className="max-w-4xl space-y-6">

        {/* Main Card Container */}
        <div className="bg-white border border-[#E2E2DC] rounded-2xl shadow-xs p-6 md:p-8 space-y-6">
          
          <div className="flex items-center gap-3 border-b border-[#E2E2DC] pb-5">
            <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 font-extrabold flex items-center justify-center text-2xl">
              📦
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1C1C1A]">Pengaturan Default Transaksi, Stok & HPP Global</h2>
              <p className="text-xs text-[#6B6B63]">
                Aturan ini berlaku secara terpusat untuk POS, Penjualan Langsung / Invoice, WooCommerce, dan integrasi e-commerce mendatang.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs font-bold text-slate-400 animate-pulse">
              Memuat pengaturan global...
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">

              {/* Status Pengurangan Stok Global */}
              <div className="p-5 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
                <div>
                  <h3 className="font-bold text-xs text-purple-900 uppercase tracking-wider">
                    1. Trigger Pengurangan Stok Produk Physical
                  </h3>
                  <p className="text-xs text-purple-800 mt-1 leading-relaxed">
                    Pilih status pesanan transaksi yang memicu pengurangan kuantitas stok produk fisik di database CRM.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-2">
                  {STATUS_OPTIONS.map((st) => {
                    const isChecked = globalForm.global_stock_reduction_status.includes(st.id)
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          const current = globalForm.global_stock_reduction_status
                          const updated = isChecked
                            ? current.filter(s => s !== st.id)
                            : [...current, st.id]
                          setGlobalForm({
                            ...globalForm,
                            global_stock_reduction_status: updated.length ? updated : ['shipped', 'completed']
                          })
                        }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
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
                <span className="text-[11px] text-purple-700/80 block">
                  Default yang direkomendasikan: <b>Shipped (Dikirim)</b> dan <b>Completed (Selesai)</b>.
                </span>
              </div>

              {/* Status Pembaruan Jurnal Item HPP & Persediaan Global */}
              <div className="p-5 bg-blue-50/50 border border-blue-200 rounded-xl space-y-3">
                <div>
                  <h3 className="font-bold text-xs text-blue-900 uppercase tracking-wider">
                    2. Trigger Pembaruan Jurnal Item (Debit HPP & Kredit Persediaan)
                  </h3>
                  <p className="text-xs text-blue-800 mt-1 leading-relaxed">
                    Pencatatan rincian HPP line item per produk (Debit HPP & Kredit Persediaan per unit) akan terbit di jurnal akuntansi saat transaksi mencapai status ini.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5 pt-2">
                  {STATUS_OPTIONS.map((st) => {
                    const isChecked = globalForm.global_journal_hpp_status.includes(st.id)
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          const current = globalForm.global_journal_hpp_status
                          const updated = isChecked
                            ? current.filter(s => s !== st.id)
                            : [...current, st.id]
                          setGlobalForm({
                            ...globalForm,
                            global_journal_hpp_status: updated.length ? updated : ['shipped', 'completed']
                          })
                        }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
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
                <span className="text-[11px] text-blue-700/80 block">
                  Jurnal HPP akan merinci setiap barang beserta SKU, Qty, dan HPP per unit secara terpisah.
                </span>
              </div>

              {/* Notification Banner */}
              {saveSuccess && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-xs font-bold text-green-700 flex items-center gap-2">
                  <span>✅</span> Pengaturan Stok & Jurnal HPP Global berhasil disimpan untuk {activeBusinessName}!
                </div>
              )}

              {errorMessage && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
                  <span>⚠️</span> {errorMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 border-t border-[#E2E2DC] flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {saving ? 'Menyimpan Pengaturan...' : '💾 Simpan Pengaturan Global'}
                </button>
              </div>

            </form>
          )}

        </div>

      </div>
    </SettingsLayout>
  )
}
