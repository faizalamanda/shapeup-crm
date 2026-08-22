import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getCachedUser } from './lib/auth'
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
  const { user, error: authError } = await getCachedUser(request, supabase);

  const isTimeoutOrNetworkError =
    authError?.message === 'Auth timeout' ||
    (authError && (authError as any).status !== 401 && (authError as any).status !== 403)

  // Not logged in + trying to access protected route → redirect to login
  // NOTE: If Supabase auth timed out or had a network error BUT the user has an auth cookie,
  // DO NOT force redirect to /login so the user isn't logged out during temporary network lag.
  if (!user && isProtectedRoute) {
    if (isTimeoutOrNetworkError && hasAuthCookie) {
      console.warn('[Middleware] Supabase auth network timeout, but session cookie exists. Allowing request.')
      return supabaseResponse
    }
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    // Preserve the original URL so we can redirect back after login
    redirectUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Already logged in + trying to access auth routes → redirect to next or onboarding
  if (user && isAuthRoute) {
    const nextParam = request.nextUrl.searchParams.get('next')
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = (nextParam && nextParam.startsWith('/')) ? nextParam : '/onboarding'
    redirectUrl.search = ''
    return NextResponse.redirect(redirectUrl)
  }

  // IMPORTANT: Return supabaseResponse (not NextResponse.next()) so the
  // updated session cookies are properly forwarded to the browser.
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
