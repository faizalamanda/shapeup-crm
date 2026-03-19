"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

export default function NewScenarioPage() {
  const [triggerType, setTriggerType] = useState('STATUS') // STATUS atau TIME
  const [timeType, setTimeType] = useState('LOOPING') // LOOPING atau SPECIFIC

  const orderStatuses = [
    'PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 
    'CANCELLED', 'REFUNDED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      <PageHeader 
        title="BUAT SKENARIO BARU" 
        description="Otomatisasi pesan berdasarkan perubahan status order atau jadwal waktu tertentu."
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
          <Input label="NAMA SKENARIO" placeholder="CONTOH: FOLLOW UP OTOMATIS COD" />
        </Card>
      </section>

      {/* STEP 2: TRIGGER UTAMA */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PILIH TIPE TRIGGER</h3>
        </div>
        <Card>
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button 
              onClick={() => setTriggerType('STATUS')}
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
              <p className="text-[11px] text-slate-500 mt-1 font-medium uppercase tracking-tight">Kirim saat status order berubah</p>
            </button>
            <button 
              onClick={() => setTriggerType('TIME')}
              className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}
            >
              <p className={`font-black text-sm uppercase ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
              <p className="text-[11px] text-slate-500 mt-1 font-medium uppercase tracking-tight">Kirim rutin atau jadwal spesifik</p>
            </button>
          </div>

          {/* DETAIL: BERDASARKAN STATUS */}
          {triggerType === 'STATUS' && (
            <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in slide-in-from-top-2">
              <label className="block text-xs font-bold text-slate-700 uppercase mb-4 tracking-wider">
                PILIH STATUS TUJUAN (Pesan dikirim saat order berubah ke status ini):
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {orderStatuses.map((status) => (
                  <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer shadow-sm">
                    <input type="checkbox" className="w-4 h-4 accent-blue-600 rounded" />
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tight">{status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* DETAIL: BERDASARKAN WAKTU */}
          {triggerType === 'TIME' && (
            <div className="animate-in fade-in slide-in-from-top-2 space-y-6">
              {/* Sub-Pilihan Waktu */}
              <div className="flex justify-center gap-4">
                <button 
                  onClick={() => setTimeType('LOOPING')}
                  className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${timeType === 'LOOPING' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200'}`}
                >
                  Looping (Interval)
                </button>
                <button 
                  onClick={() => setTimeType('SPECIFIC')}
                  className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${timeType === 'SPECIFIC' ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-400 border-slate-200'}`}
                >
                  Waktu Spesifik
                </button>
              </div>

              {/* Input Looping */}
              {timeType === 'LOOPING' && (
                <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center animate-in zoom-in-95 duration-200">
                  <label className="text-xs font-bold text-slate-600 uppercase mb-4 tracking-widest italic">Setel Interval Pengecekan</label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-400 uppercase">SETIAP</span>
                    <input type="number" className="w-20 p-3 border border-slate-300 rounded-lg font-bold text-center text-lg shadow-inner" defaultValue="1" />
                    <select className="p-3 border border-slate-300 rounded-lg font-bold text-sm bg-white outline-none shadow-sm">
                      <option>MENIT</option>
                      <option>JAM</option>
                      <option>HARI</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Input Spesifik */}
              {timeType === 'SPECIFIC' && (
                <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center animate-in zoom-in-95 duration-200">
                  <label className="text-xs font-bold text-slate-600 uppercase mb-4 tracking-widest italic">Pilih Tanggal & Jam Pengiriman</label>
                  <input 
                    type="datetime-local" 
                    className="w-full max-w-xs p-3 border border-slate-300 rounded-lg font-bold text-sm shadow-sm bg-white outline-none focus:ring-2 focus:ring-blue-500" 
                  />
                </div>
              )}
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
          <TextArea label="ISI PESAN" placeholder="Halo {{nama}}, status order anda {{no_order}} sudah kami update..." />
          <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100 mt-4">
            {['nama', 'no_order', 'total', 'link_bayar'].map(t => (
              <button key={t} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-bold text-slate-500 uppercase tracking-tight hover:bg-blue-50 hover:text-blue-600 transition-colors">
                {"{{" + t + "}}"}
              </button>
            ))}
          </div>
        </Card>
      </section>

      {/* FINAL ACTION */}
      <div className="flex justify-end gap-4 pt-10">
        <Link href="/marketing">
          <Button variant="outline" className="px-10">KEMBALI KE DAFTAR</Button>
        </Link>
        <Button variant="primary" className="px-10 shadow-lg shadow-blue-200">AKTIFKAN SEKARANG</Button>
      </div>
    </div>
  )
}