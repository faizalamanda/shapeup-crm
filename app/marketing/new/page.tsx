"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

export default function NewScenarioPage() {
  const [triggerType, setTriggerType] = useState('STATUS') // STATUS atau TIME
  const [deliveryMode, setDeliveryMode] = useState('IMMEDIATE')

  const orderStatuses = [
    'PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 
    'CANCELLED', 'REFUNDED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      <PageHeader 
        title="BUAT SKENARIO BARU" 
        description="Pilih pemicu pesan otomatis berdasarkan status order atau penjadwalan waktu."
        action={
          <div className="flex gap-3">
            <Link href="/marketing">
              <Button variant="outline">BATAL</Button>
            </Link>
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
        <Card>
          <Input label="NAMA SKENARIO" placeholder="CONTOH: FOLLOW UP COD SEMARANG" />
        </Card>
      </section>

      {/* STEP 2: PILIHAN TRIGGER UTAMA */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PILIH TIPE TRIGGER</h3>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => setTriggerType('STATUS')}
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">Trigger aktif saat status order berubah.</p>
            </button>
            <button 
              onClick={() => setTriggerType('TIME')}
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">Trigger aktif rutin setiap durasi tertentu.</p>
            </button>
          </div>

          {/* DETAIL TRIGGER BERDASARKAN STATUS */}
          {triggerType === 'STATUS' && (
            <div className="mt-8 pt-8 border-t border-slate-100 animate-in fade-in slide-in-from-top-2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-4">PILIH STATUS ORDER YANG DIPANTAU:</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {orderStatuses.map((status) => (
                  <label key={status} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600" />
                    <span className="text-[12px] font-bold text-slate-700">{status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* DETAIL TRIGGER BERDASARKAN KRITERIA WAKTU */}
          {triggerType === 'TIME' && (
            <div className="mt-8 pt-8 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-4 text-center">PENGATURAN PENJADWALAN:</label>
                <div className="flex items-center justify-center gap-4 p-6 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase">SETIAP</span>
                  <div className="flex gap-2">
                    <input type="number" className="w-20 p-2 border border-slate-300 rounded font-bold text-center" defaultValue="1" />
                    <select className="p-2 border border-slate-300 rounded font-bold text-sm bg-white outline-none">
                      <option>MENIT</option>
                      <option>JAM</option>
                      <option>HARI</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="text-center">
                <span className="text-[10px] font-bold text-slate-300 uppercase italic tracking-widest">— ATAU —</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-3 text-center">SPESIFIK WAKTU & TANGGAL:</label>
                <div className="max-w-xs mx-auto">
                  <input type="datetime-local" className="w-full p-3 border border-slate-300 rounded font-bold text-sm shadow-sm" />
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
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">ISI PESAN OTOMATIS</h3>
        </div>
        <Card>
          <TextArea label="TEMPLATE PESAN" placeholder="Halo {{nama}}, kami mendeteksi order anda..." />
          <div className="flex flex-wrap gap-2 pt-4">
            {['nama', 'no_order', 'total', 'link_bayar'].map(t => (
              <button key={t} className="px-3 py-1 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-500 uppercase">
                {"{{" + t + "}}"}
              </button>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}