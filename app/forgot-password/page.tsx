"use client"
import { useState, useEffect, useRef, Suspense } from 'react'
import { forgotPasswordAction } from '@/app/auth/actions'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [loadingStep, setLoadingStep] = useState(0)
  const isSubmittingRef = useRef(false)
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    let timer: any
    if (loading) {
      setLoadingStep(0)
      timer = setTimeout(() => {
        setLoadingStep(1)
      }, 2500)
    } else {
      setLoadingStep(0)
    }
    return () => clearTimeout(timer)
  }, [loading])

  useEffect(() => {
    const errorParam = searchParams.get('error')
    if (errorParam) {
      setErrorMsg(errorParam)
    }
  }, [searchParams])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!email || isSubmittingRef.current || loading || cooldown > 0) return

    isSubmittingRef.current = true
    setLoading(true)
    setErrorMsg('')

    try {
      const formData = new FormData()
      formData.append('email', email)

      const res = await forgotPasswordAction(formData)

      if (res?.error) {
        const rawMsg = String(res.error).trim()
        let msg = rawMsg
        const lower = msg.toLowerCase()
        if (lower.includes('tidak ditemukan') || lower.includes('user not found')) {
          msg = 'Akun dengan alamat email ini tidak ditemukan.'
        } else if (lower.includes('for security purposes') || lower.includes('rate limit') || lower.includes('60 seconds')) {
          // If rate limited, Supabase already sent OTP, redirect directly to verify
          router.push(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`)
          return
        } else if (lower.includes('invalid email')) {
          msg = 'Format alamat email tidak valid.'
        }
        setErrorMsg(msg)
        setLoading(false)
        return
      }

      // Success or alreadySent: Redirect directly to OTP verification page
      router.push(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`)
    } catch (err: any) {
      console.error('[ForgotPassword] Error:', err)
      const rawMsg = String(err?.message || '').trim()
      setErrorMsg(rawMsg || 'Terjadi kesalahan saat mengirim kode OTP.')
    } finally {
      setLoading(false)
      isSubmittingRef.current = false
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60">
        
        {/* Brand Icon & Heading */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-4 shadow-lg shadow-blue-200">
            S
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Lupa Password?</h1>
          <p className="text-slate-500 mt-2 font-medium text-sm">
            Masukkan email akun Anda untuk menerima 6-digit kode OTP pemulihan kata sandi.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 rounded-2xl text-sm font-bold text-center bg-red-50 text-red-600 border border-red-100 flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Alamat Email</label>
            <div className="relative">
              <input 
                type="email" 
                placeholder="nama@bisnis.com"
                value={email} 
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium disabled:opacity-60 disabled:cursor-not-allowed" 
                required 
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-400 mt-2 px-1">
              Kami akan mengirimkan 6-digit kode OTP langsung ke kotak masuk Anda.
            </p>
          </div>

          <button 
            type="submit" 
            disabled={loading || !email.trim()}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transform active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{loadingStep === 1 ? 'Menghubungkan ke email...' : 'Mengirim Kode OTP...'}</span>
              </>
            ) : (
              'Kirim Kode OTP & Lanjutkan'
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-sm font-medium text-slate-600">
          <Link href="/login" className="inline-flex items-center gap-1.5 text-blue-600 font-bold hover:underline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            <span>Kembali ke Halaman Masuk</span>
          </Link>
        </div>

      </div>
    </div>
  )
}

export default function ForgotPassword() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="text-center font-bold text-slate-500">Memuat...</div>
      </div>
    }>
      <ForgotPasswordForm />
    </Suspense>
  )
}
