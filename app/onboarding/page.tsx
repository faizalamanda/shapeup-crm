"use client"

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'

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
  { id: 'orders', name: 'Orders Penjualan', href: '/orders', category: 'Penjualan', description: 'Daftar & status riwayat pesanan', icon: '🛒' },
  { id: 'invoices', name: 'Invoices & Tagihan', href: '/orders/invoices', category: 'Penjualan', description: 'Faktur & penagihan pembayaran', icon: '🧾' },
  { id: 'products', name: 'Daftar Produk', href: '/products', category: 'Katalog', description: 'Kelola harga, stok, & variasi', icon: '📦' },
  { id: 'stock_opname', name: 'Stock Opname', href: '/stock-opname', category: 'Katalog', description: 'Penyesuaian jumlah stok fisik', icon: '📋' },
  { id: 'customers', name: 'Data Pelanggan', href: '/customers', category: 'Pelanggan', description: 'Database & riwayat kontak pembeli', icon: '👥' },
  { id: 'cohort', name: 'Returning Cohort', href: '/customers/cohorts/returning', category: 'Pelanggan', description: 'Analisis repeat order & retensi', icon: '📊' },
  { id: 'retention', name: 'Retensi Produk', href: '/customers/product-retention', category: 'Pelanggan', description: 'Produk paling sering dibeli ulang', icon: '📈' },
  { id: 'expenses', name: 'Catat Pengeluaran', href: '/expenses', category: 'Pengeluaran', description: 'Pencatatan biaya operasional harian', icon: '💸' },
  { id: 'suppliers', name: 'Pemasok (Suppliers)', href: '/suppliers', category: 'Pengeluaran', description: 'Vendor stok & pemasok bahan', icon: '🏭' },
  { id: 'inbox', name: 'Inbox / WA Chat', href: '/inbox', category: 'Komunikasi', description: 'Perpesanan pelanggan terintegrasi', icon: '💬' },
  { id: 'accounting_trans', name: 'Jurnal Akuntansi', href: '/accounting/transactions', category: 'Akuntansi', description: 'Buku kas & pembukuan umum', icon: '📖' },
  { id: 'profit_loss', name: 'Laba Rugi', href: '/accounting/profit-loss', category: 'Akuntansi', description: 'Laporan untung rugi operasional', icon: '💵' },
  { id: 'employees', name: 'Karyawan & Gaji', href: '/employees', category: 'HR', description: 'Manajemen staf & daftar gaji', icon: '👔' },
  { id: 'settings', name: 'Pengaturan Bisnis', href: '/settings', category: 'Sistem', description: 'Profil bisnis & hak akses user', icon: '⚙️' },
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

// Helper: Path permission validator based on User Role & Permissions
const isPathAllowed = (href: string, role: string | null, perms: string[], wabaActive: boolean): boolean => {
  if (!role) return true // default open during initial loading
  if (role === 'admin' || perms.includes('full_access')) return true

  if (href.startsWith('/settings')) return false
  if (href.startsWith('/inbox')) return wabaActive
  if (href.startsWith('/employees')) return perms.includes('manage_employees_salary')
  if (href.startsWith('/accounting')) return perms.includes('view_financials_no_salary')

  if (href.startsWith('/expenses')) {
    return (
      perms.includes('view_financials_no_salary') ||
      perms.includes('input_journal_expenses') ||
      perms.includes('manage_bills')
    )
  }

  if (href.startsWith('/suppliers')) {
    return (
      perms.includes('view_financials_no_salary') ||
      perms.includes('input_journal_expenses') ||
      perms.includes('manage_bills') ||
      perms.includes('manage_purchases')
    )
  }

  if (href.startsWith('/orders') || href.startsWith('/customers')) {
    return (
      perms.includes('view_financials_no_salary') ||
      perms.includes('manage_invoices')
    )
  }

  if (href.startsWith('/products') || href.startsWith('/stock-opname')) {
    return (
      perms.includes('view_financials_no_salary') ||
      perms.includes('manage_invoices') ||
      perms.includes('manage_products')
    )
  }

  return true
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
]

