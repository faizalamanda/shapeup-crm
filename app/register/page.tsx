"use client"
import { useState } from 'react'
import { registerAction } from '@/app/auth/actions'
import { useRouter } from 'next/navigation'

const features = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    text: 'Kelola data customer dalam satu tempat',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    text: 'Pantau performa bisnis secara real-time',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    text: 'Lihat riwayat order kapan saja',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
    text: 'Follow up pelanggan lebih mudah & tepat sasaran',
  },
]

export default function Register() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const router = useRouter()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg('')
    setSuccessMsg('')

    const formData = new FormData()
    formData.append('email', email)
    formData.append('password', password)
    formData.append('fullName', fullName)

    const res = await registerAction(formData)

    if (res?.error) {
      setErrorMsg(res.error)
    } else {
      setSuccessMsg('Akun berhasil dibuat! Cek email Anda untuk konfirmasi, lalu masuk ke dashboard.')
      setTimeout(() => router.push('/login'), 3000)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--su-bg)', fontFamily: "'Inter', system-ui, sans-serif" }}>
      
      {/* ── Left Panel: Marketing ── */}
      <div
        className="hidden lg:flex lg:w-1/2 xl:w-[55%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 60%, #1D4ED8 100%)' }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />

        {/* Decorative blobs */}
        <div style={{
          position: 'absolute', top: '-80px', right: '-80px',
          width: '360px', height: '360px',
          background: 'radial-gradient(circle, rgba(59,130,246,0.25) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{
          position: 'absolute', bottom: '-60px', left: '-60px',
          width: '280px', height: '280px',
          background: 'radial-gradient(circle, rgba(245,158,11,0.15) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div style={{
              width: 40, height: 40,
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(8px)',
              borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid rgba(255,255,255,0.2)',
              fontWeight: 900, fontSize: 18, color: '#fff',
            }}>
              S
            </div>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>
              ShapeUp
            </span>
          </div>
        </div>

        {/* Main Copy */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 99, padding: '4px 14px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
              <span style={{ color: '#FCD34D', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                CRM untuk Bisnis Anda
              </span>
            </div>

            <h1 style={{
              fontSize: 'clamp(28px, 3.5vw, 44px)',
              fontWeight: 900,
              color: '#fff',
              lineHeight: 1.15,
              letterSpacing: '-0.03em',
              margin: 0,
            }}>
              Bisnis Anda punya{' '}
              <span style={{
                background: 'linear-gradient(90deg, #60A5FA, #A78BFA)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                customer.
              </span>
              <br />
              ShapeUp bantu mereka{' '}
              <span style={{
                background: 'linear-gradient(90deg, #FCD34D, #F97316)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                kembali.
              </span>
            </h1>

            <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16, lineHeight: 1.7, maxWidth: 420, margin: 0 }}>
              Kelola data customer, lihat riwayat order, pantau performa bisnis, dan follow up pelanggan dari satu dashboard yang mudah dipahami.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-3">
            {features.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3"
                style={{
                  animation: `su-fade-in 0.4s ease forwards`,
                  animationDelay: `${i * 80}ms`,
                  opacity: 0,
                }}
              >
                <div style={{
                  width: 36, height: 36, flexShrink: 0,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#93C5FD',
                }}>
                  {f.icon}
                </div>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 500 }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer quote */}
        <div className="relative z-10">
          <div style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            padding: '16px 20px',
            backdropFilter: 'blur(8px)',
          }}>
            <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>
              "ShapeUp membantu kami mengelola ratusan customer dengan jauh lebih teratur. Kami bisa tahu siapa yang perlu di-follow up hari ini tanpa harus buka spreadsheet."
            </p>
            <div className="flex items-center gap-2 mt-3">
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800, color: '#fff',
              }}>
                A
              </div>
              <div>
                <div style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>Ahmad Fauzan</div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>Pemilik Toko Online, Jakarta</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Form ── */}
      <div className="w-full lg:w-1/2 xl:w-[45%] flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[420px] su-fade-in">

          {/* Mobile-only marketing header */}
          <div className="block lg:hidden mb-8">
            {/* Logo */}
            <div className="flex items-center gap-2 mb-6">
              <div style={{
                width: 36, height: 36,
                background: 'var(--su-primary)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, fontSize: 16, color: '#fff',
              }}>
                S
              </div>
              <span style={{ fontWeight: 800, fontSize: 17, color: 'var(--su-text)', letterSpacing: '-0.02em' }}>
                ShapeUp
              </span>
            </div>

            {/* Headline */}
            <h1 style={{
              fontSize: 26, fontWeight: 900, lineHeight: 1.2,
              letterSpacing: '-0.03em', color: 'var(--su-text)',
              margin: '0 0 10px 0',
            }}>
              Bisnis Anda punya{' '}
              <span style={{
                background: 'linear-gradient(90deg, #2563EB, #7C3AED)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                customer.
              </span>
              <br />
              ShapeUp bantu mereka{' '}
              <span style={{
                background: 'linear-gradient(90deg, #D97706, #EA580C)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>
                kembali.
              </span>
            </h1>

            {/* Subheadline */}
            <p style={{
              fontSize: 14, color: 'var(--su-text-muted)',
              lineHeight: 1.65, margin: 0,
            }}>
              Kelola data customer, lihat riwayat order, pantau performa bisnis, dan follow up pelanggan dari satu dashboard yang mudah dipahami.
            </p>

            {/* Divider */}
            <div style={{ height: 1, background: 'var(--su-border)', margin: '20px 0' }} />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 style={{
              fontSize: 28, fontWeight: 900, color: 'var(--su-text)',
              letterSpacing: '-0.03em', margin: 0, lineHeight: 1.2,
            }}>
              Mulai Sekarang
            </h2>
            <p style={{ color: 'var(--su-text-muted)', marginTop: 8, fontSize: 15, lineHeight: 1.6 }}>
              Buat akun gratis dan kelola bisnis Anda dengan lebih cerdas.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleRegister} className="space-y-4">

            {/* Full Name */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: 'var(--su-text)', marginBottom: 6, letterSpacing: '0.02em',
              }}>
                Nama Lengkap
              </label>
              <input
                type="text"
                id="fullName"
                placeholder="contoh: Ahmad Fauzan"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                style={{
                  width: '100%', padding: '12px 16px',
                  background: '#FAFAF8',
                  border: '1.5px solid var(--su-border)',
                  borderRadius: 10, fontSize: 14, fontWeight: 500,
                  color: 'var(--su-text)', outline: 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'var(--su-primary)'
                  e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.08)'
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'var(--su-border)'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Email */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: 'var(--su-text)', marginBottom: 6, letterSpacing: '0.02em',
              }}>
                Alamat Email
              </label>
              <input
                type="email"
                id="email"
                placeholder="nama@bisnis.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{
                  width: '100%', padding: '12px 16px',
                  background: '#FAFAF8',
                  border: '1.5px solid var(--su-border)',
                  borderRadius: 10, fontSize: 14, fontWeight: 500,
                  color: 'var(--su-text)', outline: 'none',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={e => {
                  e.target.style.borderColor = 'var(--su-primary)'
                  e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.08)'
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'var(--su-border)'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 700,
                color: 'var(--su-text)', marginBottom: 6, letterSpacing: '0.02em',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  placeholder="Minimal 8 karakter"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  style={{
                    width: '100%', padding: '12px 48px 12px 16px',
                    background: '#FAFAF8',
                    border: '1.5px solid var(--su-border)',
                    borderRadius: 10, fontSize: 14, fontWeight: 500,
                    color: 'var(--su-text)', outline: 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = 'var(--su-primary)'
                    e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.08)'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--su-border)'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--su-text-faint)', padding: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--su-text-faint)', marginTop: 5, fontWeight: 500 }}>
                Minimal 8 karakter
              </p>
            </div>

            {/* Password strength */}
            {password.length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: -8 }}>
                {[1, 2, 3].map(level => {
                  const strength = password.length >= 12 ? 3 : password.length >= 8 ? 2 : 1
                  return (
                    <div key={level} style={{
                      flex: 1, height: 3, borderRadius: 99,
                      background: level <= strength
                        ? strength === 1 ? '#EF4444' : strength === 2 ? '#F59E0B' : '#16A34A'
                        : 'var(--su-border)',
                      transition: 'background 0.25s',
                    }} />
                  )
                })}
              </div>
            )}

            {/* Error */}
            {errorMsg && (
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'var(--su-danger-light)',
                border: '1px solid rgba(220,38,38,0.15)',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--su-danger)', lineHeight: 1.5 }}>
                  {errorMsg}
                </span>
              </div>
            )}

            {/* Success */}
            {successMsg && (
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: 'var(--su-success-light)',
                border: '1px solid rgba(22,163,74,0.15)',
                display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--su-success)', lineHeight: 1.5 }}>
                  {successMsg}
                </span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              id="register-submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '13px 20px',
                background: loading ? '#93C5FD' : 'var(--su-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 800,
                letterSpacing: '0.02em',
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(37,99,235,0.35)',
                transform: 'translateY(0)',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
              onMouseEnter={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--su-primary-dark)'
                  ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(37,99,235,0.4)'
                }
              }}
              onMouseLeave={e => {
                if (!loading) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--su-primary)'
                  ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(37,99,235,0.35)'
                }
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff', borderRadius: '50%',
                    animation: 'su-spin 0.8s linear infinite',
                  }} />
                  Membuat Akun...
                </>
              ) : (
                'Mulai Sekarang →'
              )}
            </button>
          </form>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            margin: '24px 0', color: 'var(--su-text-faint)',
          }}>
            <div style={{ flex: 1, height: 1, background: 'var(--su-border)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              atau
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--su-border)' }} />
          </div>

          {/* Sign in link */}
          <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--su-text-muted)', fontWeight: 500 }}>
            Sudah punya akun?{' '}
            <a
              href="/login"
              style={{
                color: 'var(--su-primary)',
                fontWeight: 700,
                textDecoration: 'none',
                borderBottom: '1.5px solid transparent',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderBottomColor = 'var(--su-primary)')}
              onMouseLeave={e => (e.currentTarget.style.borderBottomColor = 'transparent')}
            >
              Masuk ke akun Anda
            </a>
          </p>

          {/* Terms */}
          <p style={{
            textAlign: 'center', fontSize: 11,
            color: 'var(--su-text-faint)', marginTop: 20, lineHeight: 1.6,
          }}>
            Dengan mendaftar, Anda menyetujui{' '}
            <a href="#" style={{ color: 'var(--su-text-muted)', fontWeight: 600 }}>Syarat & Ketentuan</a>
            {' '}dan{' '}
            <a href="#" style={{ color: 'var(--su-text-muted)', fontWeight: 600 }}>Kebijakan Privasi</a>{' '}
            kami.
          </p>
        </div>
      </div>
    </div>
  )
}