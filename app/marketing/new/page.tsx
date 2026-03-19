"use client"
import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import MarketingTrigger from '@/components/marketing/MarketingTrigger'
import AudienceSegmentBuilder from '@/components/marketing/AudienceSegmentBuilder'
import YCloudMessageEditor from '@/components/marketing/YCloudMessageEditor'
import Link from 'next/link'

export default function NewScenarioPage() {
  const [triggerType, setTriggerType] = useState('STATUS')
  const [timeType, setTimeType] = useState('LOOPING')

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-32 animate-in fade-in duration-500">
      <PageHeader 
        title="BUAT AUTOMATION BARU" 
        description="Gabungkan data order dan customer untuk marketing yang presisi."
        action={
          <div className="flex gap-3">
            <Link href="/marketing"><Button variant="outline" className="font-black text-xs uppercase">BATAL</Button></Link>
            <Button variant="primary" className="px-8 font-black text-xs uppercase shadow-lg shadow-blue-100">SIMPAN & RUN</Button>
          </div>
        }
      />

      {/* STEP 1: NAMA */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">1</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">IDENTITAS</h3>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <Input label="NAMA SKENARIO" placeholder="MISAL: FOLLOW UP COD" className="font-bold uppercase text-sm" />
        </div>
      </section>

      {/* STEP 2: TRIGGER */}
      <MarketingTrigger 
        triggerType={triggerType} setTriggerType={setTriggerType}
        timeType={timeType} setTimeType={setTimeType} 
      />

      {/* STEP 3: SEGMENTASI (Hanya jika trigger Waktu) */}
      {triggerType === 'TIME' && <AudienceSegmentBuilder />}

      {/* STEP 4: MESSAGE */}
      <YCloudMessageEditor />

      <div className="flex justify-end pt-10 border-t border-slate-200">
         <Button variant="primary" className="w-full md:w-auto px-16 py-6 font-black text-xs tracking-[0.2em] uppercase">
            AKTIFKAN SEKARANG
         </Button>
      </div>
    </div>
  )
}