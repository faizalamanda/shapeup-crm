"use client"
import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import AudienceSegmentBuilder from './AudienceSegmentBuilder'

interface Props {
  triggerType: string;
  setTriggerType: (t: string) => void;
  timeType: string;
  setTimeType: (t: string) => void;
}

const ORDER_STATUS_OPTIONS = [
  'PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 
  'CANCELLED', 'REFUNDED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'
];

export default function MarketingTrigger({ triggerType, setTriggerType, timeType, setTimeType }: Props) {
  return (
    <section className="space-y-4">
      {/* HEADER STEP */}
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & TARGETING</h3>
      </div>
      
      <Card>
        {/* PILIHAN UTAMA: STATUS VS WAKTU */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button 
            onClick={() => setTriggerType('STATUS')} 
            className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
          >
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
            <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim saat order berganti status</p>
          </button>
          <button 
            onClick={() => setTriggerType('TIME')} 
            className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
          >
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
            <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim terjadwal ke segment pilihan</p>
          </button>
        </div>

        {/* KONTEN JIKA PILIH STATUS */}
        {triggerType === 'STATUS' && (
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in duration-300">
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-widest text-center">PILIH STATUS TUJUAN:</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ORDER_STATUS_OPTIONS.map(status => (
                <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer shadow-sm transition-all group">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600 rounded" />
                  <span className="text-[11px] font-bold text-slate-700 uppercase group-hover:text-blue-600">{status}</span>
                </label>
              ))}
            </div>
            <p className="mt-6 text-[10px] text-blue-500 font-bold uppercase tracking-tight text-center italic">
              * Pesan akan otomatis terkirim setiap kali ada order yang berganti ke status yang dipilih di atas.
            </p>
          </div>
        )}

        {/* KONTEN JIKA PILIH WAKTU */}
        {triggerType === 'TIME' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-top-2">
            {/* Toggle Looping vs Spesifik */}
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
            <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex justify-center items-center gap-4 font-bold text-xs uppercase tracking-tight">
              {timeType === 'LOOPING' ? (
                <>
                  <span className="text-slate-400">SETIAP</span>
                  <input type="number" defaultValue="1" className="w-20 p-2 border border-slate-300 rounded font-bold text-lg text-center bg-white shadow-inner outline-none focus:ring-2 focus:ring-blue-500" />
                  <select className="p-2 border border-slate-300 rounded bg-white font-bold text-xs outline-none focus:ring-2 focus:ring-blue-500">
                    <option>MENIT</option><option>JAM</option><option>HARI</option>
                  </select>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-black mb-1">PILIH TANGGAL & JAM:</span>
                  <input type="datetime-local" className="p-3 border border-slate-300 rounded-lg shadow-sm font-bold bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
              )}
            </div>

            {/* SEGMENT TARGETING (Muncul di bawah setting waktu) */}
            <div className="pt-8 border-t border-slate-200">
              <div className="flex items-center gap-2 mb-4">
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">SEGMENT TARGETING</label>
                <div className="h-[1px] bg-slate-100 flex-1"></div>
              </div>
              
              {/* Memanggil Component AudienceSegmentBuilder */}
              <AudienceSegmentBuilder />
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}