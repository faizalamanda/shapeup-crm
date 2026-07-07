"use client"

/**
 * CustomerAddressForm — Komponen reusable untuk field alamat.
 *
 * Render field dinamis berdasarkan country_preset yang dipilih:
 * - indonesia : address_line1/2, kecamatan, kota, provinsi (38 dropdown), kode_pos
 * - malaysia  : address_line1/2, city, negeri (dropdown), postcode
 * - usa       : address_line1/2, city, state (dropdown), zip
 * - custom    : address_line1/2, city, state/region, postcode, country text
 *
 * JSONB yang disimpan ke kolom `address_data` di tabel customers:
 * {
 *   country_preset, country, address_line1, address_line2,
 *   subdistrict?, city, state, postcode
 * }
 */

export type AddressData = {
  country_preset: 'indonesia' | 'malaysia' | 'usa' | 'custom'
  country: string
  address_line1: string
  address_line2: string
  subdistrict: string   // kecamatan — hanya relevan untuk Indonesia
  city: string
  state: string         // provinsi / negeri / US state
  postcode: string
}

export const EMPTY_ADDRESS: AddressData = {
  country_preset: 'indonesia',
  country: 'Indonesia',
  address_line1: '',
  address_line2: '',
  subdistrict: '',
  city: '',
  state: '',
  postcode: '',
}

// ─── Data Wilayah ─────────────────────────────────────────────────────────────

const PROVINSI_INDONESIA = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau',
  'Jambi', 'Bengkulu', 'Sumatera Selatan', 'Kepulauan Bangka Belitung',
  'Lampung', 'DKI Jakarta', 'Jawa Barat', 'Banten', 'Jawa Tengah',
  'DI Yogyakarta', 'Jawa Timur', 'Bali', 'Nusa Tenggara Barat',
  'Nusa Tenggara Timur', 'Kalimantan Barat', 'Kalimantan Tengah',
  'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat',
  'Sulawesi Selatan', 'Sulawesi Tenggara', 'Maluku', 'Maluku Utara',
  'Papua Barat', 'Papua Barat Daya', 'Papua', 'Papua Selatan',
  'Papua Tengah', 'Papua Pegunungan',
]

const NEGERI_MALAYSIA = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'Wilayah Persekutuan Kuala Lumpur',
  'Wilayah Persekutuan Labuan', 'Wilayah Persekutuan Putrajaya',
]

const STATES_USA = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
  'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

// ─── Preset Config ─────────────────────────────────────────────────────────────

const PRESET_CONFIG = {
  indonesia: { label: '🇮🇩 Indonesia', country: 'Indonesia', countryCode: 'ID' },
  malaysia:  { label: '🇲🇾 Malaysia',  country: 'Malaysia',  countryCode: 'MY' },
  usa:       { label: '🇺🇸 USA',       country: 'United States', countryCode: 'US' },
  custom:    { label: '🌐 Lainnya',    country: '',          countryCode: '' },
} as const

// ─── Input Styles ──────────────────────────────────────────────────────────────

const inputCls = "w-full p-2 text-sm rounded-xl border border-[#EBEBEA] focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all bg-white"
const labelCls = "text-xs font-bold text-[#70706E] block mb-1"
const selectCls = `${inputCls} bg-white`

// ─── Component ────────────────────────────────────────────────────────────────

interface CustomerAddressFormProps {
  value: AddressData
  onChange: (data: AddressData) => void
  /** Tampilkan dalam mode compact (tanpa border card pembungkus) */
  compact?: boolean
}

