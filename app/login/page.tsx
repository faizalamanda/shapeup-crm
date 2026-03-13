"use client"
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)
    if (error) {
      setErrorMsg(error.message)
    } else {
      // Jika berhasil, arahkan ke dashboard
      router.push('/dashboard')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900">Masuk ShapeUp</h1>
          <p className="text-slate-500 mt-2">Kelola database pelanggan Anda kembali</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Email</label>
            <input 
              type="email" 
              placeholder="nama@bisnis.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all" 
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition-all" 
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-700 transform active:scale-[0.98] transition-all disabled:bg-green-300"
          >
            {loading ? 'Mengecek Akun...' : 'Masuk Sekarang'}
          </button>
        </form>

        {errorMsg && (
          <div className="mt-6 p-4 rounded-lg text-sm font-medium text-center bg-red-50 text-red-600">
            {errorMsg}
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-sm text-slate-600">
          Belum punya akun? <a href="/register" className="text-green-600 font-bold hover:underline">Daftar di sini</a>
        </div>
      </div>
    </div>
  )
}