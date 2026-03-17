"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
// Import komponen UI Mas
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

        // 2. Ambil data customer HANYA untuk bisnis tersebut
        const { data: custData } = await supabase
          .from('customer_metrics')
          .select('*')
          .eq('business_id', profile.active_business_id)

        setCustomers(custData || [])
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

  if (loading) return <div className="p-20 text-center font-black text-slate-300 animate-pulse">MENYINKRONKAN DATA...</div>

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-6xl mx-auto">
        
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <div className="flex items-center gap-3">
               <h1 className="text-3xl font-bold tracking-tight">Pelanggan</h1>
               <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-black uppercase tracking-widest shadow-lg shadow-blue-100">
                 📍 {activeBiz?.name}
               </span>
            </div>
            <p className="text-slate-500 text-sm mt-1 font-medium italic">
              Menampilkan data eksklusif untuk unit bisnis terpilih.
            </p>
          </div>
        </header>

        {customers.length === 0 ? (
          /* INSTRUKSI JIKA KOSONG */
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-[2.5rem] p-16 text-center">
            <h2 className="text-xl font-black text-slate-800 mb-4">Belum Ada Pelanggan di {activeBiz?.name}</h2>
            <div className="bg-slate-50 p-6 rounded-2xl max-w-md mx-auto text-left inline-block">
               <p className="text-xs font-bold text-slate-400 uppercase mb-3 tracking-widest">Langkah Integrasi:</p>
               <code className="text-[10px] block bg-white p-3 rounded border border-slate-200 mb-4 break-all">
                 https://crm.com/api/webhook/woo?bid={activeBiz?.id}
               </code>
               <p className="text-xs text-slate-500 leading-relaxed">
                 Salin URL di atas ke Webhook WooCommerce Anda untuk mulai menarik data secara otomatis.
               </p>
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