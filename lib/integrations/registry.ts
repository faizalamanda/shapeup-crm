export type IntegrationStatus = 'available' | 'coming_soon' | 'beta'
export type IntegrationCategory = 'e-commerce' | 'payment' | 'shipping' | 'messaging' | 'inventory'

export interface IntegrationField {
  key: string
  label: string
  type: 'text' | 'password' | 'url' | 'boolean' | 'select'
  placeholder?: string
  description?: string
  required?: boolean
  options?: { value: string; label: string }[]
}

export interface IntegrationPlugin {
  id: string
  name: string
  description: string
  icon: string
  category: IntegrationCategory
  status: IntegrationStatus
  badge?: string
  fields: IntegrationField[]
  docUrl?: string
  getWebhookUrl?: (businessId: string, origin: string) => string
}

export const INTEGRATION_PLUGINS: IntegrationPlugin[] = [
  {
    id: 'inventory_reports',
    name: 'Laporan Inventory & Stok',
    description: 'Modul Laporan Persediaan Lengkap: Stock Report, Location Report, Move History (Lot/Status), Move Analysis (Pivot & Charts), dan Valuation (FIFO/LIFO/AVCO).',
    icon: '📦',
    category: 'inventory',
    status: 'available',
    badge: 'Plugin Resmi',
    fields: [],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Hubungkan toko WordPress & WooCommerce Anda untuk sinkronisasi pesanan & pelanggan secara otomatis.',
    icon: '🛍️',
    category: 'e-commerce',
    status: 'available',
    badge: 'Aktif',
    getWebhookUrl: (businessId: string, origin: string) => {
      const baseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : '')
      return `${baseUrl}/api/webhook/woo?bid=${businessId}`
    },
    fields: [
      {
        key: 'store_url',
        label: 'URL Toko WordPress / WooCommerce',
        type: 'url',
        placeholder: 'https://tokoanda.com',
        description: 'URL utama domain WooCommerce Anda.',
        required: true,
      },
      {
        key: 'consumer_key',
        label: 'Consumer Key (REST API)',
        type: 'text',
        placeholder: 'ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        description: 'Dapatkan dari WooCommerce > Settings > Advanced > REST API.',
        required: true,
      },
      {
        key: 'consumer_secret',
        label: 'Consumer Secret (REST API)',
        type: 'password',
        placeholder: 'cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        description: 'Kunci rahasia REST API WooCommerce Anda.',
        required: true,
      },
    ],
  },
  {
    id: 'waba_official',
    name: 'WABA Official (Meta)',
    description: 'Integrasi resmi WhatsApp Business API dari Meta. Kirim dan terima pesan teks secara instan melalui Inbox ShapeUp CRM.',
    icon: '📱',
    category: 'messaging',
    status: 'available',
    badge: 'Aktif',
    getWebhookUrl: (businessId: string, origin: string) => {
      const baseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : '')
      return `${baseUrl}/api/webhook/waba?bid=${businessId}`
    },
    fields: [
      {
        key: 'access_token',
        label: 'Meta Access Token (System User / Permanent Token)',
        type: 'password',
        placeholder: 'EAAG...',
        description: 'Dapatkan dari Meta Business Manager > System Users > Generate Token.',
        required: true,
      },
      {
        key: 'phone_number_id',
        label: 'Phone Number ID',
        type: 'text',
        placeholder: '123456789012345',
        description: 'ID Nomor HP WABA dari Dashboard Meta Developer Portal.',
        required: true,
      },
      {
        key: 'waba_id',
        label: 'WhatsApp Business Account ID (WABA ID)',
        type: 'text',
        placeholder: '109876543210987',
        description: 'ID Akun Bisnis WhatsApp Anda.',
        required: true,
      },
      {
        key: 'webhook_verify_token',
        label: 'Webhook Verify Token',
        type: 'text',
        placeholder: 'shapeup_waba_verify_token_123',
        description: 'Token verifikasi bebas yang Anda masukkan pada konfigurasi Webhook Meta.',
        required: true,
      },
    ],
  },
  {
    id: 'ycloud',
    name: 'YCloud (WhatsApp)',
    description: 'Hubungkan YCloud WhatsApp Business API untuk pengiriman pesan otomatis, notifikasi pesanan, dan automation.',
    icon: '💬',
    category: 'messaging',
    status: 'available',
    badge: 'Aktif',
    getWebhookUrl: (businessId: string, origin: string) => {
      const baseUrl = origin || (typeof window !== 'undefined' ? window.location.origin : '')
      return `${baseUrl}/api/webhook/ycloud?bid=${businessId}`
    },
    fields: [
      {
        key: 'api_key',
        label: 'YCloud API Key',
        type: 'password',
        placeholder: 'yc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        description: 'Dapatkan API Key dari dashboard YCloud > Settings > API Keys.',
        required: true,
      },
      {
        key: 'whatsapp_number',
        label: 'Nomor WhatsApp Pengirim (Opsional)',
        type: 'text',
        placeholder: '628xxxxxxxxxx',
        description: 'Nomor WhatsApp terverifikasi di YCloud yang digunakan sebagai pengirim utama.',
        required: false,
      },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Integrasi otomatis produk dan pesanan dari toko Shopify Anda ke ShapeUp CRM.',
    icon: '📦',
    category: 'e-commerce',
    status: 'coming_soon',
    badge: 'Segera Hadir',
    fields: [],
  },
  {
    id: 'tiktok',
    name: 'TikTok Shop',
    description: 'Koneksikan pesanan live shopping & toko TikTok Shop secara terpusat.',
    icon: '🎵',
    category: 'e-commerce',
    status: 'coming_soon',
    badge: 'Segera Hadir',
    fields: [],
  },
  {
    id: 'shopee',
    name: 'Shopee Store',
    description: 'Sinkronisasi pesanan dan laporan penjualan dari toko marketplace Shopee.',
    icon: '🧡',
    category: 'e-commerce',
    status: 'coming_soon',
    badge: 'Segera Hadir',
    fields: [],
  },
  {
    id: 'tokopedia',
    name: 'Tokopedia Seller',
    description: 'Hubungkan Tokopedia Seller Center untuk memantau performa toko.',
    icon: '💚',
    category: 'e-commerce',
    status: 'coming_soon',
    badge: 'Segera Hadir',
    fields: [],
  },
]
