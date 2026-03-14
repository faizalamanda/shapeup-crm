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

  // Hitung total otomatis untuk footer
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
    <div className="max-w-5xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Buat Pesanan Manual</h1>
        <p className="text-slate-500 text-sm">Input data pelanggan dan rincian produk untuk pesanan baru.</p>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-100 overflow-hidden">
        
        {/* SECTION 1: PELANGGAN */}
        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Informasi Pelanggan</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">Nama Lengkap</label>
              <input 
                value={name}
                placeholder="Andi Wijaya" 
                className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-black font-medium" 
                onChange={e => setName(e.target.value)} 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1">Nomor WhatsApp</label>
              <input 
                value={phone}
                placeholder="08565..." 
                className="w-full p-3.5 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-black font-medium" 
                onChange={e => setPhone(e.target.value)} 
              />
              <p className="text-[10px] text-slate-400 italic ml-1">Format otomatis dibersihkan sistem.</p>
            </div>
          </div>
        </div>

        {/* SECTION 2: ITEM PRODUK */}
        <div className="p-8">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-6">Rincian Produk</h3>
          
          <div className="space-y-5">
            {items.map((item, index) => (
              <div key={index} className="flex flex-wrap lg:flex-nowrap gap-4 items-end bg-white p-2 rounded-2xl transition-all animate-in fade-in slide-in-from-top-2">
                
                {/* Nama Produk */}
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 ml-1 uppercase">Nama Produk</label>
                  <input 
                    value={item.product_name}
                    placeholder="Contoh: Cintya Blouse - Yellow" 
                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all text-black text-sm font-medium" 
                    onChange={e => updateItem(index, 'product_name', e.target.value)} 
                  />
                </div>

                {/* Qty */}
                <div className="w-20 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase text-center block">Qty</label>
                  <input 
                    type="number" 
                    value={item.quantity}
                    className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-black text-sm text-center font-bold" 
                    onChange={e => updateItem(index, 'quantity', Number(e.target.value))} 
                  />
                </div>

                {/* Harga Satuan */}
                <div className="w-40 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Harga Satuan</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3.5 text-slate-400 text-xs font-bold">Rp</span>
                    <input 
                      type="number" 
                      value={item.price}
                      className="w-full p-3 pl-8 bg-slate-50 border border-slate-100 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-black text-sm font-medium" 
                      onChange={e => updateItem(index, 'price', Number(e.target.value))} 
                    />
                  </div>
                </div>

                {/* SUB TOTAL (KOLOM BARU) */}
                <div className="w-44 space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1 text-right block">Subtotal</label>
                  <div className="w-full p-3 bg-blue-50/50 border border-transparent rounded-xl text-blue-600 text-sm font-black text-right">
                    Rp {(item.quantity * item.price).toLocaleString('id-ID')}
                  </div>
                </div>

                {/* Hapus */}
                <button 
                  onClick={() => removeItem(index)}
                  className="p-3 text-slate-300 hover:text-red-500 transition-colors mb-0.5"
                  title="Hapus baris"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>

          <button 
            onClick={addItem} 
            className="mt-8 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-all hover:translate-x-1"
          >
            <span className="flex items-center justify-center w-6 h-6 bg-blue-50 rounded-full text-blue-600">+</span>
            Tambah Baris Produk
          </button>
        </div>

        {/* SECTION 3: FOOTER TOTAL */}
        <div className="p-8 bg-[#0F172A] text-white flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">Total Tagihan Akhir</p>
            <h2 className="text-4xl font-black tracking-tighter text-white">
              <span className="text-blue-400 text-xl mr-1 font-bold">Rp</span>
              {totalAmount.toLocaleString('id-ID')}
            </h2>
          </div>
          <button 
            onClick={handleSave} 
            disabled={loading}
            className={`w-full md:w-auto px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.1em] transition-all shadow-2xl ${
              loading 
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
              : 'bg-blue-600 text-white hover:bg-blue-500 hover:-translate-y-1 active:translate-y-0 shadow-blue-500/20'
            }`}
          >
            {loading ? 'Sedang Memproses...' : 'Simpan & Posting Order'}
          </button>
        </div>
      </div>
    </div>
  )
}