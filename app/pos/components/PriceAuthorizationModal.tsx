"use client"

import { useState, useEffect, useCallback } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

export interface AuthorizationRecord {
  authorization_id: string
  approved_by_id: string
  approved_by_name: string
  authorization_type: 'line_item_price' | 'global_discount'
  product_id?: string | null
  reason?: string | null
}

interface ApproverOption {
  id: string
  name: string
  email: string
  role: string
  has_pin: boolean
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: (authRecord: AuthorizationRecord) => void
  authorizationType: 'line_item_price' | 'global_discount'
  title?: string
  targetDescription: string
  productId?: string | null
  proposedPrice?: number
  currentPrice?: number
  discountApplied?: number
  requirePin: boolean
  requireReason: boolean
}

export default function PriceAuthorizationModal({
  isOpen,
  onClose,
  onSuccess,
  authorizationType,
  title,
  targetDescription,
  productId,
  proposedPrice,
  currentPrice,
  discountApplied,
  requirePin,
  requireReason,
}: Props) {
  const [approvers, setApprovers] = useState<ApproverOption[]>([])
  const [selectedApproverId, setSelectedApproverId] = useState<string>('')
  const [pin, setPin] = useState<string>('')
  const [showPin, setShowPin] = useState<boolean>(false)
  const [reason, setReason] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [fetchingApprovers, setFetchingApprovers] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const loadApprovers = useCallback(async () => {
    setFetchingApprovers(true)
    setErrorMessage('')
    try {
      const res = await fetch('/api/pos/price-authorizations')
      if (res.ok) {
        const data = await res.json()
        const list: ApproverOption[] = data.approvers || []
        setApprovers(list)
        if (list.length > 0) {
          setSelectedApproverId(list[0].id)
        }
      } else {
        setErrorMessage('Gagal memuat daftar approver.')
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal memuat daftar approver.')
    } finally {
      setFetchingApprovers(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setPin('')
      setShowPin(false)
      setReason('')
      setErrorMessage('')
      loadApprovers()
    }
  }, [isOpen, loadApprovers])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage('')

    if (requirePin && (!selectedApproverId || pin.length !== 6)) {
      setErrorMessage('Pilih approver dan masukkan 6 digit PIN!')
      return
    }

    if (requireReason && !reason.trim()) {
      setErrorMessage('Alasan otorisasi wajib diisi!')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/pos/price-authorizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approver_id: selectedApproverId || null,
          pin: requirePin ? pin : null,
          reason: reason.trim() || null,
          trigger: authorizationType === 'line_item_price' ? 'line_price' : 'global_discount',
          authorization_type: authorizationType,
          product_id: productId || null,
          proposed_price: proposedPrice ?? null,
          requested_net_price: proposedPrice ?? 0,
          current_price: currentPrice ?? null,
          discount_applied: discountApplied ?? null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Otorisasi gagal')
      }

      const approverName = approvers.find(a => a.id === selectedApproverId)?.name || 'Approver'
      onSuccess({
        authorization_id: data.authorization_id,
        approved_by_id: selectedApproverId,
        approved_by_name: approverName,
        authorization_type: authorizationType,
        product_id: productId || null,
        reason: reason.trim() || null,
      })
      onClose()
    } catch (err: any) {
      setErrorMessage(err.message || 'Otorisasi gagal')
    } finally {
      setLoading(false)
    }
  }

  const selectedApprover = approvers.find(a => a.id === selectedApproverId)

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="sm"
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg">🔐</span>
          <span className="text-slate-900 font-extrabold text-sm sm:text-base">
            {title || (authorizationType === 'global_discount' ? 'Otorisasi Diskon Global' : 'Otorisasi Batas Harga')}
          </span>
        </div>
      }
      description={
        <span className="text-xs text-amber-600 font-semibold truncate block mt-0.5">
          ⚠️ {targetDescription}
        </span>
      }
      footer={
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3 px-3 border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition active:scale-95 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={
              loading ||
              fetchingApprovers ||
              (requirePin && pin.length !== 6) ||
              (requireReason && !reason.trim())
            }
            className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shadow-blue-500/20 active:scale-95 text-center disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Memverifikasi...' : 'Setujui Otorisasi'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Banner Info */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
          <span className="text-base shrink-0">🛡️</span>
          <div className="text-xs text-amber-900">
            <p className="font-bold">Persetujuan Diperlukan</p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              {authorizationType === 'global_discount'
                ? 'Penerapan diskon global keranjang memerlukan persetujuan otorisasi sesuai kebijakan toko.'
                : 'Harga satuan yang dimasukkan berada di bawah batas minimum yang ditentukan toko.'}
            </p>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2">
            <span>❌</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Approver Selection & PIN (if requirePin) */}
        {requirePin && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Pilih Approver (Owner / Admin / Manajer)
              </label>
              {fetchingApprovers ? (
                <div className="text-xs text-slate-400 py-2">Memuat daftar approver...</div>
              ) : approvers.length === 0 ? (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  Belum ada akun approver yang memiliki PIN otorisasi. Mohon atur PIN di Pengaturan Staf.
                </div>
              ) : (
                <select
                  value={selectedApproverId}
                  onChange={(e) => setSelectedApproverId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {approvers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.role === 'owner' ? 'Owner' : a.role}) {!a.has_pin ? '— [Belum ada PIN]' : ''}
                    </option>
                  ))}
                </select>
              )}
              {selectedApprover && !selectedApprover.has_pin && (
                <p className="text-[11px] text-rose-600 font-semibold mt-1">
                  ⚠️ Pengguna ini belum mengatur PIN otorisasi POS.
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                6 Digit PIN Approver
              </label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="Masukkan 6 digit PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  className="w-full px-3.5 py-2.5 pr-12 border border-slate-200 rounded-xl text-base tracking-widest font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-center"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  tabIndex={-1}
                  aria-label={showPin ? 'Sembunyikan PIN' : 'Lihat PIN'}
                >
                  {showPin ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reason Input (if requireReason) */}
        {requireReason && (
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Alasan Otorisasi {requireReason ? '(Wajib Diisi)' : '(Opsional)'}
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Barang cacat minor di kemasan, promo khusus relasi pelanggan setia, clearance sale..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <p className="text-[11px] text-slate-400">
              Alasan akan disimpan permanen dalam catatan audit log untuk rekonsiliasi berkala.
            </p>
          </div>
        )}
      </form>
    </FullScreenModal>
  )
}
