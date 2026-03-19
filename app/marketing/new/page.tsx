"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { PageHeader } from '@/components/ui/PageHeader'
import Link from 'next/link'

export default function NewScenarioPage() {
  const [deliveryType, setDeliveryType] = useState('IMMEDIATE')

  const orderStatuses = [
    'PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 
    'CANCELLED', 'REFUNDED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-20">
      <PageHeader 
        title="BUAT SKENARIO BARU" 
        description="Susun alur pengiriman pesan otomatis berdasarkan status order."
        action={
          <div className="flex gap-3">
            <Link href="/marketing">
              <Button variant="outline">BATAL</Button>
            </Link>
            <Button variant="primary">SIMPAN SKENARIO</Button>
          </div>
        }
      />

      {/* STEP 1: INFORMASI DASAR */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">1</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">IDENTITAS SKENARIO</h3>
        </div>
        <Card>
          <Input 
            label="NAMA SKENARIO" 
            placeholder="CONTOH: FOLLOW UP COD BELUM KONFIRMASI" 
          />
        </Card>
      </section>

      {/* STEP 2: TRIGGER (STATUS ORDER) */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PILIH TRIGGER (STATUS ORDER)</h3>
        </div>
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {orderStatuses.map((status) => (
              <label key={status} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-all">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" />
                <span className="text-[12px] font-bold text-slate-700">{status}</span>
              </label>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-slate-400 font-medium uppercase tracking-wider">
            *Pesan akan terpicu jika order berubah ke salah satu status di atas.
          </p>
        </Card>
      </section>

      {/* STEP 3: WAKTU PENGIRIMAN */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">3</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">PENGATURAN WAKTU KIRIM</h3>
        </div>
        <Card>
          <div className="space-y-6">
            <div className="flex gap-4">
              <button 
                onClick={() => setDeliveryType('IMMEDIATE')}
                className={`flex-1 p-4 rounded-xl border-2 transition-all text-sm font-bold uppercase tracking-tight ${deliveryType === 'IMMEDIATE' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-100 text-slate-400'}`}
              >
                LANGSUNG TERKIRIM
              </button>
              <button 
                onClick={() => setDeliveryType('DELAY')}
                className={`flex-1 p-4 rounded-xl border-2 transition-all text-sm font-bold uppercase tracking-tight ${deliveryType === 'DELAY' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-100 text-slate-400'}`}
              >
                CEK BERKALA / DELAY
              </button>
            </div>

            {deliveryType === 'DELAY' && (
              <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in duration-300">
                <label className="block text-xs font-bold text-slate-600 uppercase mb-3 text-center">PILIH DURASI PENGECEKAN</label>
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-2">
                    <input type="number" className="w-20 p-2 border border-slate-300 rounded font-bold text-center" defaultValue="15" />
                    <select className="p-2 border border-slate-300 rounded font-bold text-sm bg-white outline-none">
                      <option>MENIT</option>
                      <option>JAM</option>
                      <option>HARI</option>
                    </select>
                  </div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">SETELAH TRIGGER AKTIF</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* STEP 4: ISI PESAN */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">4</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">KONTEN PESAN (WHATSAPP)</h3>
        </div>
        <Card>
          <div className="space-y-6">
            <TextArea 
              label="ISI TEMPLATE PESAN" 
              placeholder="Halo {{nama}}, order anda {{no_order}} sudah kami proses..." 
            />
            <div className="flex flex-wrap gap-2 pt-2">
              {['nama', 'total', 'no_order', 'kurir', 'link_invoice'].map(t => (
                <button key={t} className="px-3 py-1.5 bg-slate-100 hover:bg-blue-100 border border-slate-200 rounded text-[11px] font-bold text-slate-600 transition-all uppercase tracking-tight">
                  {"{{" + t + "}}"}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* ACTION BUTTONS FOOTER */}
      <div className="flex justify-end gap-4 pt-10 border-t border-slate-200">
        <Link href="/marketing">
          <Button variant="outline" className="px-10">KEMBALI KE LIST</Button>
        </Link>
        <Button variant="primary" className="px-10">AKTIFKAN AUTOMATION SEKARANG</Button>
      </div>
    </div>
  )
}