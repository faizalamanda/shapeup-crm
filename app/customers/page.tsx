"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar } from './components/FilterBar'
import { CustomerTable } from './components/CustomerTable'

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBiz, setActiveBiz] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // 1. Ambil Bisnis Aktif
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name)')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBiz(profile.businesses)

        // 2. Ambil Data Metrics Real
        const { data: custData } = await supabase
          .from('customer_metrics')
          .select('*')
          .eq('business_id', profile.active_business_id)
          .order('ltv', { ascending: false })

        setCustomers(custData || [])
      }
    }
    setLoading(false)
  }

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
      (c.phone || '').includes(searchQuery)
    )
  }, [customers, searchQuery])

  if (loading) return <div className="p-20 text-center text-slate-400 font-medium">Memuat data pelanggan...</div>

  return (
    <div className="min-h-screen bg-[#FAF9F6] p-8 md:p-12">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER SESUAI SCREENSHOT */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-slate-800">Pelanggan</h1>
            <span className="bg-[#2563EB] text-white text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
              📍 {activeBiz?.name || 'ALAMANDA'}
            </span>
          </div>
          <p className="text-slate-500 text-sm italic">
            Menampilkan data eksklusif untuk unit bisnis terpilih.
          </p>
        </header>

        <StatsPanel customers={customers} />
        
        <FilterBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

        <CustomerTable customers={filteredCustomers} />

      </div>
    </div>
  )
}