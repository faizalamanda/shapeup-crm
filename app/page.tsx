import { redirect } from 'next/navigation'

export default function Home() {
  // Middleware handles auth check:
  // - Logged in  → stays at /dashboard
  // - Logged out → redirected to /login
  redirect('/dashboard')
}
