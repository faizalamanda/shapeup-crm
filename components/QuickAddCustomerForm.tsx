"use client"

/**
 * QuickAddCustomerForm — Form lengkap untuk membuat customer baru.
 *
 * Menggabungkan field identitas (nama, phone opsional, email) dengan
 * CustomerAddressForm (alamat global berbasis JSONB) dan
 * profil akun marketplace (Shopee, TikTok Shop, dll untuk kebutuhan PII masking).
 *
 * Bisa dipakai sebagai:
 * - Inline panel di halaman invoice baru
 * - Embedded di modal POS / order manual
 *
 * Props:
 *   value       — state form
 *   onChange    — callback update field
 *   compact     — true = tanpa heading/card wrapper (inline mode)
 */

import { useState } from 'react'
import { CustomerAddressForm, AddressData, EMPTY_ADDRESS } from './CustomerAddressForm'

export type MarketplaceProfiles = {
  shopee?: string
  tiktok?: string
  tokopedia?: string
  lazada?: string
  amazon?: string
  other_platform?: string
  other_handle?: string
  [key: string]: string | undefined
}

export type NewCustomerFormData = {
  name: string
  phone: string
  email: string
  address: AddressData
  marketplace_profiles?: MarketplaceProfiles
}

export const EMPTY_CUSTOMER_FORM: NewCustomerFormData = {
  name: '',
  phone: '',
  email: '',
  address: EMPTY_ADDRESS,
  marketplace_profiles: {
    shopee: '',
    tiktok: '',
    tokopedia: '',
    lazada: '',
    amazon: '',
    other_platform: '',
    other_handle: ''
  }
}

interface QuickAddCustomerFormProps {
  value: NewCustomerFormData
  onChange: (data: NewCustomerFormData) => void
  compact?: boolean
}

const inputCls = "w-full p-2 text-sm rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
const labelCls = "text-xs font-bold text-[#70706E] block mb-1"

export function QuickAddCustomerForm({ value, onChange, compact = false }: QuickAddCustomerFormProps) {
  const [showMarketplaceSection, setShowMarketplaceSection] = useState(
    Boolean(
      value.marketplace_profiles?.shopee ||
      value.marketplace_profiles?.tiktok ||
      value.marketplace_profiles?.tokopedia ||
      value.marketplace_profiles?.other_handle
    )
  )
  const [showOtherPlatform, setShowOtherPlatform] = useState(
    Boolean(value.marketplace_profiles?.other_handle)
  )

  const set = (field: keyof Omit<NewCustomerFormData, 'address' | 'marketplace_profiles'>, val: string) => {
    onChange({ ...value, [field]: val })
  }

  const setMarketplace = (platform: string, val: string) => {
    const current = value.marketplace_profiles || {}
    onChange({
      ...value,
      marketplace_profiles: {
        ...current,
        [platform]: val
      }
    })
  }

  const identityFields = (
    <div className="space-y-4">
      {/* Nama + Phone + Email */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={labelCls}>Nama Lengkap *</label>
          <input
            type="text"
            value={value.name}
            onChange={e => set('name', e.target.value)}
            placeholder="Nama Customer"
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className={labelCls}>
            Nomor HP / WhatsApp <span className="text-[10px] font-normal text-slate-400">(Opsional jika dari marketplace)</span>
          </label>
          <input
            type="text"
            value={value.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="Contoh: 08123456789"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Email (Opsional)</label>
          <input
            type="email"
            value={value.email}
            onChange={e => set('email', e.target.value)}
            placeholder="email@customer.com"
            className={inputCls}
          />
        </div>
      </div>

      {/* Akun Marketplace Section (Shopee, TikTok, dll) */}
      <div className="border border-slate-200/80 rounded-xl p-3.5 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">🛍️</span>
            <div>
              <p className="text-xs font-bold text-slate-700">Akun Marketplace Pembeli (Opsional)</p>
              <p className="text-[10px] text-slate-400">
                Gunakan jika nomor HP disensor/tidak tersedia oleh Shopee, TikTok Shop, dll.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMarketplaceSection(!showMarketplaceSection)}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline px-2 py-1 rounded"
          >
            {showMarketplaceSection ? 'Sembunyikan' : '+ Atur Akun Marketplace'}
          </button>
        </div>

        {showMarketplaceSection && (
          <div className="mt-3.5 pt-3 border-t border-slate-200/60 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Shopee */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
                  Username Shopee
                </label>
                <input
                  type="text"
                  value={value.marketplace_profiles?.shopee || ''}
                  onChange={e => setMarketplace('shopee', e.target.value.replace(/^@/, ''))}
                  placeholder="Contoh: budi_olshop"
                  className={inputCls}
                />
              </div>

              {/* TikTok Shop */}
              <div>
                <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full bg-black inline-block"></span>
                  Username TikTok Shop
                </label>
                <input
                  type="text"
                  value={value.marketplace_profiles?.tiktok || ''}
                  onChange={e => setMarketplace('tiktok', e.target.value.replace(/^@/, ''))}
                  placeholder="Contoh: anita_store"
                  className={inputCls}
                />
              </div>
            </div>

            {/* Platform Lainnya (Tokopedia, Lazada, Amazon, dll) */}
            {showOtherPlatform ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 mb-1 block">Nama Platform Lain</label>
                  <input
                    type="text"
                    value={value.marketplace_profiles?.other_platform || ''}
                    onChange={e => setMarketplace('other_platform', e.target.value)}
                    placeholder="Contoh: Tokopedia, Lazada, Amazon, Etsy"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-600 mb-1 block">Username / ID Pembeli</label>
                  <input
                    type="text"
                    value={value.marketplace_profiles?.other_handle || ''}
                    onChange={e => setMarketplace('other_handle', e.target.value.replace(/^@/, ''))}
                    placeholder="Contoh: budi_collection"
                    className={inputCls}
                  />
                </div>
              </div>
            ) : (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowOtherPlatform(true)}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                >
                  <span>+ Tambah Platform Lain (Tokopedia, Amazon, Lazada, Etsy, dll)</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Address Section */}
      <CustomerAddressForm
        value={value.address}
        onChange={address => onChange({ ...value, address })}
        compact={compact}
      />
    </div>
  )

  if (compact) return identityFields

  return (
    <div className="border border-[#EBEBEA] rounded-2xl p-5 bg-white space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">👤</span>
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#70706E]">
          Data Customer Baru
        </h3>
      </div>
      {identityFields}
    </div>
  )
}
