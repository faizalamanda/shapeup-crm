"use client"
import { useState, useEffect, Suspense } from 'react'
import { resetPasswordAction, forgotPasswordAction } from '@/app/auth/actions'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

function ResetPasswordForm() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  const [checkingSession, setCheckingSession] = useState(true)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [invalidReason, setInvalidReason] = useState('')
  
  // OTP Verification States
  const [otpEmail, setOtpEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(60)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState('')

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(3)

  const searchParams = useSearchParams()
  const router = useRouter()

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  useEffect(() => {
    let mounted = true
    const emailParam = searchParams.get('email')
    if (emailParam) {
      setOtpEmail(emailParam)
    }

    async function verifyAuth() {
      try {
        // Fast path: If URL has no token/code/hash, immediately display the OTP form
        const hasCode = searchParams.get('code')
        const hasTokenHash = searchParams.get('token_hash')
        const hasHash = typeof window !== 'undefined' && Boolean(window.location.hash)

        // 1. Check token_hash in query params (if opened from direct email link)
        if (hasTokenHash) {
          const recoveryType = (searchParams.get('type') || 'recovery') as any
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: hasTokenHash,
            type: recoveryType === 'recovery' ? 'recovery' : 'email',
          })
          if (!error && data?.session && mounted) {
            setIsAuthorized(true)
            setCheckingSession(false)
            return
          }
        }

        // 2. Check PKCE code in query params
        if (hasCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(hasCode)
          if (!error && mounted) {
            setIsAuthorized(true)
            setCheckingSession(false)
            return
          }
        }

        // 3. Check hash fragment (implicit recovery flow: #access_token=...)
        if (hasHash) {
          const hashClean = window.location.hash.startsWith('#')
            ? window.location.hash.slice(1)
            : window.location.hash
          const hashParams = new URLSearchParams(hashClean)

          const accessToken = hashParams.get('access_token')
          const refreshToken = hashParams.get('refresh_token')

          if (accessToken) {
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || '',
            })
            if (!error && data?.session && mounted) {
              setIsAuthorized(true)
              setCheckingSession(false)
              return
            }
          }
        }

        // 4. Check if there is already an active session
        const { data: { session } } = await supabase.auth.getSession()
        if (session && mounted) {
          setIsAuthorized(true)
          setCheckingSession(false)
          return
        }

        // 5. Also check getUser
        const { data: { user } } = await supabase.auth.getUser()
        if (user && mounted) {
          setIsAuthorized(true)
          setCheckingSession(false)
          return
        }

        if (mounted) {
          setIsAuthorized(false)
          setCheckingSession(false)
        }
      } catch (err) {
        console.error('[ResetPassword] Verification error:', err)
        if (mounted) {
          setIsAuthorized(false)
          setCheckingSession(false)
        }
      }
    }

    verifyAuth()

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        if (mounted) {
          setIsAuthorized(true)
          setCheckingSession(false)
        }
      }
    })

    return () => {
      mounted = false
      authListener?.subscription?.unsubscribe()
    }
  }, [searchParams])

  // Handle manual 6-digit OTP verification
  const handleVerifyOtpManual = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpEmail.trim()) {
      setOtpError('Silakan masukkan alamat email Anda.')
      return
    }
    const cleanCode = otpCode.replace(/\D/g, '').trim()
    if (cleanCode.length !== 6) {
      setOtpError('Kode OTP harus terdiri dari 6 digit angka.')
      return
    }

    setOtpLoading(true)
    setOtpError('')
    setResendSuccess('')

    try {
      // 1. Try verify with type: 'email' (from direct OTP signInWithOtp)
      let verifyRes = await supabase.auth.verifyOtp({
        email: otpEmail.trim().toLowerCase(),
        token: cleanCode,
        type: 'email',
      })

      // 2. Fallback to type: 'recovery' if sent via recovery mailer
      if (verifyRes.error) {
        verifyRes = await supabase.auth.verifyOtp({
          email: otpEmail.trim().toLowerCase(),
          token: cleanCode,
          type: 'recovery',
        })
      }

      if (verifyRes.error) {
        let msg = verifyRes.error.message
        if (msg.toLowerCase().includes('expired')) {
          msg = 'Kode OTP telah kedaluwarsa. Silakan kirim ulang kode baru.'
        } else if (msg.toLowerCase().includes('invalid')) {
          msg = 'Kode OTP yang Anda masukkan salah. Periksa kembali email Anda.'
        }
        setOtpError(msg)
        return
      }

      if (verifyRes.data?.session) {
        setIsAuthorized(true)
        setInvalidReason('')
      }
    } catch (err: any) {
      setOtpError(err?.message || 'Gagal memverifikasi kode OTP.')
    } finally {
      setOtpLoading(false)
    }
  }

  // Handle Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resendLoading || !otpEmail.trim()) return
    setResendLoading(true)
    setResendSuccess('')
    setOtpError('')

    try {
      const formData = new FormData()
      formData.append('email', otpEmail.trim().toLowerCase())
      const res = await forgotPasswordAction(formData)
      if (res?.error) {
        setOtpError(res.error)
      } else {
        setResendSuccess('Kode OTP baru telah dikirim ke email Anda.')
        setResendCooldown(60)
      }
    } catch (err: any) {
      setOtpError(err?.message || 'Gagal mengirim ulang kode OTP.')
    } finally {
      setResendLoading(false)
    }
  }

  useEffect(() => {
    if (!success) return
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          window.location.href = '/login'
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [success])

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setErrorMsg('')

    if (newPassword.length < 6) {
      setErrorMsg('Password baru minimal harus 6 karakter.')
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Konfirmasi password tidak cocok.')
      return
    }

    setLoading(true)

    try {
      // Direct client call to updateUser using active session
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) {
        let msg = error.message
        const lower = msg.toLowerCase()
        if (lower.includes('should be at least 6 characters')) {
          msg = 'Password minimal harus 6 karakter.'
        } else if (lower.includes('same as the old password') || lower.includes('different from the old password')) {
          msg = 'Password baru tidak boleh sama dengan password sebelumnya.'
        } else if (lower.includes('auth session missing')) {
          msg = 'Sesi pemulihan tidak ditemukan atau telah kedaluwarsa. Silakan masukkan ulang kode OTP.'
        }
        setErrorMsg(msg)
        setLoading(false)
        return
      }

      // Also call server action to ensure server cookies are in sync
      const formData = new FormData()
      formData.append('password', newPassword)
      formData.append('confirmPassword', confirmPassword)
      await resetPasswordAction(formData).catch(() => null)

      setSuccess(true)
    } catch (err: any) {
      console.error('[ResetPassword] Update error:', err)
      setErrorMsg(err?.message || 'Gagal memperbarui password. Silakan coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // Loading state while verifying token/session
  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60 text-center">
          <svg className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <h2 className="text-lg font-bold text-slate-800">Menyiapkan Pemulihan...</h2>
          <p className="text-slate-500 text-sm mt-1">Harap tunggu sebentar</p>
        </div>
      </div>
    )
  }

  // STEP 1: OTP Entry & Verification
  if (!isAuthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60 text-center">
          <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-100">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Verifikasi Kode OTP</h2>
          <p className="text-slate-500 text-xs mt-2 leading-relaxed">
            {otpEmail ? (
              <>
                Masukkan 6-digit kode OTP yang telah dikirim ke <span className="font-bold text-slate-800">{otpEmail}</span>:
              </>
            ) : (
              'Masukkan email dan 6-digit kode OTP yang telah dikirim ke email Anda:'
            )}
          </p>

          {otpError && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 text-xs font-semibold rounded-xl border border-red-100 flex items-center gap-2 text-left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{otpError}</span>
            </div>
          )}

          {resendSuccess && (
            <div className="mt-4 p-3 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-xl border border-emerald-100 flex items-center gap-2 text-left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>{resendSuccess}</span>
            </div>
          )}

          <form onSubmit={handleVerifyOtpManual} className="mt-6 space-y-4 text-left">
            {!searchParams.get('email') && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5 px-1">Alamat Email</label>
                <input
                  type="email"
                  value={otpEmail}
                  onChange={(e) => setOtpEmail(e.target.value)}
                  placeholder="nama@email.com"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none"
                  required
                />
              </div>
            )}

            <div>
              <div className="flex justify-between items-center mb-1.5 px-1">
                <label className="block text-xs font-bold text-slate-700">Kode OTP 6-Digit</label>
                <span className="text-[11px] text-slate-400 font-medium">Cek kotak masuk/spam</span>
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-center text-2xl font-black tracking-[0.35em] text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={otpLoading || otpCode.length !== 6 || !otpEmail.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-2xl text-sm shadow-xl shadow-blue-200 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer pt-3"
            >
              {otpLoading ? (
                <>
                  <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Memverifikasi Kode OTP...</span>
                </>
              ) : (
                'Verifikasi Kode & Buat Password'
              )}
            </button>
          </form>

          {/* Resend button */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resendCooldown > 0 || resendLoading}
              className="text-blue-600 hover:text-blue-700 font-bold disabled:text-slate-400 transition-colors cursor-pointer"
            >
              {resendLoading ? 'Mengirim...' : resendCooldown > 0 ? `Kirim Ulang Kode (${resendCooldown}s)` : 'Kirim Ulang Kode OTP'}
            </button>

            <Link
              href="/forgot-password"
              className="text-slate-500 hover:text-slate-700 font-medium"
            >
              Ganti Email
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60 text-center">
          <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Password Berhasil Diubah!</h2>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            Kata sandi baru Anda telah berhasil disimpan. Anda akan dialihkan ke halaman masuk dalam{' '}
            <span className="font-bold text-blue-600">{countdown} detik</span>.
          </p>

          <div className="mt-6">
            <Link
              href="/login"
              className="w-full bg-blue-600 text-white font-bold py-3.5 rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transition-all flex items-center justify-center gap-2 text-sm"
            >
              Masuk Sekarang
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isPasswordValid = newPassword.length >= 6
  const isMatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword
  const isMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200/60">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl mx-auto mb-4 shadow-lg shadow-blue-200">
            S
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Atur Ulang Password</h1>
          <p className="text-slate-500 mt-2 font-medium text-sm">
            Buat password baru yang aman untuk akun Anda
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

        <form onSubmit={handleResetPassword} className="space-y-5">
          {/* New Password */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Password Baru</label>
            <div className="relative">
              <input 
                type={showNewPassword ? 'text' : 'password'} 
                placeholder="Minimal 6 karakter"
                value={newPassword} 
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-5 py-3.5 pr-12 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all font-medium" 
                required 
                minLength={6}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                tabIndex={-1}
                aria-label={showNewPassword ? 'Sembunyikan password' : 'Lihat password'}
              >
                {showNewPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
            
            {/* Password strength bar */}
            {newPassword.length > 0 && (
              <div className="flex gap-1.5 mt-2 px-1">
                <div className={`h-1.5 flex-1 rounded-full transition-all ${newPassword.length >= 6 ? 'bg-amber-500' : 'bg-red-400'}`} />
                <div className={`h-1.5 flex-1 rounded-full transition-all ${newPassword.length >= 8 ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                <div className={`h-1.5 flex-1 rounded-full transition-all ${newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) ? 'bg-emerald-600' : 'bg-slate-200'}`} />
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Konfirmasi Password Baru</label>
            <div className="relative">
              <input 
                type={showConfirmPassword ? 'text' : 'password'} 
                placeholder="Ulangi password baru"
                value={confirmPassword} 
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-5 py-3.5 pr-12 bg-slate-50 border rounded-2xl text-slate-900 focus:ring-4 outline-none transition-all font-medium ${
                  isMismatch
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500/10'
                    : isMatch
                    ? 'border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500/10'
                    : 'border-slate-200 focus:ring-blue-500/10 focus:border-blue-500'
                }`}
                required 
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                tabIndex={-1}
                aria-label={showConfirmPassword ? 'Sembunyikan password' : 'Lihat password'}
              >
                {showConfirmPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Match hint */}
            {confirmPassword.length > 0 && (
              <p className={`text-xs mt-2 px-1 font-semibold flex items-center gap-1.5 ${isMatch ? 'text-emerald-600' : 'text-red-500'}`}>
                {isMatch ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>Password cocok</span>
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    <span>Konfirmasi password belum cocok</span>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Submit */}
          <button 
            type="submit" 
            disabled={loading || !isPasswordValid || !isMatch}
            className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-200 transform active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Menyimpan Password...</span>
              </>
            ) : (
              'Simpan Password Baru'
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

export default function ResetPassword() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="text-center font-bold text-slate-500">Memuat...</div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
