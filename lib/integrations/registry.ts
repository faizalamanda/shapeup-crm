export type IntegrationStatus = 'available' | 'coming_soon' | 'beta'
export type IntegrationCategory = 'e-commerce' | 'payment' | 'shipping' | 'messaging'

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
