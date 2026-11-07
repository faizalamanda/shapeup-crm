'use server'

import { createClient } from '@/lib/supabaseServer'
import { redirect } from 'next/navigation'

async function getAppOrigin(): Promise<string> {
  try {
    const { headers } = await import('next/headers')
    const headersList = await headers()
    const host = headersList.get('x-forwarded-host') || headersList.get('host')
    const forwardedProto = headersList.get('x-forwarded-proto')
    const isLocal = !forwardedProto && (host?.includes('localhost') || host?.includes('127.0.0.1') || process.env.NODE_ENV === 'development')
    const proto = forwardedProto || (isLocal ? 'http' : 'https')
    if (host) {
      return `${proto}://${host}`
    }
  } catch {}
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
}

export async function loginAction(formData: FormData) {
  const rawEmail = formData.get('email') as string
  const password = formData.get('password') as string

  if (!rawEmail || !password) {
    return { error: 'Email dan password harus diisi.' }
  }

  const email = rawEmail.trim().toLowerCase()
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    const errorMsg = error.message?.toLowerCase() || ''
    const isUnconfirmed = errorMsg.includes('email not confirmed') || (error as any).code === 'email_not_confirmed'

    if (isUnconfirmed || error.message === 'Invalid login credentials') {
      let isActuallyUnconfirmed = isUnconfirmed
      let targetEmail = email

      if (!isActuallyUnconfirmed) {
        // Check if user actually exists and is unconfirmed to provide clear feedback
        try {
          const { getAdminSupabase } = await import('@/lib/supabaseServer')
          const admin = getAdminSupabase()
          const { data: userData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
          const existingUser = userData?.users?.find(u => u.email?.toLowerCase() === email)
          if (existingUser && !existingUser.email_confirmed_at) {
            isActuallyUnconfirmed = true
            targetEmail = (existingUser.email || email).trim().toLowerCase()
          }
        } catch (e) {
          console.warn('[loginAction] Admin user check failed:', e)
        }
      }

      if (isActuallyUnconfirmed) {
        // Otomatis kirim ulang email autentikasi/verifikasi
        let alreadySent = false
        try {
          const origin = await getAppOrigin()
          const { getAdminSupabase } = await import('@/lib/supabaseServer')
          const admin = getAdminSupabase()
          const resendClient = (admin && admin.auth) ? admin : supabase

          const { error: resendErr } = await resendClient.auth.resend({
            type: 'signup',
            email: targetEmail,
            options: {
              emailRedirectTo: `${origin}/auth/callback`,
            },
          })
          if (resendErr) {
            const rMsg = resendErr.message?.toLowerCase() || ''
            const rCode = (resendErr as any).code || ''
            if (
              rCode === 'over_email_send_rate_limit' ||
              rMsg.includes('for security purposes') ||
              rMsg.includes('60 seconds')
            ) {
              alreadySent = true
            }
          }
        } catch (resendCatch) {
          console.warn('[loginAction] Auto-resend verification error:', resendCatch)
        }

        return {
          unconfirmed: true,
          email: targetEmail,
          error: alreadySent
            ? 'Akun Anda belum dikonfirmasi. Tautan verifikasi baru saja dikirimkan sebelumnya. Harap periksa kotak masuk atau FOLDER SPAM email Anda.'
            : 'Akun Anda belum dikonfirmasi. Tautan verifikasi baru telah otomatis kami kirimkan ke email Anda. Harap periksa kotak masuk atau FOLDER SPAM email Anda.',
        }
      }

      return { error: 'Email atau password salah.' }
    }

    return { error: error.message }
  }

  return { success: true }
}

export async function resendVerificationAction(rawEmail: string) {
  if (!rawEmail) {
    return { error: 'Email harus diisi.' }
  }
  const email = rawEmail.trim().toLowerCase()
  const supabase = await createClient()

  try {
    const origin = await getAppOrigin()
    const { getAdminSupabase } = await import('@/lib/supabaseServer')
    const admin = getAdminSupabase()
    const resendClient = (admin && admin.auth) ? admin : supabase

    const { error } = await resendClient.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    })

    if (error) {
      const errorMsg = error.message?.toLowerCase() || ''
      const errorCode = (error as any).code || ''
      if (
        errorCode === 'over_email_send_rate_limit' ||
        errorMsg.includes('for security purposes') ||
        errorMsg.includes('60 seconds')
      ) {
        return {
          success: true,
          alreadySent: true,
          message: 'Tautan verifikasi sudah dikirimkan baru-baru ini. Silakan periksa kotak masuk atau FOLDER SPAM Anda.',
        }
      }
      return { error: error.message }
    }

    return {
      success: true,
      message: 'Tautan verifikasi baru berhasil dikirim. Silakan periksa kotak masuk atau FOLDER SPAM Anda.',
    }
  } catch (err: any) {
    return { error: err?.message || 'Gagal mengirim ulang tautan verifikasi.' }
  }
}

