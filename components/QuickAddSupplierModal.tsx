"use client"

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export type SupplierItem = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

type QuickAddSupplierModalProps = {
  isOpen: boolean
  onClose: () => void
  initialName?: string
  onSuccess: (newSupplier: SupplierItem) => void
}

export default function QuickAddSupplierModal({
  isOpen,
  onClose,
  initialName = '',
  onSuccess
}: QuickAddSupplierModalProps) {
  const [mounted, setMounted] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setName(initialName)
      setPhone('')
      setEmail('')
      setAddress('')
      setErrorMessage('')
    }
  }, [isOpen, initialName])

  if (!isOpen || !mounted) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setErrorMessage('Nama pemasok wajib diisi!')
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null
        })
      })

      if (!res.ok) {
        const errData = await res.json()
        throw new Error(errData.error || 'Gagal membuat pemasok baru')
      }

      const createdSupplier = await res.json()
      onSuccess(createdSupplier)
      onClose()
    } catch (err: any) {
      console.error(err)
      setErrorMessage(err.message || 'Terjadi kesalahan')
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h3 className="text-xs font-black uppercase tracking-wider text-gray-800">
            🏢 Tambah Pemasok (Supplier) Baru
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-bold text-red-700">
              ⚠️ {errorMessage}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              Nama Pemasok / Perusahaan *
            </label>
            <input
              type="text"
              required
              placeholder="Contoh: PT Sumber Makmur"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                No. HP / WhatsApp
              </label>
              <input
                type="text"
                placeholder="08123456789"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                Email
              </label>
              <input
                type="email"
                placeholder="supplier@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              Alamat Lengkap
            </label>
            <textarea
              rows={2}
              placeholder="Alamat kantor / gudang supplier..."
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-xs font-semibold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
            />
          </div>

          <div className="pt-4 border-t border-gray-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-600 font-bold text-xs uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Pemasok'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
