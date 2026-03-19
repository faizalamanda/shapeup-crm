"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

export default function NewScenarioPage() {
  const [triggerType, setTriggerType] = useState('STATUS') 
  const [timeType, setTimeType] = useState('LOOPING')
  const [filters, setFilters] = useState([{ id: 1, key: 'TOTAL_ORDER', op: 'more than', value: '' }])

  const orderStatuses = ['PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED']

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      <PageHeader 
        title="BUAT SKENARIO BARU" 
        description="Otomatisasi berdasarkan perubahan status atau segmentasi audience terjadwal."
        action={
          <div className="flex gap-3">
            <Link href="/marketing"><Button variant="outline">BATAL</Button></Link>
            <Button variant="primary">SIMPAN SKENARIO</Button>
          </div>
        }
      />

      {/* STEP 1: IDENTITAS */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">1</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">IDENTITAS SKENARIO</h3>
        </div>
        <Card><Input label="NAMA SKENARIO" placeholder="CONTOH: BROADCAST PELANGGAN LOYAL" /></Card>
      </section>

      {/* STEP 2: TRIGGER & TARGETING */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & AUDIENCE</h3>
        </div>
        <Card>
          {/* Tipe Trigger Utama */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button onClick={() => setTriggerType('STATUS')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
              <p className={`font-black text-sm uppercase ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tight">Kirim ke order yang baru berganti status</p>
            </button>
            <button onClick={() => setTriggerType('TIME')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
              <p className={`font-black text-sm uppercase ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
              <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tight">Kirim ke segment audience terjadwal</p>
            </button>
          </div>

          {/* Render Detail Trigger Status */}
          {triggerType === 'STATUS' && (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in duration-300">
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-4 tracking-widest">PILIH STATUS TUJUAN:</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {orderStatuses.map((status) => (
                  <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer shadow-sm">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600 rounded" />
                    <span className="text-[11px] font-bold text-slate-700 uppercase">{status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Render Detail Trigger Waktu + Segment Filter */}
          {triggerType === 'TIME' && (
            <div className="animate-in fade-in duration-300 space-y-8">
              {/* Pilihan Looping / Spesifik */}
              <div className="flex justify-center gap-4">
                {['LOOPING', 'SPECIFIC'].map((t) => (
                  <button key={t} onClick={() => setTimeType(t)} className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${timeType === t ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-200'}`}>
                    {t === 'LOOPING' ? 'Looping (Interval)' : 'Waktu Spesifik'}
                  </button>
                ))}
              </div>

              {/* Input Detail Waktu */}
              <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center">
                {timeType === 'LOOPING' ? (
                  <div className="flex items-center gap-3 font-bold uppercase text-xs">
                    <span className="text-slate-400">SETIAP</span>
                    <input type="number" className="w-20 p-2 border border-slate-300 rounded-lg text-center" defaultValue="1" />
                    <select className="p-2 border border-slate-300 rounded-lg bg-white outline-none">
                      <option>MENIT</option><option>JAM</option><option>HARI</option>
                    </select>
                  </div>
                ) : (
                  <input type="datetime-local" className="p-3 border border-slate-300 rounded-lg font-bold text-sm bg-white shadow-sm" />
                )}
              </div>

              {/* SEGMENT TARGETING (Mockup Image Style) */}
              <div className="pt-6 border-t border-slate-200">
                <label className="block text-[11px] font-black text-slate-600 uppercase mb-4 tracking-widest">SEGMENT TARGETING:</label>
                <div className="space-y-3 bg-[#F1F5F9] p-6 rounded-xl border border-slate-200">
                  {filters.map((f, idx) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2 animate-in slide-in-from-left-2 duration-200">
                      {idx > 0 && <span className="text-[10px] font-black text-blue-600 uppercase mx-2">AND</span>}
                      
                      {/* Pill Filter Container */}
                      <div className="flex items-center bg-white border border-slate-300 rounded-md overflow-hidden shadow-sm">
                        <select className="bg-slate-50 px-3 py-2 text-[11px] font-bold border-r border-slate-200 outline-none text-slate-700">
                          <option>LAST_CONTACTED</option>
                          <option>TOTAL_ORDER_VALUE</option>
                          <option>CITY</option>
                          <option>PAYMENT_METHOD</option>
                          <option>HAS_SENT_LOG</option>
                        </select>
                        <select className="px-3 py-2 text-[11px] font-bold border-r border-slate-200 outline-none text-blue-600">
                          <option>more than</option>
                          <option>less than</option>
                          <option>between</option>
                          <option>is</option>
                        </select>
                        <input type="text" className="px-3 py-2 text-[11px] font-bold outline-none w-24" placeholder="VALUE" />
                        <button className="px-2 py-2 bg-slate-50 text-slate-400 hover:text-red-500 border-l border-slate-200">✕</button>
                      </div>

                      {idx === filters.length - 1 && (
                        <button onClick={() => setFilters([...filters, { id: Date.now(), key: '', op: '', value: '' }])} className="w-8 h-8 rounded-md bg-white border border-slate-300 text-slate-600 font-bold hover:bg-blue-600 hover:text-white transition-all">+</button>
                      )}
                    </div>
                  ))}
                  <p className="text-[9px] text-slate-400 font-black uppercase mt-4 tracking-tighter">
                    *Kirim pesan hanya ke customer yang memenuhi kriteria di atas.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* STEP 3: KONTEN PESAN */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">3</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN</h3>
        </div>
        <Card>
          <TextArea label="ISI PESAN" placeholder="Halo {{nama}}, kami ada promo untuk anda..." />
          <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100 mt-4">
            {['nama', 'no_order', 'total', 'link_bayar'].map(t => (
              <button key={t} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-500 uppercase tracking-tight hover:bg-blue-50">
                {"{{" + t + "}}"}
              </button>
            ))}
          </div>
        </Card>
      </section>

      <div className="flex justify-end gap-4 pt-10">
        <Link href="/marketing"><Button variant="outline" className="px-10 uppercase font-black text-xs">KEMBALI</Button></Link>
        <Button variant="primary" className="px-10 shadow-lg uppercase font-black text-xs">AKTIFKAN AUTOMATION</Button>
      </div>
    </div>
  )
}