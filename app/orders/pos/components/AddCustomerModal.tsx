"use client"
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createBrowserClient } from '@supabase/ssr'

type Customer = {
  id: string
  name: string
  phone: string
  email?: string
}

type AddCustomerModalProps = {
  isOpen: boolean
  onClose: () => void
  onSave: (customer: Customer) => void
  businessId: string
}

export default function AddCustomerModal({ isOpen, onClose, onSave, businessId }: AddCustomerModalProps) {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      setName('')
      setPhone('')
      setEmail('')
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) return alert('Nama pelanggan wajib diisi!')
    if (!phone.trim()) return alert('Nomor HP/WhatsApp wajib diisi!')

    // Clean and format phone number (e.g. 0812... -> 62812...)
    let cleanPhone = phone.replace(/\D/g, '')
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.substring(1)
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone
    }

    if (cleanPhone.length < 8) {
      return alert('Nomor HP tidak valid!')
    }

    setSaving(true)
    try {
      const response = await fetch('/api/pos/customer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          phone: cleanPhone,
          email: email.trim() || null,
        }),
      })

      const result = await response.json()
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Gagal menyimpan customer')
      }

      if (result.existing) {
        alert(`Pelanggan dengan nomor tersebut sudah terdaftar sebagai "${result.customer.name}". Otomatis memilih pelanggan tersebut.`)
      }

      onSave({
        id: result.customer.id,
        name: result.customer.name,
        phone: result.customer.phone,
        email: result.customer.email
      })
      onClose()
    } catch (err: any) {
      console.error('Error saving customer:', err)
      alert('Gagal menyimpan pelanggan: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen || !mounted) return null

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex justify-center items-center p-4 overflow-y-auto z-[10000] animate-in fade-in duration-200">
      <div 
        className="bg-white border border-[#E2E2DC] rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden transform scale-100 transition-all duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-white border-b border-[#E2E2DC]">
          <div>
            <span className="text-[9px] font-bold text-[#2563EB] uppercase tracking-widest block">CRM Database</span>
            <h3 className="text-sm font-black text-[#1C1C1A] uppercase tracking-tight mt-0.5">
              Tambah Pelanggan Baru
            </h3>
          </div>
          <button 
            onClick={onClose} 
            className="text-[#6B6B63] hover:text-[#1C1C1A] transition-colors text-xl font-light focus:outline-none"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form id="add-customer-form" onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F7F7F5]">
          <div>
            <label className="block text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest mb-1.5">Nama Lengkap *</label>
            <input
              type="text"
              required
              className="w-full p-3 border border-[#E2E2DC] bg-white rounded-xl focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none text-sm font-semibold text-[#1C1C1A] transition-all placeholder:text-gray-300"
              placeholder="Contoh: Ahmad Fauzi"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest mb-1.5">Nomor HP / WhatsApp *</label>
            <input
              type="text"
              required
              className="w-full p-3 border border-[#E2E2DC] bg-white rounded-xl focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none text-sm font-semibold text-[#1C1C1A] transition-all placeholder:text-gray-300"
              placeholder="Contoh: 08123456789"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-[#6B6B63] uppercase tracking-widest mb-1.5">Email (Opsional)</label>
            <input
              type="email"
              className="w-full p-3 border border-[#E2E2DC] bg-white rounded-xl focus:ring-2 focus:ring-[#2563EB]/10 focus:border-[#2563EB] outline-none text-sm font-semibold text-[#1C1C1A] transition-all placeholder:text-gray-300"
              placeholder="Contoh: ahmad@gmail.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-[#E2E2DC] flex gap-3 justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="px-5 py-3 border border-[#E2E2DC] rounded-xl text-xs font-bold uppercase tracking-wider text-[#6B6B63] hover:bg-slate-50 disabled:opacity-50 transition-all"
          >
            Batal
          </button>
          <button
            type="submit"
            form="add-customer-form"
            disabled={saving}
            className="px-5 py-3 bg-[#2563EB] text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md shadow-blue-100 hover:bg-[#1D4ED8] disabled:opacity-50 transition-all"
          >
            {saving ? 'Menyimpan...' : 'Simpan Pelanggan'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
