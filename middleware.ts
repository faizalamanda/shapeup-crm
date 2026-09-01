import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getCachedUser, isInvalidTokenError } from './lib/auth'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  const isProtectedRoute =
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/marketing') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/orders') ||
    pathname.startsWith('/customers') ||
    pathname.startsWith('/products') ||
    pathname.startsWith('/accounting') ||
    pathname.startsWith('/employees') ||
    pathname.startsWith('/expenses') ||
    pathname.startsWith('/purchases') ||
    pathname.startsWith('/suppliers') ||
    pathname.startsWith('/stock-opname')

  const isAuthRoute = pathname === '/login' || pathname === '/register'
  const isRoot = pathname === '/'

  // Check if any Supabase auth cookies are present in the request
  const allCookies = request.cookies.getAll()
  const hasAuthCookie = allCookies.some(
    (c) => (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) && Boolean(c.value)
  )

  // FAST PATH: If user has NO auth cookies, avoid calling Supabase auth API entirely
  if (!hasAuthCookie) {
    if (isProtectedRoute) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/login'
      redirectUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(redirectUrl)
    }
    return NextResponse.next()
  }

  // ONLY instantiate Supabase server client and check session if an auth cookie exists
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: (url, options) => {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 6000)
          if (options?.signal) {
            options.signal.addEventListener('abort', () => controller.abort())
          }
          return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timeoutId))
        },
      },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // First write to the request so server components can read them
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Then write to the response so the browser gets them
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Retrieve cached user (or fetch once) with timeout handling
  const { user, error: authError } = await getCachedUser(request, supabase)

  const isInvalidToken = isInvalidTokenError(authError)
  const isTimeoutOrNetworkError =
    !isInvalidToken &&
    (authError?.message === 'Auth timeout' ||
      (authError && (authError as any).status !== 401 && (authError as any).status !== 403 && (authError as any).status !== 400))

  // If token was revoked or invalid (e.g. 400 Bad Request on refresh token),
  // purge all dead auth cookies so browser stops sending them.
  if (isInvalidToken) {
    allCookies.forEach(c => {
      if (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) {
        supabaseResponse.cookies.delete(c.name)
      }
    })

    if (isProtectedRoute) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/login'
      redirectUrl.searchParams.set('next', pathname)
      const redirectResponse = NextResponse.redirect(redirectUrl)
      allCookies.forEach(c => {
        if (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) {
          redirectResponse.cookies.delete(c.name)
        }
      })
      return redirectResponse
    }
  }

  // Not logged in + trying to access protected route → redirect to login
  if (!user && isProtectedRoute) {
    if (isTimeoutOrNetworkError && hasAuthCookie) {
      console.warn('[Middleware] Supabase auth network timeout, but session cookie exists. Allowing request.')
      return supabaseResponse
    }
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('next', pathname)
    const redirectResponse = NextResponse.redirect(redirectUrl)
    allCookies.forEach(c => {
      if (c.name.startsWith('sb-') || c.name.includes('auth-token') || c.name.includes('supabase')) {
        redirectResponse.cookies.delete(c.name)
      }
    })
    return redirectResponse
  }

  // Already logged in + trying to access auth routes → redirect to next or onboarding
  if (user && isAuthRoute) {
    const nextParam = request.nextUrl.searchParams.get('next')
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = (nextParam && nextParam.startsWith('/')) ? nextParam : '/onboarding'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - api/ (API routes handled by their own auth)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public assets (svg, png, jpg, jpeg, gif, webp)
     */
    '/((?!api/|_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
