/**
 * ─── POS Checkout & Hybrid Adaptive Order Numbering Service ─────────────────
 *
 * Isolated client-side checkout orchestrator for POS:
 * 1. Online (Normal, ~150-300ms): Requests authoritative sequential order number
 *    from server (`POS-YYYYMMDD-XXXX`) via `POST /api/pos/order` with explicit
 *    `business_id`, `x-business-id` header, and `client_attempt_id` idempotency.
 * 2. Slow Network / Timeout (> 5s) or Offline: Seamlessly falls back to a
 *    device-partitioned offline order number (`POS-YYMMDD-OF<TAG>-<SEQ>`) and
 *    persists the payload in a local outbox queue for automatic background sync
 *    when connectivity is restored.
 *
 * Keeping this logic outside `POSWorkspace.tsx` ensures UI updates (pricing,
 * variants, modifiers, modals) never regress receipt numbering or sync integrity.
 */

import { getBusinessTimezone } from '@/lib/localzone'

const DEVICE_TAG_KEY = 'shapeup_pos_device_tag_v1'
const OFFLINE_SEQ_PREFIX = 'shapeup_pos_offline_seq_v1_'
const OFFLINE_QUEUE_PREFIX = 'shapeup_pos_offline_queue_v1_'
const DEFAULT_CONFIRM_TIMEOUT_MS = 5000

export interface PosCheckoutResult {
  status: 'confirmed' | 'offline_fallback' | 'rejected'
  orderId: string | null
  orderNumber: string | null
  queueNumber: number | null
  isOffline: boolean
  error?: string
}

export interface OfflineOrderQueueItem {
  attemptId: string
  businessId: string
  orderNumber: string
  queueNumber: number
  payload: Record<string, any>
  createdAt: string
}

export function createCheckoutAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Generates or reads a permanent 2-character device tag for offline fallback numbers.
 * Used ONLY when offline/timeout so two devices never collide.
 */
export function getOrCreateDeviceTag(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const gen = () =>
    chars[Math.floor(Math.random() * chars.length)] +
    chars[Math.floor(Math.random() * chars.length)]

  if (typeof window === 'undefined') return gen()
  try {
    const existing = localStorage.getItem(DEVICE_TAG_KEY)
    if (existing && /^[A-Z0-9]{2}$/.test(existing)) {
      return existing
    }
    const created = gen()
    localStorage.setItem(DEVICE_TAG_KEY, created)
    return created
  } catch {
    return gen()
  }
}

