"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

interface Props {
  isOpen: boolean
  onClose: () => void
  currentDiscountType: 'nominal' | 'percent'
  currentDiscountValue: string
  subtotal: number
  requireAuth?: boolean
  existingAuthorization?: any
  onRequestAuthorization?: (calculatedDiscount: number) => void
  onApply: (type: 'nominal' | 'percent', value: string) => void
}

export default function GlobalDiscountModal({
  isOpen,
  onClose,
  currentDiscountType,
  currentDiscountValue,
  subtotal,
  requireAuth = false,
  existingAuthorization,
  onRequestAuthorization,
  onApply,
}: Props) {
  const [discountType, setDiscountType] = useState<'nominal' | 'percent'>('nominal')
  const [discountValue, setDiscountValue] = useState('')

  useEffect(() => {
    if (isOpen) {
      setDiscountType(currentDiscountType || 'nominal')
      setDiscountValue(currentDiscountValue || '')
    }
  }, [isOpen, currentDiscountType, currentDiscountValue])

  if (!isOpen) return null

  const numVal = Number(discountValue) || 0

  const calculatedDiscount =
    discountType === 'percent'
      ? Math.round((subtotal * Math.min(100, Math.max(0, numVal))) / 100)
      : Math.min(subtotal, Math.max(0, numVal))

  const isApproved = Boolean(existingAuthorization)
  const needsAuth = requireAuth && numVal > 0 && !isApproved

  const handleSave = () => {
    if (numVal <= 0) {
      onApply('nominal', '')
      onClose()
      return
    }

    if (needsAuth) {
      if (onRequestAuthorization) {
        onRequestAuthorization(calculatedDiscount)
      }
      return
    }

    onApply(discountType, discountValue)
    onClose()
  }

  const handleClear = () => {
    onApply('nominal', '')
    onClose()
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="sm"
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg">🏷️</span>
          <span className="text-slate-900 font-extrabold text-sm sm:text-base">Diskon Global Pesanan</span>
        </div>
      }
      description="Potongan harga umum untuk keseluruhan pesanan keranjang belanja"
      footer={
        <div className="flex items-center gap-2.5">
          {currentDiscountValue && (
            <button
              type="button"
              onClick={handleClear}
              className="py-3 px-3.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs transition active:scale-95"
            >
              Hapus
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-3 border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition active:scale-95"
          >
            Batal
          </button>
          {needsAuth ? (
            <button
              type="button"
              onClick={() => {
                if (onRequestAuthorization) {
                  onRequestAuthorization(calculatedDiscount)
                }
              }}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shadow-blue-500/20 active:scale-95 text-center flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>🔐</span>
              <span>Minta Otorisasi Diskon</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shadow-emerald-500/20 active:scale-95 text-center cursor-pointer"
            >
              Terapkan Diskon
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Type Toggle: Nominal (Rp) vs Persen (%) */}
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Tipe Potongan
          </label>
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setDiscountType('nominal')
                setDiscountValue('')
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                discountType === 'nominal'
                  ? 'bg-white shadow-xs text-emerald-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Rupiah (Rp)
            </button>
            <button
              type="button"
              onClick={() => {
                setDiscountType('percent')
                setDiscountValue('')
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                discountType === 'percent'
                  ? 'bg-white shadow-xs text-emerald-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Persen (%)
            </button>
          </div>
        </div>

        {/* Input Value */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            {discountType === 'percent' ? 'Persentase Diskon (0 - 100%)' : 'Nominal Diskon (Rp)'}
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-3 text-slate-400 font-bold text-sm">
              {discountType === 'percent' ? '%' : 'Rp'}
            </span>
            <input
              type="number"
              value={discountValue}
              onChange={(e) => {
                const val = e.target.value
                if (discountType === 'percent') {
                  if (Number(val) > 100) return
                }
                setDiscountValue(val)
              }}
              placeholder="0"
              className="w-full pl-10 pr-4 py-2.5 text-base font-extrabold text-slate-900 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            />
          </div>
        </div>

        {/* Auth Notice */}
        {needsAuth && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5">
            <span className="text-base shrink-0">🔐</span>
            <div className="text-xs text-amber-900">
              <p className="font-bold">Otorisasi Diperlukan</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Kebijakan toko mewajibkan persetujuan otorisasi untuk setiap penerapan diskon global keranjang.
              </p>
            </div>
          </div>
        )}

        {isApproved && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-900 flex items-center gap-1.5">
              <span>✅</span>
              <span>Diskon Global Disetujui</span>
            </span>
            <span className="text-[11px] font-semibold text-emerald-700">
              {existingAuthorization?.approved_by_name || 'Approver'}
            </span>
          </div>
        )}

        {/* Subtotal Preview */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal Pesanan:</span>
            <span className="font-bold text-slate-700">Rp {subtotal.toLocaleString('id-ID')}</span>
          </div>
          <div className="flex justify-between text-emerald-700 font-bold">
            <span>Potongan Diskon:</span>
            <span>- Rp {calculatedDiscount.toLocaleString('id-ID')}</span>
          </div>
          <div className="pt-2 border-t border-slate-200 flex justify-between font-extrabold text-slate-900 text-sm">
            <span>Total Akhir:</span>
            <span className="text-indigo-900">
              Rp {Math.max(0, subtotal - calculatedDiscount).toLocaleString('id-ID')}
            </span>
          </div>
        </div>
      </div>
    </FullScreenModal>
  )
}
