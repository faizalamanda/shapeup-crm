import * as XLSX from 'xlsx'

export interface OrderFieldDefinition {
  key: string
  label: string
  group: 'order' | 'customer' | 'item'
  required?: boolean
  description: string
  synonyms: string[]
}

export const ORDER_TARGET_FIELDS: OrderFieldDefinition[] = [
  // ── Kelompok Informasi Pesanan ──────────────────────────────────────────
  {
    key: 'order_number',
    label: 'No. Pesanan / Struk / Faktur',
    group: 'order',
    required: true,
    description: 'Nomor unik transaksi, struk, atau invoice untuk grouping item dan anti-duplikasi',
    synonyms: [
      'no. pesanan', 'nomor pesanan', 'no pesanan', 'order id', 'order_id', 'order number', 'order_number',
      'no. struk', 'no struk', 'nomor struk', 'receipt id', 'receipt number', 'receipt_id', 'receipt_number',
      'no. faktur', 'no faktur', 'nomor faktur', 'invoice no', 'invoice number', 'no invoice', 'invoice_no',
      'id transaksi', 'nomor transaksi', 'transaction id', 'transaction_id'
    ]
  },
  {
    key: 'order_date',
    label: 'Tanggal Transaksi',
    group: 'order',
    description: 'Waktu transaksi pesanan terjadi (mendukung format tanggal & jam)',
    synonyms: [
      'tanggal', 'date', 'waktu', 'time', 'date & time', 'date and time', 'order date', 'order_date',
      'tanggal transaksi', 'waktu transaksi', 'tanggal penjualan', 'waktu penjualan', 'created at', 'created_at',
      'waktu pesanan dibuat', 'tanggal pesanan'
    ]
  },
  {
    key: 'source_platform',
    label: 'Platform / Sumber Pesanan',
    group: 'order',
    description: 'Nama platform asal (cth: Moka POS, Pawoon, Majoo, Shopee, Tokopedia, Manual)',
    synonyms: [
      'platform', 'source', 'channel', 'sumber pesanan', 'sumber', 'toko', 'outlet', 'gerai', 'cabang',
      'source platform', 'source_platform', 'outlet name', 'nama outlet'
    ]
  },
  {
    key: 'status',
    label: 'Status Pesanan',
    group: 'order',
    description: 'Status pesanan (completed/selesai, processing, pending, cancelled/batal)',
    synonyms: [
      'status', 'status pesanan', 'order status', 'status transaksi', 'transaction status', 'kondisi pesanan'
    ]
  },
  {
    key: 'payment_status',
    label: 'Status Pembayaran',
    group: 'order',
    description: 'Status pelunasan (paid/lunas, partial/dp, unpaid/belum bayar)',
    synonyms: [
      'status pembayaran', 'payment status', 'status bayar', 'keterangan bayar'
    ]
  },
  {
    key: 'payment_method',
    label: 'Metode Pembayaran',
    group: 'order',
    description: 'Metode yang digunakan pelanggan (Cash, Transfer, QRIS, EDC, COD, dll)',
    synonyms: [
      'metode pembayaran', 'payment method', 'cara bayar', 'jenis pembayaran', 'payment type', 'tipe pembayaran',
      'alat bayar', 'tender'
    ]
  },
  {
    key: 'discount_amount',
    label: 'Diskon Pesanan',
    group: 'order',
    description: 'Potongan harga atau voucher transaksi',
    synonyms: [
      'diskon', 'discount', 'potongan', 'voucher', 'diskon transaksi', 'discounts', 'potongan harga',
      'voucher penjual', 'diskon toko'
    ]
  },
  {
    key: 'shipping_cost',
    label: 'Ongkos Kirim',
    group: 'order',
    description: 'Biaya pengiriman / ongkir pesanan',
    synonyms: [
      'ongkir', 'ongkos kirim', 'biaya pengiriman', 'shipping', 'shipping cost', 'shipping_cost', 'biaya kirim'
    ]
  },
  {
    key: 'grand_total',
    label: 'Total Transaksi (Grand Total)',
    group: 'order',
    description: 'Total akhir pembayaran transaksi',
    synonyms: [
      'total', 'grand total', 'grand_total', 'total bayar', 'total pembayaran', 'total pesanan',
      'total collected', 'net sales', 'total harga', 'nominal akhir', 'total bersih'
    ]
  },
  {
    key: 'created_by',
    label: 'Kasir / Operator / Dibuat Oleh',
    group: 'order',
    description: 'Nama kasir atau staf yang melayani transaksi',
    synonyms: [
      'kasir', 'cashier', 'operator', 'served by', 'staff', 'employee', 'nama kasir', 'nama operator',
      'dibuat oleh', 'created by', 'created_by'
    ]
  },

  // ── Kelompok Data Pelanggan ─────────────────────────────────────────────
  {
    key: 'customer_name',
    label: 'Nama Pelanggan',
    group: 'customer',
    description: 'Nama pembeli atau penerima barang',
    synonyms: [
      'nama pelanggan', 'customer name', 'customer', 'pelanggan', 'nama pembeli', 'nama customer',
      'nama penerima', 'recipient name', 'buyer'
    ]
  },
  {
    key: 'customer_phone',
    label: 'No. WhatsApp / HP',
    group: 'customer',
    description: 'Nomor telepon seluler atau WhatsApp pelanggan',
    synonyms: [
      'no hp', 'no. hp', 'nomor hp', 'telepon', 'no telepon', 'phone', 'whatsapp', 'no wa', 'no. wa',
      'customer phone', 'no kontak', 'nomor telepon', 'phone number', 'recipient phone'
    ]
  },
  {
    key: 'customer_email',
    label: 'Email Pelanggan',
    group: 'customer',
    description: 'Alamat email pelanggan untuk faktur / notifikasi',
    synonyms: [
      'email', 'customer email', 'email pelanggan', 'email pembeli', 'e-mail'
    ]
  },
  {
    key: 'shipping_address',
    label: 'Alamat Pengiriman',
    group: 'customer',
    description: 'Alamat lengkap tujuan pengiriman pesanan',
    synonyms: [
      'alamat', 'alamat pengiriman', 'address', 'shipping address', 'alamat lengkap', 'alamat tujuan'
    ]
  },
  {
    key: 'shipping_city',
    label: 'Kota / Kabupaten',
    group: 'customer',
    description: 'Kota atau kabupaten tujuan pengiriman',
    synonyms: [
      'kota', 'kabupaten', 'city', 'kota/kabupaten', 'kota pengiriman'
    ]
  },

  // ── Kelompok Rincian Produk (Items) ────────────────────────────────────
  {
    key: 'product_name',
    label: 'Nama Produk / Item',
    group: 'item',
    required: true,
    description: 'Nama barang atau menu yang dipesan',
    synonyms: [
      'nama produk', 'product name', 'item name', 'nama barang', 'item', 'produk', 'nama menu', 'menu',
      'product', 'barang'
    ]
  },
  {
    key: 'sku',
    label: 'SKU / Kode Barang',
    group: 'item',
    description: 'Kode unik barang atau barcode produk',
    synonyms: [
      'sku', 'kode barang', 'kode produk', 'item sku', 'barcode', 'sku induk', 'nomor variasi', 'product sku'
    ]
  },
  {
    key: 'variant_name',
    label: 'Varian / Ukuran / Modifiers',
    group: 'item',
    description: 'Keterangan variasi produk (misal: Size L, Merah, Normal Ice, dll)',
    synonyms: [
      'varian', 'variant', 'variant name', 'variasi', 'variasi produk', 'opsi', 'modifiers', 'modifier',
      'warna/ukuran', 'nama varian'
    ]
  },
  {
    key: 'quantity',
    label: 'Jumlah (Qty)',
    group: 'item',
    required: true,
    description: 'Kuantitas atau banyaknya barang yang dibeli',
    synonyms: [
      'jumlah', 'qty', 'quantity', 'kuantitas', 'banyaknya', 'volume', 'jumlah terjual', 'pcs'
    ]
  },
  {
    key: 'item_price',
    label: 'Harga Satuan Item',
    group: 'item',
    description: 'Harga normal per 1 unit barang sebelum diskon',
    synonyms: [
      'harga', 'price', 'harga satuan', 'unit price', 'harga jual', 'harga normal', 'gross sales',
      'harga awal', 'item price'
    ]
  },
  {
    key: 'item_total',
    label: 'Total Harga Item',
    group: 'item',
    description: 'Subtotal harga per baris item (Qty x Harga)',
    synonyms: [
      'total item', 'subtotal item', 'total harga item', 'subtotal', 'line total', 'total harga'
    ]
  }
]

