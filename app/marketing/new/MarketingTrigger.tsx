"use client"
import { Card } from '@/components/ui/Card'
import AudienceSegmentBuilder from './AudienceSegmentBuilder'

export default function MarketingTrigger({ triggerType, setTriggerType, timeType, setTimeType, filters, setFilters }: any) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-4 px-2">
        <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">2</span>
        <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">TRIGGER & TARGETING</h3>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <button onClick={() => setTriggerType('STATUS')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'STATUS' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'STATUS' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Status</p>
          </button>
          <button onClick={() => setTriggerType('TIME')} className={`p-6 rounded-xl border-2 text-left transition-all ${triggerType === 'TIME' ? 'border-blue-600 bg-blue-50' : 'border-slate-100 opacity-60'}`}>
            <p className={`font-black text-sm uppercase tracking-tight ${triggerType === 'TIME' ? 'text-blue-700' : 'text-slate-400'}`}>Berdasarkan Waktu</p>
          </button>
        </div>

        {triggerType === 'STATUS' ? (
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200">
             <p className="text-[11px] font-black text-slate-400 uppercase mb-4 tracking-widest text-center">PILIH STATUS TUJUAN:</p>
             <div className="grid grid-cols-2 md:grid-cols-3 gap-3 uppercase font-bold text-[11px]">
               {['PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED'].map(s => (
                 <label key={s} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm cursor-pointer hover:border-blue-300">
                   <input type="checkbox" className="w-4 h-4 accent-blue-600" /> {s}
                 </label>
               ))}
             </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in">
            <div className="flex justify-center gap-2 bg-slate-100 p-1 rounded-full w-fit mx-auto">
              {['LOOPING', 'SPECIFIC'].map(t => (
                <button key={t} onClick={() => setTimeType(t)} className={`px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all ${timeType === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{t}</button>
              ))}
            </div>
            <div className="pt-8 border-t border-slate-200">
              <label className="block text-[11px] font-black text-slate-400 uppercase mb-4 tracking-widest">SEGMENT TARGETING</label>
              <AudienceSegmentBuilder filters={filters} setFilters={setFilters} />
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}