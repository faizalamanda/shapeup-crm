"use client"
import { useEffect, useState, type ChangeEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import MarketingTrigger from '../../new/MarketingTrigger'
import YCloudMessageEditor from '../../new/YCloudMessageEditor'
// IMPORT GENERATOR (Pastikan path-nya benar sesuai struktur folder Mas)
import { DEFAULT_ONE_TIME, DEFAULT_SCHEDULE, generateSQLFilter, generateScheduling, type AudienceFilter, type OneTimeConfig, type ScheduleConfig } from '../../new/AudienceSegmentBuilder'
import { formatTemplateDataForSupabase, hydrateTemplateDataForEditor, type HeaderFormat, type TemplateVarDraft } from '../../new/variables'

export default function EditScenarioPage() {
  const params = useParams()
  const id = params?.id 
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // -- STATE PUSAT --
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

  // LOAD DATA LAMA
  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      const { data, error } = await supabase
        .from('marketing_scenarios')
        .select('*')
        .eq('id', id)
        .single()
      
      if (data && !error) {
        setName(data.name || '')
        setTriggerType(data.trigger_type || 'STATUS')
        setTimeType(data.trigger_config?.timeType || 'LOOPING')
        setSchedule({ ...DEFAULT_SCHEDULE, ...(data.trigger_config?.schedule || {}) })
        setOneTime({ ...DEFAULT_ONE_TIME, ...(data.trigger_config?.oneTime || {}) })
        setFilters(data.filters || [])
        setTemplateName(data.template_name || '')

        const hydrated = hydrateTemplateDataForEditor(data.template_vars)
        setHeaderFormat(hydrated.headerFormat)
        setHeaderVars(hydrated.headerVars)
        setHeaderMediaUrl(hydrated.headerMediaUrl)
        setHeaderFilename(hydrated.headerFilename)
        setTemplateVars(hydrated.bodyVars)
      }
      setLoading(false)
    }
    loadData()
  }, [id])

  const handleUpdate = async () => {
    if (!name || !templateName) return alert("NAMA & TEMPLATE TIDAK BOLEH KOSONG");
    
    setSaving(true)

    // RE-GENERATE LOGIC SQL (Ini bagian yang tadi ketinggalan)
    const sqlFilter = generateSQLFilter(filters);
    const schedulingLogic = generateScheduling(
      filters,
      triggerType === 'TIME' && timeType === 'SCHEDULED' ? schedule : undefined,
      triggerType === 'TIME' && timeType === 'SPECIFIC' ? oneTime : undefined
    );

    const templateDataPayload = formatTemplateDataForSupabase({
      headerFormat,
      headerVars,
      headerMediaUrl,
      headerFilename,
      bodyVars: templateVars,
    });

    const { error } = await supabase
      .from('marketing_scenarios')
      .update({
        name,
        trigger_type: triggerType,
        trigger_config: { timeType, schedule, oneTime },
        // UPDATE KOLOM LOGIKANYA JUGA
        sql_filter: sqlFilter,
        scheduling_logic: schedulingLogic,
        filters, // Tetap simpan array filter untuk UI
        template_name: templateName,
        template_vars: templateDataPayload,
      })
      .eq('id', id)

    if (error) {
      alert("GAGAL UPDATE: " + error.message)
    } else {
      alert("PERUBAHAN DISIMPAN!")
      router.push('/marketing')
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="p-20 text-center font-black uppercase text-[10px] tracking-[0.2em] animate-pulse text-slate-400">
      Memuat Data Skenario...
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-12 pb-32 pt-8 animate-in fade-in duration-500">
      <PageHeader 
        title="EDIT SKENARIO" 
        description={`Update konfigurasi untuk skenario: ${name}`}
        action={
          <Button onClick={() => router.back()} variant="outline" className="font-black text-xs uppercase">
            KEMBALI
          </Button>
        }
      />

      <section className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <Input 
          label="NAMA SKENARIO" 
          value={name} 
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} 
          className="font-bold text-sm" 
        />
      </section>

      {/* STEP 2: TRIGGER & TARGETING */}
      <MarketingTrigger 
        triggerType={triggerType} setTriggerType={setTriggerType}
        timeType={timeType} setTimeType={setTimeType} 
        filters={filters} setFilters={setFilters}
        schedule={schedule} setSchedule={setSchedule}
        oneTime={oneTime} setOneTime={setOneTime}
      />

      {/* STEP 3: MESSAGE CONFIGURATION */}
      <YCloudMessageEditor 
        templateName={templateName} setTemplateName={setTemplateName}
        headerFormat={headerFormat} setHeaderFormat={setHeaderFormat}
        headerVars={headerVars} setHeaderVars={setHeaderVars}
        headerMediaUrl={headerMediaUrl} setHeaderMediaUrl={setHeaderMediaUrl}
        headerFilename={headerFilename} setHeaderFilename={setHeaderFilename}
        templateVars={templateVars} setTemplateVars={setTemplateVars}
      />

      <div className="pt-10 border-t border-slate-200">
        {saving ? (
          <div className="w-full py-6 font-black text-xs uppercase tracking-[0.2em] bg-slate-100 text-slate-400 rounded-xl text-center border border-slate-200 cursor-not-allowed">
            SEDANG MENYIMPAN...
          </div>
        ) : (
          <Button 
            onClick={handleUpdate} 
            variant="primary" 
            className="w-full py-6 font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-blue-100"
          >
            SIMPAN PERUBAHAN
          </Button>
        )}
      </div>
    </div>
  )
}
