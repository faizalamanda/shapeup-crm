/**
 * ShapeUp CRM — Platform Superadmin Access Control
 * 
 * Memastikan data makro platform (GMV seluruh toko, MAU, dan MRR)
 * HANYA dapat diakses oleh Pemilik Platform / Tim Internal Pengembang,
 * BUKAN oleh admin toko (tenant/merchant) biasa.
 */

export const DEFAULT_PLATFORM_SUPERADMINS: string[] = [
  'alamandatoko@gmail.com',
]

/**
 * Mendapatkan daftar email yang memiliki akses ke level Superadmin / Platform Owner.
 * Mendukung penambahan email via env variable:
 * NEXT_PUBLIC_PLATFORM_SUPERADMIN_EMAILS="email1@domain.com,email2@domain.com"
 */
export function getPlatformSuperadminEmails(): string[] {
  const envPublic = process.env.NEXT_PUBLIC_PLATFORM_SUPERADMIN_EMAILS
  const envPrivate = typeof process !== 'undefined' ? process.env.PLATFORM_SUPERADMIN_EMAILS : undefined

  const raw = [envPublic, envPrivate].filter(Boolean).join(',')
  const customList = raw
    ? raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : []

  return Array.from(new Set([...DEFAULT_PLATFORM_SUPERADMINS.map(e => e.toLowerCase()), ...customList]))
}

/**
 * Helper untuk memeriksa apakah user yang sedang aktif adalah Platform Superadmin.
 */
export function isPlatformSuperadmin(email?: string | null): boolean {
  if (!email) return false
  const cleanEmail = email.trim().toLowerCase()
  const list = getPlatformSuperadminEmails()
  return list.includes(cleanEmail)
}
