"use client"
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import MarketingTrigger from '../../new/MarketingTrigger'
import YCloudMessageEditor from '../../new/YCloudMessageEditor'

export default function EditScenarioPage() {
  const params = useParams()
  const id = params?.id // Ambil ID dengan aman
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // -- STATE PUSAT --
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState('STATUS')
  const [timeType, setTimeType] = useState('LOOPING')
  const [filters, setFilters] = useState([])
  const [templateName, setTemplateName] = useState('')
  const [templateVars, setTemplateVars] = useState([])

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
        setFilters(data.filters || [])
        setTemplateName(data.template_name || '')
        setTemplateVars(data.template_vars || [])
      }
      setLoading(false)
    }
    loadData()
  }, [id])

  const handleUpdate = async () => {
    if (!name || !templateName) return alert("NAMA & TEMPLATE TIDAK BOLEH KOSONG");
    
    setSaving(true)
    const { error } = await supabase
      .from('marketing_scenarios')
      .update({
        name,
        trigger_type: triggerType,
        trigger_config: { timeType },
        filters,
        template_name: templateName,
        template_vars: templateVars
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
          onChange={(e: any) => setName(e.target.value)} 
          className="font-bold text-sm" 
        />
      </section>

      {/* STEP 2: TRIGGER & TARGETING */}
      <MarketingTrigger 
        triggerType={triggerType} setTriggerType={setTriggerType}
        timeType={timeType} setTimeType={setTimeType} 
        filters={filters} setFilters={setFilters}
      />

      {/* STEP 3: MESSAGE CONFIGURATION */}
      <YCloudMessageEditor 
        templateName={templateName} setTemplateName={setTemplateName}
        templateVars={templateVars} setTemplateVars={setTemplateVars}
      />

      <div className="pt-10 border-t border-slate-200">
        {/* Kita pakai pengecekan manual agar tidak mengirim prop 'disabled' ke Button */}
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