// ── Auto-Detect Column by Source Header ─────────────────────────────────────
export function detectOrderFieldByHeader(rawHeader: string): string {
  const clean = rawHeader.trim().toLowerCase().replace(/[_\-\.]+/g, ' ')
  
  // 1. Exact match across synonyms
  for (const field of ORDER_TARGET_FIELDS) {
    for (const syn of field.synonyms) {
      if (clean === syn.toLowerCase()) {
        return field.key
      }
    }
  }

  // 2. Contains match (prioritize specific fields first)
  if (clean.includes('struk') || clean.includes('receipt') || clean.includes('faktur') || clean.includes('invoice') || clean.includes('order id') || clean.includes('order number')) {
    return 'order_number'
  }
  if (clean.includes('telepon') || clean.includes('phone') || clean.includes('hp') || clean.includes('whatsapp') || clean.includes('wa')) {
    return 'customer_phone'
  }
  if (clean.includes('email')) {
    return 'customer_email'
  }
  if (clean.includes('pelanggan') || clean.includes('customer') || clean.includes('pembeli')) {
    return 'customer_name'
  }
  if (clean.includes('barang') || clean.includes('produk') || clean.includes('item name') || clean.includes('product name')) {
    return 'product_name'
  }
  if (clean.includes('sku') || clean.includes('barcode')) {
    return 'sku'
  }
  if (clean.includes('qty') || clean.includes('kuantitas') || clean.includes('jumlah')) {
    return 'quantity'
  }
  if (clean.includes('varian') || clean.includes('variant') || clean.includes('modifier')) {
    return 'variant_name'
  }
  if (clean.includes('diskon') || clean.includes('discount') || clean.includes('potongan')) {
    return 'discount_amount'
  }
  if (clean.includes('ongkir') || clean.includes('shipping')) {
    return 'shipping_cost'
  }
  if (clean.includes('grand total') || clean.includes('total bayar') || clean.includes('total collected') || clean.includes('total akhir')) {
    return 'grand_total'
  }
  if (clean.includes('harga') || clean.includes('price')) {
    return 'item_price'
  }
  if (clean.includes('tanggal') || clean.includes('date') || clean.includes('waktu')) {
    return 'order_date'
  }
  if (clean.includes('kasir') || clean.includes('cashier') || clean.includes('operator') || clean.includes('served by')) {
    return 'created_by'
  }
  if (clean.includes('metode') || clean.includes('payment') || clean.includes('cara bayar')) {
    return 'payment_method'
  }

  return ''
}

