"use client"
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        // Jika tidak ada user, tendang kembali ke halaman login
        router.push('/login')
      } else {
        setUser(user)
        setLoading(false)
      }
    }
    checkUser()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-black font-bold">
        Memuat Data...
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar Sederhana */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-blue-600">ShapeUp CRM</h1>
        <button 
          onClick={handleLogout}
          className="bg-red-50 text-red-600 px-4 py-2 rounded-lg font-semibold hover:bg-red-100 transition-colors"
        >
          Keluar
        </button>
      </nav>

      {/* Konten Utama */}
      <main className="p-8 max-w-4xl mx-auto">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-black">
          <h2 className="text-2xl font-bold mb-2">Selamat Datang! 👋</h2>
          <p className="text-slate-500 mb-6">Berikut adalah ringkasan akun bisnis Anda.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nama Bisnis</p>
              <p className="text-lg font-semibold text-slate-800">
                {user.user_metadata?.business_name || 'Bisnis Tanpa Nama'}
              </p>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email Akun</p>
              <p className="text-lg font-semibold text-slate-800">{user.email}</p>
            </div>
          </div>

          <div className="mt-8 p-6 border-2 border-dashed border-slate-200 rounded-2xl text-center">
            <p className="text-slate-500 font-medium">
              Data pelanggan dari WooCommerce akan muncul di sini.
            </p>
            <button className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">
              Hubungkan WooCommerce
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}