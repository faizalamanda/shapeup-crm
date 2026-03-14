"use client"
import { useState } from 'react'
import { formatPhoneNumberSmart } from '@/lib/utils'

export default function NewOrderManual() {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [items, setItems] = useState([{ product_name: '', quantity: 1, price: 0 }])
  const [loading, setLoading] = useState(false)

  // Fungsi menambah baris produk
  const addItem = () => setItems([...items, { product_name: '', quantity: 1, price: 0 }])
  
  // Fungsi menghapus baris produk
  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  // Fungsi update data di tiap baris
  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  // Hitung total otomatis
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.price), 0)

  const handleSave = async () => {
    if (!name || !phone) return alert("Nama dan No HP wajib diisi!");
    
    setLoading(true)
    try {
      const res = await fetch('/api/orders/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          phone, 
          items, 
          total_amount: totalAmount 
        })
      })
      
      if (res.ok) {
        alert("Order & Customer Berhasil Disimpan!")
        // Reset form
        setName('')
        setPhone('')
        setItems([{ product_name: '', quantity: 1, price: 0 }])
      } else {
        const err = await res.json()
        alert("Gagal menyimpan: " + err.error)
      }
    } catch (error) {
      alert("Terjadi kesalahan sistem")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Buat Pesanan Manual</h1>
        <p className="text-slate-500">Input data pelanggan dan rincian produk untuk pesanan baru.</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
        {/* SECTION 1: PELANGGAN */}
        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Informasi Pelanggan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-700">Nama Lengkap</label>
              <input 
                value={name}
                placeholder="Andi Wijaya" 
                className="w-full p-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-black" 
                onChange={e => setName(e.target.value)} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-700">Nomor WhatsApp</label>
              <input 
                value={phone}
                placeholder="08123xxx" 
                className="w-full p-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 transition-all text-black" 
                onChange={e => setPhone(e.target.value)} 
              />
              <p className="text-[10px] text-slate-400 italic">Format akan otomatis dirapikan sistem.</p>
            </div>
          </div>
        </div>

        {/* SECTION 2: ITEM PRODUK */}
        <div className="p-8">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Rincian Produk</h3>
          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="flex flex-wrap md:flex-nowrap gap-4 items-end animate-in fade-in slide-in-from-top-2">
                <div className="flex-1 min-w-[200px] space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Nama Produk</label>
                  <input 
                    value={item.product_name}
                    placeholder="Contoh: Gamis Hitam XL" 
                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all text-black text-sm" 
                    onChange={e => updateItem(index, 'product_name', e.target.value)} 
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Qty</label>
                  <input 
                    type="number" 
                    value={item.quantity}
                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-black text-sm text-center" 
                    onChange={e => updateItem(index, 'quantity', Number(e.target.value))} 
                  />
                </div>
                <div className="w-40 space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Harga Satuan</label>
                  <input 
                    type="number" 
                    value={item.price}
                    placeholder="Rp"
                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-black text-sm" 
                    onChange={e => updateItem(index, 'price', Number(e.target.value))} 
                  />
                </div>
                <button 
                  onClick={() => removeItem(index)}
                  className="p-3 text-slate-300 hover:text-red-500 transition-colors mb-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button 
            onClick={addItem} 
            className="mt-6 flex items-center gap-2 text-sm font-bold text-blue-600 hover:text-blue-700 transition-colors"
          >
            <span className="flex items-center justify-center w-5 h-5 border-2 border-blue-600 rounded-full text-xs">+</span>
            Tambah Baris Produk
          </button>
        </div>

        {/* SECTION 3: FOOTER TOTAL */}
        <div className="p-8 bg-slate-900 text-white flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Total Tagihan</p>
            <h2 className="text-3xl font-black">Rp {totalAmount.toLocaleString('id-ID')}</h2>
          </div>
          <button 
            onClick={handleSave} 
            disabled={loading}
            className={`w-full md:w-auto px-12 py-4 rounded-2xl font-black text-sm uppercase tracking-tighter transition-all shadow-lg ${
              loading ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-400 shadow-blue-500/20'
            }`}
          >
            {loading ? 'Memproses...' : 'Simpan & Posting Order'}
          </button>
        </div>
      </div>
    </div>
  )
}