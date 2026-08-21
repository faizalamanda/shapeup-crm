"use client"
import { useState, useEffect, Suspense } from 'react'
import { loginAction } from '@/app/auth/actions'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const searchParams = useSearchParams()

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setErrorMsg(errorParam)
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')

    try {
      // 1. Try direct Supabase client login first for instant feedback & safety
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authErr) {
        setErrorMsg(authErr.message === 'Invalid login credentials' ? 'Email atau password salah.' : authErr.message)
        setLoading(false)
        return
      }

      // 2. Sync server action session cookies
      const formData = new FormData()
      formData.append('email', email)
      formData.append('password', password)

      try {
        await loginAction(formData)
      } catch (saErr) {
        console.warn('[Login] Server action sync warning:', saErr)
      }

      // 3. Clear old session caches and redirect
      if (typeof window !== 'undefined') {
        sessionStorage.clear()
      }

      const nextParam = searchParams.get('next')
      if (nextParam && nextParam.startsWith('/')) {
        window.location.href = nextParam
      } else {
        const isDismissed = localStorage.getItem('shapeup_onboarding_dismissed') === 'true'
        window.location.href = isDismissed ? '/dashboard' : '/onboarding'
      }
    } catch (err: any) {
      console.error('[Login] Login error:', err)
      setErrorMsg(err?.message || 'Terjadi kesalahan saat masuk. Silakan coba lagi.')
      setLoading(false)
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

export default function Login() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="text-center font-bold text-slate-500">Memuat...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}