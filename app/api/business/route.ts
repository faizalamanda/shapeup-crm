import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const cookieStore = await cookies()
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  const { name, address, phone } = await req.json()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const { data: biz, error: bizError } = await supabase
      .from('businesses')
      .insert({ name, address, phone, owner_id: user.id })
      .select().single()

    if (bizError) throw bizError

    await supabase.from('profiles').update({ business_id: biz.id }).eq('id', user.id)

    return NextResponse.json({ success: true, business: biz })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}