"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar } from './components/FilterBar'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBiz, setActiveBiz] = useState<any>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')

  useEffect(() => {
    fetchActiveData()
  }, [])

  async function fetchActiveData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      // 1. Ambil Bisnis yang sedang aktif dari profil
      const { data: profile } = await supabase
        .from('profiles')
        .select('active_business_id, businesses!active_business_id(name, id)')
        .eq('id', user.id)
        .single()

      if (profile?.active_business_id) {
        setActiveBiz(profile.businesses)

        // 2. Ambil data dari view customer_metrics
        const { data: custData, error } = await supabase
          .from('customer_metrics')
          .select('*')
          .eq('business_id', profile.active_business_id)
          .order('ltv', { ascending: false })

        if (!error) setCustomers(custData || [])
      }
    }
    setLoading(false)
  }

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const name = c.customer_name || ''
      const phone = c.phone || ''
      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || phone.includes(searchQuery)
      return matchesSearch
    })
  }, [customers, searchQuery])

  if (loading) return <div className="p-20 text-center font-black text-slate-300 animate-pulse uppercase tracking-widest">Menyinkronkan Data...</div>

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-6xl mx-auto">
        
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex items-center gap-3">
               <h1 className="text-3xl font-bold tracking-tight uppercase italic">Pelanggan</h1>
               <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg shadow-blue-100">
                 📍 {activeBiz?.name}
               </span>
            </div>
            <p className="text-slate-500 text-sm mt-1 font-medium italic">
              Database pelanggan unit bisnis aktif.
            </p>
          </div>
        </header>

        {customers.length === 0 ? (
          <div className="bg-white border-4 border-black p-16 text-center shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xl font-black text-slate-800 mb-4 uppercase italic">Belum Ada Pelanggan</h2>
            <p className="text-slate-500 mb-8 font-medium">Data akan muncul otomatis setelah pesanan WooCommerce masuk.</p>
            <div className="bg-slate-50 p-6 border-2 border-black inline-block text-left">
               <p className="text-[10px] font-black uppercase tracking-widest mb-2">Webhook URL:</p>
               <code className="text-xs bg-white p-2 border border-slate-200 block break-all">
                 https://shapeup-crm.vercel.app/api/webhook/woo?bid={activeBiz?.id}
               </code>
            </div>
          </div>
        ) : (
          <>
            <StatsPanel customers={customers} />
            <FilterBar 
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              filterCategory={filterCategory} setFilterCategory={setFilterCategory}
            />
            <CustomerTable 
              customers={filteredCustomers} 
              onSelect={(c) => setSelectedCustomer(c)} 
            />
          </>
        )}
      </div>

      <CustomerDetail 
        customer={selectedCustomer} 
        onClose={() => setSelectedCustomer(null)} 
      />
    </div>
  )
}