// ── Built-in Presets for Indonesian POS & Marketplaces ──────────────────────
export interface PresetDefinition {
  id: string
  name: string
  badge: string
  sourcePlatformDefault: string
  mapping: Record<string, string>
  sampleData: Record<string, any>[]
}

export const ORDER_IMPORT_PRESETS: PresetDefinition[] = [
  // ── 1. MOKA POS (Export Item Details) ──────────────────────────────────
  {
    id: 'moka_pos',
    name: 'Moka POS (Export Item Details)',
    badge: 'POS',
    sourcePlatformDefault: 'Moka POS',
    mapping: {
      'Receipt Number': 'order_number',
      'Date & Time': 'order_date',
      'Item Name': 'product_name',
      'Variant Name': 'variant_name',
      'SKU': 'sku',
      'Quantity': 'quantity',
      'Price': 'item_price',
      'Discounts': 'discount_amount',
      'Total Collected': 'grand_total',
      'Payment Type': 'payment_method',
      'Customer Name': 'customer_name',
      'Customer Phone': 'customer_phone',
      'Served By': 'created_by',
      'Outlet Name': 'source_platform'
    },
    sampleData: [
      {
        'Receipt Number': 'RCP-10021',
        'Date & Time': '2026-10-28 14:15:00',
        'Item Name': 'Kopi Susu Gula Aren',
        'Variant Name': 'Less Sugar',
        'SKU': 'KOP-AREN',
        'Quantity': 2,
        'Price': 22000,
        'Discounts': 0,
        'Total Collected': 64000,
        'Payment Type': 'QRIS',
        'Customer Name': 'Andi Pratama',
        'Customer Phone': '081234567890',
        'Served By': 'Budi Kasir',
        'Outlet Name': 'Moka POS Cabang Pusat'
      },
      {
        'Receipt Number': 'RCP-10021',
        'Date & Time': '2026-10-28 14:15:00',
        'Item Name': 'Croissant Almond',
        'Variant Name': 'Regular',
        'SKU': 'CRS-ALM',
        'Quantity': 1,
        'Price': 20000,
        'Discounts': 0,
        'Total Collected': 64000,
        'Payment Type': 'QRIS',
        'Customer Name': 'Andi Pratama',
        'Customer Phone': '081234567890',
        'Served By': 'Budi Kasir',
        'Outlet Name': 'Moka POS Cabang Pusat'
      },
      {
        'Receipt Number': 'RCP-10022',
        'Date & Time': '2026-10-28 15:30:00',
        'Item Name': 'Matcha Latte',
        'Variant Name': 'Hot',
        'SKU': 'MTC-HOT',
        'Quantity': 1,
        'Price': 28000,
        'Discounts': 3000,
        'Total Collected': 25000,
        'Payment Type': 'Cash',
        'Customer Name': 'Siti Rahma',
        'Customer Phone': '087811223344',
        'Served By': 'Ani Barista',
        'Outlet Name': 'Moka POS Cabang Pusat'
      }
    ]
  },

  // ── 2. PAWOON POS (Detail Penjualan) ───────────────────────────────────
  {
    id: 'pawoon_pos',
    name: 'Pawoon POS (Detail Penjualan)',
    badge: 'POS',
    sourcePlatformDefault: 'Pawoon',
    mapping: {
      'ID Struk': 'order_number',
      'Tanggal & Waktu': 'order_date',
      'Nama Produk': 'product_name',
      'Varian Produk': 'variant_name',
      'SKU Produk': 'sku',
      'Kuantitas (Qty)': 'quantity',
      'Harga Satuan': 'item_price',
      'Diskon Transaksi': 'discount_amount',
      'Total Bayar': 'grand_total',
      'Metode Pembayaran': 'payment_method',
      'Nama Pelanggan': 'customer_name',
      'No. HP': 'customer_phone',
      'Nama Kasir': 'created_by',
      'Nama Outlet': 'source_platform'
    },
    sampleData: [
      {
        'ID Struk': 'PWN-2026-8801',
        'Tanggal & Waktu': '2026-10-28 11:40:00',
        'Nama Produk': 'Nasi Goreng Spesial',
        'Varian Produk': 'Pedas Sedang',
        'SKU Produk': 'NAS-GOR-SP',
        'Kuantitas (Qty)': 2,
        'Harga Satuan': 35000,
        'Diskon Transaksi': 5000,
        'Total Bayar': 85000,
        'Metode Pembayaran': 'Tunai',
        'Nama Pelanggan': 'Rian Wijaya',
        'No. HP': '085612345678',
        'Nama Kasir': 'Kasir 1',
        'Nama Outlet': 'Pawoon Resto'
      },
      {
        'ID Struk': 'PWN-2026-8801',
        'Tanggal & Waktu': '2026-10-28 11:40:00',
        'Nama Produk': 'Es Teh Manis',
        'Varian Produk': 'Dingin',
        'SKU Produk': 'MIN-ESTEH',
        'Kuantitas (Qty)': 2,
        'Harga Satuan': 10000,
        'Diskon Transaksi': 0,
        'Total Bayar': 85000,
        'Metode Pembayaran': 'Tunai',
        'Nama Pelanggan': 'Rian Wijaya',
        'No. HP': '085612345678',
        'Nama Kasir': 'Kasir 1',
        'Nama Outlet': 'Pawoon Resto'
      }
    ]
  },

  // ── 3. MAJOO POS (Detail Penjualan) ───────────────────────────────────
  {
    id: 'majoo_pos',
    name: 'Majoo POS (Detail Penjualan)',
    badge: 'POS',
    sourcePlatformDefault: 'Majoo',
    mapping: {
      'Nomor Invoice': 'order_number',
      'Tanggal Penjualan': 'order_date',
      'Nama Barang': 'product_name',
      'SKU / Kode Barang': 'sku',
      'Varian': 'variant_name',
      'Jumlah Terjual (Qty)': 'quantity',
      'Harga Satuan': 'item_price',
      'Potongan / Diskon': 'discount_amount',
      'Total / Nominal Akhir': 'grand_total',
      'Cara Bayar': 'payment_method',
      'Kasir': 'created_by',
      'Nama Customer': 'customer_name',
      'Telepon': 'customer_phone',
      'Outlet': 'source_platform'
    },
    sampleData: [
      {
        'Nomor Invoice': 'MJ-202610-001',
        'Tanggal Penjualan': '2026-10-28 13:00:00',
        'Nama Barang': 'Polo Shirt Pria',
        'SKU / Kode Barang': 'POL-BLK-L',
        'Varian': 'Hitam / L',
        'Jumlah Terjual (Qty)': 1,
        'Harga Satuan': 120000,
        'Potongan / Diskon': 10000,
        'Total / Nominal Akhir': 110000,
        'Cara Bayar': 'Kartu Debit',
        'Kasir': 'Dewi Majoo',
        'Nama Customer': 'Hendra Saputra',
        'Telepon': '081399887766',
        'Outlet': 'Majoo Fashion Store'
      }
    ]
  },

  // ── 4. SHOPEE (Laporan Pesanan Saya) ─────────────────────────────────
  {
    id: 'shopee',
    name: 'Shopee (Laporan Pesanan Saya)',
    badge: 'Marketplace',
    sourcePlatformDefault: 'Shopee',
    mapping: {
      'No. Pesanan': 'order_number',
      'Waktu Pesanan Dibuat': 'order_date',
      'Status Pesanan': 'status',
      'Nama Produk': 'product_name',
      'Nomor Referensi SKU': 'sku',
      'Nama Variasi': 'variant_name',
      'Jumlah': 'quantity',
      'Harga Awal': 'item_price',
      'Total Diskon': 'discount_amount',
      'Perkiraan Ongkos Kirim': 'shipping_cost',
      'Total Pembayaran': 'grand_total',
      'Metode Pembayaran': 'payment_method',
      'Username (Pembeli)': 'customer_name',
      'No. Telepon': 'customer_phone',
      'Alamat Pengiriman': 'shipping_address',
      'Kota/Kabupaten': 'shipping_city'
    },
    sampleData: [
      {
        'No. Pesanan': '241028AB1234XY',
        'Waktu Pesanan Dibuat': '2026-10-28 09:20:00',
        'Status Pesanan': 'Selesai',
        'Nama Produk': 'Kaos Polos Cotton Combed 30s',
        'Nomor Referensi SKU': 'KOS-PUT-M',
        'Nama Variasi': 'Putih, M',
        'Jumlah': 2,
        'Harga Awal': 45000,
        'Total Diskon': 5000,
        'Perkiraan Ongkos Kirim': 12000,
        'Total Pembayaran': 97000,
        'Metode Pembayaran': 'ShopeePay',
        'Username (Pembeli)': 'shopee_user_jkt',
        'No. Telepon': '081298765432',
        'Alamat Pengiriman': 'Jl. Sudirman No. 45',
        'Kota/Kabupaten': 'Jakarta Selatan'
      }
    ]
  },

  // ── 5. TOKOPEDIA (Daftar Pesanan) ─────────────────────────────────────
  {
    id: 'tokopedia',
    name: 'Tokopedia (Daftar Pesanan)',
    badge: 'Marketplace',
    sourcePlatformDefault: 'Tokopedia',
    mapping: {
      'Nomor Invoice': 'order_number',
      'Tanggal Pembayaran': 'order_date',
      'Status Terakhir': 'status',
      'Nama Produk': 'product_name',
      'Nomor SKU': 'sku',
      'Jumlah Produk Dibeli': 'quantity',
      'Harga Awal (Rp.)': 'item_price',
      'Total Diskon Produk (Rp.)': 'discount_amount',
      'Biaya Pengiriman Tunai (Rp.)': 'shipping_cost',
      'Total Pembayaran (Rp.)': 'grand_total',
      'Nama Pembeli': 'customer_name',
      'No Telp Pembeli': 'customer_phone',
      'Alamat Pengiriman': 'shipping_address',
      'Kota': 'shipping_city'
    },
    sampleData: [
      {
        'Nomor Invoice': 'INV/20261028/MPL/345678901',
        'Tanggal Pembayaran': '2026-10-28 10:15:00',
        'Status Terakhir': 'Pesanan Selesai',
        'Nama Produk': 'Botol Minum Tumbler Stainless 500ml',
        'Nomor SKU': 'TMB-BLK-500',
        'Jumlah Produk Dibeli': 1,
        'Harga Awal (Rp.)': 85000,
        'Total Diskon Produk (Rp.)': 0,
        'Biaya Pengiriman Tunai (Rp.)': 10000,
        'Total Pembayaran (Rp.)': 95000,
        'Nama Pembeli': 'Dimas Anggara',
        'No Telp Pembeli': '085712349876',
        'Alamat Pengiriman': 'Jl. Dago Asri No. 12',
        'Kota': 'Kota Bandung'
      }
    ]
  },

  // ── 6. TIKTOK SHOP (Order Details) ───────────────────────────────────
  {
    id: 'tiktok_shop',
    name: 'TikTok Shop (Export Order)',
    badge: 'Marketplace',
    sourcePlatformDefault: 'TikTok',
    mapping: {
      'Order ID': 'order_number',
      'Created Time': 'order_date',
      'Order Status': 'status',
      'Product Name': 'product_name',
      'Seller SKU': 'sku',
      'Variation': 'variant_name',
      'Quantity': 'quantity',
      'Item Subtotal': 'item_price',
      'Order Discount': 'discount_amount',
      'Shipping Fee': 'shipping_cost',
      'Order Total Amount': 'grand_total',
      'Buyer Name': 'customer_name',
      'Phone Number': 'customer_phone',
      'Recipient Address': 'shipping_address',
      'City': 'shipping_city'
    },
    sampleData: [
      {
        'Order ID': 'TT-578912345678',
        'Created Time': '2026-10-28 16:45:00',
        'Order Status': 'Delivered',
        'Product Name': 'Lipstick Velvet Matte Lip Cream',
        'Seller SKU': 'LIP-MAT-02',
        'Variation': 'Shade 02 Rose',
        'Quantity': 2,
        'Item Subtotal': 49000,
        'Order Discount': 10000,
        'Shipping Fee': 0,
        'Order Total Amount': 88000,
        'Buyer Name': 'Nadia Putri',
        'Phone Number': '089612345678',
        'Recipient Address': 'Jl. Pemuda No. 8',
        'City': 'Kota Surabaya'
      }
    ]
  },

  // ── 7. SHAPEUP CRM STANDARD ──────────────────────────────────────────
  {
    id: 'shapeup_standard',
    name: 'ShapeUp CRM Standard Format',
    badge: 'Standard',
    sourcePlatformDefault: 'Manual',
    mapping: {
      'No. Pesanan': 'order_number',
      'Tanggal': 'order_date',
      'Platform': 'source_platform',
      'Status Pesanan': 'status',
      'Status Pembayaran': 'payment_status',
      'Metode Pembayaran': 'payment_method',
      'Nama Pelanggan': 'customer_name',
      'No. WhatsApp / HP': 'customer_phone',
      'Email Pelanggan': 'customer_email',
      'Alamat Pengiriman': 'shipping_address',
      'Kota / Kabupaten': 'shipping_city',
      'SKU Produk': 'sku',
      'Nama Produk': 'product_name',
      'Variasi / Modifiers': 'variant_name',
      'Qty': 'quantity',
      'Harga Satuan (Rp)': 'item_price',
      'Diskon Item (Rp)': 'discount_amount',
      'Ongkir (Rp)': 'shipping_cost',
      'Total Transaksi (Rp)': 'grand_total',
      'Dibuat Oleh': 'created_by'
    },
    sampleData: [
      {
        'No. Pesanan': 'ORD-2026-001',
        'Tanggal': '2026-10-28 10:00:00',
        'Platform': 'Manual',
        'Status Pesanan': 'completed',
        'Status Pembayaran': 'paid',
        'Metode Pembayaran': 'Cash',
        'Nama Pelanggan': 'Budi Santoso',
        'No. WhatsApp / HP': '081234567890',
        'Email Pelanggan': 'budi@example.com',
        'Alamat Pengiriman': 'Jl. Kebon Jeruk No. 10',
        'Kota / Kabupaten': 'Jakarta Barat',
        'SKU Produk': 'PROD-001',
        'Nama Produk': 'Kemeja Flannel Pria',
        'Variasi / Modifiers': 'Size L / Navy',
        'Qty': 2,
        'Harga Satuan (Rp)': 150000,
        'Diskon Item (Rp)': 10000,
        'Ongkir (Rp)': 15000,
        'Total Transaksi (Rp)': 305000,
        'Dibuat Oleh': 'Admin Toko'
      }
    ]
  }
]

// ── Download Sample Excel File Helper ───────────────────────────────────────
export function downloadPresetSampleExcel(presetId: string) {
  const preset = ORDER_IMPORT_PRESETS.find(p => p.id === presetId) || ORDER_IMPORT_PRESETS[0]
  
  const ws = XLSX.utils.json_to_sheet(preset.sampleData)
  
  // Set clean column widths
  const colWidths = Object.keys(preset.sampleData[0] || {}).map(k => ({
    wch: Math.max(k.length + 4, 16)
  }))
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Template Import')
  
  const cleanId = preset.id.replace(/[^a-zA-Z0-9_-]/g, '_')
  XLSX.writeFile(wb, `Template_Import_Order_${cleanId}.xlsx`)
}
