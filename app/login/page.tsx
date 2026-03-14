"use client"
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr' // Gunakan ini
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const router = useRouter()

  // Inisialisasi client Supabase khusus browser
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
    } else {
      // PENTING: Gunakan refresh() untuk memastikan middleware membaca cookie terbaru
      router.refresh() 
      
      // Berikan jeda sangat singkat agar cookie tertanam sempurna sebelum pindah
      setTimeout(() => {
        router.push('/dashboard')
      }, 100)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60">
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-4 shadow-lg shadow-blue-200">
            S
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Masuk ShapeUp</h1>
          <p className="text-slate-500 mt-2 font-medium">Kelola bisnis Anda dengan lebih cerdas</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Email</label>
            <input 
              type="email" 
              placeholder="nama@bisnis.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium" 
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium" 
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transform active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Mengecek Akun...' : 'Masuk Sekarang'}
          </button>
        </form>

        {errorMsg && (
          <div className="mt-6 p-4 rounded-2xl text-sm font-bold text-center bg-red-50 text-red-600 border border-red-100">
            {errorMsg}
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-sm font-medium text-slate-600">
          Belum punya akun? <a href="/register" className="text-blue-600 font-bold hover:underline">Daftar di sini</a>
        </div>
      </div>
    </div>
  )
}