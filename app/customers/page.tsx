"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar } from './components/FilterBar'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail' // <--- Pastikan diimpor

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null) // <--- State untuk modal
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
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

  if (loading) return <div className="p-20 text-center text-slate-400 font-medium italic">Sinkronisasi data...</div>

  return (
    <div className="min-h-screen bg-[#FAF9F6] p-8 md:p-12 relative">
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 text-3xl font-bold text-slate-800">Pelanggan</header>
        
        <StatsPanel customers={customers} />
        <FilterBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        
        {/* OPER FUNGSI onSelect KE TABEL */}
        <CustomerTable 
          customers={filteredCustomers} 
          onSelect={(customer) => setSelectedCustomer(customer)} 
        />
      </div>

      {/* RENDER MODAL DI SINI */}
      <CustomerDetail 
        customer={selectedCustomer} 
        onClose={() => setSelectedCustomer(null)} 
      />
    </div>
  )
}