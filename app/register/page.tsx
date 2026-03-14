"use client"
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // Mendaftarkan user ke Auth Supabase dengan metadata
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName, // Ini akan ditangkap trigger SQL di atas
        },
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    })

    if (error) {
      alert(error.message)
    } else {
      alert("Cek email Anda untuk konfirmasi pendaftaran!")
      router.push('/login')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="bg-white p-10 rounded-[2.5rem] shadow-xl shadow-slate-200 w-full max-w-md">
        <h1 className="text-3xl font-black text-slate-900 mb-2">Daftar Akun</h1>
        <p className="text-slate-500 font-medium mb-8">Mulai kelola bisnis Anda sekarang.</p>

        <form onSubmit={handleRegister} className="space-y-4">
          <input 
            type="text" placeholder="Nama Lengkap" required
            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
            value={fullName} onChange={e => setFullName(e.target.value)}
          />
          <input 
            type="email" placeholder="Email" required
            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
            value={email} onChange={e => setEmail(e.target.value)}
          />
          <input 
            type="password" placeholder="Password" required
            className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-blue-600 font-bold"
            value={password} onChange={e => setPassword(e.target.value)}
          />
          <button 
            type="submit" disabled={loading}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
          >
            {loading ? 'Mendaftar...' : 'Buat Akun'}
          </button>
        </form>
      </div>
    </div>
  )
}