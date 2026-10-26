"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'

interface CartItemData {
  product: { id?: string; name: string; price?: number; cost_price?: number; prevent_below_hpp?: boolean }
  selectedVariant?: { id?: string; name: string; price?: number; cost_price?: number }
  finalPrice: number
  discount?: number
  quantity: number
  note?: string
  authorization?: any
}

interface Props {
  isOpen: boolean
  onClose: () => void
  item: CartItemData | null
  isGuarded?: boolean
  costPrice?: number
  allowOverride?: boolean
  existingAuthorization?: any
  onRequestAuthorization?: (data: {
    proposedPrice: number
    currentPrice: number
    discountApplied: number
  }) => void
  onSave: (updates: {
    finalPrice: number
    discount: number
    quantity: number
    note: string
  }) => void
  onRemove: () => void
}

export default function CartItemEditModal({
  isOpen,
  onClose,
  item,
  isGuarded = false,
  costPrice = 0,
  allowOverride = false,
  existingAuthorization,
  onRequestAuthorization,
  onSave,
  onRemove,
}: Props) {
  const [quantity, setQuantity] = useState<number>(1)
  const [finalPrice, setFinalPrice] = useState<number>(0)
  const [discount, setDiscount] = useState<number>(0)
  const [note, setNote] = useState<string>('')

  // Determine standard base price for reset option
  const originalBasePrice = Number(
    item?.selectedVariant?.price ?? item?.product?.price ?? item?.finalPrice ?? 0
  )

  useEffect(() => {
    if (isOpen && item) {
      setQuantity(item.quantity || 1)
      setFinalPrice(Number(item.finalPrice) || 0)
      setDiscount(Number(item.discount) || 0)
      setNote(item.note || '')
    }
  }, [isOpen, item])

  if (!isOpen || !item) return null

  const handleQtyChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, prev + delta))
  }

  const netUnitPrice = Math.max(0, finalPrice - discount)
  const itemTotal = netUnitPrice * quantity

  // Evaluasi batas harga (internal boolean only, numeric costPrice is NEVER shown)
  const isBelowCost = Boolean(
    isGuarded &&
    costPrice > 0 &&
    netUnitPrice < costPrice
  )

  // Evaluasi otorisasi: jika harga bersih diturunkan lebih rendah dari harga yang telah disetujui sebelumnya,
  // maka otorisasi lama batal dan wajib minta otorisasi ulang.
  const activeAuth = existingAuthorization || item.authorization
  const previousApprovedPrice =
    activeAuth?.proposed_price !== undefined
      ? Number(activeAuth.proposed_price)
      : Math.max(0, Number(item.finalPrice || 0) - Number(item.discount || 0))

  const isApproved = Boolean(activeAuth) && netUnitPrice >= previousApprovedPrice
  const isBlocked = isBelowCost && !isApproved && !allowOverride
  const needsAuth = isBelowCost && !isApproved && allowOverride

  const handleSave = () => {
    if (isBlocked) return
    if (needsAuth) {
      if (onRequestAuthorization) {
        onRequestAuthorization({
          proposedPrice: netUnitPrice,
          currentPrice: originalBasePrice,
          discountApplied: discount,
        })
      }
      return
    }

    onSave({
      finalPrice: Math.max(0, Number(finalPrice) || 0),
      discount: Math.max(0, Number(discount) || 0),
      quantity: Math.max(1, Number(quantity) || 1),
      note: note.trim(),
    })
    onClose()
  }

  const handleRemove = () => {
    onRemove()
    onClose()
  }

  const subtitle = item.selectedVariant
    ? `${item.product.name} — ${item.selectedVariant.name}`
    : item.product.name

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      desktopSize="sm"
      title={
        <div className="flex items-center gap-2">
          <span className="text-lg">✏️</span>
          <span className="text-slate-900 font-extrabold text-sm sm:text-base">Edit Item Pesanan</span>
        </div>
      }
      description={
        <span className="text-xs text-indigo-600 font-semibold truncate block mt-0.5">
          {subtitle}
        </span>
      }
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRemove}
            className="py-2.5 px-3 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-xl text-xs transition active:scale-95 flex items-center gap-1 shrink-0"
            title="Hapus item dari keranjang"
          >
            <span>🗑️</span>
            <span>Hapus</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-3 border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition active:scale-95"
          >
            Batal
          </button>
          {needsAuth ? (
            <button
              type="button"
              onClick={handleSave}
              className="flex-1 py-2.5 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-xs transition shadow-md shadow-blue-500/20 active:scale-95 text-center flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>🔐</span>
              <span>Minta Otorisasi</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSave}
              disabled={isBlocked}
              className={`flex-1 py-2.5 px-3 font-extrabold rounded-xl text-xs transition shadow-md active:scale-95 text-center cursor-pointer ${
                isBlocked
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-indigo-500/20'
              }`}
            >
              Simpan
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3.5">
        {/* Quantity Stepper */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Jumlah / Kuantitas
          </label>
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-1.5">
            <button
              type="button"
              onClick={() => handleQtyChange(-1)}
              disabled={quantity <= 1}
              className="w-10 h-9 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-40 flex items-center justify-center font-black text-base transition shadow-2xs"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              onWheel={(e) => e.currentTarget.blur()}
              className="w-20 text-center font-extrabold text-base bg-transparent text-slate-900 outline-none"
            />
            <button
              type="button"
              onClick={() => handleQtyChange(1)}
              className="w-10 h-9 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-black text-base transition shadow-2xs"
            >
              +
            </button>
          </div>
        </div>

        {/* Unit Price */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Harga Satuan (Rp)
            </label>
            {finalPrice !== originalBasePrice && (
              <button
                type="button"
                onClick={() => setFinalPrice(originalBasePrice)}
                className="text-[10px] text-indigo-600 font-bold hover:underline"
              >
                ↺ Reset ke Rp {originalBasePrice.toLocaleString('id-ID')}
              </button>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">Rp</span>
            <input
              type="number"
              min="0"
              value={finalPrice === 0 ? '' : finalPrice}
              onChange={(e) => setFinalPrice(Number(e.target.value))}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="0"
              className={`w-full pl-9 pr-3 py-2 text-sm font-bold text-slate-900 rounded-xl border focus:outline-none focus:ring-2 bg-white ${
                isBelowCost ? 'border-amber-400 focus:ring-amber-500' : 'border-slate-200 focus:ring-indigo-500'
              }`}
            />
          </div>
        </div>

        {/* Discount per Item */}
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Potongan Diskon per Item (Rp)
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-xs">Rp</span>
            <input
              type="number"
              min="0"
              value={discount === 0 ? '' : discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="0"
              className={`w-full pl-9 pr-3 py-2 text-sm font-bold text-slate-900 rounded-xl border focus:outline-none focus:ring-2 bg-white ${
                isBelowCost ? 'border-amber-400 focus:ring-amber-500' : 'border-slate-200 focus:ring-indigo-500'
              }`}
            />
            {discount > 0 && (
              <button
                type="button"
                onClick={() => setDiscount(0)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Price Floor Violation Notice (Minimal Notification, NO numeric HPP) */}
        {isBelowCost && (
          <div className="p-3 rounded-xl border transition-all space-y-1.5 bg-amber-50 border-amber-300">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Harga di bawah batas minimum</span>
              </span>
              {isApproved && (
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300">
                  ✅ Disetujui
                </span>
              )}
            </div>
            {!isApproved && (
              <p className="text-[11px] text-amber-800">
                {allowOverride
                  ? 'Memerlukan otorisasi sebelum dapat disimpan dan diproses.'
                  : 'Penetapan harga di bawah batas minimum diblokir oleh kebijakan toko.'}
              </p>
            )}
            {isApproved && (
              <p className="text-[11px] text-emerald-800">
                Disetujui oleh {activeAuth?.approved_by_name || 'Approver'}
              </p>
            )}
          </div>
        )}

        {/* Item Note */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Catatan Khusus Item
            </label>
            {note && (
              <button
                type="button"
                onClick={() => setNote('')}
                className="text-[10px] text-rose-500 font-bold hover:underline"
              >
                ✕ Kosongkan
              </button>
            )}
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: Tanpa es, minta kantong terpisah, dll..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>

        {/* Real-time Subtotal Preview */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
          <div className="text-slate-500">
            Total Item ({quantity}x):
          </div>
          <div className="text-sm font-extrabold text-indigo-900">
            Rp {itemTotal.toLocaleString('id-ID')}
          </div>
        </div>
      </div>
    </FullScreenModal>
  )
}
