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
