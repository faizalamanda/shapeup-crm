---
name: "Auth Lifecycle & Password Integrity"
description: "Standar otentikasi, konsistensi password registrasi vs login, disambiguasi akun email belum dikonfirmasi, deteksi obfuscated sign-up, serta sanitasi keyboard mobile."
---

# Auth Lifecycle & Password Integrity Architecture — ShapeUp CRM

Panduan arsitektur dan standar implementasi untuk alur pendaftaran (*Sign Up*), masuk (*Sign In*), pemulihan kata sandi (*Recovery/Reset Password*), serta pencegahan disparitas password antara register dan login.

---

## 🎯 Masalah Umum & Akar Penyebab Disparitas Password

Di masa lalu, pengguna sering melaporkan bahwa password saat login **"tidak cocok"** dengan yang baru saja dibuat saat pendaftaran. Setelah audit mendalam, ditemukan 4 akar penyebab teknis:

1. **Email Confirmation Masking (`Invalid login credentials`):**
   Supabase Auth mengembalikan error `Invalid login credentials` (atau `Email not confirmed`) saat pengguna mencoba login dengan akun yang belum dikonfirmasi via email. Frontend yang memetakan error ini menjadi `"Email atau password salah"` membuat pengguna mengira password yang diketik salah.
2. **Ketiadaan Konfirmasi Password di Form Registrasi:**
   Form pendaftaran tanpa kolom `Konfirmasi Password` membuat kesalahan ketik (*typo*) tidak terdeteksi saat mendaftar, sehingga gagal saat login dengan password yang diniatkan.
3. **Supabase Obfuscated Sign-Up (Email Sudah Ada):**
   Jika email sudah terdaftar, `supabase.auth.signUp()` tidak melempar error (untuk mencegah *user enumeration*), melainkan mengembalikan `data.user.identities: []` tanpa memperbarui password lama. Pengguna mengira akun baru berhasil dibuat dengan password baru.
4. **Mobile Keyboard Auto-Casing & Auto-Correction:**
   Ketika tombol mata (*Show Password*) ditekan, input berubah menjadi `type="text"`. Pada keyboard ponsel (Android/iOS), hal ini memicu otomatisasi huruf kapital pertama (*Sentence Case*) atau spasi otomatis, menyebabkan password yang didaftarkan berbeda dengan yang diketik saat login.

---

## 🛡️ Standar Implementasi Wajib

### 1. `registerAction` (`app/auth/actions.ts`)

```typescript
export async function registerAction(formData: FormData) {
  const rawEmail = formData.get('email') as string
  const password = formData.get('password') as string
  const confirmPassword = formData.get('confirmPassword') as string
  const fullName = formData.get('fullName') as string

  if (!rawEmail || !password || !fullName) {
    return { error: 'Semua bidang harus diisi.' }
  }

  // Wajib validasi kecocokan password
  if (confirmPassword && password !== confirmPassword) {
    return { error: 'Konfirmasi password tidak cocok.' }
  }

  // Standar panjang password register: minimal 8 karakter
  if (password.length < 8) {
    return { error: 'Password minimal harus 8 karakter.' }
  }

  const email = rawEmail.trim().toLowerCase()
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback`,
    },
  })

  if (error) return { error: error.message }

  // ⚠️ WAJIB: Deteksi akun yang sudah terdaftar via identities kosong
  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: 'Email ini sudah terdaftar. Silakan langsung masuk atau gunakan fitur Lupa Password jika Anda lupa kata sandi.' }
  }

  // Upsert profile record
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
```

---

### 2. `loginAction` (`app/auth/actions.ts`) — Disambiguasi Akun Unconfirmed

```typescript
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
    if (errorMsg.includes('email not confirmed') || (error as any).code === 'email_not_confirmed') {
      return { error: 'Akun belum dikonfirmasi. Silakan buka kotak masuk atau spam email Anda untuk mengklik tautan konfirmasi terlebih dahulu.' }
    }

    if (error.message === 'Invalid login credentials') {
      // Periksa apakah akun user sebenarnya ada tapi belum dikonfirmasi
      try {
        const { getAdminSupabase } = await import('@/lib/supabaseServer')
        const admin = getAdminSupabase()
        const { data: userData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        const existingUser = userData?.users?.find(u => u.email?.toLowerCase() === email)
        if (existingUser && !existingUser.email_confirmed_at) {
          return { error: 'Akun belum dikonfirmasi. Silakan buka kotak masuk atau folder spam email Anda dan klik tautan verifikasi sebelum masuk.' }
        }
      } catch {
        // Fallback anggun
      }
      return { error: 'Email atau password salah.' }
    }

    return { error: error.message }
  }

  return { success: true }
}
```

---

### 3. Sanitasi Atribut Input Keyboard Mobile (UI)

Di seluruh halaman otentikasi (`/login`, `/register`, `/reset-password`):

```tsx
<input
  type={showPassword ? 'text' : 'password'}
  id="password"
  name="password"
  autoComplete="new-password" // atau "current-password" pada login
  autoCapitalize="none"
  autoCorrect="off"
  spellCheck={false}
  placeholder="Minimal 8 karakter"
  value={password}
  onChange={e => setPassword(e.target.value)}
  required
/>
```

---

### 4. Indikator Kecocokan Konfirmasi Password Real-Time

Di `/register` dan `/reset-password`, sediakan indikator visual langsung saat pengguna mengetik:

```tsx
{confirmPassword.length > 0 && (
  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
    {confirmPassword === password ? (
      <span style={{ color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>
        ✓ Password cocok
      </span>
    ) : (
      <span style={{ color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
        ✕ Konfirmasi password tidak cocok
      </span>
    )}
  </div>
)}
```
