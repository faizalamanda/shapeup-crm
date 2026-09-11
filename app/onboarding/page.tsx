"use client"

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { canAccessPath } from '@/lib/permissions'
import { useUserContext } from '@/components/UserContext'
import { getLocalDateRangeLimits, localDateToUtcBounds } from '@/lib/localzone'

// ─── Available Shortcuts Pool ────────────────────────────────────────────────
type ShortcutItem = {
  id: string
  name: string
  href: string
  category: string
  description: string
  icon: string // Emoji / Icon Key
  badge?: string
}

const AVAILABLE_SHORTCUTS: ShortcutItem[] = [
  { id: 'pos', name: 'POS Kasir', href: '/orders/pos', category: 'Penjualan', description: 'Transaksi kasir instan & cetak struk', icon: '💻', badge: 'Kasir' },
  { id: 'orders', name: 'Orders', href: '/orders', category: 'Penjualan', description: 'Daftar & status riwayat pesanan', icon: '🛒' },
  { id: 'invoices', name: 'Invoices', href: '/orders/invoices', category: 'Penjualan', description: 'Faktur & penagihan pembayaran', icon: '🧾' },
  { id: 'products', name: 'Produk', href: '/products', category: 'Katalog', description: 'Kelola harga, stok, & variasi', icon: '📦' },
  { id: 'stock_opname', name: 'Stok Opname', href: '/stock-opname', category: 'Katalog', description: 'Penyesuaian jumlah stok fisik', icon: '📋' },
  { id: 'customers', name: 'Pelanggan', href: '/customers', category: 'Pelanggan', description: 'Database & riwayat kontak pembeli', icon: '👥' },
  { id: 'cohort', name: 'Retensi Cohort', href: '/customers/cohorts/returning', category: 'Pelanggan', description: 'Analisis repeat order & retensi', icon: '📊' },
  { id: 'retention', name: 'Retensi Produk', href: '/customers/product-retention', category: 'Pelanggan', description: 'Produk paling sering dibeli ulang', icon: '📈' },
  { id: 'expenses', name: 'Pengeluaran', href: '/expenses', category: 'Pengeluaran', description: 'Pencatatan biaya operasional harian', icon: '💸' },
  { id: 'suppliers', name: 'Pemasok', href: '/suppliers', category: 'Pengeluaran', description: 'Vendor stok & pemasok bahan', icon: '🏭' },
  { id: 'inbox', name: 'Inbox Chat', href: '/inbox', category: 'Komunikasi', description: 'Perpesanan pelanggan terintegrasi', icon: '💬' },
  { id: 'accounting_trans', name: 'Jurnal Akuntansi', href: '/accounting/transactions', category: 'Akuntansi', description: 'Buku kas & pembukuan umum', icon: '📖' },
  { id: 'profit_loss', name: 'Laba Rugi', href: '/accounting/profit-loss', category: 'Akuntansi', description: 'Laporan untung rugi operasional', icon: '💵' },
  { id: 'cash_flow', name: 'Arus Kas', href: '/accounting/cash-flow', category: 'Akuntansi', description: 'Laporan alur kas masuk & keluar', icon: '📈' },
  { id: 'balance_sheet', name: 'Neraca', href: '/accounting/balance-sheet', category: 'Akuntansi', description: 'Laporan posisi keuangan & ekuitas', icon: '⚖️' },
  { id: 'employees', name: 'Karyawan & Gaji', href: '/employees', category: 'HR', description: 'Manajemen staf & daftar gaji', icon: '👔' },
  { id: 'settings', name: 'Pengaturan', href: '/settings', category: 'Sistem', description: 'Profil bisnis & hak akses user', icon: '⚙️' },
]

const DEFAULT_SHORTCUT_IDS = ['pos', 'orders', 'products', 'customers', 'stock_opname', 'expenses', 'inbox', 'cohort']
const CATEGORIES = ['Semua', 'Penjualan', 'Katalog', 'Pelanggan', 'Pengeluaran', 'Komunikasi', 'Akuntansi', 'HR', 'Sistem']

// Category Color Palette Generator for World-Class Aesthetic
const getCategoryStyles = (category: string) => {
  switch (category) {
    case 'Penjualan':
      return { bg: 'bg-blue-50 hover:bg-blue-100/80', border: 'border-blue-200', text: 'text-blue-600', ring: 'focus:ring-blue-400' }
    case 'Katalog':
      return { bg: 'bg-amber-50 hover:bg-amber-100/80', border: 'border-amber-200', text: 'text-amber-600', ring: 'focus:ring-amber-400' }
    case 'Pelanggan':
      return { bg: 'bg-emerald-50 hover:bg-emerald-100/80', border: 'border-emerald-200', text: 'text-emerald-700', ring: 'focus:ring-emerald-400' }
    case 'Pengeluaran':
      return { bg: 'bg-rose-50 hover:bg-rose-100/80', border: 'border-rose-200', text: 'text-rose-600', ring: 'focus:ring-rose-400' }
    case 'Komunikasi':
      return { bg: 'bg-purple-50 hover:bg-purple-100/80', border: 'border-purple-200', text: 'text-purple-600', ring: 'focus:ring-purple-400' }
    case 'Akuntansi':
      return { bg: 'bg-teal-50 hover:bg-teal-100/80', border: 'border-teal-200', text: 'text-teal-600', ring: 'focus:ring-teal-400' }
    case 'HR':
      return { bg: 'bg-indigo-50 hover:bg-indigo-100/80', border: 'border-indigo-200', text: 'text-indigo-600', ring: 'focus:ring-indigo-400' }
    default:
      return { bg: 'bg-slate-100 hover:bg-slate-200/80', border: 'border-slate-200', text: 'text-slate-700', ring: 'focus:ring-slate-400' }
  }
}