export default function OnboardingPage() {
  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ), [])

  // User Role & Permissions State
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [currentUserPermissions, setCurrentUserPermissions] = useState<string[]>([])
  const [isWabaActive, setIsWabaActive] = useState(false)
  const [isRoleLoading, setIsRoleLoading] = useState(true)

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

  const toggleStage = (stageNum: number) => {
    setOpenStageNums(prev =>
      prev.includes(stageNum) ? prev.filter(s => s !== stageNum) : [...prev, stageNum]
    )
  }

  const toggleAllStages = () => {
    if (openStageNums.length === 3) {
      setOpenStageNums([])
    } else {
      setOpenStageNums([1, 2, 3])
    }
  }

  // Fetch User Role, Permissions, and WABA Plugin Status
  useEffect(() => {
    async function loadUserRoleAndPermissions() {
      setIsRoleLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setIsRoleLoading(false)
          return
        }

        const [
          { data: profile },
          { data: staffRows },
          { data: ownedBiz }
        ] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
          supabase.from('business_staff').select('*, businesses(*)').eq('profile_id', user.id),
          supabase.from('businesses').select('*').eq('owner_id', user.id)
        ])

        const activeBizId = profile?.active_business_id || ownedBiz?.[0]?.id || staffRows?.[0]?.businesses?.id

        if (activeBizId) {
          const { data: wabaInt } = await supabase
            .from('integrations')
            .select('is_active, api_credentials')
            .eq('platform_name', 'waba_official')
            .filter('api_credentials->>business_id', 'eq', activeBizId)
            .maybeSingle()

          setIsWabaActive(Boolean(wabaInt && wabaInt.is_active === true))
        }

        const activeBs = staffRows?.find((item: any) => item.businesses?.id === activeBizId)
        const isUserAdmin = profile?.role === 'admin' || activeBs?.role === 'admin' || ownedBiz?.some((b: any) => b.id === activeBizId)

        if (isUserAdmin) {
          setCurrentUserRole('admin')
          setCurrentUserPermissions(['full_access'])
        } else if (activeBs) {
          setCurrentUserRole(activeBs.role)
          setCurrentUserPermissions(activeBs.permissions || [])
        } else {
          setCurrentUserRole('staff')
          setCurrentUserPermissions([])
        }
      } catch (err) {
        console.error("Error loading user role & permissions in onboarding:", err)
        setCurrentUserRole('admin')
      } finally {
        setIsRoleLoading(false)
      }
    }

    loadUserRoleAndPermissions()
  }, [supabase])

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
      setLoadingDb(true)
      try {
        const [
          { count: prodCount },
          { count: ordCount },
          { count: custCount },
          { count: expCount },
          { count: supCount },
        ] = await Promise.all([
          supabase.from('products').select('*', { count: 'exact', head: true }),
          supabase.from('orders').select('*', { count: 'exact', head: true }),
          supabase.from('customers').select('*', { count: 'exact', head: true }),
          supabase.from('expenses').select('*', { count: 'exact', head: true }),
          supabase.from('suppliers').select('*', { count: 'exact', head: true }),
        ])

        setDbCounts({
          products: prodCount || 0,
          orders: ordCount || 0,
          customers: custCount || 0,
          expenses: expCount || 0,
          suppliers: supCount || 0,
        })
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
    if (isRoleLoading) return AVAILABLE_SHORTCUTS
    return AVAILABLE_SHORTCUTS.filter(s => isPathAllowed(s.href, currentUserRole, currentUserPermissions, isWabaActive))
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
    return ONBOARDING_STAGES.filter(t => isPathAllowed(t.href, currentUserRole, currentUserPermissions, isWabaActive))
  }, [currentUserRole, currentUserPermissions, isWabaActive])

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
              <div className="flex justify-between text-[10px] sm:text-[11px] font-semibold text-slate-500">
                <span>Stage 1: Setup</span>
                <span>Stage 2: Transaksi Harian</span>
                <span>Stage 3: Growth & Retensi</span>
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
                  {openStageNums.length === 3 ? 'Tutup Semua' : 'Buka Semua'}
                </button>
              </div>
            </div>

            {[1, 2, 3].map(stageNum => {
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


      {/* ─── WORLD-CLASS MOBILE-FIRST QUICK MENU ────────────────────────────── */}
      <div className="bg-white border border-[var(--su-border,#E2E2DC)] rounded-xl p-4 sm:p-6 md:p-8 shadow-sm space-y-5">
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                Quick Menu Icon (Pintasan Cepat)
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Pintasan halaman favorit. **Klik 1-tap** untuk membuka langsung, atau aktifkan mode edit untuk menyesuaikan.
            </p>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-slate-100 p-1 rounded-lg flex items-center gap-1 border border-slate-200">
              <button
                onClick={() => toggleViewMode('compact')}
                title="Tampilan Ikon Ringkas (Mobile App Launcher)"
                className={`p-1.5 rounded-md text-xs font-bold transition-all ${
                  viewMode === 'compact'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              </button>
              <button
                onClick={() => toggleViewMode('detailed')}
                title="Tampilan Kartu Detail"
                className={`p-1.5 rounded-md text-xs font-bold transition-all ${
                  viewMode === 'detailed'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
            </div>

            <button
              onClick={() => setIsEditingShortcuts(!isEditingShortcuts)}
              className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg border transition-all ${
                isEditingShortcuts
                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm animate-pulse'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              {isEditingShortcuts ? '✓ Selesai Edit' : '⚙️ Edit Pintasan'}
            </button>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-extrabold bg-blue-600 text-white hover:bg-blue-700 px-3 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>+ Tambah</span>
            </button>
          </div>
        </div>

        {isEditingShortcuts && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between text-xs text-amber-900 animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="text-base">🛠️</span>
              <span className="font-semibold">
                **Mode Edit Aktif**: Tekan ikon <span className="text-red-600 font-bold">(-)</span> untuk menghapus, atau gunakan panah untuk menggeser posisi pintasan.
              </span>
            </div>
            <button
              onClick={resetDefaultShortcuts}
              className="font-bold underline text-amber-800 hover:text-amber-950 shrink-0 ml-2"
            >
              Reset Default
            </button>
          </div>
        )}

        {/* ─── QUICK MENU GRID DISPLAY ─────────────────────────────────────── */}
        {activeShortcutsList.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl space-y-3">
            <p className="text-sm font-semibold text-slate-500">Belum ada pintasan cepat yang diizinkan / ditambahkan.</p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="text-xs font-bold text-blue-600 hover:underline"
            >
              + Tambah Pintasan Cepat Sekarang
            </button>
          </div>
        ) : viewMode === 'compact' ? (
          <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 sm:gap-4">
            {activeShortcutsList.map((shortcut, index) => {
              const catStyles = getCategoryStyles(shortcut.category)
              return (
                <div key={shortcut.id} className="relative group flex flex-col items-center">
                  {isEditingShortcuts && (
                    <div className="absolute -top-1.5 -right-1.5 z-20 flex items-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeShortcut(shortcut.id)
                        }}
                        title="Hapus pintasan"
                        className="w-5 h-5 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center font-bold text-xs shadow-md transition-transform hover:scale-110"
                      >
                        -
                      </button>
                    </div>
                  )}

                  {isEditingShortcuts && (
                    <div className="absolute -bottom-2 z-20 flex items-center gap-1 bg-white border border-slate-300 rounded-full px-1 shadow-sm">
                      <button
                        onClick={() => moveShortcut(index, 'left')}
                        disabled={index === 0}
                        className="text-[10px] text-slate-600 disabled:opacity-20 hover:text-blue-600 px-0.5 font-bold"
                      >
                        ‹
                      </button>
                      <button
                        onClick={() => moveShortcut(index, 'right')}
                        disabled={index === activeShortcutsList.length - 1}
                        className="text-[10px] text-slate-600 disabled:opacity-20 hover:text-blue-600 px-0.5 font-bold"
                      >
                        ›
                      </button>
                    </div>
                  )}

                  <Link
                    href={isEditingShortcuts ? '#' : shortcut.href}
                    onClick={(e) => {
                      if (isEditingShortcuts) e.preventDefault()
                    }}
                    className={`w-full flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all duration-150 ${
                      isEditingShortcuts ? 'cursor-default opacity-90' : 'active:scale-95 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border ${catStyles.bg} ${catStyles.border} flex items-center justify-center text-2xl sm:text-3xl shadow-xs transition-transform group-hover:scale-105 ${
                      isEditingShortcuts ? 'ring-2 ring-amber-400 ring-offset-1 animate-pulse' : ''
                    }`}>
                      {shortcut.icon}
                      <span className={`absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border border-white ${catStyles.bg}`} />
                    </div>

                    <span className="text-[11px] sm:text-xs font-bold text-slate-800 text-center line-clamp-1 w-full tracking-tight">
                      {shortcut.name}
                    </span>
                  </Link>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeShortcutsList.map((shortcut, index) => {
              const catStyles = getCategoryStyles(shortcut.category)
              return (
                <div
                  key={shortcut.id}
                  className={`group relative border rounded-xl p-4 transition-all duration-200 flex flex-col justify-between ${
                    isEditingShortcuts
                      ? 'bg-amber-50/40 border-amber-300 ring-1 ring-amber-300'
                      : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-md'
                  }`}
                >
                  {isEditingShortcuts && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 z-10 bg-white border border-slate-200 rounded-md p-1 shadow-xs">
                      <button
                        onClick={() => moveShortcut(index, 'left')}
                        disabled={index === 0}
                        title="Geser ke kiri"
                        className="p-1 text-slate-500 hover:text-blue-600 disabled:opacity-30"
                      >
                        ←
                      </button>
                      <button
                        onClick={() => moveShortcut(index, 'right')}
                        disabled={index === activeShortcutsList.length - 1}
                        title="Geser ke kanan"
                        className="p-1 text-slate-500 hover:text-blue-600 disabled:opacity-30"
                      >
                        →
                      </button>
                      <button
                        onClick={() => removeShortcut(shortcut.id)}
                        title="Hapus pintasan"
                        className="p-1 text-red-600 hover:text-red-800 font-bold ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  <Link href={isEditingShortcuts ? '#' : shortcut.href} className="block space-y-2.5">
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl p-2 rounded-xl border ${catStyles.bg} ${catStyles.border}`}>
                        {shortcut.icon}
                      </span>
                      <div>
                        <span className={`text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border ${catStyles.border} ${catStyles.bg} ${catStyles.text}`}>
                          {shortcut.category}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors mt-0.5">
                          {shortcut.name}
                        </h3>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {shortcut.description}
                    </p>
                  </Link>

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-blue-600">
                    <span>Buka Halaman</span>
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>


      {/* ─── DISMISS CONFIRMATION MODAL ─────────────────────────────────────── */}
      {showDismissModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-300 rounded-t-2xl sm:rounded-xl w-full max-w-2xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col slide-in-from-bottom sm:slide-in-from-bottom-0 duration-200">
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto sm:hidden -mt-1 mb-1" />

            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                  Tambah Pintasan Quick Menu
                </h3>
                <p className="text-xs text-slate-500">
                  Pilih fitur yang sering Anda buka untuk ditambahkan ke layar depan.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Cari fitur (contoh: POS, Customers, Invoices)..."
                value={shortcutSearch}
                onChange={e => setShortcutSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar text-xs border-b border-slate-100 pb-2.5">
              {CATEGORIES.map(cat => {
                const isActive = selectedCategory === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-full font-bold whitespace-nowrap shrink-0 transition-all ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                )
              })}
            </div>

            <div className="overflow-y-auto space-y-2 pr-1 flex-1 min-h-[220px]">
              {unaddedShortcutsList.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-500 space-y-1">
                  <p className="font-semibold">Tidak ada fitur yang cocok.</p>
                  <p className="text-[11px] text-slate-400">Semua fitur pada kategori ini mungkin sudah ditambahkan atau tidak diizinkan untuk akun Anda.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {unaddedShortcutsList.map(shortcut => {
                    const catStyles = getCategoryStyles(shortcut.category)
                    const isAdded = activeShortcutIds.includes(shortcut.id)
                    return (
                      <div
                        key={shortcut.id}
                        className="flex items-center justify-between border border-slate-200 hover:border-blue-300 rounded-xl p-3.5 hover:bg-slate-50/80 transition-all group"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                          <span className={`text-2xl p-2.5 rounded-xl border ${catStyles.bg} ${catStyles.border} shrink-0`}>
                            {shortcut.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                                {shortcut.name}
                              </span>
                              <span className={`text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 ${catStyles.border} ${catStyles.bg} ${catStyles.text}`}>
                                {shortcut.category}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 truncate leading-relaxed">
                              {shortcut.description}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => addShortcut(shortcut.id)}
                          disabled={isAdded}
                          className={`text-xs font-extrabold px-3.5 py-2 rounded-xl shadow-xs transition-all shrink-0 active:scale-95 ${
                            isAdded
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 cursor-default'
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
                        >
                          {isAdded ? '✓ Ditambahkan' : '+ Tambah'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-3 flex justify-between items-center">
              <span className="text-xs text-slate-500 font-medium">
                {activeShortcutsList.length} pintasan aktif
              </span>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl shadow-xs"
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
