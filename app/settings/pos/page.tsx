"use client"

import { useState, useEffect, useCallback } from 'react'
import SettingsLayout from '@/components/SettingsLayout'
import { useUserContext } from '@/components/UserContext'
import Link from 'next/link'

interface ApproverItem {
  user_id: string
  name: string
  email: string
  role: string
  is_owner: boolean
  can_approve_pos: boolean
  has_pin: boolean
}

export default function POSSettingsPage() {
  const { activeBusiness, currentUserRole, isOwner, bizLoading } = useUserContext()
  const activeBusinessId = activeBusiness?.id || null
  const activeBusinessName = activeBusiness?.name || ''

  const isAdminOrOwner = isOwner || currentUserRole === 'admin'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Settings State
  const [globalEnabled, setGlobalEnabled] = useState(false)
  const [requireGlobalDiscountAuth, setRequireGlobalDiscountAuth] = useState(false)
  const [requireApproverPin, setRequireApproverPin] = useState(false)
  const [requireReason, setRequireReason] = useState(false)

  // Approvers State
  const [approvers, setApprovers] = useState<ApproverItem[]>([])
  const [selectedApproverIds, setSelectedApproverIds] = useState<Set<string>>(new Set())
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    if (!activeBusinessId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/settings/pos')
      const json = await res.json()

      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal memuat pengaturan POS')
      }

      const s = json.settings || {}
      setGlobalEnabled(Boolean(s.global_enabled))
      setRequireGlobalDiscountAuth(Boolean(s.require_global_discount_auth))
      setRequireApproverPin(Boolean(s.require_approver_pin))
      setRequireReason(Boolean(s.require_reason))

      const approverList: ApproverItem[] = Array.isArray(json.approvers) ? json.approvers : []
      setApprovers(approverList)

      const checkedIds = new Set<string>()
      approverList.forEach((a) => {
        if (a.can_approve_pos || a.is_owner) {
          checkedIds.add(a.user_id)
        }
      })
      setSelectedApproverIds(checkedIds)
    } catch (err: any) {
      console.error('Fetch POS settings error:', err)
      setErrorMessage(err.message || 'Terjadi kesalahan saat memuat data')
    } finally {
      setLoading(false)
    }
  }, [activeBusinessId])

  useEffect(() => {
    if (activeBusinessId) {
      fetchSettings()
    }
  }, [activeBusinessId, fetchSettings])

  const handleToggleApprover = (userId: string, isOwnerUser: boolean) => {
    if (isOwnerUser) return // Owner is always approver

    setSelectedApproverIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const handleResetPin = async (userId: string, userName: string) => {
    if (!confirm(`Apakah Anda yakin ingin mereset PIN untuk ${userName}? Pengguna harus mengatur PIN baru.`)) {
      return
    }

    setResettingUserId(userId)
    try {
      const res = await fetch('/api/pos/approver-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset_staff',
          target_user_id: userId
        })
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal mereset PIN')
      }

      alert(`PIN untuk ${userName} berhasil direset.`)
      await fetchSettings()
    } catch (e: any) {
      alert(e.message || 'Gagal mereset PIN')
    } finally {
      setResettingUserId(null)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setErrorMessage(null)

    try {
      const payload = {
        settings: {
          global_enabled: globalEnabled,
          channels: ['pos'],
          require_global_discount_auth: requireGlobalDiscountAuth,
          require_approver_pin: requireApproverPin,
          require_reason: requireReason
        },
        approver_user_ids: Array.from(selectedApproverIds)
      }

      const res = await fetch('/api/settings/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Gagal menyimpan pengaturan POS')
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3500)
    } catch (err: any) {
      setErrorMessage(err.message || 'Terjadi kesalahan saat menyimpan pengaturan')
    } finally {
      setSaving(false)
    }
  }

  if (bizLoading) {
    return (
      <SettingsLayout title="Kasir POS & Proteksi HPP" subtitle="Memuat informasi unit bisnis...">
        <div className="bg-white rounded-2xl border border-[#E2E2DC] p-12 flex flex-col items-center justify-center min-h-[350px] gap-3">
          <div className="w-8 h-8 border-3 border-[#E2E2DC] border-t-blue-600 rounded-full animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-[#A8A89E]">Memeriksa Unit Bisnis Aktif...</p>
        </div>
      </SettingsLayout>
    )
  }

  if (!isAdminOrOwner) {
    return (
      <SettingsLayout title="Kasir POS & Proteksi HPP" subtitle="Akses terbatas untuk Pemilik & Admin">
        <div className="bg-white border border-[#E2E2DC] rounded-xl p-8 text-center space-y-4 max-w-xl mx-auto shadow-sm">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center text-xl mx-auto">
            🚫
          </div>
          <h2 className="text-xl font-bold text-[#1C1C1A]">Akses Dibatasi</h2>
          <p className="text-xs text-[#6B6B63]">
            Halaman Pengaturan POS & Proteksi HPP hanya dapat diakses oleh Pemilik Unit Bisnis atau staf dengan wewenang Admin.
          </p>
        </div>
      </SettingsLayout>
    )
  }

  return (
    <SettingsLayout
      title="Kasir POS & Proteksi HPP"
      subtitle={`Pengaturan proteksi harga jual minimum HPP, otorisasi diskon, dan penunjukan approver untuk ${activeBusinessName || 'Unit Bisnis'}`}
    >
      <div className="max-w-4xl space-y-6">
        <div className="bg-white border border-[#E2E2DC] rounded-2xl shadow-xs p-6 md:p-8 space-y-6">
          <div className="flex items-center gap-3 border-b border-[#E2E2DC] pb-5">
            <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 font-extrabold flex items-center justify-center text-2xl">
              🛡️
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1C1C1A]">Proteksi Margin & Otorisasi Transaksi Kasir</h2>
              <p className="text-xs text-[#6B6B63]">
                Kendalikan harga jual di POS agar tidak mengalami kerugian akibat margin negatif di bawah HPP atau diskon tanpa izin.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-xs font-bold text-slate-400 animate-pulse">
              Memuat pengaturan POS...
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              {/* Alert Feedback */}
              {errorMessage && (
                <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              {saveSuccess && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2 animate-in fade-in">
                  <span>✅</span>
                  <span>Pengaturan POS & Approver berhasil disimpan!</span>
                </div>
              )}

              {/* 1. Global HPP Protection Switch */}
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🌐</span>
                      <h3 className="font-extrabold text-sm text-slate-900">
                        Aktifkan Proteksi HPP untuk SEMUA Produk (Global)
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Sekali diaktifkan, <strong>seluruh produk</strong> di katalog otomatis dilindungi dari penjualan di bawah modal HPP saat kasir mengedit harga atau diskon item. Toggle di form produk akan otomatis terkunci.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                    <input
                      type="checkbox"
                      checked={globalEnabled}
                      onChange={(e) => setGlobalEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* 2. Global Discount Authorization Switch */}
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🏷️</span>
                      <h3 className="font-extrabold text-sm text-slate-900">
                        Wajib Otorisasi untuk Setiap Diskon Global Keranjang
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Default <strong>nonaktif</strong> (kasir bebas memberikan diskon global). Jika diaktifkan, setiap diskon nominal atau persen pada keseluruhan keranjang belanja wajib disetujui melalui otorisasi.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                    <input
                      type="checkbox"
                      checked={requireGlobalDiscountAuth}
                      onChange={(e) => setRequireGlobalDiscountAuth(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* 3. Authorization Method (Checklist) */}
              <div className="p-5 bg-indigo-50/60 border border-indigo-100 rounded-2xl space-y-4">
                <div>
                  <h3 className="font-bold text-xs text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                    <span>🔐</span>
                    <span>Metode Otorisasi (Bila Harga di Bawah HPP atau Diskon Global)</span>
                  </h3>
                  <p className="text-xs text-indigo-800 mt-1 leading-relaxed">
                    Pilih persyaratan yang harus dipenuhi di layar kasir ketika ada harga yang melanggar batas HPP atau memicu otorisasi:
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Option 1: PIN Approver */}
                  <label className={`p-4 rounded-xl border flex items-start gap-3 cursor-pointer transition select-none ${
                    requireApproverPin ? 'bg-white border-blue-400 shadow-xs' : 'bg-white/60 border-indigo-100 hover:bg-white'
                  }`}>
                    <input
                      type="checkbox"
                      checked={requireApproverPin}
                      onChange={(e) => setRequireApproverPin(e.target.checked)}
                      className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <div>
                      <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <span>🔑</span> Wajib PIN Approver
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        Approver yang ditunjuk harus memasukkan 6 digit PIN pribadi di perangkat kasir.
                      </p>
                    </div>
                  </label>

                  {/* Option 2: Written Reason */}
                  <label className={`p-4 rounded-xl border flex items-start gap-3 cursor-pointer transition select-none ${
                    requireReason ? 'bg-white border-blue-400 shadow-xs' : 'bg-white/60 border-indigo-100 hover:bg-white'
                  }`}>
                    <input
                      type="checkbox"
                      checked={requireReason}
                      onChange={(e) => setRequireReason(e.target.checked)}
                      className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <div>
                      <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <span>📝</span> Wajib Alasan Tertulis
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        Kasir/Approver wajib menuliskan alasan override (misal: cuci gudang, barang reject, dll).
                      </p>
                    </div>
                  </label>
                </div>

                {/* Dynamic Behavior Note */}
                <div className="p-3 bg-white/80 border border-indigo-200/80 rounded-xl text-xs space-y-1">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <span>💡</span> <span>Perilaku Sistem:</span>
                  </div>
                  {!requireApproverPin && !requireReason ? (
                    <p className="text-rose-700 font-semibold leading-relaxed">
                      🚫 <strong>Blokir Total (Hard Block):</strong> Tidak ada opsi yang dicentang. Kasir sama sekali tidak dapat menjual di bawah HPP. Tombol Simpan & Bayar akan dikunci.
                    </p>
                  ) : requireApproverPin && !requireReason ? (
                    <p className="text-slate-600 leading-relaxed">
                      🔐 Kasir wajib meminta <strong>PIN Approver</strong> yang terdaftar sebelum transaksi dapat dilanjutkan.
                    </p>
                  ) : !requireApproverPin && requireReason ? (
                    <p className="text-slate-600 leading-relaxed">
                      📝 Kasir cukup menuliskan <strong>alasan override</strong> secara mandiri. Alasan akan terekam di log audit transaksi.
                    </p>
                  ) : (
                    <p className="text-slate-600 leading-relaxed">
                      🔐📝 Paling ketat: Kasir wajib meminta <strong>PIN Approver</strong> dan menuliskan <strong>alasan override</strong>.
                    </p>
                  )}
                </div>
              </div>

              {/* 4. Approver List & PIN Status */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-xs text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>👥</span>
                      <span>Daftar Approver POS</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Pilih siapa saja anggota tim yang berhak memberikan otorisasi override harga & diskon di kasir:
                    </p>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100 bg-white">
                  {approvers.map((user) => {
                    const isChecked = selectedApproverIds.has(user.user_id) || user.is_owner

                    return (
                      <div key={user.user_id} className="p-4 flex items-center justify-between gap-4 hover:bg-slate-50/60 transition">
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            disabled={user.is_owner}
                            checked={isChecked}
                            onChange={() => handleToggleApprover(user.user_id, user.is_owner)}
                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-900 truncate">{user.name}</span>
                              {user.is_owner ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">
                                  Owner (Selalu)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 uppercase">
                                  {user.role}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">{user.email || 'Tanpa email'}</p>
                          </div>
                        </div>

                        {/* PIN Status & Reset Button */}
                        <div className="flex items-center gap-2 shrink-0">
                          {user.has_pin ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                              <span>✅</span> PIN Aktif
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
                              <span>⚠️</span> Belum Set PIN
                            </span>
                          )}

                          {user.has_pin && (
                            <button
                              type="button"
                              onClick={() => handleResetPin(user.user_id, user.name)}
                              disabled={resettingUserId === user.user_id}
                              className="px-2.5 py-1 text-[11px] font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg transition disabled:opacity-50"
                              title="Reset PIN jika pengguna lupa PIN"
                            >
                              {resettingUserId === user.user_id ? 'Mereset...' : 'Reset PIN'}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-500 flex items-start gap-2">
                  <span>ℹ️</span>
                  <span>
                    Untuk alasan keamanan, nilai PIN tidak dapat dilihat di sini. Masing-masing approver dapat mengatur dan mengganti PIN 6 digit mandiri di menu{' '}
                    <Link href="/settings/staff" className="font-bold text-blue-600 underline">
                      Pengaturan &gt; Staf & Hak Akses
                    </Link>.
                  </span>
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-4 border-t border-[#E2E2DC] flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Menyimpan Pengaturan...</span>
                    </>
                  ) : (
                    <span>💾 Simpan Pengaturan POS</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </SettingsLayout>
  )
}
