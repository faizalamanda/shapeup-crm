const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'app', 'settings', 'integrations', 'page.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// 1. Add state
const stateBlock = `
  // Accurate Form State
  const [accurateClientId, setAccurateClientId] = useState('')
  const [accurateClientSecret, setAccurateClientSecret] = useState('')
  const [accurateAccessToken, setAccurateAccessToken] = useState('')
  const [accurateDbId, setAccurateDbId] = useState('')
  const [isSyncingAccurate, setIsSyncingAccurate] = useState(false)
`
if (!content.includes('// Accurate Form State')) {
  content = content.replace('  // WooCommerce Form State', stateBlock + '\n  // WooCommerce Form State')
}

// 2. Populate form state in useEffect
const populateBlock = `
        // Populate Accurate form if exists
        const accurate = map['accurate']
        if (accurate && accurate.config) {
          setAccurateClientId(accurate.config.client_id || '')
          setAccurateClientSecret(accurate.config.client_secret || '')
          setAccurateAccessToken(accurate.config.access_token || '')
          setAccurateDbId(accurate.config.db_id || '')
        }
`
if (!content.includes('// Populate Accurate form if exists')) {
  content = content.replace('        // Populate WooCommerce form if exists', populateBlock + '\n        // Populate WooCommerce form if exists')
}

// 3. Save handler
const saveHandler = `
  // Handle Save Accurate Integration
  const handleSaveAccurate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Unauthenticated')
      
      const { data: profile } = await supabase.from('profiles').select('active_business_id').eq('id', user.id).single()
      if (!profile?.active_business_id) throw new Error('No business selected')

      const config = {
        client_id: accurateClientId,
        client_secret: accurateClientSecret,
        access_token: accurateAccessToken,
        db_id: accurateDbId
      }

      const { error } = await supabase.from('business_integrations').upsert({
        business_id: profile.active_business_id,
        provider: 'accurate',
        name: 'Accurate Online',
        is_active: accurateAccessToken ? true : false,
        config: config
      }, { onConflict: 'business_id,provider' })

      if (error) throw error

      toast.success('Pengaturan Accurate berhasil disimpan!')
      setSelectedPlugin(null) // close modal
      fetchIntegrations(profile.active_business_id) // refresh state
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Gagal menyimpan pengaturan Accurate.')
    } finally {
      setIsSaving(false)
    }
  }

  // Handle Sync Accurate
  const handleSyncAccurate = async () => {
    setIsSyncingAccurate(true)
    try {
      const res = await fetch('/api/integrations/accurate/sync-orders', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(json.message || 'Sinkronisasi berhasil!')
    } catch (err: any) {
      toast.error(err.message || 'Gagal sinkronisasi.')
    } finally {
      setIsSyncingAccurate(false)
    }
  }
`
if (!content.includes('// Handle Save Accurate Integration')) {
  content = content.replace('  // Handle Save WooCommerce Integration', saveHandler + '\n  // Handle Save WooCommerce Integration')
}

// 4. Plugin fetch
const pluginFind = `
  const accuratePlugin = INTEGRATION_PLUGINS.find(p => p.id === 'accurate')!
  const accurateSaved = integrationsData['accurate']
`
if (!content.includes('const accuratePlugin = INTEGRATION_PLUGINS.find')) {
  content = content.replace("  const wooPlugin = INTEGRATION_PLUGINS.find(p => p.id === 'woocommerce')!", pluginFind + "\n  const wooPlugin = INTEGRATION_PLUGINS.find(p => p.id === 'woocommerce')!")
}

