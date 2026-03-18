import './globals.css'
import { Sidebar } from '@/components/ui/Sidebar'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-[#f8f9fa] min-h-screen font-sans antialiased text-[#333]">
        <div className="flex flex-col lg:flex-row min-h-screen">
          
          {/* Navigasi Global */}
          <Sidebar />

          {/* MAIN CONTENT AREA - FULL WIDTH */}
          <main className="flex-1 lg:ml-64 w-full transition-all duration-200">
            {/* Full width tapi tetap ada padding samping yang aman (p-6 sampai p-12).
              Tidak dibatasi max-width agar leluasa melihat data tabel besar.
            */}
            <div className="p-6 md:p-10 lg:p-12 w-full min-h-screen">
              {children}
            </div>
          </main>

        </div>
      </body>
    </html>
  )
}