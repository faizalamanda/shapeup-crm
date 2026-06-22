"use client"
import { useState, useEffect, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { StatsPanel } from './components/StatsPanel'
import { FilterBar, FilterRule } from './components/FilterBar'
import { AnalyticsCharts } from './components/AnalyticsCharts'
import { CustomerTable } from './components/CustomerTable'
import { CustomerDetail } from './components/CustomerDetail'

export default function CustomerPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [rules, setRules] = useState<FilterRule[]>([])
  const [showCharts, setShowCharts] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('active_business_id')
          .eq('id', user.id)
          .single()

        if (profile?.active_business_id) {
          const { data: custData, error } = await supabase
            .from('customer_metrics')
            .select('*')
            .eq('business_id', profile.active_business_id)
            .order('ltv', { ascending: false })

          if (error) throw error
          setCustomers(custData || [])
        }
      }
    } catch (err) {
      console.error('Error fetching customers:', err)
    } finally {
      setLoading(false)
    }
  }

  // Dynamically extract unique statuses present in the customer metrics dataset
  const availableStatuses = useMemo(() => {
    const statuses = new Set<string>()
    customers.forEach(c => {
      if (c.last_order_status) {
        statuses.add(c.last_order_status.toLowerCase())
      }
    })
    if (statuses.size === 0) {
      return ['completed', 'processing', 'on-hold', 'pending', 'failed', 'cancelled']
    }
    return Array.from(statuses).sort()
  }, [customers])

  // Filter evaluation logic
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      // 1. Text Search Filter (Name or Phone)
      const matchesSearch = 
        (c.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
        (c.phone || '').includes(searchQuery)

      if (!matchesSearch) return false

      // 2. Chained Segment Builder Rules
      for (const rule of rules) {
        if (!rule.value) continue // Skip incomplete rules

        const field = rule.field
        const operator = rule.operator

        // Numeric evaluation
        if (field === 'ltv' || field === 'aov' || field === 'total_order_count') {
          const cVal = Number(c[field]) || 0
          const rVal = Number(rule.value) || 0

          if (operator === 'greater_or_equal' && !(cVal >= rVal)) return false
          if (operator === 'less_or_equal' && !(cVal <= rVal)) return false
          if (operator === 'equal' && !(cVal === rVal)) return false
        }

        // Date evaluation
        if (field === 'last_order_date' || field === 'joined_at') {
          if (!c[field]) return false
          const cDate = new Date(c[field]).getTime()
          const rDate = new Date(rule.value).getTime()

          if (isNaN(cDate) || isNaN(rDate)) return false
          if (operator === 'after' && !(cDate >= rDate)) return false
          if (operator === 'before' && !(cDate <= rDate)) return false
        }

        // String evaluation
        if (field === 'last_order_status') {
          const cStr = (c[field] || '').toLowerCase()
          const rStr = (rule.value || '').toLowerCase()

          if (operator === 'is' && cStr !== rStr) return false
          if (operator === 'is_not' && cStr === rStr) return false
        }
      }

      return true
    })
  }, [customers, searchQuery, rules])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Menyelaraskan Data Pelanggan...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 text-slate-900 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between border-b border-slate-200/60 pb-6 mb-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Pelanggan & CRM</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Analisa & Segmentasi Pelanggan</h1>
          <p className="text-sm font-medium text-slate-500 mt-1">
            Segmentasikan customer, analisis AOV (Average Order Value) dan pantau CLTV (Customer Lifetime Value) secara komprehensif.
          </p>
        </div>
      </div>

      {/* KPI Stats Panel */}
      <StatsPanel customers={filteredCustomers} />

      {/* Metorik Style Filter & Preset Bar */}
      <FilterBar 
        searchQuery={searchQuery} 
        setSearchQuery={setSearchQuery} 
        rules={rules}
        setRules={setRules}
        showCharts={showCharts}
        setShowCharts={setShowCharts}
        availableStatuses={availableStatuses}
      />

      {/* SVG Distributions Charts */}
      {showCharts && (
        <AnalyticsCharts customers={filteredCustomers} />
      )}

      {/* Main Customers List Table */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">
            Menampilkan {filteredCustomers.length} dari {customers.length} pelanggan
          </p>
        </div>
        <CustomerTable 
          customers={filteredCustomers} 
          onSelect={(customer) => setSelectedCustomer(customer)} 
        />
      </div>

      {/* Customer Detail Drawer / Modal */}
      <CustomerDetail 
        customer={selectedCustomer} 
        onClose={() => setSelectedCustomer(null)} 
      />
    </div>
  )
}