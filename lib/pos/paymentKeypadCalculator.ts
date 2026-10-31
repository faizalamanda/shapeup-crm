export type TenderCategory = 'cash' | 'qris' | 'bank' | 'edc'

export interface KeypadTenderLine {
  id: string
  tenderId?: string
  accountId: string
  accountCode?: string
  accountName?: string
  tenderName: string
  category: TenderCategory
  amount: number
  cashReceived: number
  referenceNumber: string
}

export interface KeypadCalculationResult {
  totalAllocated: number
  totalCashReceived: number
  totalChange: number
  remainingBill: number
  isFullyCovered: boolean
  isOverpaid: boolean
  statusLabel: 'LUNAS' | 'BELUM LUNAS' | 'LEBIH'
}

/**
 * Calculates two-way balance (Sisa Tagihan vs Kembalian) for multi-tender lines.
 * Strictly respects non-cash ceiling: non-cash cannot produce change.
 */
export function calculatePaymentBalance(
  lines: KeypadTenderLine[],
  targetBill: number
): KeypadCalculationResult {
  let totalAllocated = 0
  let totalCashReceived = 0
  let totalChange = 0

  for (const line of lines) {
    const amt = Math.max(0, Number(line.amount) || 0)
    totalAllocated += amt

    if (line.category === 'cash') {
      const rec = Math.max(0, Number(line.cashReceived) || 0)
      totalCashReceived += rec
      if (rec > amt) {
        totalChange += (rec - amt)
      }
    } else {
      totalCashReceived += amt
    }
  }

  const remainingBill = Math.max(0, targetBill - totalAllocated)
  const isFullyCovered = totalAllocated >= targetBill
  const isOverpaid = totalAllocated > targetBill

  let statusLabel: 'LUNAS' | 'BELUM LUNAS' | 'LEBIH' = 'BELUM LUNAS'
  if (totalAllocated === targetBill) statusLabel = 'LUNAS'
  else if (totalAllocated > targetBill) statusLabel = 'LEBIH'

  return {
    totalAllocated,
    totalCashReceived,
    totalChange,
    remainingBill,
    isFullyCovered,
    isOverpaid,
    statusLabel
  }
}

/**
 * Processes numpad actions with Auto-Replace (First Touch) behavior.
 */
export function processNumpadAction(params: {
  currentValue: number
  action: string
  isFirstTouch: boolean
  maxLimit?: number
}): { nextValue: number; nextFirstTouch: boolean } {
  const { currentValue, action, isFirstTouch, maxLimit = 2_000_000_000 } = params

  if (action === 'CLEAR') {
    return { nextValue: 0, nextFirstTouch: false }
  }

  if (action === 'BACKSPACE') {
    if (isFirstTouch) {
      return { nextValue: 0, nextFirstTouch: false }
    }
    const s = String(currentValue)
    const nextVal = s.length > 1 ? Number(s.slice(0, -1)) : 0
    return { nextValue: nextVal, nextFirstTouch: false }
  }

  if (action === '+10000') {
    const nextVal = Math.min(maxLimit, currentValue + 10000)
    return { nextValue: nextVal, nextFirstTouch: false }
  }

  if (action === '+20000') {
    const nextVal = Math.min(maxLimit, currentValue + 20000)
    return { nextValue: nextVal, nextFirstTouch: false }
  }

  if (action === '+50000') {
    const nextVal = Math.min(maxLimit, currentValue + 50000)
    return { nextValue: nextVal, nextFirstTouch: false }
  }

  // Handle digit inputs: '0'..'9', '000', '00'
  let nextVal = currentValue

  if (isFirstTouch) {
    // First touch replaces the prefilled value
    if (action === '000' || action === '00' || action === '0') {
      nextVal = 0
    } else {
      nextVal = Number(action) || 0
    }
  } else {
    // Subsequent touches append to existing value
    if (action === '000') {
      if (currentValue > 0) nextVal = Number(String(currentValue) + '000')
    } else if (action === '00') {
      if (currentValue > 0) nextVal = Number(String(currentValue) + '00')
    } else {
      const s = currentValue === 0 ? action : String(currentValue) + action
      nextVal = Number(s) || 0
    }
  }

  if (nextVal > maxLimit) {
    nextVal = maxLimit
  }

  return { nextValue: nextVal, nextFirstTouch: false }
}

/**
 * Generates dynamic quick cash chips based on remaining or target bill.
 */
export function generateQuickCashChips(target: number): number[] {
  if (target <= 0) return [0]

  const chips: number[] = [target]
  const round10 = Math.ceil(target / 10000) * 10000
  const round20 = Math.ceil(target / 20000) * 20000
  const round50 = Math.ceil(target / 50000) * 50000
  const round100 = Math.ceil(target / 100000) * 100000

  if (round10 > target && !chips.includes(round10)) chips.push(round10)
  if (round20 > target && !chips.includes(round20)) chips.push(round20)
  if (round50 > target && !chips.includes(round50)) chips.push(round50)
  if (round100 > target && !chips.includes(round100)) chips.push(round100)

  const commonBills = [50000, 100000, 200000, 500000]
  for (const bill of commonBills) {
    if (bill > target && !chips.includes(bill)) {
      chips.push(bill)
    }
  }

  return chips.slice(0, 4)
}
