"use client"
import { useState, useMemo } from 'react'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar } from './components/FilterBar'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'

export default function CustomerPage() {
  // Data State
  const [customers] = useState([
    { id: 1, name: 'Budi Santoso', phone: '628123456789', order_count: 5, ltv: 2500000, category: 'VIP', address: 'Jl. Melati No. 5, Jakarta', notes: 'Pelanggan loyal sejak 2024.' },
    { id: 2, name: 'Siti Aminah', phone: '628998877665', order_count: 1, ltv: 150000, category: 'General', address: 'Gg. Kelinci, Bandung', notes: 'Suka tanya promo.' },
  ])

  // UI States
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')

  // Logic Filter
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone.includes(searchQuery)
      const matchesCategory = filterCategory === 'All' || c.category === filterCategory
      return matchesSearch && matchesCategory
    })
  }, [customers, searchQuery, filterCategory])

  return (
    <div className="min-h-screen bg-[#fcfaf7] p-8 md:p-12 text-[#2e2e2e]">
      <div className="max-w-6xl mx-auto">
        
        {/* HEADER */}
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex justify-between items-end">
          <h1 className="text-3xl font-bold tracking-tight">Pelanggan</h1>
          <button className="bg-[#2e8540] text-white px-5 py-2 rounded font-bold text-sm shadow-sm">+ Tambah Pelanggan</button>
        </header>

        {/* DASHBOARD STATS */}
        <StatsPanel customers={customers} />
        
        {/* SEARCH & FILTERS */}
        <FilterBar 
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
        />

        {/* LIST TABLE */}
        {filteredCustomers.length > 0 ? (
          <CustomerTable 
            customers={filteredCustomers} 
            onSelect={(c) => setSelectedCustomer(c)} 
          />
        ) : (
          <div className="p-20 text-center border-2 border-dashed border-slate-300 rounded text-slate-400 font-bold uppercase text-[10px] tracking-widest bg-white">
            Tidak ada data pelanggan yang cocok dengan filter.
          </div>
        )}
      </div>

      {/* MODAL DETAIL */}
      <CustomerDetail 
        customer={selectedCustomer} 
        onClose={() => setSelectedCustomer(null)} 
      />
    </div>
  )
}