"use client"
import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import MarketingTrigger from './MarketingTrigger'
import YCloudMessageEditor from './YCloudMessageEditor'
import Link from 'next/link'
import { supabase } from '@/lib/supabase' // Sudah diperbaiki sesuai file supabase.ts Mas
import { useRouter } from 'next/navigation'

export default function NewScenarioPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // -- STATE UNTUK SUPABASE (PUSAT DATA) --
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('STATUS')
  const [timeType, setTimeType] = useState('LOOPING')
  const [filters, setFilters] = useState([]) // Data filter dari AudienceSegmentBuilder
  const [templateName, setTemplateName] = useState('') // Nama Template YCloud
  const [templateVars, setTemplateVars] = useState([]) // Variabel {{1}}, {{2}}, dst

  // -- LOGIC SIMPAN KE DATABASE --
  const handleSave = async () => {
    if (!name || !templateName) {
      return alert("NAMA SKENARIO & NAMA TEMPLATE YCLOUD WAJIB DIISI!");
    }
    
    setLoading(true)

    const payload = {
      name: name,
      trigger_type: triggerType,
      trigger_config: { timeType },
      filters: filters,
      template_name: templateName,
      template_vars: templateVars,
      platform: 'YCLOUD',
      is_active: true
    }

    // Eksekusi Insert ke Tabel marketing_scenarios
    const { error } = await supabase
      .from('marketing_scenarios')
      .insert([payload])

    if (error) {
      alert("GAGAL MENYIMPAN: " + error.message)
    } else {
      alert("SKENARIO BERHASIL DIAKTIFKAN!")
      router.push('/marketing') // Balik ke halaman daftar
    }
    setLoading(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-32 pt-8 animate-in fade-in duration-500">
      <PageHeader 
        title="BUAT AUTOMATION BARU" 
        description="Otomatisasi pengiriman pesan berdasarkan status order atau segmentasi waktu."
        action={
          <div className="flex gap-3">
            <Link href="/marketing">
              <Button variant="outline" className="font-black text-xs uppercase">BATAL</Button>
            </Link>
            <Button 
              onClick={handleSave} 
              disabled={loading} 
              variant="primary" 
              className="px-8 font-black text-xs uppercase shadow-lg shadow-blue-100"
            >
              {loading ? 'SAVING...' : 'SIMPAN & RUN'}
            </Button>
          </div>
        }
      />

      {/* STEP 1: IDENTITAS */}
      <section className="space-y-4">
        <div className="flex items-center gap-4 px-2">
          <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">1</span>
          <h3 className="font-bold text-slate-800 uppercase tracking-tight text-lg">IDENTITAS SKENARIO</h3>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <Input 
            label="NAMA SKENARIO" 
            value={name}
            onChange={(e: any) => setName(e.target.value)}
            placeholder="MISAL: FOLLOW UP COD BELUM BAYAR" 
            className="font-bold uppercase text-sm" 
          />
        </div>
      </section>

      {/* STEP 2: TRIGGER & TARGETING */}
      {/* Mengirim state & setter ke komponen anak agar data sinkron */}
      <MarketingTrigger 
        triggerType={triggerType} 
        setTriggerType={setTriggerType}
        timeType={timeType} 
        setTimeType={setTimeType} 
        filters={filters} 
        setFilters={setFilters}
      />

      {/* STEP 3: MESSAGE CONFIGURATION */}
      {/* Mengirim state template ke YCloudMessageEditor */}
      <YCloudMessageEditor 
        templateName={templateName} 
        setTemplateName={setTemplateName}
        templateVars={templateVars} 
        setTemplateVars={setTemplateVars}
      />

      {/* FOOTER ACTION */}
      <div className="flex justify-end pt-10 border-t border-slate-200">
         <Button 
            onClick={handleSave} 
            disabled={loading} 
            variant="primary" 
            className="w-full md:w-auto px-16 py-6 font-black text-xs tracking-[0.2em] uppercase shadow-xl shadow-blue-100"
          >
            {loading ? 'SEDANG MEMPROSES...' : 'AKTIFKAN AUTOMATION'}
         </Button>
      </div>
    </div>
  )
}