// 5. Card
const cardBlock = `
        {/* ACCURATE PLUGIN CARD */}
        {accuratePlugin && (
          <div
            className={\`group relative bg-white border \${accurateSaved?.is_active ? 'border-green-300' : 'border-slate-200'} rounded-2xl p-5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden\`}
            onClick={() => setSelectedPlugin(accuratePlugin)}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full blur-3xl -mr-10 -mt-10 transition-colors group-hover:bg-blue-50"></div>
            
            <div className="relative z-10 flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center text-2xl shadow-sm border border-slate-100">
                {accuratePlugin.icon}
              </div>
              <div className="flex flex-col items-end gap-2">
                {accurateSaved?.is_active ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    Terkoneksi
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    Belum Terhubung
                  </span>
                )}
                <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 tracking-wider uppercase">
                  {accuratePlugin.category}
                </span>
              </div>
            </div>

            <div className="relative z-10">
              <h3 className="text-base font-bold text-[#1C1C1A]">{accuratePlugin.name}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed line-clamp-3">
                {accuratePlugin.description}
              </p>
            </div>
            
            <div className="relative z-10 mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 group-hover:text-blue-600 transition-colors">
                {accurateSaved?.is_active ? 'Kelola Pengaturan →' : 'Hubungkan Sekarang →'}
              </span>
            </div>
          </div>
        )}
`
if (!content.includes('{/* ACCURATE PLUGIN CARD */}')) {
  content = content.replace('{/* 1. WOOCOMMERCE PLUGIN CARD */}', cardBlock + '\n        {/* 1. WOOCOMMERCE PLUGIN CARD */}')
}

// 6. Modal
const modalBlock = `
      {/* ACCURATE CONFIGURATION MODAL / DRAWER */}
      {selectedPlugin?.id === 'accurate' && mounted && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
            onClick={() => !isSaving && setSelectedPlugin(null)}
          ></div>
          
          <div className="relative w-full sm:w-[500px] h-[90vh] sm:h-auto sm:max-h-[85vh] bg-white sm:rounded-2xl shadow-2xl flex flex-col transform transition-all animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95">
            
            {/* Header */}
            <div className="flex-none px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white sm:rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-xl border border-slate-100">
                  {selectedPlugin.icon}
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#1C1C1A]">Integrasi {selectedPlugin.name}</h2>
                  <p className="text-xs text-slate-500">Konfigurasi API Credentials</p>
                </div>
              </div>
              <button 
                onClick={() => !isSaving && setSelectedPlugin(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveAccurate} className="flex-1 overflow-y-auto p-6 space-y-5">
              
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl">ℹ️</span>
                  <div>
                    <h4 className="text-sm font-bold text-blue-900">Petunjuk</h4>
                    <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                      Dapatkan kredensial ini dari Accurate Developer Portal. Pastikan aplikasi telah mendapatkan akses (Otorisasi) untuk database Anda.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                    Client ID (OAuth)
                  </label>
                  <input
                    type="text"
                    required
                    value={accurateClientId}
                    onChange={(e) => setAccurateClientId(e.target.value)}
                    placeholder="Masukkan Client ID"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                    Client Secret (OAuth)
                  </label>
                  <input
                    type="password"
                    required
                    value={accurateClientSecret}
                    onChange={(e) => setAccurateClientSecret(e.target.value)}
                    placeholder="Masukkan Client Secret"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                    Access Token
                  </label>
                  <input
                    type="password"
                    required
                    value={accurateAccessToken}
                    onChange={(e) => setAccurateAccessToken(e.target.value)}
                    placeholder="Bearer token"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1C1C1A] mb-1.5">
                    Database ID (X-Session-ID)
                  </label>
                  <input
                    type="text"
                    required
                    value={accurateDbId}
                    onChange={(e) => setAccurateDbId(e.target.value)}
                    placeholder="ID Session Accurate"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                  />
                </div>
              </div>

              {accurateSaved?.is_active && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col gap-2">
                  <p className="text-xs text-slate-500 mb-2">Tarik pesanan terbaru dari Accurate secara manual:</p>
                  <button
                    type="button"
                    onClick={handleSyncAccurate}
                    disabled={isSyncingAccurate}
                    className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {isSyncingAccurate ? 'Menarik Data...' : '🔄 Sinkronisasi Data Order & HPP Sekarang'}
                  </button>
                </div>
              )}

              {/* Footer */}
              <div className="pt-6 mt-6 border-t border-slate-100 flex items-center justify-end gap-3 pb-safe">
                <button
                  type="button"
                  onClick={() => !isSaving && setSelectedPlugin(null)}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-black rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </button>
              </div>

            </form>
          </div>
        </div>,
        document.body
      )}
`
if (!content.includes('{/* ACCURATE CONFIGURATION MODAL / DRAWER */}')) {
  content = content.replace('{/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}', modalBlock + '\n      {/* WOOCOMMERCE CONFIGURATION MODAL / DRAWER */}')
}

fs.writeFileSync(filePath, content, 'utf-8')
console.log('Successfully injected Accurate into page.tsx')
