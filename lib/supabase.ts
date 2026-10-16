import { createBrowserClient } from '@supabase/ssr'

function getUrlString(url: RequestInfo | URL): string {
  if (typeof url === 'string') return url
  if (url instanceof URL) return url.toString()
  if (url && typeof (url as any).url === 'string') return (url as any).url
  try {
    return String(url || '')
  } catch {
    return ''
  }
}

async function authFetchWithRetry(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const urlStr = getUrlString(url)
  // Email operations (/recover, /signup, /otp, /invite, /resend, /magiclink) require time for SMTP handshake
  // and must NEVER be retried automatically to prevent triggering Supabase's strict 60s rate limit.
  const isEmailMutation =
    urlStr.includes('/recover') ||
    urlStr.includes('/signup') ||
    urlStr.includes('/otp') ||
    urlStr.includes('/invite') ||
    urlStr.includes('/resend') ||
    urlStr.includes('/magiclink')
  const timeoutMs = isEmailMutation ? 15000 : 6000
  const maxRetries = isEmailMutation ? 0 : 2
  let delay = 200

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort())
      }

      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)

      if (urlStr.includes('/auth/v1/') && res.status >= 500 && attempt < maxRetries) {
        console.warn(`[SupabaseAuth] Auth API returned status ${res.status}. Retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
        delay *= 1.5
        continue
      }

      return res
    } catch (err: any) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay))
        delay *= 1.5
        continue
      }
      throw err
    }
  }

  return fetch(url, options)
}

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      fetch: authFetchWithRetry,
    },
    cookieOptions: {
      maxAge: 31536000, // 1 year (365 days)
      sameSite: 'lax',
      path: '/',
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  }
)