// ─── Activity Stage Definitions ──────────────────────────────────────────────
type OnboardingTask = {
  id: string
  stage: number
  stageTitle: string
  stageBadge: string
  title: string
  desc: string
  actionLabel: string
  href: string
  dbCheckKey?: string
  icon: string
}

const ONBOARDING_STAGES: OnboardingTask[] = [
  // Stage 1
  {
    id: 'create_product',
    stage: 1,
    stageTitle: 'Stage 1: Setup & Katalog Dasar',
    stageBadge: 'Persiapan Awal',
    title: 'Tambahkan Produk Pertama',
    desc: 'Daftarkan minimal 1 item barang atau jasa untuk mulai melakukan transaksi.',
    actionLabel: 'Kelola Produk',
    href: '/products',
    dbCheckKey: 'products',
    icon: '📦',
  },
  {
    id: 'setup_stock',
    stage: 1,
    stageTitle: 'Stage 1: Setup & Katalog Dasar',
    stageBadge: 'Persiapan Awal',
    title: 'Atur Stok Opname / Saldo Stok',
    desc: 'Sesuaikan jumlah stok fisik awal barang di gudang atau toko Anda.',
    actionLabel: 'Buka Stock Opname',
    href: '/stock-opname',
    dbCheckKey: 'stock_opname',
    icon: '📋',
  },
  {
    id: 'add_supplier',
    stage: 1,
    stageTitle: 'Stage 1: Setup & Katalog Dasar',
    stageBadge: 'Persiapan Awal',
    title: 'Daftarkan Pemasok / Supplier',
    desc: 'Simpan kontak supplier langganan untuk mempermudah pembelian barang.',
    actionLabel: 'Tambah Supplier',
    href: '/suppliers',
    dbCheckKey: 'suppliers',
    icon: '🏭',
  },

  // Stage 2
  {
    id: 'first_pos_order',
    stage: 2,
    stageTitle: 'Stage 2: Transaksi & Operasional Harian',
    stageBadge: 'Aktif Harian (Core Goal)',
    title: 'Buat Transaksi Penjualan / POS Kasir',
    desc: 'Lakukan pencatatan transaksi penjualan harian pertama Anda via POS atau Orders.',
    actionLabel: 'Buka POS Kasir',
    href: '/orders/pos',
    dbCheckKey: 'orders',
    icon: '💻',
  },
  {
    id: 'add_customer',
    stage: 2,
    stageTitle: 'Stage 2: Transaksi & Operasional Harian',
    stageBadge: 'Aktif Harian (Core Goal)',
    title: 'Tambahkan Data Pelanggan Baru',
    desc: 'Catat nama & nomor kontak pelanggan untuk membangun database pelanggan.',
    actionLabel: 'Tambah Pelanggan',
    href: '/customers',
    dbCheckKey: 'customers',
    icon: '👥',
  },
  {
    id: 'log_expense',
    stage: 2,
    stageTitle: 'Stage 2: Transaksi & Operasional Harian',
    stageBadge: 'Aktif Harian (Core Goal)',
    title: 'Catat Pengeluaran Operasional Harian',
    desc: 'Masukkan pengeluaran operasional toko agar arus kas (Cash Flow) tercatat rapi.',
    actionLabel: 'Catat Pengeluaran',
    href: '/expenses',
    dbCheckKey: 'expenses',
    icon: '💸',
  },

  // Stage 3
  {
    id: 'send_chat',
    stage: 3,
    stageTitle: 'Stage 3: Customer Engagement & Growth',
    stageBadge: 'Analisis & Retensi',
    title: 'Broadcast / Hubungi Pelanggan via Inbox',
    desc: 'Kirim pesan atau info promo ke pelanggan melalui fitur Inbox & WA Chat.',
    actionLabel: 'Buka Inbox Chat',
    href: '/inbox',
    dbCheckKey: 'inbox',
    icon: '💬',
  },
  {
    id: 'check_cohort',
    stage: 3,
    stageTitle: 'Stage 3: Customer Engagement & Growth',
    stageBadge: 'Analisis & Retensi',
    title: 'Pantau Analisis Returning Cohort',
    desc: 'Cek persentase pelanggan yang melakukan repeat order dari waktu ke waktu.',
    actionLabel: 'Lihat Cohort Report',
    href: '/customers/cohorts/returning',
    dbCheckKey: 'cohort',
    icon: '📊',
  },
  {
    id: 'create_invoice',
    stage: 3,
    stageTitle: 'Stage 3: Customer Engagement & Growth',
    stageBadge: 'Analisis & Retensi',
    title: 'Terbitkan Invoice / Tagihan Pelanggan',
    desc: 'Buat tagihan resmi untuk pesanan tempo atau piutang pelanggan.',
    actionLabel: 'Buat Invoice',
    href: '/orders/invoices',
    dbCheckKey: 'invoices',
    icon: '🧾',
  },

  // Stage 4
  {
    id: 'check_profit_loss',
    stage: 4,
    stageTitle: 'Stage 4: Laporan Keuangan & Akuntansi',
    stageBadge: 'Buku Kas & Finansial',
    title: 'Pantau Laporan Laba Rugi (Profit & Loss)',
    desc: 'Tinjau ringkasan pendapatan, HPP, beban operasional, dan laba bersih usaha.',
    actionLabel: 'Buka Laba Rugi',
    href: '/accounting/profit-loss',
    dbCheckKey: 'orders',
    icon: '💵',
  },
  {
    id: 'check_cash_flow',
    stage: 4,
    stageTitle: 'Stage 4: Laporan Keuangan & Akuntansi',
    stageBadge: 'Buku Kas & Finansial',
    title: 'Analisis Arus Kas (Cash Flow)',
    desc: 'Lacak pergerakan kas masuk dari penjualan dan kas keluar untuk biaya operasional.',
    actionLabel: 'Buka Arus Kas',
    href: '/accounting/cash-flow',
    dbCheckKey: 'expenses',
    icon: '📈',
  },
  {
    id: 'check_balance_sheet',
    stage: 4,
    stageTitle: 'Stage 4: Laporan Keuangan & Akuntansi',
    stageBadge: 'Buku Kas & Finansial',
    title: 'Periksa Neraca Keuangan (Balance Sheet)',
    desc: 'Pantau keseimbangan aset, liabilitas (hutang), dan ekuitas (modal) bisnis Anda.',
    actionLabel: 'Buka Neraca',
    href: '/accounting/balance-sheet',
    dbCheckKey: 'orders',
    icon: '⚖️',
  },
]

