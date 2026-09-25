import { createBrowserClient } from '@supabase/ssr'

async function authFetchWithRetry(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
  const maxRetries = 2
  let delay = 200

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort())
      }

      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId)

      const urlStr = typeof url === 'string' ? url : url.toString()
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