export async function registerAction(formData: FormData) {
  const rawEmail = formData.get('email') as string
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string
  const fullName = formData.get('fullName') as string

  if (!rawEmail || !password || !fullName) {
    return { error: 'Semua bidang harus diisi.' }
  }

  if (confirmPassword && password !== confirmPassword) {
    return { error: 'Konfirmasi password tidak cocok.' }
  }

  if (password.length < 8) {
    return { error: 'Password minimal harus 8 karakter.' }
  }

  const email = rawEmail.trim().toLowerCase()
  const supabase = await createClient()
  const origin = await getAppOrigin()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // Supabase returns an empty identities array if a user with this email already exists
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    try {
      const { getAdminSupabase } = await import('@/lib/supabaseServer')
      const admin = getAdminSupabase()
      const { data: userData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const existingUser = userData?.users?.find(u => u.email?.toLowerCase() === email)
      if (existingUser && !existingUser.email_confirmed_at) {
        // Otomatis kirim ulang verifikasi ke pemilik email
        try {
          await supabase.auth.resend({
            type: 'signup',
            email,
            options: {
              emailRedirectTo: `${origin}/auth/callback`,
            },
          })
        } catch (resendErr) {
          console.warn('[registerAction] Resend to unconfirmed user warning:', resendErr)
        }

        return {
          error: 'Email ini sudah terdaftar sebelumnya namun belum diverifikasi. Tautan verifikasi baru telah kami kirimkan ke email Anda. Harap periksa kotak masuk atau FOLDER SPAM / PROMOSI untuk mengaktifkan akun Anda.'
        }
      }
    } catch (e) {
      console.warn('[registerAction] Existing user check error:', e)
    }

    return { error: 'Email ini sudah terdaftar. Silakan langsung masuk atau gunakan fitur Lupa Password jika Anda lupa kata sandi.' }
  }

  // Ensure profile record exists with full_name & email
  if (data?.user?.id) {
    const { getAdminSupabase } = await import('@/lib/supabaseServer')
    const admin = getAdminSupabase()
    await admin.from('profiles').upsert({
      id: data.user.id,
      email: email,
      full_name: fullName,
      role: 'admin'
    }, { onConflict: 'id' })
  }

  return { 
    success: true,
    requiresConfirmation: !data?.session
  }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return { success: true }
}

export async function forgotPasswordAction(formData: FormData) {
  try {
    const rawEmail = formData.get('email') as string
    if (!rawEmail) {
      return { error: 'Email harus diisi.' }
    }

    const email = rawEmail.trim().toLowerCase()
    const supabase = await createClient()

    let origin = ''
    try {
      const { headers } = await import('next/headers')
      const headersList = await headers()
      const host = headersList.get('x-forwarded-host') || headersList.get('host')
      const forwardedProto = headersList.get('x-forwarded-proto')
      const isLocal = !forwardedProto && (host?.includes('localhost') || host?.includes('127.0.0.1') || process.env.NODE_ENV === 'development')
      const proto = forwardedProto || (isLocal ? 'http' : 'https')
      if (host) {
        origin = `${proto}://${host}`
      }
    } catch (e) {
      // fallback if headers() fails in environment
    }

    if (!origin) {
      origin = process.env.NEXT_PUBLIC_SITE_URL || 'https://shapeup-crm.vercel.app'
    }

    const redirectTo = `${origin}/reset-password?email=${encodeURIComponent(email)}`

    // Uses recovery mailer template (recovery.html) and redirects directly to /reset-password
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })

    if (error) {
      const errorMsg = error.message?.toLowerCase() || ''
      const errorCode = (error as any).code || ''
      if (
        errorCode === 'over_email_send_rate_limit' ||
        errorMsg.includes('for security purposes') ||
        errorMsg.includes('60 seconds')
      ) {
        return {
          success: true,
          alreadySent: true,
          email,
          message: 'Kode OTP baru saja dikirim ke email Anda. Silakan cek kotak masuk atau folder spam Anda.',
        }
      }

      const rawMsg = String(error.message || '').trim()
      if (!rawMsg || rawMsg === '{}' || rawMsg === '[object Object]') {
        return { success: true, email }
      }

      return { error: rawMsg }
    }

    return { success: true, email }
  } catch (err: any) {
    console.error('[forgotPasswordAction] Unexpected error:', err)
    const rawMsg = String(err?.message || '').trim()
    if (!rawMsg || rawMsg === '{}' || rawMsg === '[object Object]') {
      return { success: true }
    }
    return { error: rawMsg || 'Terjadi kesalahan saat memproses permintaan OTP.' }
  }
}

export async function resetPasswordAction(formData: FormData) {
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string

  if (!password || !confirmPassword) {
    return { error: 'Password baru dan konfirmasi password harus diisi.' }
  }

  if (password.length < 6) {
    return { error: 'Password minimal harus 6 karakter.' }
  }

  if (password !== confirmPassword) {
    return { error: 'Konfirmasi password tidak cocok.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

