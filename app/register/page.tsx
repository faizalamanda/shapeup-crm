"use client"
import { useState } from 'react'
import { supabase } from '../../lib/supabase' // Jalur disesuaikan karena tidak pakai folder src
import { useRouter } from 'next/navigation'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const router = useRouter()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { business_name: businessName } 
      }
    })

    setLoading(false)
    if (error) {
      setMessage(`Error: ${error.message}`)
    } else {
      setMessage('Berhasil! Silakan cek email Anda untuk konfirmasi pendaftaran.')
      // Opsional: otomatis arahkan ke login setelah beberapa detik
      setTimeout(() => router.push('/login'), 3000)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900">ShapeUp CRM</h1>
          <p className="text-slate-500 mt-2">Buat akun untuk mengelola pelanggan Anda</p>
        </div>
        
        <form onSubmit={handleRegister} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Nama Bisnis</label>
            <input 
              type="text" 
              placeholder="Contoh: FitLife Studio"
              value={businessName} 
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" 
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Email</label>
            <input 
              type="email" 
              placeholder="nama@bisnis.com"
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" 
              required 
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
            <input 
              type="password" 
              placeholder="••••••••"
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" 
              required 
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transform active:scale-[0.98] transition-all disabled:bg-blue-300 disabled:transform-none"
          >
            {loading ? 'Sedang Mendaftar...' : 'Daftar Sekarang'}
          </button>
        </form>

        {message && (
          <div className={`mt-6 p-4 rounded-lg text-sm font-medium text-center ${message.includes('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {message}
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-slate-100 text-center text-sm text-slate-600">
          Sudah punya akun? <a href="/login" className="text-blue-600 font-bold hover:underline">Masuk di sini</a>
        </div>
      </div>
    </div>
  )
}