export type TenderCategory = 'cash' | 'qris' | 'bank' | 'edc'

export interface POSTender {
  id: string
  name: string
  category: TenderCategory
  account_id: string
  account_code?: string
  account_name?: string
  is_active: boolean
  sort_order: number
}

export interface COAAssetAccount {
  id: string
  code: string
  name: string
  type?: string
  sub_type?: string
}

/**
 * Auto-classifies a Chart of Accounts (COA) asset account into a Tender category.
 */
export function classifyAccountCategory(acc: COAAssetAccount, activeRegisterAccountId?: string | null): TenderCategory {
  if (activeRegisterAccountId && acc.id === activeRegisterAccountId) {
    return 'cash'
  }

  const code = (acc.code || '').trim()
  const name = (acc.name || '').toLowerCase()

  // Cash / Physical Drawer
  if (code === '101000' || name.includes('kas laci') || name.includes('kasir') || name.includes('tunai')) {
    return 'cash'
  }

  // QRIS Gateways
  if (name.includes('qris')) {
    return 'qris'
  }

  // EDC Card Machines
  if (name.includes('edc') || name.includes('debit') || name.includes('kartu')) {
    return 'edc'
  }

  // If code is specifically 101200 and named QRIS/Bank
  if (code === '101200' && (name.includes('qris') || name.includes('pos'))) {
    return 'qris'
  }

  // General Bank / Cash
  if (name.includes('kas') && !name.includes('bank')) {
    return 'cash'
  }

  return 'bank'
}

/**
 * Resolves the active list of POS Tenders for a business.
 * Uses custom configured tenders if present, otherwise auto-generates smart tenders from COA.
 */
export function resolveBusinessTenders(options: {
  accounts: COAAssetAccount[]
  customTenders?: POSTender[] | null
  activeRegisterAccountId?: string | null
}): POSTender[] {
  const { accounts = [], customTenders, activeRegisterAccountId } = options

  const assetAccounts = accounts.filter(
    (a) => a.type === 'ASSET' && (a.code?.startsWith('101') || a.sub_type === 'bank_cash')
  )

  const accountMap = new Map<string, COAAssetAccount>()
  accounts.forEach((a) => accountMap.set(a.id, a))

  // 1. If custom tenders exist and are configured
  if (Array.isArray(customTenders) && customTenders.length > 0) {
    const validTenders = customTenders
      .filter((t) => t.is_active)
      .map((t) => {
        const acc = accountMap.get(t.account_id)
        return {
          ...t,
          account_code: acc?.code || t.account_code,
          account_name: acc?.name || t.account_name || t.name
        }
      })
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    if (validTenders.length > 0) {
      return validTenders
    }
  }

  // 2. Smart Fallback: Auto-generate tenders from asset accounts
  if (assetAccounts.length === 0) {
    return [
      {
        id: 'default-pos-cash',
        name: 'Tunai (Laci Kasir)',
        category: 'cash',
        account_id: 'default-pos-cash',
        account_code: '101000',
        account_name: 'Kas POS (Tunai)',
        is_active: true,
        sort_order: 1
      },
      {
        id: 'default-pos-qris',
        name: 'QRIS POS',
        category: 'qris',
        account_id: 'default-pos-qris',
        account_code: '101200',
        account_name: 'Bank / QRIS POS',
        is_active: true,
        sort_order: 2
      },
      {
        id: 'default-main-bank',
        name: 'Transfer Bank',
        category: 'bank',
        account_id: 'default-main-bank',
        account_code: '101100',
        account_name: 'Kas / Bank Utama',
        is_active: true,
        sort_order: 3
      }
    ]
  }

  const generated: POSTender[] = []

  // Ensure cash drawer is prioritized
  let cashAcc = assetAccounts.find((a) => a.id === activeRegisterAccountId)
  if (!cashAcc) {
    cashAcc = assetAccounts.find((a) => a.code === '101000' || a.name.toLowerCase().includes('kas'))
  }
  if (!cashAcc && assetAccounts.length > 0) {
    cashAcc = assetAccounts[0]
  }

  if (cashAcc) {
    generated.push({
      id: `tender-cash-${cashAcc.id}`,
      name: 'Tunai (Laci Kasir)',
      category: 'cash',
      account_id: cashAcc.id,
      account_code: cashAcc.code,
      account_name: cashAcc.name,
      is_active: true,
      sort_order: 1
    })
  }

  // Generate for other asset accounts
  let order = 2
  assetAccounts.forEach((acc) => {
    if (cashAcc && acc.id === cashAcc.id) return

    const cat = classifyAccountCategory(acc, activeRegisterAccountId)
    let cleanName = acc.name

    // Beautify display names for quick cashier identification
    if (cat === 'qris' && !cleanName.toLowerCase().startsWith('qris')) {
      cleanName = `QRIS ${cleanName}`
    } else if (cat === 'bank' && !cleanName.toLowerCase().startsWith('bank') && !cleanName.toLowerCase().startsWith('transfer')) {
      cleanName = `Transfer ${cleanName}`
    } else if (cat === 'edc' && !cleanName.toLowerCase().startsWith('edc')) {
      cleanName = `EDC ${cleanName}`
    }

    generated.push({
      id: `tender-${acc.id}`,
      name: cleanName,
      category: cat,
      account_id: acc.id,
      account_code: acc.code,
      account_name: acc.name,
      is_active: true,
      sort_order: order++
    })
  })

  // Sort: Cash first, then QRIS, then Bank/EDC
  const categoryPriority: Record<TenderCategory, number> = {
    cash: 1,
    qris: 2,
    bank: 3,
    edc: 4
  }

  return generated.sort((a, b) => {
    const pA = categoryPriority[a.category] || 99
    const pB = categoryPriority[b.category] || 99
    if (pA !== pB) return pA - pB
    return a.sort_order - b.sort_order
  })
}
