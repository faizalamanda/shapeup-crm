"use client"

import { useState, useEffect } from 'react'
import { FullScreenModal } from '@/components/ui/FullScreenModal'
import { PaperSize } from '@/lib/pos/printerAdapter'
import { useUserContext } from '@/components/UserContext'
import { supabase } from '@/lib/supabase'
import { fetchLoyaltySettings } from '@/plugins/loyalty/helpers/loyaltyApi'

export interface ReceiptSettings {
  storeName: string
  address: string
  phone: string
  footerNote: string
  paperSize: PaperSize
  autoPrintAfterPayment: boolean
  showItemNumbering: boolean
  showLoyaltyPoints: boolean
}

const STORAGE_KEY = 'shapeup_pos_receipt_settings'

export function getStoredReceiptSettings(defaultBusinessName: string = 'ShapeUp Store'): ReceiptSettings {
  if (typeof window === 'undefined') {
    return {
      storeName: defaultBusinessName,
      address: '',
      phone: '',
      footerNote: 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.',
      paperSize: '58mm',
      autoPrintAfterPayment: false,
      showItemNumbering: true,
      showLoyaltyPoints: true
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        storeName: parsed.storeName || defaultBusinessName,
        address: parsed.address || '',
        phone: parsed.phone || '',
        footerNote: parsed.footerNote || 'Terima kasih atas kunjungan Anda!',
        paperSize: parsed.paperSize || '58mm',
        autoPrintAfterPayment: Boolean(parsed.autoPrintAfterPayment),
        showItemNumbering: parsed.showItemNumbering !== undefined ? Boolean(parsed.showItemNumbering) : true,
        showLoyaltyPoints: parsed.showLoyaltyPoints !== undefined ? Boolean(parsed.showLoyaltyPoints) : true
      }
    }
  } catch (e) {
    console.warn('Failed reading receipt settings:', e)
  }

  return {
    storeName: defaultBusinessName,
    address: '',
    phone: '',
    footerNote: 'Terima kasih atas kunjungan Anda!\nBarang yang sudah dibeli tidak dapat ditukar/dikembalikan.',
    paperSize: '58mm',
    autoPrintAfterPayment: false,
    showItemNumbering: true,
    showLoyaltyPoints: true
  }
}

type Props = {
  isOpen: boolean
  onClose: () => void
  defaultBusinessName?: string
  businessId?: string
  onSave?: (settings: ReceiptSettings) => void
}

