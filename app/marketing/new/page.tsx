"use client"
import { useState, type ChangeEvent } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import MarketingTrigger from './MarketingTrigger'
import YCloudMessageEditor from './YCloudMessageEditor'
import Link from 'next/link'
import { supabase } from '@/lib/supabase' 
import { useRouter } from 'next/navigation'
// IMPORT GENERATOR DARI KOMPONEN BUILDER
import { DEFAULT_ONE_TIME, DEFAULT_SCHEDULE, generateSQLFilter, generateScheduling, type AudienceFilter, type OneTimeConfig, type ScheduleConfig } from './AudienceSegmentBuilder'
import { formatTemplateDataForSupabase, formatTemplateVarsForSupabase, type HeaderFormat, type TemplateVarDraft } from './variables'

export default function NewScenarioPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // -- STATE UNTUK SUPABASE (PUSAT DATA) --
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('STATUS')
  const [timeType, setTimeType] = useState('LOOPING')
  const [filters, setFilters] = useState<AudienceFilter[]>([]) 
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE)
  const [oneTime, setOneTime] = useState<OneTimeConfig>(DEFAULT_ONE_TIME)
  const [templateName, setTemplateName] = useState('') 
  const [headerFormat, setHeaderFormat] = useState<HeaderFormat>('NONE')
  const [headerVars, setHeaderVars] = useState<TemplateVarDraft[]>([])
  const [headerMediaUrl, setHeaderMediaUrl] = useState('')
  const [headerFilename, setHeaderFilename] = useState('')
  const [templateVars, setTemplateVars] = useState<TemplateVarDraft[]>([]) 

  // -- LOGIC SIMPAN KE DATABASE --
  const handleSave = async () => {
    if (!name || !templateName) {
      return alert("NAMA SKENARIO & NAMA TEMPLATE YCLOUD WAJIB DIISI!");
    }

    // DEBUG: Cek di console browser apakah filters ada isinya
    console.log("DEBUG: State Filters sebelum Save:", filters);
    
    setLoading(true)

    // AMBIL ACTIVE BUSINESS ID UNTUK MULTI-TENANT
    let activeBusinessId: string | null = null
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()
      if (profile?.active_business_id) {
        activeBusinessId = profile.active_business_id
      }
    }

    // PROSES GENERATE: Mengubah array filter menjadi kalimat SQL
    const sqlFilter = generateSQLFilter(filters);
    const schedulingLogic = generateScheduling(
      filters,
      triggerType === 'TIME' && timeType === 'SCHEDULED' ? schedule : undefined,
      triggerType === 'TIME' && timeType === 'SPECIFIC' ? oneTime : undefined
    );

    console.log("DEBUG: SQL Filter dihasilkan:", sqlFilter);
    console.log("DEBUG: Scheduling Logic dihasilkan:", schedulingLogic);

    const formattedBodyVars = formatTemplateVarsForSupabase(templateVars)
    const formattedHeaderVars = formatTemplateVarsForSupabase(headerVars)

    const payload: Record<string, any> = {
      name: name,
      trigger_type: triggerType,
      trigger_config: { 
        timeType, 
        schedule, 
        oneTime,
        header_format: headerFormat,
        header_vars: formattedHeaderVars,
        header_media_url: headerMediaUrl.trim(),
        header_filename: headerFilename.trim()
      },
      
      // KOLOM UNTUK SI PENJALA DI SUPABASE (MULTI-TENANT)
      sql_filter: sqlFilter,
      scheduling_logic: schedulingLogic,
      channel_type: 'whatsapp',
      
      filters: filters, // Array asli tetap disimpan untuk keperluan edit UI
      template_name: templateName,
      template_vars: formattedBodyVars,
      platform: 'YCLOUD',
      is_active: true
    }

    if (activeBusinessId) {
      payload.business_id = activeBusinessId
    }

    const { error } = await supabase
      .from('marketing_scenarios')
      .insert([payload])

    if (error) {
      alert("GAGAL MENYIMPAN: " + error.message)
      setLoading(false)
    } else {
      alert("SKENARIO BERHASIL DIAKTIFKAN!")
      router.push('/marketing')
    }
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
            
            {loading ? (
              <div className="px-8 py-2.5 bg-slate-100 text-slate-400 font-black text-xs uppercase rounded-md border border-slate-200 cursor-not-allowed flex items-center">
                SAVING...
              </div>
            ) : (
              <Button 
                onClick={handleSave} 
                variant="primary" 
                className="px-8 font-black text-xs uppercase shadow-lg shadow-blue-100"
              >
                SIMPAN & RUN
              </Button>
            )}
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
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="Misal: Follow up COD Belum Bayar" 
            className="font-bold text-sm" 
          />
        </div>
      </section>

      {/* STEP 2: TRIGGER & FILTERS */}
      <MarketingTrigger 
        triggerType={triggerType} 
        setTriggerType={setTriggerType}
        timeType={timeType} 
        setTimeType={setTimeType} 
        filters={filters} 
        setFilters={setFilters}
        schedule={schedule}
        setSchedule={setSchedule}
        oneTime={oneTime}
        setOneTime={setOneTime}
      />

      {/* STEP 3: MESSAGE CONTENT */}
      <YCloudMessageEditor 
        templateName={templateName} 
        setTemplateName={setTemplateName}
        headerFormat={headerFormat}
        setHeaderFormat={setHeaderFormat}
        headerVars={headerVars}
        setHeaderVars={setHeaderVars}
        headerMediaUrl={headerMediaUrl}
        setHeaderMediaUrl={setHeaderMediaUrl}
        headerFilename={headerFilename}
        setHeaderFilename={setHeaderFilename}
        templateVars={templateVars} 
        setTemplateVars={setTemplateVars}
      />

      {/* FOOTER ACTION */}
      <div className="flex justify-end pt-10 border-t border-slate-200">
         {loading ? (
            <div className="w-full md:w-auto px-16 py-6 bg-slate-100 text-slate-400 font-black text-xs tracking-[0.2em] uppercase rounded-xl border border-slate-200 text-center cursor-not-allowed">
              SEDANG MEMPROSES...
            </div>
         ) : (
            <Button 
              onClick={handleSave} 
              variant="primary" 
              className="w-full md:w-auto px-16 py-6 font-black text-xs tracking-[0.2em] uppercase shadow-xl shadow-blue-100"
            >
              AKTIFKAN AUTOMATION
            </Button>
         )}
      </div>
    </div>
  )
}
