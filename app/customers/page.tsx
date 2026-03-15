"use client"
import { useState, useMemo } from 'react'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar } from './components/FilterBar'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'

export default function CustomerPage() {
  const [customers] = useState([
    { id: 1, name: 'Budi Santoso', phone: '628123456789', order_count: 5, ltv: 2500000, category: 'VIP', address: 'Jl. Melati No. 5, Jakarta', notes: 'Pelanggan loyal sejak 2024.' },
    { id: 2, name: 'Siti Aminah', phone: '628998877665', order_count: 1, ltv: 150000, category: 'General', address: 'Gg. Kelinci, Bandung', notes: 'Suka tanya promo.' },
  ])

  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('All')

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
        
        {/* HEADER DENGAN DESKRIPSI */}
        <header className="border-b-2 border-slate-200 pb-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pelanggan</h1>
            <p className="text-slate-500 text-sm mt-1 font-medium">
              Gunakan tombol WA untuk menghubungi pelanggan secara langsung atau klik nama untuk detail profil.
            </p>
          </div>
          <button className="bg-[#2e8540] hover:bg-[#246632] text-white px-5 py-2 rounded font-bold text-sm shadow-sm transition-all active:scale-95">+ Tambah Pelanggan</button>
        </header>

        <StatsPanel customers={customers} />
        
        <FilterBar 
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
        />

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

      <CustomerDetail 
        customer={selectedCustomer} 
        onClose={() => setSelectedCustomer(null)} 
      />
    </div>
  )
}