// ShapeUp Omnichannel RMA Engine — Shared Types & SMB UX Constants (Client + Server Safe)

export type RmaFulfillmentStage =
  | 'requested'
  | 'approved'
  | 'received_quarantine'
  | 'inspected'
  | 'rejected'
  | 'cancelled'

export type RmaSettlementStage = 'pending' | 'settled' | 'not_applicable'

export type RmaSettlementMethod = 'credit_memo' | 'refund' | 'store_credit' | 'exchange' | 'none'

export type RmaDisposition =
  | 'pending'
  | 'restock'
  | 'quarantine'
  | 'writeoff'
  | 'rtv_vendor'
  | 'lost_in_transit'

export interface RmaReasonOption {
  code: string
  label: string
  waiveFee: boolean
  suggestedDisposition: Exclude<RmaDisposition, 'pending'>
}

export const RMA_REASONS: RmaReasonOption[] = [
  {
    code: 'defective',
    label: 'Cacat Produksi / Rusak Pabrik',
    waiveFee: true,
    suggestedDisposition: 'quarantine'
  },
  {
    code: 'wrong_size',
    label: 'Tukar Ukuran / Varian / Warna',
    waiveFee: false,
    suggestedDisposition: 'restock'
  },
  {
    code: 'not_as_described',
    label: 'Salah Kirim Barang / Tidak Sesuai Pesanan',
    waiveFee: true,
    suggestedDisposition: 'restock'
  },
  {
    code: 'damaged_courier',
    label: 'Rusak Saat Pengiriman Kurir',
    waiveFee: true,
    suggestedDisposition: 'writeoff'
  },
  {
    code: 'cod_failed',
    label: 'Retur Paket COD Gagal Kirim',
    waiveFee: true,
    suggestedDisposition: 'restock'
  },
  {
    code: 'changed_mind',
    label: 'Berubah Pikiran / Batal Sebagian',
    waiveFee: false,
    suggestedDisposition: 'restock'
  },
  {
    code: 'other',
    label: 'Lainnya',
    waiveFee: false,
    suggestedDisposition: 'quarantine'
  }
]

export const RMA_REASON_MAP: Record<string, RmaReasonOption> = Object.fromEntries(
  RMA_REASONS.map((r) => [r.code, r])
)

export interface RmaDispositionOption {
  value: Exclude<RmaDisposition, 'pending'>
  shortLabel: string
  smbDescription: string
  badgeClass: string
}

export const RMA_DISPOSITION_OPTIONS: RmaDispositionOption[] = [
  {
    value: 'restock',
    shortLabel: 'Layak Jual — Masuk Rak Utama',
    smbDescription: 'Barang mulus, langsung menambah stok aktif siap jual.',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200'
  },
  {
    value: 'quarantine',
    shortLabel: 'Tahan di Karantina — Cek Lanjut',
    smbDescription: 'Disimpan di pos karantina tanpa mencemari stok rak utama.',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200'
  },
  {
    value: 'rtv_vendor',
    shortLabel: 'Cacat Pabrik — Klaim ke Supplier',
    smbDescription: 'Diretur balik ke pemasok / memotong tagihan supplier.',
    badgeClass: 'bg-orange-50 text-orange-800 border-orange-200'
  },
  {
    value: 'writeoff',
    shortLabel: 'Rusak Parah — Buang / Rugi',
    smbDescription: 'Tidak layak jual; dicatat sebagai beban kerugian barang rusak.',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200'
  },
  {
    value: 'lost_in_transit',
    shortLabel: 'Hilang di Kurir Ekspedisi',
    smbDescription: 'Paket hilang dalam perjalanan retur; dicatat kerugian kurir.',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-300'
  }
]

export const RMA_DISPOSITION_MAP: Record<string, RmaDispositionOption> = Object.fromEntries(
  RMA_DISPOSITION_OPTIONS.map((d) => [d.value, d])
)

export interface RmaItemRecord {
  id: string
  rma_id: string
  business_id: string
  order_id: string
  order_item_ref: string
  product_id: string | null
  variant_id: string | null
  name: string
  variant_name: string | null
  sku: string | null
  qty: number
  unit_net_price: number
  line_refund: number
  unit_cost: number
  track_stock: boolean
  disposition: RmaDisposition
  quarantine_move_id?: string | null
  resolution_move_id?: string | null
  created_at: string
}

export interface RmaRequestRecord {
  id: string
  business_id: string
  order_id: string
  customer_id: string | null
  rma_number: string
  channel: string
  fulfillment_stage: RmaFulfillmentStage
  settlement_stage: RmaSettlementStage
  settlement_method: RmaSettlementMethod | null
  reason_code: string
  reason_note: string | null
  return_courier: string | null
  return_tracking_number: string | null
  gross_return_amount: number
  restocking_fee: number
  net_credit_amount: number
  refund_paid_amount: number
  credit_memo_amount: number
  store_credit_issued: number
  exchange_total: number
  shortfall_collected: number
  receipt_transaction_id?: string | null
  disposition_transaction_id?: string | null
  settlement_transaction_id?: string | null
  created_by_name?: string | null
  received_at?: string | null
  inspected_at?: string | null
  settled_at?: string | null
  created_at: string
  updated_at: string
  rma_items?: RmaItemRecord[]
  orders?: {
    id: string
    order_number: string
    grand_total: number
    amount_paid: number
    payment_status: string | null
    status: string | null
    source_platform: string | null
    customers?: {
      id: string
      name: string
      phone: string | null
    } | null
  } | null
}

export function generateRmaNumber(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `RMA-${y}${m}${d}-${rand}`
}

export function buildRmaWhatsAppMessage(params: {
  businessName: string
  rmaNumber: string
  orderNumber: string
  customerName?: string | null
  itemsSummary: string
  businessAddress?: string | null
}): string {
  const greeting = params.customerName ? `Halo Kak *${params.customerName}*,` : 'Halo Kak,'
  const addrLine = params.businessAddress
    ? `\n📍 *Alamat Pengiriman Retur:*\n${params.businessAddress}\n`
    : ''
  return [
    greeting,
    `Pengajuan retur Anda untuk pesanan *#${params.orderNumber}* di *${params.businessName}* telah kami setujui.`,
    '',
    `📋 *Nomor Tiket RMA:* ${params.rmaNumber}`,
    `📦 *Item Retur:* ${params.itemsSummary}`,
    addrLine,
    `Mohon tuliskan kode *${params.rmaNumber}* di luar paket dan informasikan nomor resi pengiriman balik kepada kami agar gudang dapat memprosesnya dengan cepat. Terima kasih!`
  ]
    .filter(Boolean)
    .join('\n')
}