export function CustomerAddressForm({ value, onChange, compact = false }: CustomerAddressFormProps) {

  const handlePresetChange = (preset: AddressData['country_preset']) => {
    const config = PRESET_CONFIG[preset]
    onChange({
      ...value,
      country_preset: preset,
      country: config.country,
      // reset field wilayah saat ganti preset
      subdistrict: '',
      state: '',
    })
  }

  const set = (field: keyof AddressData, val: string) => {
    onChange({ ...value, [field]: val })
  }

  const { country_preset } = value

  const content = (
    <div className="space-y-4">
      {/* Country Preset Selector */}
      <div>
        <label className={labelCls}>Format Alamat / Negara</label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_CONFIG) as AddressData['country_preset'][]).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetChange(preset)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all ${
                country_preset === preset
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-[#70706E] border-[#EBEBEA] hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {PRESET_CONFIG[preset].label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom country name — only for 'custom' preset */}
      {country_preset === 'custom' && (
        <div>
          <label className={labelCls}>Nama Negara</label>
          <input
            type="text"
            value={value.country}
            onChange={e => set('country', e.target.value)}
            placeholder="Contoh: Singapore, Australia..."
            className={inputCls}
          />
        </div>
      )}

      {/* Address Line 1 */}
      <div>
        <label className={labelCls}>
          {country_preset === 'indonesia' ? 'Alamat (Jalan, No. Rumah)' : 'Address Line 1'}
        </label>
        <input
          type="text"
          value={value.address_line1}
          onChange={e => set('address_line1', e.target.value)}
          placeholder={
            country_preset === 'indonesia'
              ? 'Contoh: Jl. Merdeka No. 10'
              : country_preset === 'malaysia'
              ? 'Contoh: No. 5, Jalan Ampang'
              : country_preset === 'usa'
              ? 'Contoh: 123 Main St'
              : 'Street address, P.O. box'
          }
          className={inputCls}
        />
      </div>

      {/* Address Line 2 */}
      <div>
        <label className={labelCls}>
          {country_preset === 'indonesia' ? 'RT/RW, Gang, Blok (Opsional)' : 'Address Line 2 (Optional)'}
        </label>
        <input
          type="text"
          value={value.address_line2}
          onChange={e => set('address_line2', e.target.value)}
          placeholder={
            country_preset === 'indonesia'
              ? 'Contoh: RT 02/RW 05, Gg. Mawar'
              : country_preset === 'usa'
              ? 'Apartment, suite, unit, building, floor...'
              : 'Apartment, suite, etc. (optional)'
          }
          className={inputCls}
        />
      </div>

      {/* Kecamatan — Indonesia only */}
      {country_preset === 'indonesia' && (
        <div>
          <label className={labelCls}>Kecamatan</label>
          <input
            type="text"
            value={value.subdistrict}
            onChange={e => set('subdistrict', e.target.value)}
            placeholder="Contoh: Menteng"
            className={inputCls}
          />
        </div>
      )}

      {/* City / Kota */}
      <div>
        <label className={labelCls}>
          {country_preset === 'indonesia' ? 'Kota / Kabupaten' : 'City'}
        </label>
        <input
          type="text"
          value={value.city}
          onChange={e => set('city', e.target.value)}
          placeholder={
            country_preset === 'indonesia'
              ? 'Contoh: Jakarta Pusat'
              : country_preset === 'malaysia'
              ? 'Contoh: Kuala Lumpur'
              : 'Contoh: New York'
          }
          className={inputCls}
        />
      </div>

      {/* State / Provinsi / Negeri — dropdown for ID & MY & USA, text for custom */}
      <div>
        <label className={labelCls}>
          {country_preset === 'indonesia'
            ? 'Provinsi'
            : country_preset === 'malaysia'
            ? 'Negeri'
            : country_preset === 'usa'
            ? 'State'
            : 'State / Region / Provinsi'}
        </label>
        {country_preset === 'indonesia' && (
          <select value={value.state} onChange={e => set('state', e.target.value)} className={selectCls}>
            <option value="">-- Pilih Provinsi --</option>
            {PROVINSI_INDONESIA.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {country_preset === 'malaysia' && (
          <select value={value.state} onChange={e => set('state', e.target.value)} className={selectCls}>
            <option value="">-- Pilih Negeri --</option>
            {NEGERI_MALAYSIA.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {country_preset === 'usa' && (
          <select value={value.state} onChange={e => set('state', e.target.value)} className={selectCls}>
            <option value="">-- Select State --</option>
            {STATES_USA.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {country_preset === 'custom' && (
          <input
            type="text"
            value={value.state}
            onChange={e => set('state', e.target.value)}
            placeholder="State / Region / Province"
            className={inputCls}
          />
        )}
      </div>

      {/* Postcode */}
      <div>
        <label className={labelCls}>
          {country_preset === 'indonesia' ? 'Kode Pos' : country_preset === 'usa' ? 'ZIP Code' : 'Postcode'}
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={value.postcode}
          onChange={e => set('postcode', e.target.value)}
          placeholder={
            country_preset === 'indonesia'
              ? 'Contoh: 10310'
              : country_preset === 'usa'
              ? 'Contoh: 10001'
              : 'Postcode'
          }
          maxLength={10}
          className={`${inputCls} w-36`}
        />
      </div>
    </div>
  )

  if (compact) return content

  return (
    <div className="border-t border-slate-100 pt-4 mt-1">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#70706E] mb-4 flex items-center gap-2">
        <span>📍</span> Alamat Pengiriman / Billing
        <span className="font-normal normal-case tracking-normal text-slate-400">(opsional, untuk segmentasi)</span>
      </p>
      {content}
    </div>
  )
}
