"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

// 1. DEFINISI VARIABEL DATABASE (ORDER & CUSTOMER)
const AUDIENCE_VARIABLES = [
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text' },
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text' },
  { key: 'customer_phone', label: 'CUSTOMER: NO WA', type: 'text' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number' },
  { key: 'payment_method', label: 'ORDER: METODE BAYAR', type: 'text' },
  { key: 'order_status', label: 'ORDER: STATUS SAAT INI', type: 'text' },
  { key: 'last_ordered', label: 'ORDER: TANGGAL TERAKHIR', type: 'date' },
  { key: 'last_contacted', label: 'LOG: TERAKHIR DIHUBUNGI', type: 'date' },
]

const ORDER_STATUS_OPTIONS = [
  'PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 
  'CANCELLED', 'REFUNDED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'
]

export default function NewAdvancedScenario() {
  // State Utama
  const [triggerType, setTriggerType] = useState('STATUS') // STATUS | TIME
  const [timeType, setTimeType] = useState('LOOPING') // LOOPING | SPECIFIC
  const [scenarioName, setScenarioName] = useState('')
  
  // State untuk Dynamic Filters
  const [filters, setFilters] = useState([
    { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }
  ])

  // --- LOGIKA FILTER ---

  // Ambil Operator berdasarkan tipe data variabel
  const getOperators = (key: string) => {
    const field = AUDIENCE_VARIABLES.find(v => v.key === key)
    if (field?.type === 'text') return ['is', 'is not', 'contains', 'starts with', 'ends with']
    if (field?.type === 'number') return ['more than', 'less than', 'equal to', 'between']
    if (field?.type === 'date') return ['before', 'after', 'on', 'between', 'more than (days ago)']
    return ['is']
  }

  const addFilter = () => {
    setFilters([...filters, { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }])
  }

  const removeFilter = (id: number) => {
    if (filters.length > 1) {
      setFilters(filters.filter(f => f.id !== id))
    }
  }

  const updateFilter = (id: number, field: string, value: any) => {
    setFilters(filters.map(f => f.id === id ? { ...f, [field]: value } : f))
  }

  const toggleLogic = (id: number) => {
    setFilters(filters.map(f => f.id === id ? { ...f, logic: f.logic === 'AND' ? 'OR' : 'AND' } : f))
  }

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-32">
      <PageHeader 
        title="BUAT SKENARIO AUTOMATION" 
        description="Bangun alur pesan otomatis dengan segmentasi audience yang presisi."
        action={
          <div className="flex gap-3">
            <Link href="/marketing"><Button variant="outline">BATAL</Button></Link>
            <Button variant="primary" className="shadow-lg shadow-blue-100">SIMPAN & AKTIFKAN</Button>
          </div>
        }
      />

      {/* STEP 1: IDENTITAS */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">1</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">IDENTITAS SKENARIO</h3>
        </div>
        <Card>
          <Input 
            label="NAMA SKENARIO" 
            placeholder="CONTOH: FOLLOW UP COD BELUM KONFIRMASI (SEMARANG)" 
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
          />
        </Card>
      </section>

      {/* STEP 2: TRIGGER & TARGETING */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PILIH TRIGGER & AUDIENCE</h3>
        </div>
        
        <Card>
          {/* PEMILIH TRIGGER UTAMA */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button 
              onClick={() => setTriggerType('STATUS')} 
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim saat order berubah ke status tertentu</p>
            </button>
            <button 
              onClick={() => setTriggerType('TIME')} 
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim rutin ke segment audience pilihan</p>
            </button>
          </div>

          {/* DETAIL: TRIGGER STATUS */}
          {triggerType === 'STATUS' && (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in duration-300">
              <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-widest">PILIH STATUS TUJUAN:</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {ORDER_STATUS_OPTIONS.map((status) => (
                  <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer shadow-sm transition-all">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600 rounded" />
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tighter">{status}</span>
                  </label>
                ))}
              </div>
              <p className="mt-4 text-[10px] text-blue-500 font-bold uppercase tracking-tight">* PESAN AKAN TERKIRIM KE SETIAP DATA ORDER YANG BERGANTI KE STATUS DI ATAS.</p>
            </div>
          )}

          {/* DETAIL: TRIGGER WAKTU + SEGMENT BUILDER */}
          {triggerType === 'TIME' && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-8">
              {/* Toggle Looping / Specific */}
              <div className="flex justify-center gap-2 bg-slate-100 p-1 rounded-full w-fit mx-auto">
                <button 
                  onClick={() => setTimeType('LOOPING')} 
                  className={`px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all ${timeType === 'LOOPING' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  Looping (Interval)
                </button>
                <button 
                  onClick={() => setTimeType('SPECIFIC')} 
                  className={`px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all ${timeType === 'SPECIFIC' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}
                >
                  Waktu Spesifik
                </button>
              </div>

              {/* Input Detail Waktu */}
              <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center">
                {timeType === 'LOOPING' ? (
                  <div className="flex items-center gap-4 font-bold uppercase text-xs">
                    <span className="text-slate-400 tracking-widest">SETIAP</span>
                    <input type="number" className="w-20 p-2 border border-slate-300 rounded-lg text-center font-bold text-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white" defaultValue="1" />
                    <select className="p-2 border border-slate-300 rounded-lg bg-white outline-none font-bold">
                      <option>MENIT</option><option>JAM</option><option>HARI</option>
                    </select>
                  </div>
                ) : (
                  <input type="datetime-local" className="p-3 border border-slate-300 rounded-lg font-bold text-sm bg-white shadow-sm outline-none focus:ring-2 focus:ring-blue-500" />
                )}
              </div>

              {/* SEGMENT TARGETING BUILDER */}
              <div className="pt-6 border-t border-slate-200">
                <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-[0.2em]">SEGMENT TARGETING</label>
                
                <div className="space-y-3 bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner">
                  {filters.map((f, idx) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2 duration-300">
                      {/* Logic Switcher (AND/OR) */}
                      {idx > 0 && (
                        <button 
                          onClick={() => toggleLogic(f.id)}
                          className={`px-3 py-1 text-[10px] font-black rounded transition-all shadow-sm uppercase min-w-[50px] ${f.logic === 'AND' ? 'bg-blue-600 text-white' : 'bg-orange-500 text-white'}`}
                        >
                          {f.logic}
                        </button>
                      )}
                      
                      {/* Filter Row Pill */}
                      <div className="flex items-center bg-white border border-slate-300 rounded-lg shadow-sm overflow-hidden flex-1 md:flex-none">
                        {/* Pilih Variabel (Data Source) */}
                        <select 
                          value={f.key}
                          onChange={(e) => updateFilter(f.id, 'key', e.target.value)}
                          className="bg-slate-50 px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 outline-none text-slate-800 uppercase"
                        >
                          {AUDIENCE_VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                        </select>

                        {/* Pilih Operator Sesuai Tipe Data */}
                        <select 
                          value={f.op}
                          onChange={(e) => updateFilter(f.id, 'op', e.target.value)}
                          className="px-3 py-2.5 text-[11px] font-bold border-r border-slate-200 outline-none text-blue-600 uppercase"
                        >
                          {getOperators(f.key).map(op => <option key={op} value={op}>{op}</option>)}
                        </select>

                        {/* Input Value */}
                        <input 
                          type="text" 
                          value={f.value}
                          onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                          className="px-4 py-2.5 text-[11px] font-bold outline-none flex-1 md:w-40 placeholder:text-slate-300 uppercase"
                          placeholder="VALUE..."
                        />

                        {/* Tombol Hapus */}
                        <button 
                          onClick={() => removeFilter(f.id)}
                          className="px-4 py-2.5 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 border-l border-slate-200 transition-colors"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Tombol Tambah (Hanya di baris terakhir) */}
                      {idx === filters.length - 1 && (
                        <button 
                          onClick={addFilter}
                          className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 font-bold hover:bg-blue-600 hover:text-white transition-all shadow-sm active:scale-95"
                        >
                          +
                        </button>
                      )}
                    </div>
                  ))}
                  <p className="text-[9px] text-slate-400 font-black uppercase mt-4 tracking-tighter">
                    * PESAN HANYA AKAN DIKIRIM KE PELANGGAN YANG MEMENUHI SELURUH KRITERIA SEGMENTASI DI ATAS.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* STEP 3: ISI PESAN */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">3</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN (WHATSAPP)</h3>
        </div>
        <Card>
          <div className="space-y-6">
            <TextArea 
              label="TEMPLATE PESAN" 
              placeholder="Halo {{nama}}, kami mendeteksi order anda {{no_order}} belum dibayar..." 
              className="min-h-[150px] font-bold text-slate-700"
            />
            <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100">
              {['nama', 'no_order', 'total', 'link_invoice', 'kota_tujuan'].map(tag => (
                <button key={tag} className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded text-[10px] font-bold text-slate-500 uppercase tracking-tight transition-all">
                  {"{{" + tag + "}}"}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* FOOTER ACTIONS */}
      <div className="flex justify-end items-center gap-4 pt-10 border-t border-slate-200">
        <Link href="/marketing">
          <Button variant="outline" className="px-10 uppercase font-black text-xs tracking-widest">KEMBALI KE DAFTAR</Button>
        </Link>
        <Button variant="primary" className="px-10 py-6 shadow-xl shadow-blue-100 uppercase font-black text-xs tracking-widest">
          SIMPAN & AKTIFKAN AUTOMATION
        </Button>
      </div>
    </div>
  )
}