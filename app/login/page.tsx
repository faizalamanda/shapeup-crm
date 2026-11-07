"use client"
import { useState, useEffect, Suspense } from 'react'
import { loginAction, resendVerificationAction } from '@/app/auth/actions'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null)
  const [unconfirmedMsg, setUnconfirmedMsg] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendNotice, setResendNotice] = useState<string | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setErrorMsg(errorParam)
    }
  }, [searchParams])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown > 0])

  const handleResend = async () => {
    if (!unconfirmedEmail || resendCooldown > 0 || resendLoading) return
    setResendLoading(true)
    setResendNotice(null)
    try {
      const res = await resendVerificationAction(unconfirmedEmail)
      if (res?.error) {
        setResendNotice(`Gagal: ${res.error}`)
      } else {
        setResendNotice(res?.message || 'Tautan verifikasi baru berhasil dikirim!')
        setResendCooldown(60)
      }
    } catch (err: any) {
      setResendNotice(err?.message || 'Gagal mengirim ulang tautan verifikasi.')
    } finally {
      setResendLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setUnconfirmedEmail(null)
    setUnconfirmedMsg(null)
    setResendNotice(null)

    try {
      const formData = new FormData()
      formData.append('email', email)
      formData.append('password', password)

      const res = await loginAction(formData)

      if (res?.unconfirmed) {
        setUnconfirmedEmail(res.email || email)
        setUnconfirmedMsg(res.error || 'Akun Anda belum dikonfirmasi.')
        setResendCooldown(60)
        setLoading(false)
        return
      }

      if (res?.error) {
        setErrorMsg(res.error === 'Invalid login credentials' ? 'Email atau password salah.' : res.error)
        setLoading(false)
        return
      }

      // Clear old stale local caches
      if (typeof window !== 'undefined') {
        sessionStorage.clear()
        if (window.localStorage) {
          const keysToRemove: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && (key.startsWith('su_dash_') || key.startsWith('cache_'))) {
              keysToRemove.push(key)
            }
          }
          keysToRemove.forEach(k => localStorage.removeItem(k))
        }
      }

      // Immediate redirect
      const nextParam = searchParams.get('next')
      if (nextParam && nextParam.startsWith('/')) {
        window.location.href = nextParam
      } else {
        const isDismissed = localStorage.getItem('shapeup_onboarding_dismissed') === 'true'
        window.location.href = isDismissed ? '/dashboard' : '/onboarding'
      }
    } catch (err: any) {
      console.error('[Login] Login error:', err)
      // Deteksi versi usang saat deploy (deployment skew)
      if (err?.message?.includes('Server Action') || err?.message?.includes('was not found on the server')) {
        setErrorMsg('Aplikasi baru saja diperbarui di server. Memuat ulang halaman...')
        setTimeout(() => {
          window.location.reload()
        }, 1200)
        return
      }
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
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium" 
              required 
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <label className="block text-sm font-bold text-slate-700">Password</label>
              <Link 
                href="/forgot-password" 
                className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
              >
                Lupa Password?
              </Link>
            </div>
            <div className="relative">
              <input 
                type={showPassword ? 'text' : 'password'} 
                placeholder="••••••••"
                value={password} 
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full px-5 py-3.5 pr-12 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium" 
                required 
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                tabIndex={-1}
                aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transform active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Mengecek Akun & Memuat Data...</span>
              </>
            ) : 'Masuk Sekarang'}
          </button>
        </form>

        {unconfirmedEmail && (
          <div className="mt-6 p-5 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-950 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 text-lg shrink-0 mt-0.5">
                ✉️
              </div>
              <div className="flex-1 text-left">
                <h4 className="font-extrabold text-sm text-amber-950 mb-1">
                  Akun Belum Dikonfirmasi
                </h4>
                <p className="text-xs text-amber-900 leading-relaxed font-medium">
                  {unconfirmedMsg || (
                    <>Tautan aktivasi baru telah otomatis dikirimkan ke <strong>{unconfirmedEmail}</strong>.</>
                  )}
                </p>

                <div className="mt-3 p-3 bg-white/80 rounded-xl border border-amber-200/70 text-xs text-amber-900 shadow-xs">
                  <div className="text-amber-950 flex items-center gap-1.5 mb-1 font-bold">
                    <span>⚠️</span>
                    <span>PENTING: Periksa Folder Spam</span>
                  </div>
                  <p className="text-amber-800/90 leading-relaxed">
                    Jika tidak ada di Kotak Masuk (Inbox), silakan periksa folder <strong>Spam</strong>, <strong>Junk</strong>, atau tab <strong>Promosi</strong> email Anda, lalu klik tautan tersebut untuk mengaktifkan akun.
                  </p>
                </div>

                {resendNotice && (
                  <div className="mt-2.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">
                    {resendNotice}
                  </div>
                )}

                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCooldown > 0 || resendLoading}
                    className="text-xs font-bold px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-xl transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 shadow-sm shadow-amber-200"
                  >
                    {resendLoading ? (
                      'Mengirim...'
                    ) : resendCooldown > 0 ? (
                      `Kirim Ulang (${resendCooldown}s)`
                    ) : (
                      'Kirim Ulang Email'
                    )}
                  </button>
                  <span className="text-[11px] text-amber-700/80 font-medium">
                    {resendCooldown > 0 ? 'Tunggu 1 menit sebelum meminta lagi' : 'Belum menerima email?'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {errorMsg && !unconfirmedEmail && (
          <div className="mt-6 p-4 rounded-2xl text-sm font-bold text-center bg-red-50 text-red-600 border border-red-100">
            {errorMsg}
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-sm font-medium text-slate-600">
          Belum punya akun? <Link href="/register" className="text-blue-600 font-bold hover:underline">Daftar di sini</Link>
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