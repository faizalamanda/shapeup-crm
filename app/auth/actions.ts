'use server'

import { createClient } from '@/lib/supabaseServer'
import { redirect } from 'next/navigation'

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
    return { error: error.message }
  }

  return { success: true }
}

export async function registerAction(formData: FormData) {
  const rawEmail = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('fullName') as string

  if (!rawEmail || !password || !fullName) {
    return { error: 'Semua bidang harus diisi.' }
  }

  const email = rawEmail.trim().toLowerCase()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  // Ensure profile record exists with full_name & email
  if (data.user?.id) {
    const { getAdminSupabase } = await import('@/lib/supabaseServer')
    const admin = getAdminSupabase()
    await admin.from('profiles').upsert({
      id: data.user.id,
      email: email,
      full_name: fullName,
      role: 'admin'
    }, { onConflict: 'id' })
  }

  return { success: true }
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return { success: true }
}

export async function forgotPasswordAction(formData: FormData) {
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
    origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  }

  const redirectTo = `${origin}/auth/callback?next=/reset-password`

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
        message: 'Tautan reset kata sandi sudah dikirim ke email Anda baru-baru ini. Demi keamanan, tautan hanya dapat dikirim 1 kali per menit. Silakan cek kotak masuk atau folder spam Anda.',
      }
    }
    return { error: error.message }
  }

  return { success: true }
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

