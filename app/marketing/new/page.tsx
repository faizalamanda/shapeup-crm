"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

// Definisi Variabel dan Jenis Datanya
const AUDIENCE_VARIABLES = [
  { key: 'customer_name', label: 'CUSTOMER: NAMA', type: 'text' },
  { key: 'customer_city', label: 'CUSTOMER: KOTA', type: 'text' },
  { key: 'total_spent', label: 'ORDER: TOTAL BELANJA', type: 'number' },
  { key: 'payment_method', label: 'ORDER: METODE BAYAR', type: 'text' },
  { key: 'last_ordered', label: 'ORDER: TANGGAL TERAKHIR', type: 'date' },
  { key: 'last_contacted', label: 'LOG: TERAKHIR DIHUBUNGI', type: 'date' },
]

export default function AdvancedNewScenario() {
  const [triggerType, setTriggerType] = useState('STATUS')
  const [timeType, setTimeType] = useState('LOOPING')
  
  // State untuk Filter
  const [filters, setFilters] = useState([
    { id: Date.now(), key: 'customer_name', op: 'is', value: '', logic: 'AND' }
  ])

  // Fungsi ambil operator berdasarkan tipe data
  const getOperators = (key: string) => {
    const field = AUDIENCE_VARIABLES.find(v => v.key === key)
    if (field?.type === 'text') return ['is', 'is not', 'contains', 'starts with']
    if (field?.type === 'number') return ['more than', 'less than', 'equal to', 'between']
    if (field?.type === 'date') return ['before', 'after', 'on', 'between', 'more than (days)']
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
    <div className="max-w-5xl mx-auto space-y-10 pb-24">
      <PageHeader 
        title="BUAT SKENARIO ADVANCED" 
        description="Filter audience berdasarkan data order, customer, dan riwayat log pesan."
        action={<Link href="/marketing"><Button variant="primary">SIMPAN & AKTIFKAN</Button></Link>}
      />

      {/* STEP 2: TRIGGER & TARGETING */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & SEGMENTASI</h3>
        </div>
        
        <Card>
          {/* PEMILIH TRIGGER UTAMA */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => setTriggerType('STATUS')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
              <p className={`font-black text-sm uppercase ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>BERDASARKAN STATUS</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tight">KIRIM SAAT ORDER BERUBAH STATUS</p>
            </button>
            <button onClick={() => setTriggerType('TIME')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
              <p className={`font-black text-sm uppercase ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>BERDASARKAN WAKTU</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tight">KIRIM KE SEGMENT TERJADWAL</p>
            </button>
          </div>

          {/* DETAIL TIME + SEGMENT TARGETING */}
          {triggerType === 'TIME' && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-8">
              {/* INPUT WAKTU */}
              <div className="flex justify-center gap-2 bg-slate-100 p-1 rounded-full w-fit mx-auto mb-6">
                {['LOOPING', 'SPECIFIC'].map(t => (
                  <button key={t} onClick={() => setTimeType(t)} className={`px-6 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${timeType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{t}</button>
                ))}
              </div>

              {/* SEGMENT BUILDER */}
              <div className="pt-6 border-t border-slate-200">
                <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-[0.2em]">SEGMENT TARGETING</label>
                
                <div className="space-y-3 bg-slate-50 p-6 rounded-xl border border-slate-200">
                  {filters.map((f, idx) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2">
                      {/* Logical Switcher (AND/OR) */}
                      {idx > 0 && (
                        <button 
                          onClick={() => toggleLogic(f.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded hover:bg-blue-700 transition-colors uppercase min-w-[45px]"
                        >
                          {f.logic}
                        </button>
                      )}
                      
                      {/* Row Filter */}
                      <div className="flex items-center bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
                        {/* Variabel Selection */}
                        <select 
                          value={f.key}
                          onChange={(e) => updateFilter(f.id, 'key', e.target.value)}
                          className="bg-slate-50 px-3 py-2 text-[11px] font-bold border-r border-slate-200 outline-none text-slate-800 uppercase"
                        >
                          {AUDIENCE_VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
                        </select>

                        {/* Smart Operator Selection */}
                        <select 
                          value={f.op}
                          onChange={(e) => updateFilter(f.id, 'op', e.target.value)}
                          className="px-3 py-2 text-[11px] font-bold border-r border-slate-200 outline-none text-blue-600 uppercase"
                        >
                          {getOperators(f.key).map(op => <option key={op} value={op}>{op}</option>)}
                        </select>

                        {/* Value Input */}
                        <input 
                          type="text" 
                          value={f.value}
                          onChange={(e) => updateFilter(f.id, 'value', e.target.value)}
                          className="px-3 py-2 text-[11px] font-bold outline-none w-32 placeholder:text-slate-300"
                          placeholder="MASUKKAN NILAI"
                        />

                        {/* Delete Button */}
                        <button 
                          onClick={() => removeFilter(f.id)}
                          className="px-3 py-2 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 border-l border-slate-200 transition-colors"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Add Button (Hanya di baris terakhir) */}
                      {idx === filters.length - 1 && (
                        <button 
                          onClick={addFilter}
                          className="w-8 h-8 flex items-center justify-center rounded border border-slate-300 bg-white text-slate-600 font-bold hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                        >
                          +
                        </button>
                      )}
                    </div>
                  ))}
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
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN</h3>
        </div>
        <Card>
          <TextArea label="TEMPLATE PESAN (WHATSAPP)" placeholder="Halo {{nama}}, kami mendeteksi order anda..." />
        </Card>
      </section>
    </div>
  )
}