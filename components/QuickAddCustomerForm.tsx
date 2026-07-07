"use client"

/**
 * QuickAddCustomerForm — Form lengkap untuk membuat customer baru.
 *
 * Menggabungkan field identitas (nama, phone, email) dengan
 * CustomerAddressForm (alamat global berbasis JSONB).
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

import { CustomerAddressForm, AddressData, EMPTY_ADDRESS } from './CustomerAddressForm'

export type NewCustomerFormData = {
  name: string
  phone: string
  email: string
  address: AddressData
}

export const EMPTY_CUSTOMER_FORM: NewCustomerFormData = {
  name: '',
  phone: '',
  email: '',
  address: EMPTY_ADDRESS,
}

interface QuickAddCustomerFormProps {
  value: NewCustomerFormData
  onChange: (data: NewCustomerFormData) => void
  compact?: boolean
}

const inputCls = "w-full p-2 text-sm rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
const labelCls = "text-xs font-bold text-[#70706E] block mb-1"

export function QuickAddCustomerForm({ value, onChange, compact = false }: QuickAddCustomerFormProps) {
  const set = (field: keyof Omit<NewCustomerFormData, 'address'>, val: string) => {
    onChange({ ...value, [field]: val })
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
          <label className={labelCls}>Nomor HP / WhatsApp *</label>
          <input
            type="text"
            value={value.phone}
            onChange={e => set('phone', e.target.value)}
            placeholder="Contoh: 08123456789"
            className={inputCls}
            required
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