export default function ReceiptSettingsModal({ isOpen, onClose, defaultBusinessName = 'ShapeUp Store', businessId, onSave }: Props) {
  const { activeBusiness } = useUserContext()
  const targetBizId = businessId || activeBusiness?.id

  const [storeName, setStoreName] = useState(defaultBusinessName)
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [footerNote, setFooterNote] = useState('Terima kasih atas kunjungan Anda!')
  const [paperSize, setPaperSize] = useState<PaperSize>('58mm')
  const [autoPrintAfterPayment, setAutoPrintAfterPayment] = useState(false)
  const [showItemNumbering, setShowItemNumbering] = useState(true)
  const [showLoyaltyPoints, setShowLoyaltyPoints] = useState(true)
  const [isLoyaltyProgramEnabled, setIsLoyaltyProgramEnabled] = useState(false)
  const [loadingLoyalty, setLoadingLoyalty] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      const s = getStoredReceiptSettings(defaultBusinessName)
      setStoreName(s.storeName)
      setAddress(s.address)
      setPhone(s.phone)
      setFooterNote(s.footerNote)
      setPaperSize(s.paperSize)
      setAutoPrintAfterPayment(s.autoPrintAfterPayment)
      setShowItemNumbering(s.showItemNumbering)
      setShowLoyaltyPoints(s.showLoyaltyPoints)
      setSaveSuccess(false)

      if (targetBizId) {
        setLoadingLoyalty(true)
        fetchLoyaltySettings(supabase, targetBizId)
          .then((ls) => {
            setIsLoyaltyProgramEnabled(Boolean(ls?.is_enabled))
          })
          .catch((err) => {
            console.warn('[ReceiptSettings] Failed checking loyalty settings:', err)
            setIsLoyaltyProgramEnabled(false)
          })
          .finally(() => {
            setLoadingLoyalty(false)
          })
      } else {
        setIsLoyaltyProgramEnabled(false)
      }
    }
  }, [isOpen, defaultBusinessName, targetBizId])

  const handleSave = () => {
    const settings: ReceiptSettings = {
      storeName: storeName.trim() || defaultBusinessName,
      address: address.trim(),
      phone: phone.trim(),
      footerNote: footerNote.trim(),
      paperSize,
      autoPrintAfterPayment,
      showItemNumbering,
      showLoyaltyPoints
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      if (onSave) onSave(settings)
      setSaveSuccess(true)
      setTimeout(() => {
        onClose()
      }, 600)
    } catch (e) {
      console.error('Failed saving receipt settings:', e)
    }
  }

  return (
    <FullScreenModal
      isOpen={isOpen}
      onClose={onClose}
      title="⚙️ Pengaturan Struk & Printer Kasir"
      description="Konfigurasi header struk, informasi toko, nomor urut produk, dan poin loyalty"
      desktopSize="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {saveSuccess ? (
            <span className="text-xs font-bold text-emerald-600">✓ Pengaturan berhasil disimpan!</span>
          ) : <span />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs transition shadow-sm"
            >
              Simpan Pengaturan
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        {/* Kolom Kiri: Form Pengaturan */}
        <div className="space-y-4">
          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Nama Toko / Bisnis di Struk
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Contoh: Toko Berkah Jaya"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Alamat Toko (Opsional)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Contoh: Jl. Sudirman No. 45, Jakarta"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Nomor Telepon / WhatsApp
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Contoh: 0812-3456-7890"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Ukuran Kertas Printer Kasir
            </label>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as PaperSize)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="58mm">Thermal 58mm (Ukuran Standar Kasir Mini)</option>
              <option value="80mm">Thermal 80mm (Ukuran Standar Resto / Supermarket)</option>
              <option value="A4">Kertas Halaman A4 / Invoice</option>
            </select>
          </div>

          <div>
            <label className="block font-bold text-slate-700 uppercase tracking-wide mb-1">
              Catatan Kaki Struk (Footer Notes)
            </label>
            <textarea
              rows={3}
              value={footerNote}
              onChange={(e) => setFooterNote(e.target.value)}
              placeholder="Pesan ucapan terima kasih atau kebijakan retur..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 font-medium focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
            />
          </div>

          {/* Opsi Tampilan & Cetak */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <span className="block font-bold text-slate-800 uppercase tracking-wider text-[11px]">
              Opsi Format Struk & Fitur
            </span>

            {/* Toggle 1: Nomor Urut Pencatatan Produk */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="itemNumberingCheckbox"
                checked={showItemNumbering}
                onChange={(e) => setShowItemNumbering(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <label htmlFor="itemNumberingCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                  Nomor Urut Pencatatan Produk
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Tampilkan nomor urut (1, 2, 3...) di sebelah kiri nama setiap item produk untuk memudahkan verifikasi daftar belanjaan.
                </p>
              </div>
            </div>

            {/* Toggle 2: Poin Loyalty Pelanggan */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="loyaltyPointsCheckbox"
                checked={isLoyaltyProgramEnabled && showLoyaltyPoints}
                disabled={!isLoyaltyProgramEnabled || loadingLoyalty}
                onChange={(e) => setShowLoyaltyPoints(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer disabled:opacity-40"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <label htmlFor="loyaltyPointsCheckbox" className={`font-semibold text-xs ${isLoyaltyProgramEnabled ? 'text-slate-800 cursor-pointer' : 'text-slate-400'}`}>
                    Tampilkan Poin Loyalty Member
                  </label>
                  {loadingLoyalty ? (
                    <span className="text-[9px] font-medium text-slate-400">Memeriksa...</span>
                  ) : isLoyaltyProgramEnabled ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200">
                      🟢 Fitur Aktif di Bisnis
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-md border border-amber-200">
                      ⚠️ Fitur Belum Aktif
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {isLoyaltyProgramEnabled 
                    ? 'Mencetak tier member, perolehan poin transaksi ini, dan total saldo poin akhir pada struk pelanggan member.'
                    : 'Program loyalty member belum diaktifkan oleh bisnis. Anda dapat mengaktifkannya di menu Pelanggan → Program Loyalty.'}
                </p>
              </div>
            </div>

            {/* Toggle 3: Auto-Print */}
            <div className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
              <input
                type="checkbox"
                id="autoPrintCheckbox"
                checked={autoPrintAfterPayment}
                onChange={(e) => setAutoPrintAfterPayment(e.target.checked)}
                className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              <div className="flex-1">
                <label htmlFor="autoPrintCheckbox" className="font-semibold text-slate-800 cursor-pointer text-xs block">
                  Cetak Otomatis Setelah Pembayaran
                </label>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Otomatis membuka dialog cetak struk sesaat setelah transaksi kasir berhasil diselesaikan.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Kolom Kanan: Pratinjau Struk Live */}
        <div className="bg-slate-100 p-4 rounded-2xl border border-slate-200 flex flex-col items-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5">
            👁️ Pratinjau Tampilan Struk
          </span>
          <div 
            className={`bg-white text-black font-mono p-4 rounded-lg shadow-md border border-slate-200 text-[11px] leading-tight ${
              paperSize === '58mm' ? 'w-[240px]' : paperSize === '80mm' ? 'w-[300px]' : 'w-full max-w-sm'
            }`}
          >
            <div className="text-center pb-2 border-b border-dashed border-slate-400 space-y-0.5">
              <h4 className="font-bold text-xs uppercase">{storeName || 'NAMA TOKO'}</h4>
              {address && <p className="text-[10px] text-slate-600">{address}</p>}
              {phone && <p className="text-[10px] text-slate-600">Telp: {phone}</p>}
            </div>

            <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[10px] text-slate-600">
              <div className="flex justify-between">
                <span>No: POS-20261012</span>
                <span>12/10/26 15:30</span>
              </div>
              <div className="flex justify-between">
                <span>Kasir: Budi Santoso</span>
                <span>Pelanggan: Budi (Member)</span>
              </div>
            </div>

            <div className="py-2 border-b border-dashed border-slate-400 space-y-1">
              <div>
                <p className="font-bold">{showItemNumbering ? '1. ' : ''}Contoh Item Produk A</p>
                <div className="flex justify-between text-slate-600">
                  <span>2 x Rp 25.000</span>
                  <span>Rp 50.000</span>
                </div>
              </div>
              <div>
                <p className="font-bold">{showItemNumbering ? '2. ' : ''}Contoh Item Produk B</p>
                <div className="flex justify-between text-slate-600">
                  <span>1 x Rp 15.000</span>
                  <span>Rp 15.000</span>
                </div>
              </div>
            </div>

            <div className="py-2 border-b border-dashed border-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>Rp 65.000</span>
              </div>
              <div className="flex justify-between font-bold text-xs pt-1 border-t border-slate-200">
                <span>TOTAL:</span>
                <span>Rp 65.000</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-600 pt-0.5">
                <span>Bayar Tunai:</span>
                <span>Rp 100.000</span>
              </div>
              <div className="flex justify-between text-[10px] font-semibold text-slate-800">
                <span>Kembalian:</span>
                <span>Rp 35.000</span>
              </div>
            </div>

            {/* Live Preview Blok Loyalty Rewards */}
            {isLoyaltyProgramEnabled && showLoyaltyPoints && (
              <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
                <div className="flex justify-between font-bold text-slate-800">
                  <span>LOYALTY REWARDS</span>
                  <span>🥇 Gold</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Poin Transaksi:</span>
                  <span className="font-semibold text-slate-800">+6 Poin</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Total Saldo Poin:</span>
                  <span className="font-semibold text-slate-800">246 Poin</span>
                </div>
              </div>
            )}

            <div className="pt-2 text-center text-[9px] text-slate-500 whitespace-pre-line">
              {footerNote || 'Terima kasih atas kunjungan Anda!'}
            </div>
          </div>
        </div>
      </div>
    </FullScreenModal>
  )
}
