"use client"
import { Card } from '@/components/ui/Card'
import AudienceSegmentBuilder, { DEFAULT_ONE_TIME, DEFAULT_SCHEDULE, type AudienceFilter, type OneTimeConfig, type OneTimeMode, type ScheduleConfig, type ScheduleFrequency } from './AudienceSegmentBuilder'

type MarketingTriggerProps = {
  triggerType: string
  setTriggerType: (triggerType: string) => void
  timeType: string
  setTimeType: (timeType: string) => void
  filters: AudienceFilter[]
  setFilters: (filters: AudienceFilter[]) => void
  schedule?: ScheduleConfig
  setSchedule?: (schedule: ScheduleConfig) => void
  oneTime?: OneTimeConfig
  setOneTime?: (oneTime: OneTimeConfig) => void
}

export default function MarketingTrigger({ triggerType, setTriggerType, timeType, setTimeType, filters, setFilters, schedule, setSchedule, oneTime, setOneTime }: MarketingTriggerProps) {
  const currentSchedule: ScheduleConfig = schedule || DEFAULT_SCHEDULE
  const currentOneTime: OneTimeConfig = oneTime || DEFAULT_ONE_TIME

  const updateSchedule = (field: keyof ScheduleConfig, value: string) => {
    if (!setSchedule) return
    setSchedule({ ...currentSchedule, [field]: value })
  }

  const updateOneTime = (field: keyof OneTimeConfig, value: string) => {
    if (!setOneTime) return
    setOneTime({ ...currentOneTime, [field]: value })
  }

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
              {[
                { id: 'LOOPING', label: 'TERUS-MENERUS' },
                { id: 'SCHEDULED', label: 'TERJADWAL' },
                { id: 'SPECIFIC', label: 'SEKALI JALAN' },
              ].map(t => (
                <button key={t.id} onClick={() => setTimeType(t.id)} className={`px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all ${timeType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{t.label}</button>
              ))}
            </div>

            {timeType === 'SCHEDULED' && (
              <div className="bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner space-y-5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-blue-600 rounded-full"></div>
                  <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Pengaturan Jadwal</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Siklus</label>
                    <p className="text-[10px] font-semibold text-slate-400">Pilih seberapa sering skenario dijalankan.</p>
                    <select
                      value={currentSchedule.frequency}
                      onChange={(e) => updateSchedule('frequency', e.target.value as ScheduleFrequency)}
                      className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold uppercase outline-none focus:border-blue-500"
                    >
                      <option value="DAILY">Harian</option>
                      <option value="WEEKLY">Mingguan</option>
                      <option value="MONTHLY">Bulanan</option>
                    </select>
                  </div>

                  {currentSchedule.frequency === 'WEEKLY' && (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Hari</label>
                      <select
                        value={currentSchedule.weekday}
                        onChange={(e) => updateSchedule('weekday', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold uppercase outline-none focus:border-blue-500"
                      >
                        <option value="1">Senin</option>
                        <option value="2">Selasa</option>
                        <option value="3">Rabu</option>
                        <option value="4">Kamis</option>
                        <option value="5">Jumat</option>
                        <option value="6">Sabtu</option>
                        <option value="0">Minggu</option>
                      </select>
                    </div>
                  )}

                  {currentSchedule.frequency === 'MONTHLY' && (
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Tanggal</label>
                      <p className="text-[10px] font-semibold text-slate-400">Isi angka 1-31.</p>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={currentSchedule.monthDay}
                        onChange={(e) => updateSchedule('monthDay', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold uppercase outline-none focus:border-blue-500"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Jam & Menit</label>
                    <p className="text-[10px] font-semibold text-slate-400">Format 24 jam: jam 00-23, menit 00-59.</p>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={currentSchedule.hour}
                        onChange={(e) => updateSchedule('hour', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-center outline-none focus:border-blue-500"
                      />
                      <span className="text-slate-400 font-black">:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={currentSchedule.minute}
                        onChange={(e) => updateSchedule('minute', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-center outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {timeType === 'SPECIFIC' && (
              <div className="bg-[#F8FAFC] p-6 rounded-xl border border-slate-200 shadow-inner space-y-5">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-blue-600 rounded-full"></div>
                  <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Eksekusi Sekali Jalan</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { id: 'IMMEDIATE', label: 'Langsung Jalan' },
                    { id: 'SPECIFIC_DATETIME', label: 'Tanggal & Waktu Spesifik' },
                  ].map(option => (
                    <button
                      key={option.id}
                      onClick={() => updateOneTime('mode', option.id as OneTimeMode)}
                      className={`p-4 rounded-lg border-2 text-left transition-all ${
                        currentOneTime.mode === option.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white text-slate-400'
                      }`}
                    >
                      <p className={`text-[11px] font-black uppercase ${currentOneTime.mode === option.id ? 'text-blue-700' : 'text-slate-400'}`}>{option.label}</p>
                    </button>
                  ))}
                </div>

                {currentOneTime.mode === 'SPECIFIC_DATETIME' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Tanggal Jalan</label>
                      <p className="text-[10px] font-semibold text-slate-400">Format tanggal: YYYY-MM-DD.</p>
                      <input
                        type="date"
                        value={currentOneTime.date}
                        onChange={(e) => updateOneTime('date', e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold uppercase outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Jam & Menit</label>
                      <p className="text-[10px] font-semibold text-slate-400">Format 24 jam: jam 00-23, menit 00-59.</p>
                      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={currentOneTime.hour}
                          onChange={(e) => updateOneTime('hour', e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-center outline-none focus:border-blue-500"
                        />
                        <span className="text-slate-400 font-black">:</span>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={currentOneTime.minute}
                          onChange={(e) => updateOneTime('minute', e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold text-center outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

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
