"use client"
import { Card } from '@/components/ui/Card'

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
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm text-[10px]">2</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & PENJADWALAN</h3>
      </div>
      
      <Card>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button 
            onClick={() => setTriggerType('STATUS')} 
            className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
          >
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
            <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim saat order berubah status</p>
          </button>
          <button 
            onClick={() => setTriggerType('TIME')} 
            className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-100 opacity-60'}`}
          >
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
            <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-tighter">Kirim rutin ke segment pilihan</p>
          </button>
        </div>

        {triggerType === 'STATUS' ? (
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 animate-in fade-in duration-300">
            <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-widest">PILIH STATUS TUJUAN:</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {ORDER_STATUS_OPTIONS.map(status => (
                <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer shadow-sm">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600" />
                  <span className="text-[11px] font-bold text-slate-700 uppercase">{status}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-top-2">
             <div className="flex justify-center gap-2 bg-slate-100 p-1 rounded-full w-fit mx-auto">
                {['LOOPING', 'SPECIFIC'].map(t => (
                  <button key={t} onClick={() => setTimeType(t)} className={`px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all ${timeType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{t}</button>
                ))}
             </div>
             <div className="p-8 bg-slate-50 rounded-xl border border-slate-200 flex justify-center items-center gap-4 font-bold text-xs uppercase tracking-tight">
                {timeType === 'LOOPING' ? (
                  <>
                    <span className="text-slate-400">SETIAP</span>
                    <input type="number" defaultValue="1" className="w-20 p-2 border border-slate-300 rounded font-bold text-lg text-center bg-white shadow-inner" />
                    <select className="p-2 border border-slate-300 rounded bg-white font-bold text-xs outline-none">
                      <option>MENIT</option><option>JAM</option><option>HARI</option>
                    </select>
                  </>
                ) : (
                  <input type="datetime-local" className="p-3 border border-slate-300 rounded-lg shadow-sm font-bold bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                )}
             </div>
          </div>
        )}
      </Card>
    </section>
  )
}