export default function OnboardingPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  // Consume instant UserContext state (0ms delay via cache)
  const { currentUserRole, currentUserPermissions, isWabaActive, bizLoading: isRoleLoading, userProfile, activeBusiness } = useUserContext()

  // Real-time Metrics State
  const [metrics, setMetrics] = useState({
    sales: 0, salesGrowth: 0, trx: 0, trxGrowth: 0, avg: 0, avgGrowth: 0, cust: 0, custGrowth: 0, newCust: 0, newCustGrowth: 0
  })
  const [dateFilter, setDateFilter] = useState('today')
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)

  useEffect(() => {
    async function fetchMetrics() {
      if (!activeBusiness?.id) return;
      setIsLoadingMetrics(true)
      try {
        const businessTimezone = activeBusiness?.timezone || 'Asia/Jakarta'
        
        // 1. Get local date range string limits (e.g. "2026-09-11")
        // Mapping our component's dateFilter to localzone keys
        let dateKey = 'today'
        if (dateFilter === 'yesterday') dateKey = 'yesterday'
        else if (dateFilter === 'last7') dateKey = 'last7' // 'last7' is not in DateRangeKey, we must handle it manually
        else if (dateFilter === 'thisMonth') dateKey = 'this-month'
        
        let startLocal, endLocal;
        if (dateKey === 'last7') {
          const now = new Date();
          const endDate = new Date(now);
          const startDate = new Date(now);
          startDate.setDate(now.getDate() - 6);
          const { formatLocalDateString } = require('@/lib/localzone');
          startLocal = formatLocalDateString(startDate, businessTimezone);
          endLocal = formatLocalDateString(endDate, businessTimezone);
        } else {
          const range = getLocalDateRangeLimits(dateKey as any, businessTimezone)
          startLocal = range.start
          endLocal = range.end
        }

        // Current period UTC bounds
        const bounds = localDateToUtcBounds(startLocal, endLocal, businessTimezone)
        
        // Calculate Previous Period
        const sDate = new Date(startLocal)
        const eDate = new Date(endLocal)
        const diffMs = eDate.getTime() - sDate.getTime()
        const prevStart = new Date(sDate.getTime() - diffMs - 24 * 60 * 60 * 1000)
        const prevEnd = new Date(sDate.getTime() - 24 * 60 * 60 * 1000)
        const { formatLocalDateString } = require('@/lib/localzone');
        const prevBounds = localDateToUtcBounds(
          formatLocalDateString(prevStart, businessTimezone),
          formatLocalDateString(prevEnd, businessTimezone),
          businessTimezone
        )

        const countedStatuses = ['shipped', 'processing', 'complete', 'completed']
        
        const [o1Res, o2Res] = await Promise.all([
          // Current period orders (with joined customer metrics for zero-latency newCust checking)
          supabase.from('orders')
            .select('grand_total, customer_id, customer_metrics(total_order_count)')
            .eq('business_id', activeBusiness.id)
            .in('status', countedStatuses)
            .gte('order_date_utc', bounds.startOfDayISO)
            .lte('order_date_utc', bounds.endOfDayISO),
            
          // Previous period orders
          supabase.from('orders')
            .select('grand_total, customer_id, customer_metrics(total_order_count)')
            .eq('business_id', activeBusiness.id)
            .in('status', countedStatuses)
            .gte('order_date_utc', prevBounds.startOfDayISO)
            .lte('order_date_utc', prevBounds.endOfDayISO)
        ])

        const o1 = o1Res.data || []
        const o2 = o2Res.data || []
        
        // customer_metrics logic is now resolved seamlessly through relational joins in the orders query!

        // Calculation exactly like dashboard
        const s1 = o1.reduce((acc, o) => acc + (Number(o.grand_total) || 0), 0)
        const t1 = o1.length
        const a1 = t1 > 0 ? s1 / t1 : 0
        const c1 = new Set(o1.map(o => o.customer_id).filter(Boolean)).size // Unique active customers
        
        const s2 = o2.reduce((acc, o) => acc + (Number(o.grand_total) || 0), 0)
        const t2 = o2.length
        const a2 = t2 > 0 ? s2 / t2 : 0
        const c2 = new Set(o2.map(o => o.customer_id).filter(Boolean)).size

        const calcGrowth = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : (curr > 0 ? 100 : 0)

        // Count new customers based on the joined total_order_count (<= 1 or unindexed null)
        const c1New = new Set(o1.filter(o => {
          // In PostgREST, a join on a 1:1 view returns an object or null
          const m = o.customer_metrics
          return !m || m.total_order_count <= 1
        }).map(o => o.customer_id)).size

        const c2New = new Set(o2.filter(o => {
          const m = o.customer_metrics
          return !m || m.total_order_count <= 1
        }).map(o => o.customer_id)).size

        setMetrics({
          sales: s1, salesGrowth: calcGrowth(s1, s2),
          trx: t1, trxGrowth: calcGrowth(t1, t2),
          avg: a1, avgGrowth: calcGrowth(a1, a2),
          cust: c1, custGrowth: calcGrowth(c1, c2),
          newCust: c1New, newCustGrowth: calcGrowth(c1New, c2New)
        })

      } catch(e) {
        console.error('Error fetching metrics', e)
      }
      setIsLoadingMetrics(false)
    }
    fetchMetrics()
  }, [dateFilter, supabase, activeBusiness?.id])


  // Manual checked state stored in localStorage
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([])
  // Auto-detected completion counts from DB
  const [dbCounts, setDbCounts] = useState<Record<string, number>>({})
  const [loadingDb, setLoadingDb] = useState(true)

  // Expandable stages state (default empty = all closed by default)
  const [openStageNums, setOpenStageNums] = useState<number[]>([])

  // Onboarding Dismissal States (Permanently vs Temporarily)
  const [isDismissedPermanently, setIsDismissedPermanently] = useState(false)
  const [isDismissedTemporarily, setIsDismissedTemporarily] = useState(false)
  const [showDismissModal, setShowDismissModal] = useState(false)

  // Quick Menu customization state stored in localStorage
  const [activeShortcutIds, setActiveShortcutIds] = useState<string[]>(DEFAULT_SHORTCUT_IDS)
  const [isEditingShortcuts, setIsEditingShortcuts] = useState(false)
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>('compact')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('Semua')
  const [shortcutSearch, setShortcutSearch] = useState('')

  // Prevent background scrolling when modals are open
  useEffect(() => {
    if (isAddModalOpen || showDismissModal) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [isAddModalOpen, showDismissModal])

  const toggleStage = (stageNum: number) => {
    setOpenStageNums(prev =>
      prev.includes(stageNum) ? prev.filter(s => s !== stageNum) : [...prev, stageNum]
    )
  }

  const toggleAllStages = () => {
    if (openStageNums.length === allStageNumbers.length) {
      setOpenStageNums([])
    } else {
      setOpenStageNums(allStageNumbers)
    }
  }

  // Load initial local states & DB counts
  useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('shapeup_onboarding_completed')
      if (savedTasks) {
        setCompletedTaskIds(JSON.parse(savedTasks))
      }
    } catch (e) {
      console.error("Failed to load completed tasks", e)
    }

    try {
      const isDismissed = localStorage.getItem('shapeup_onboarding_dismissed') === 'true'
      if (isDismissed) setIsDismissedPermanently(true)

      const savedShortcuts = localStorage.getItem('shapeup_custom_quick_menu')
      if (savedShortcuts) {
        setActiveShortcutIds(JSON.parse(savedShortcuts))
      }
      const savedViewMode = localStorage.getItem('shapeup_quick_menu_view_mode')
      if (savedViewMode === 'compact' || savedViewMode === 'detailed') {
        setViewMode(savedViewMode)
      }
    } catch (e) {
      console.error("Failed to load custom quick menu settings", e)
    }

    async function checkDbCounts() {
      // Check session cache first to prevent redundant DB queries within 60s
      try {
        const cached = sessionStorage.getItem('su_cached_onboarding_counts')
        if (cached) {
          const parsed = JSON.parse(cached)
          if (parsed && typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < 60000) {
            setDbCounts(parsed.counts)
            setLoadingDb(false)
            return
          }
        }
      } catch (e) {}

      setLoadingDb(true)
      try {
        const [
          prodRes,
          ordRes,
          custRes,
          expRes,
          supRes,
        ] = await Promise.all([
          supabase.from('products').select('*', { count: 'exact', head: true }),
          supabase.from('orders').select('*', { count: 'exact', head: true }),
          supabase.from('customers').select('*', { count: 'exact', head: true }),
          supabase.from('expenses').select('*', { count: 'exact', head: true }),
          supabase.from('suppliers').select('*', { count: 'exact', head: true }),
        ])

        const counts = {
          products: prodRes.count || 0,
          orders: ordRes.count || 0,
          customers: custRes.count || 0,
          expenses: expRes.count || 0,
          suppliers: supRes.count || 0,
        }

        setDbCounts(counts)

        try {
          sessionStorage.setItem('su_cached_onboarding_counts', JSON.stringify({
            counts,
            timestamp: Date.now()
          }))
        } catch (e) {}
      } catch (err) {
        console.error("Error fetching onboarding DB counts", err)
      } finally {
        setLoadingDb(false)
      }
    }

    checkDbCounts()
  }, [supabase])

  // Dynamically Filtered Shortcuts & Stages based on Permissions
  const allowedShortcutsPool = useMemo(() => {
    if (isRoleLoading && !currentUserRole) return AVAILABLE_SHORTCUTS
    return AVAILABLE_SHORTCUTS.filter(s => canAccessPath(s.href, { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }))
  }, [currentUserRole, currentUserPermissions, isWabaActive, isRoleLoading])

  const activeShortcutsList = useMemo(() => {
    return activeShortcutIds
      .map(id => allowedShortcutsPool.find(s => s.id === id))
      .filter(Boolean) as ShortcutItem[]
  }, [activeShortcutIds, allowedShortcutsPool])

  const unaddedShortcutsList = useMemo(() => {
    return allowedShortcutsPool.filter(s => {
      const notAdded = !activeShortcutIds.includes(s.id)
      const matchesCategory = selectedCategory === 'Semua' || s.category === selectedCategory
      const matchesSearch = s.name.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
                            s.description.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
                            s.category.toLowerCase().includes(shortcutSearch.toLowerCase())
      return notAdded && matchesCategory && matchesSearch
    })
  }, [allowedShortcutsPool, activeShortcutIds, selectedCategory, shortcutSearch])

  const allowedTasksList = useMemo(() => {
    return ONBOARDING_STAGES.filter(t => canAccessPath(t.href, { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }))
  }, [currentUserRole, currentUserPermissions, isWabaActive])

  const allStageNumbers = useMemo(() => {
    const stages = new Set(allowedTasksList.map(t => t.stage))
    return Array.from(stages).sort((a, b) => a - b)
  }, [allowedTasksList])

  const toggleTaskCompletion = (taskId: string) => {
    setCompletedTaskIds(prev => {
      let updated: string[]
      if (prev.includes(taskId)) {
        updated = prev.filter(id => id !== taskId)
      } else {
        updated = [...prev, taskId]
      }
      try {
        localStorage.setItem('shapeup_onboarding_completed', JSON.stringify(updated))
      } catch (e) {
        console.error("Failed to save completed tasks", e)
      }
      return updated
    })
  }

  const isTaskCompleted = (task: OnboardingTask) => {
    if (completedTaskIds.includes(task.id)) return true
    if (task.dbCheckKey && dbCounts[task.dbCheckKey] && dbCounts[task.dbCheckKey] > 0) {
      return true
    }
    return false
  }

  const totalTasks = allowedTasksList.length
  const completedCount = allowedTasksList.filter(t => isTaskCompleted(t)).length
  const progressPercent = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 100

  const getStatusBadge = (percent: number) => {
    if (percent >= 100) return { title: '👑 CRM Master & High DAU', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
    if (percent >= 70) return { title: '🔥 Customer Aktif Harian', color: 'bg-blue-100 text-blue-800 border-blue-300' }
    if (percent >= 40) return { title: '⚡ Bisnis Mulai Berjalan', color: 'bg-amber-100 text-amber-800 border-amber-300' }
    return { title: '🌱 Mode Persiapan Awal', color: 'bg-slate-100 text-slate-700 border-slate-300' }
  }

  const activeBadge = getStatusBadge(progressPercent)

  // Dismissal Handlers
  const handleDismissPermanently = () => {
    setIsDismissedPermanently(true)
    setShowDismissModal(false)
    try {
      localStorage.setItem('shapeup_onboarding_dismissed', 'true')
    } catch (e) {
      console.error("Failed to save dismissal state", e)
    }
  }

  const handleDismissTemporarily = () => {
    setIsDismissedTemporarily(true)
    setShowDismissModal(false)
  }

  const handleRestoreOnboarding = () => {
    setIsDismissedPermanently(false)
    setIsDismissedTemporarily(false)
    try {
      localStorage.removeItem('shapeup_onboarding_dismissed')
    } catch (e) {
      console.error("Failed to clear dismissal state", e)
    }
  }

  // Quick Menu Handlers
  const saveQuickMenu = (newIds: string[]) => {
    setActiveShortcutIds(newIds)
    try {
      localStorage.setItem('shapeup_custom_quick_menu', JSON.stringify(newIds))
    } catch (e) {
      console.error("Failed to save custom quick menu", e)
    }
  }

  const toggleViewMode = (mode: 'compact' | 'detailed') => {
    setViewMode(mode)
    try {
      localStorage.setItem('shapeup_quick_menu_view_mode', mode)
    } catch (e) {
      console.error("Failed to save view mode", e)
    }
  }

  const removeShortcut = (id: string) => {
    const updated = activeShortcutIds.filter(item => item !== id)
    saveQuickMenu(updated)
  }

  const moveShortcut = (index: number, direction: 'left' | 'right') => {
    if (direction === 'left' && index === 0) return
    if (direction === 'right' && index === activeShortcutIds.length - 1) return

    const targetIndex = direction === 'left' ? index - 1 : index + 1
    const updated = [...activeShortcutIds]
    const temp = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = temp

    saveQuickMenu(updated)
  }

  const addShortcut = (id: string) => {
    if (!activeShortcutIds.includes(id)) {
      const updated = [...activeShortcutIds, id]
      saveQuickMenu(updated)
    }
  }

  const resetDefaultShortcuts = () => {
    saveQuickMenu(DEFAULT_SHORTCUT_IDS)
  }

  const isGuideHidden = isDismissedPermanently || isDismissedTemporarily

  return (
    <div className="min-h-screen bg-[var(--su-bg,#F7F7F5)] text-[var(--su-text,#1C1C1A)] p-3 sm:p-6 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto pb-20">
      
      {/* ─── NEW HERO DASHBOARD & AKSI CEPAT ─────────────────────────────── */}
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Welcome Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              Good morning, {userProfile?.full_name?.split(' ')[0] || userProfile?.name?.split(' ')[0] || 'User'}! <span className="text-2xl animate-wave">👋</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Semoga hari ini penjualan makin lancar.</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white/60 backdrop-blur-md border border-slate-200/60 px-2 py-1.5 sm:px-3 sm:py-2 rounded-xl shadow-sm w-fit relative group">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="appearance-none bg-transparent text-xs sm:text-sm font-bold text-slate-800 focus:outline-none cursor-pointer pr-4"
            >
              <option value="today">Hari Ini</option>
              <option value="yesterday">Kemarin</option>
              <option value="last7">7 Hari Terakhir</option>
              <option value="thisMonth">Bulan Ini</option>
            </select>
            <svg className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Dashboard Card */}
        <div className={`bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-100 rounded-3xl p-5 sm:p-6 shadow-sm transition-opacity duration-300 ${isLoadingMetrics ? 'opacity-60' : 'opacity-100'}`}>
          <div className="flex flex-col lg:flex-row justify-between gap-6">
            
            {/* Left side */}
            <div className="space-y-4 lg:w-1/3">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Penjualan {dateFilter === 'today' ? 'Hari Ini' : dateFilter === 'yesterday' ? 'Kemarin' : dateFilter === 'last7' ? '7 Hari Terakhir' : 'Bulan Ini'}</h3>
                <div className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter mt-1">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(metrics.sales)}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-sm">
                  <span className={`font-bold flex items-center ${metrics.salesGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    <svg className={`w-4 h-4 transform ${metrics.salesGrowth < 0 ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 15l7-7 7 7"/></svg>
                    {Math.abs(metrics.salesGrowth).toFixed(1)}%
                  </span>
                  <span className="text-slate-500">dari periode sblmnya</span>
                </div>
              </div>
            </div>

            {/* Right side (Metrics) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 lg:w-2/3">
              {/* Metric 1 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.trx)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Transaksi</div>
                  <div className={`text-[10px] font-bold mt-0.5 ${metrics.trxGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{metrics.trxGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.trxGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 2 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                  </div>
                  <span className="text-sm font-black text-slate-800 truncate">{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(metrics.avg)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium leading-tight">Rata-rata Transaksi</div>
                  <div className={`text-[10px] font-bold mt-0.5 ${metrics.avgGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{metrics.avgGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.avgGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 3 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.cust)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan</div>
                  <div className={`text-[10px] font-bold mt-0.5 ${metrics.custGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{metrics.custGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.custGrowth).toFixed(1)}%</div>
                </div>
              </div>
              {/* Metric 4 */}
              <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm border border-emerald-50 flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
                  </div>
                  <span className="text-lg font-black text-slate-800">{new Intl.NumberFormat('id-ID').format(metrics.newCust)}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 font-medium">Pelanggan Baru</div>
                  <div className={`text-[10px] font-bold mt-0.5 ${metrics.newCustGrowth >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{metrics.newCustGrowth >= 0 ? '↑' : '↓'} {Math.abs(metrics.newCustGrowth).toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Aksi Cepat */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-extrabold text-slate-900">Aksi Cepat</h2>
            <Link href="/orders" className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1">
              Lihat semua <span>→</span>
            </Link>
          </div>
          
          <div className="flex overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 gap-3 sm:gap-4 no-scrollbar snap-x">
            {/* Kasir (POS) */}
            {canAccessPath('/orders/pos', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/orders/pos" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#7C5A48] text-white hover:bg-[#684b3c] transition-all transform active:scale-95 shadow-md">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>
              <span className="text-[11px] sm:text-xs font-bold text-center leading-tight">Kasir (POS)</span>
            </Link>
            )}

            {/* Produk */}
            {canAccessPath('/products', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/products" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FFF6EE] border border-[#FFE8D6] hover:bg-[#FFE8D6] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-[#B47953]">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Produk</span>
            </Link>
            )}

            {/* Stok */}
            {canAccessPath('/stock-opname', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/stock-opname" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#F0FDF4] border border-[#DCFCE7] hover:bg-[#DCFCE7] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-emerald-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Stok</span>
            </Link>
            )}

            {/* Pelanggan */}
            {canAccessPath('/customers', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/customers" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#EFF6FF] border border-[#DBEAFE] hover:bg-[#DBEAFE] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-blue-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pelanggan</span>
            </Link>
            )}

            {/* Pesanan */}
            {canAccessPath('/orders', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/orders" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FEF2F2] border border-[#FEE2E2] hover:bg-[#FEE2E2] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-red-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Pesanan</span>
            </Link>
            )}

            {/* Laporan */}
            {canAccessPath('/accounting/profit-loss', { role: currentUserRole, permissions: currentUserPermissions, isWabaActive }) && (
            <Link href="/accounting/profit-loss" className="snap-start shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center gap-3 p-4 rounded-3xl bg-[#FAF5FF] border border-[#F3E8FF] hover:bg-[#F3E8FF] transition-all transform active:scale-95">
              <div className="bg-white p-2 rounded-xl shadow-sm text-purple-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
              </div>
              <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center leading-tight">Laporan</span>
            </Link>
            )}
          </div>
        </div>
      </div>

      {/* ─── RESTORE BANNER (IF DISMISSED OR HIDDEN) ────────────────────────── */}
      {isGuideHidden ? (
        <div className="bg-white border border-[var(--su-border,#E2E2DC)] rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-slate-700">
            <span className="text-base">💡</span>
            <span>Panduan Aktivitas Onboarding disembunyikan.</span>
            <span className="text-slate-400 font-normal">({progressPercent}% selesai)</span>
          </div>
          <button
            onClick={handleRestoreOnboarding}
            className="text-xs font-extrabold text-blue-600 hover:text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3.5 py-1.5 rounded-lg transition-colors shrink-0"
          >
            ⚙️ Tampilkan Kembali Panduan
          </button>
        </div>
      ) : (
        <>
          {/* ─── 100% CELEBRATION CARD ─────────────────────────────────────── */}
          {progressPercent === 100 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🎉</span>
                <div>
                  <h4 className="text-sm font-extrabold text-emerald-900">
                    Selamat! Anda Telah Menyelesaikan 100% Panduan Onboarding!
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Bisnis Anda kini siap berjalan optimal dengan pencatatan transaksi & retensi pelanggan aktif harian.
                  </p>
                </div>
              </div>
              <button
                onClick={handleDismissPermanently}
                className="text-xs font-extrabold bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 rounded-lg shadow-xs transition-colors shrink-0"
              >
                Sembunyikan Panduan Ini
              </button>
            </div>
          )}

          {/* ─── HEADER & DAU PROGRESS BANNER (WITH CLOSE X BUTTON) ─────────── */}
          <div className="relative bg-white border border-[var(--su-border,#E2E2DC)] rounded-xl p-5 md:p-8 shadow-sm space-y-6">
            
            {/* CLOSE (X) BUTTON ON TOP-RIGHT */}
            <button
              onClick={() => setShowDismissModal(true)}
              title="Sembunyikan atau tutup panduan ini"
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pr-6 sm:pr-8">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-black uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
                    🚀 Shape Up Onboarding
                  </span>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-md border ${activeBadge.color}`}>
                    {activeBadge.title}
                  </span>
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Panduan Aktivitas & Retensi Bisnis
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 max-w-2xl">
                  Selesaikan langkah-langkah di bawah ini untuk mengoptimalkan operasional Shape Up CRM.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-center gap-4 min-w-[210px]">
                <div className="relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center font-extrabold text-base sm:text-lg text-blue-600 bg-blue-100 rounded-full border-2 border-blue-500 shrink-0">
                  {progressPercent}%
                </div>
                <div>
                  <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Progres Onboarding</div>
                  <div className="text-base sm:text-lg font-black text-slate-900">{completedCount} / {totalTasks} Selesai</div>
                  <div className="text-[11px] text-slate-500">Aktivitas terverifikasi</div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden border border-slate-200">
                <div
                  className="bg-blue-600 h-full transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] sm:text-[11px] font-semibold text-slate-500 overflow-x-auto gap-2">
                <span>Stage 1: Setup</span>
                <span>Stage 2: Transaksi Harian</span>
                <span>Stage 3: Growth & Retensi</span>
                <span>Stage 4: Laporan Keuangan</span>
              </div>
            </div>
          </div>


          {/* ─── STAGE-BASED GUIDED ACTIVITIES (EXPANDABLE) ───────────────── */}
          <div className="space-y-4 sm:space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  Aktivitas Berdasarkan Stage
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Klik pada stage di bawah ini untuk melihat daftar aktivitas.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {(loadingDb || isRoleLoading) && (
                  <span className="text-xs text-slate-400 animate-pulse hidden sm:inline">
                    Memeriksa izin & data...
                  </span>
                )}
                <button
                  onClick={toggleAllStages}
                  className="text-xs font-extrabold text-blue-600 hover:text-blue-800 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {openStageNums.length === allStageNumbers.length ? 'Tutup Semua' : 'Buka Semua'}
                </button>
              </div>
            </div>

            {allStageNumbers.map(stageNum => {
              const stageTasks = allowedTasksList.filter(t => t.stage === stageNum)
              if (stageTasks.length === 0) return null // Hide stage if no permissions for any task in this stage

              const firstTask = stageTasks[0]
              const stageDoneCount = stageTasks.filter(t => isTaskCompleted(t)).length
              const isOpen = openStageNums.includes(stageNum)

              return (
                <div key={stageNum} className="bg-white border border-[var(--su-border,#E2E2DC)] rounded-xl p-4 md:p-6 shadow-sm space-y-4">
                  <div
                    onClick={() => toggleStage(stageNum)}
                    className="flex items-center justify-between gap-3 cursor-pointer select-none group hover:bg-slate-50/80 p-2 -m-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center group-hover:scale-105 transition-transform shrink-0">
                        {stageNum}
                      </span>
                      <div>
                        <h3 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {firstTask.stageTitle}
                        </h3>
                        <span className="text-[11px] sm:text-xs text-slate-500 font-medium">
                          {firstTask.stageBadge}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="text-[11px] sm:text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full whitespace-nowrap">
                        {stageDoneCount}/{stageTasks.length} <span className="hidden sm:inline">Selesai</span>
                      </div>

                      <div className={`p-1.5 rounded-md text-slate-400 group-hover:text-slate-700 transition-all transform ${isOpen ? 'rotate-180' : 'rotate-0'}`}>
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                      {stageTasks.map(task => {
                        const done = isTaskCompleted(task)
                        return (
                          <div
                            key={task.id}
                            className={`relative flex flex-col justify-between border rounded-lg p-4 transition-all duration-200 ${
                              done
                                ? 'bg-slate-50/70 border-emerald-200 shadow-none'
                                : 'bg-white border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <span className="text-2xl">{task.icon}</span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleTaskCompletion(task.id)
                                  }}
                                  title={done ? 'Tandai belum selesai' : 'Tandai selesai'}
                                  className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-md border transition-colors ${
                                    done
                                      ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                  }`}
                                >
                                  {done ? '✓ Selesai' : '○ Tandai'}
                                </button>
                              </div>

                              <h4 className={`text-sm font-bold leading-snug mb-1 ${done ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                                {task.title}
                              </h4>
                              <p className="text-xs text-slate-500 leading-relaxed mb-4">
                                {task.desc}
                              </p>
                            </div>

                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                              <Link
                                href={task.href}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                <span>{task.actionLabel}</span>
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </Link>

                              {done && (
                                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                  Verified
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}


      {/* ─── DISMISS CONFIRMATION MODAL ─────────────────────────────────────── */}
      {showDismissModal && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 overscroll-contain">
          <div className="bg-white border border-slate-300 rounded-xl w-full max-w-md p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl p-2 bg-amber-100 rounded-xl border border-amber-200">🙈</span>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Sembunyikan Panduan Onboarding?
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pilih opsi untuk menyembunyikan banner panduan ini.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDismissModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleDismissTemporarily}
                className="w-full flex items-start gap-3 p-3.5 border border-slate-200 hover:border-blue-300 rounded-xl bg-slate-50 hover:bg-blue-50/50 text-left transition-colors group"
              >
                <span className="text-xl">⏱️</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-blue-600">
                    Sembunyikan Sesi Ini
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Panduan hanya disembunyikan untuk saat ini. Panduan akan muncul kembali ketika halaman dimuat ulang.
                  </p>
                </div>
              </button>

              <button
                onClick={handleDismissPermanently}
                className="w-full flex items-start gap-3 p-3.5 border border-slate-200 hover:border-red-300 rounded-xl bg-slate-50 hover:bg-red-50/40 text-left transition-colors group"
              >
                <span className="text-xl">🚫</span>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 group-hover:text-red-600">
                    Jangan Tampilkan Lagi
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Sembunyikan secara permanen. Anda tetap dapat mengaktifkan kembali panduan ini kapan saja.
                  </p>
                </div>
              </button>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowDismissModal(false)}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 px-3 py-1.5"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ─── ADD SHORTCUT MODAL / BOTTOM SHEET ──────────────────────────────── */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200 overscroll-contain">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[80vh] transition-all animate-in zoom-in-95 duration-150 overscroll-contain">
            
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4 bg-white shrink-0">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center gap-2">
                  <span>⚡</span>
                  <span>Tambah Pintasan Quick Menu</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih fitur yang sering Anda akses untuk ditambahkan ke layar depan.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-2 rounded-xl transition-colors shrink-0 -mr-1"
                title="Tutup"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Search & Category Filter Section */}
            <div className="px-6 py-3.5 bg-slate-50/70 border-b border-slate-100 space-y-3 shrink-0">
              {/* Search Bar */}
              <div className="relative flex items-center">
                <svg className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  type="text"
                  placeholder="Cari fitur (contoh: POS, Customers, Invoices)..."
                  value={shortcutSearch}
                  onChange={e => setShortcutSearch(e.target.value)}
                  className="w-full pl-10 pr-9 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-2xs"
                />
                {shortcutSearch && (
                  <button
                    onClick={() => setShortcutSearch('')}
                    className="absolute right-3 text-slate-400 hover:text-slate-600 p-0.5 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Category Pills Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 text-xs scrollbar-none">
                {CATEGORIES.map(cat => {
                  const isActive = selectedCategory === cat
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs whitespace-nowrap shrink-0 transition-all ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      {cat}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Scrollable Items List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
              {unaddedShortcutsList.length === 0 ? (
                <div className="text-center py-12 px-4 text-xs text-slate-500 space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center text-xl mx-auto">
                    🔍
                  </div>
                  <p className="font-extrabold text-slate-700 text-sm">Tidak ada fitur yang ditemukan</p>
                  <p className="text-slate-400 max-w-xs mx-auto leading-relaxed">
                    Semua fitur pada kategori ini sudah ditambahkan atau tidak sesuai dengan kata kunci pencarian.
                  </p>
                </div>
              ) : (
                unaddedShortcutsList.map(shortcut => {
                  const catStyles = getCategoryStyles(shortcut.category)
                  const isAdded = activeShortcutIds.includes(shortcut.id)
                  return (
                    <div
                      key={shortcut.id}
                      className="group flex items-center justify-between p-3.5 bg-white hover:bg-slate-50/80 border border-slate-200/80 hover:border-blue-200 rounded-xl transition-all duration-150 shadow-2xs"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                        <div className={`w-11 h-11 rounded-xl border ${catStyles.bg} ${catStyles.border} flex items-center justify-center text-xl shrink-0 shadow-2xs`}>
                          {shortcut.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-bold text-slate-900 break-words leading-tight">
                              {shortcut.name}
                            </span>
                            <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md border shrink-0 ${catStyles.border} ${catStyles.bg} ${catStyles.text}`}>
                              {shortcut.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-0.5 leading-normal">
                            {shortcut.description}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => addShortcut(shortcut.id)}
                        disabled={isAdded}
                        className={`inline-flex items-center gap-1 text-xs font-bold px-3.5 py-2 rounded-xl transition-all shrink-0 active:scale-95 ${
                          isAdded
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                        }`}
                      >
                        {isAdded ? (
                          <>
                            <span>✓</span>
                            <span>Aktif</span>
                          </>
                        ) : (
                          <>
                            <span>+</span>
                            <span>Tambah</span>
                          </>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-slate-500">
                {activeShortcutsList.length} pintasan aktif di Quick Menu
              </span>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-5 py-2 rounded-xl shadow-xs transition-colors"
              >
                Selesai
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
