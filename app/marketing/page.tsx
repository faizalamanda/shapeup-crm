import MarketingAutomation from './components/MarketingAutomation'


export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-[#f8f9fa]">
      {/* Container utama agar konten tidak terlalu mepet ke pinggir layar */}
      <div className="max-w-7xl mx-auto">
        <MarketingAutomation />
      </div>
    </main>
  )
}