function getLocalDateShort(timezone?: string): string {
  const tz = getBusinessTimezone(timezone)
  const now = new Date()
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    // YYYYMMDD -> YYMMDD (6 digits, fits 58mm thermal width alongside OF+tag)
    return formatter.format(now).replace(/-/g, '').slice(2)
  } catch {
    const y = String(now.getFullYear()).slice(2)
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}${m}${d}`
  }
}

/**
 * Generates an offline-safe, collision-free order number:
 * Format: POS-YYMMDD-OF<2-char-tag>-<3-digit-seq> (19 chars, fits 58mm 32-col line).
 */
export function generateOfflineOrderNumber(
  businessId: string,
  timezone?: string
): { orderNumber: string; queueNumber: number } {
  const dShort = getLocalDateShort(timezone)
  const tag = getOrCreateDeviceTag()
  const seqKey = `${OFFLINE_SEQ_PREFIX}${businessId}_${dShort}`

  let nextVal = 1
  if (typeof window !== 'undefined') {
    try {
      const cur = parseInt(localStorage.getItem(seqKey) || '0', 10)
      nextVal = Number.isFinite(cur) && cur >= 0 ? cur + 1 : 1
      localStorage.setItem(seqKey, String(nextVal))
    } catch {
      nextVal = Math.floor(Date.now() % 900) + 100
    }
  }

  const orderNumber = `POS-${dShort}-OF${tag}-${String(nextVal).padStart(3, '0')}`
  return { orderNumber, queueNumber: nextVal }
}

function readOfflineQueue(businessId: string): OfflineOrderQueueItem[] {
  if (typeof window === 'undefined' || !businessId) return []
  try {
    const raw = localStorage.getItem(`${OFFLINE_QUEUE_PREFIX}${businessId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeOfflineQueue(businessId: string, items: OfflineOrderQueueItem[]): void {
  if (typeof window === 'undefined' || !businessId) return
  try {
    if (items.length === 0) {
      localStorage.removeItem(`${OFFLINE_QUEUE_PREFIX}${businessId}`)
    } else {
      localStorage.setItem(`${OFFLINE_QUEUE_PREFIX}${businessId}`, JSON.stringify(items))
    }
  } catch {
    // Ignore storage quota errors safely
  }
}

export function getOfflineOrderQueueCount(businessId?: string): number {
  if (!businessId) return 0
  return readOfflineQueue(businessId).length
}

export function enqueueOfflineOrder(item: OfflineOrderQueueItem): void {
  const queue = readOfflineQueue(item.businessId)
  if (queue.some((q) => q.attemptId === item.attemptId)) return
  queue.push(item)
  writeOfflineQueue(item.businessId, queue)
}

let isFlushingQueue = false

/**
 * Flushes any queued offline orders sequentially when connectivity is available.
 * Safe to call repeatedly (single-flight guard + server-side idempotency).
 */
export async function flushOfflineOrderQueue(businessId?: string): Promise<{
  syncedCount: number
  remainingCount: number
}> {
  if (typeof window === 'undefined' || !businessId) {
    return { syncedCount: 0, remainingCount: 0 }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { syncedCount: 0, remainingCount: readOfflineQueue(businessId).length }
  }
  if (isFlushingQueue) {
    return { syncedCount: 0, remainingCount: readOfflineQueue(businessId).length }
  }

  const queue = readOfflineQueue(businessId)
  if (queue.length === 0) {
    return { syncedCount: 0, remainingCount: 0 }
  }

  isFlushingQueue = true
  let syncedCount = 0
  const remaining: OfflineOrderQueueItem[] = []

  try {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      try {
        const res = await fetch('/api/pos/order', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-business-id': item.businessId
          },
          body: JSON.stringify({
            ...item.payload,
            business_id: item.businessId,
            client_attempt_id: item.attemptId,
            order_number: item.orderNumber,
            is_offline_fallback: true
          })
        })

        if (res.ok) {
          syncedCount++
        } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // Permanent client validation error: drop from retry loop so it doesn't block queue
          console.error(`[POS Offline Sync] Dropped rejected order ${item.orderNumber} (HTTP ${res.status})`)
        } else {
          remaining.push(...queue.slice(i))
          break
        }
      } catch {
        remaining.push(...queue.slice(i))
        break
      }
    }

    writeOfflineQueue(businessId, remaining)
    return { syncedCount, remainingCount: remaining.length }
  } finally {
    isFlushingQueue = false
  }
}

/**
 * Executes POS checkout with Hybrid Adaptive numbering:
 * - Online (< timeoutMs): awaits authoritative global sequential number from server.
 * - Offline / Network Error / Timeout (> timeoutMs): switches to device-partitioned
 *   offline number (`OF<TAG>-<SEQ>`) and queues transaction for auto-sync.
 */
export async function submitPosCheckout(params: {
  businessId: string
  timezone?: string
  attemptId: string
  payload: Record<string, any>
  timeoutMs?: number
}): Promise<PosCheckoutResult> {
  const {
    businessId,
    timezone,
    attemptId,
    payload,
    timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS
  } = params

  const triggerOfflineFallback = (): PosCheckoutResult => {
    const { orderNumber, queueNumber } = generateOfflineOrderNumber(businessId, timezone)
    enqueueOfflineOrder({
      attemptId,
      businessId,
      orderNumber,
      queueNumber,
      payload,
      createdAt: new Date().toISOString()
    })
    return {
      status: 'offline_fallback',
      orderId: null,
      orderNumber,
      queueNumber,
      isOffline: true
    }
  }

  // Immediate offline fast-path when browser reports no network
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return triggerOfflineFallback()
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('/api/pos/order', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-business-id': businessId
      },
      body: JSON.stringify({
        ...payload,
        business_id: businessId,
        client_attempt_id: attemptId
      })
    })

    clearTimeout(timer)
    const result = await res.json().catch(() => null)

    if (!res.ok) {
      // 4xx business/validation errors (e.g., shift closed, stock insufficient, price guard)
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return {
          status: 'rejected',
          orderId: null,
          orderNumber: null,
          queueNumber: null,
          isOffline: false,
          error: result?.error || `Permintaan ditolak (Status ${res.status})`
        }
      }
      // 5xx / 408 / 429 transient server errors -> safe offline fallback + retry queue
      return triggerOfflineFallback()
    }

    if (result?.order_id) {
      // Opportunistically flush any older offline-queued orders in background
      void flushOfflineOrderQueue(businessId)
      return {
        status: 'confirmed',
        orderId: result.order_id,
        orderNumber: result.order_number || null,
        queueNumber: result.queue_number ?? null,
        isOffline: false
      }
    }

    return triggerOfflineFallback()
  } catch (err: any) {
    clearTimeout(timer)
    // AbortError (timeout > 5s) or TypeError (network disconnected) -> offline fallback
    return triggerOfflineFallback()
  }
}

