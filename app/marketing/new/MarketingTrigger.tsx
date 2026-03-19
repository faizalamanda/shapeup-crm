"use client"
import { Card } from '@/components/ui/Card'

interface Props {
  triggerType: string;
  setTriggerType: (t: string) => void;
  timeType: string;
  setTimeType: (t: string) => void;
}

const ORDER_STATUS_OPTIONS = ['PENDING_PAYMENT', 'PROCESSING', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'FAILED', 'READY_TO_SHIP', 'SHIPPED'];

export default function MarketingTrigger({ triggerType, setTriggerType, timeType, setTimeType }: Props) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & PENJADWALAN</h3>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button onClick={() => setTriggerType('STATUS')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
            <p className={`font-black text-sm uppercase ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>BERDASARKAN STATUS</p>
          </button>
          <button onClick={() => setTriggerType('TIME')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
            <p className={`font-black text-sm uppercase ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>BERDASARKAN WAKTU</p>
          </button>
        </div>

        {triggerType === 'STATUS' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {ORDER_STATUS_OPTIONS.map(status => (
              <label key={status} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-blue-600" />
                <span className="text-[11px] font-bold text-slate-700 uppercase">{status}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in">
             <div className="flex justify-center gap-2 bg-slate-100 p-1 rounded-full w-fit mx-auto">
                {['LOOPING', 'SPECIFIC'].map(t => (
                  <button key={t} onClick={() => setTimeType(t)} className={`px-6 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${timeType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{t}</button>
                ))}
             </div>
             <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 flex justify-center items-center gap-3 font-bold text-xs uppercase">
                {timeType === 'LOOPING' ? (
                  <><span>SETIAP</span><input type="number" defaultValue="1" className="w-16 p-2 border border-slate-300 rounded text-center" /><select className="p-2 border border-slate-300 rounded"><option>MENIT</option><option>JAM</option><option>HARI</option></select></>
                ) : (
                  <input type="datetime-local" className="p-2 border border-slate-300 rounded shadow-sm uppercase font-bold text-xs" />
                )}
             </div>
          </div>
        )}
      </Card>
    </section>
  )
}