import { SupabaseClient } from '@supabase/supabase-js'
import { generateItemizedHppJournalLines } from './hppHelper'
import { earnPointsForOrder, reversePointsForOrder } from '@/plugins/loyalty/helpers/loyaltyApi'
import { getOrCreateDefaultAccounts } from './accountHelper'
import { resolveOrderProducts, applyStockMovement } from './inventoryHelper'
import { postJournalTransaction } from './journalHelper'
import { calculateProductsHppBatch } from './recipeHelper'

const isCodOrder = (order: any) => {
  return (order.payment_method || '').toUpperCase().includes('COD')
}

// In-memory cache for integration settings per businessId
const integrationConfigCache: Record<string, {
  defaultHppPct: number
  stockReductionStatuses: Record<string, string[]>
  journalHppStatuses: Record<string, string[]>
  salesJournalDateBasis: Record<string, 'processing_date' | 'order_date'>
  timestamp: number
}> = {}

export function invalidateIntegrationConfigCache(businessId?: string) {
  if (businessId) {
    delete integrationConfigCache[businessId]
  } else {
    for (const k of Object.keys(integrationConfigCache)) {
      delete integrationConfigCache[k]
    }
  }
}

async function getIntegrationConfigs(businessId: string, platform: string, supabase: SupabaseClient) {
  const now = Date.now()
  const pKey = platform.toLowerCase()
  const cached = integrationConfigCache[businessId]
  if (cached && (now - cached.timestamp < 60000) && cached.stockReductionStatuses[pKey]) {
    return {
      defaultHppPct: cached.defaultHppPct,
      stockReductionStatuses: cached.stockReductionStatuses[pKey] || ['shipped', 'completed'],
      journalHppStatuses: cached.journalHppStatuses[pKey] || ['shipped', 'completed'],
      salesJournalDateBasis: cached.salesJournalDateBasis?.[pKey] || 'processing_date'
    }
  }

  let defaultHppPct = 0
  let stockReductionStatuses = ['shipped', 'completed']
  let journalHppStatuses = ['shipped', 'completed']
  let salesJournalDateBasis: 'processing_date' | 'order_date' = 'processing_date'

  try {
    const { data: configRows } = await supabase
      .from('integrations')
      .select('platform_name, api_credentials')
      .filter('api_credentials->>business_id', 'eq', businessId)

    const mapConfig: Record<string, any> = {}
    if (Array.isArray(configRows)) {
      configRows.forEach((row) => {
        mapConfig[row.platform_name] = row.api_credentials || {}
      })
    }

    const globalCreds = mapConfig['global'] || {}
    if (typeof globalCreds.global_default_hpp_percentage === 'number') {
      defaultHppPct = Math.max(0, Math.min(100, globalCreds.global_default_hpp_percentage))
    }

    const platformCreds = mapConfig[pKey] || {}
    const useGlobal = platformCreds.use_global_settings !== false

    if (!useGlobal && Array.isArray(platformCreds.stock_reduction_status) && platformCreds.stock_reduction_status.length > 0) {
      stockReductionStatuses = platformCreds.stock_reduction_status
    } else if (Array.isArray(globalCreds.global_stock_reduction_status) && globalCreds.global_stock_reduction_status.length > 0) {
      stockReductionStatuses = globalCreds.global_stock_reduction_status
    }

    if (!useGlobal && Array.isArray(platformCreds.journal_hpp_status) && platformCreds.journal_hpp_status.length > 0) {
      journalHppStatuses = platformCreds.journal_hpp_status
    } else if (Array.isArray(globalCreds.global_journal_hpp_status) && globalCreds.global_journal_hpp_status.length > 0) {
      journalHppStatuses = globalCreds.global_journal_hpp_status
    }

    if (!useGlobal && platformCreds.sales_journal_date_basis) {
      salesJournalDateBasis = platformCreds.sales_journal_date_basis === 'order_date' ? 'order_date' : 'processing_date'
    } else if (globalCreds.global_sales_journal_date_basis) {
      salesJournalDateBasis = globalCreds.global_sales_journal_date_basis === 'order_date' ? 'order_date' : 'processing_date'
    }

    integrationConfigCache[businessId] = {
      defaultHppPct,
      stockReductionStatuses: { ...(cached?.stockReductionStatuses || {}), [pKey]: stockReductionStatuses },
      journalHppStatuses: { ...(cached?.journalHppStatuses || {}), [pKey]: journalHppStatuses },
      salesJournalDateBasis: { ...(cached?.salesJournalDateBasis || {}), [pKey]: salesJournalDateBasis },
      timestamp: now
    }
  } catch (err) {
    console.warn('Failed to load integration config:', err)
  }

  return { defaultHppPct, stockReductionStatuses, journalHppStatuses, salesJournalDateBasis }
}

export async function syncOrderToLedger(
  orderId: string,
  supabase: SupabaseClient,
  preloadedOrder?: any
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Fetch the order if not preloaded
    let order = preloadedOrder
    if (!order || order.subtotal === undefined || order.items_json === undefined) {
      const { data: fetchedOrder, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single()

      if (orderErr || !fetchedOrder) {
        throw new Error(`Order not found or error: ${orderErr?.message || 'unknown'}`)
      }
      order = fetchedOrder
    }

    const { business_id: businessId, order_number: orderNumber, status, grand_total } = order
    const platform = order.source_platform || 'WooCommerce'
    const isCod = isCodOrder(order)
    const items = Array.isArray(order.items_json) ? order.items_json : []

    // FIX: Parallelkan 2 calls independen (accounts + config)
    const [accountMap, integrationConfigResult] = await Promise.all([
      getOrCreateDefaultAccounts(businessId, supabase),
      getIntegrationConfigs(businessId, platform, supabase),
    ])

    const { defaultHppPct, stockReductionStatuses, journalHppStatuses, salesJournalDateBasis } = integrationConfigResult

    // resolveOrderProducts dijalankan setelah config selesai (butuh defaultHppPct)
    const matchedProducts = await resolveOrderProducts(items, businessId, defaultHppPct, supabase)

    // 4. Fetch existing transactions — ALWAYS check DB to prevent duplicate sales/payment transactions
    let salesTx: any = undefined
    let paymentTx: any = undefined
    let reversalSalesTx: any = undefined
    let reversalPaymentTx: any = undefined

    const { data: txs, error: txsErr } = await supabase
      .from('transactions')
      .select('*, journal_lines(*)')
      .eq('order_id', orderId)

    if (txsErr) {
      throw new Error(`Failed to fetch existing transactions: ${txsErr.message}`)
    }

      const isSalesTx = (tx: any) => 
        (tx.description.includes('Penjualan') || tx.description.includes('Penerbitan') || tx.description.includes('Sales')) && 
        !tx.description.includes('Pembatalan') && !tx.description.includes('Retur') && !tx.description.includes('Refund') && !tx.description.includes('Reversal')

      const isPaymentTx = (tx: any) => 
        (tx.description.includes('Pelunasan') || tx.description.includes('Pembayaran') || tx.description.includes('Payment')) && 
        !tx.description.includes('Pembatalan') && !tx.description.includes('Retur') && !tx.description.includes('Refund') && !tx.description.includes('Reversal')

      const isReversalSalesTx = (tx: any) => 
        (tx.description.includes('Pembatalan') || tx.description.includes('Retur') || tx.description.includes('Refund') || tx.description.includes('Reversal')) && 
        (tx.description.includes('Penjualan') || tx.description.includes('Penerbitan') || tx.description.includes('Sales'))

      const isReversalPaymentTx = (tx: any) => 
        (tx.description.includes('Pembatalan') || tx.description.includes('Retur') || tx.description.includes('Refund') || tx.description.includes('Reversal')) && 
        (tx.description.includes('Pelunasan') || tx.description.includes('Pembayaran') || tx.description.includes('Payment'))

      salesTx = txs?.find(isSalesTx)
      paymentTx = txs?.find(isPaymentTx)
      reversalSalesTx = txs?.find(isReversalSalesTx)
      reversalPaymentTx = txs?.find(isReversalPaymentTx)

    // Determine payment date
    let paymentDate = new Date().toISOString()
    if (platform === 'WooCommerce') {
      const raw = order.raw_source_data || {}
      if (isCod) {
        if (raw.date_completed_gmt) paymentDate = new Date(raw.date_completed_gmt.endsWith('Z') ? raw.date_completed_gmt : raw.date_completed_gmt + 'Z').toISOString()
        else if (raw.date_completed) paymentDate = new Date(raw.date_completed.includes('+') || raw.date_completed.endsWith('Z') ? raw.date_completed : raw.date_completed + '+07:00').toISOString()
        else paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
      } else {
        if (raw.date_paid_gmt) paymentDate = new Date(raw.date_paid_gmt.endsWith('Z') ? raw.date_paid_gmt : raw.date_paid_gmt + 'Z').toISOString()
        else if (raw.date_paid) paymentDate = new Date(raw.date_paid.includes('+') || raw.date_paid.endsWith('Z') ? raw.date_paid : raw.date_paid + '+07:00').toISOString()
        else paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
      }
    }

    const isSalesTriggered = stockReductionStatuses.includes(status) || 
                             journalHppStatuses.includes(status) ||
                             status === 'completed'

    const orderRef = `Order #${orderNumber}`

    // Determine precise order / shipped move date
    let orderMoveDate = order.updated_at ? new Date(order.updated_at).toISOString() : new Date().toISOString()
    const raw = order.raw_source_data || {}
    if (raw.date_shipped_gmt) orderMoveDate = new Date(raw.date_shipped_gmt + 'Z').toISOString()
    else if (raw.date_shipped) orderMoveDate = new Date(raw.date_shipped).toISOString()
    else if (raw.date_completed_gmt) orderMoveDate = new Date(raw.date_completed_gmt + 'Z').toISOString()
    else if (raw.date_completed) orderMoveDate = new Date(raw.date_completed).toISOString()

    // 6. State Machine for Transitions
    if (isSalesTriggered) {
      // 6.1 SALES POSTING
      let sharedHppMap: Map<string, any> | undefined
      const needsHpp = stockReductionStatuses.includes(status) || journalHppStatuses.includes(status)

      if (needsHpp && matchedProducts.length > 0) {
        const productIds = matchedProducts.map((m: any) => m.dbProduct?.id).filter(Boolean)
        if (productIds.length > 0) {
          sharedHppMap = await calculateProductsHppBatch(productIds, supabase)
        }
      }

      // Stock Deduction — STRICTLY obey user settings (stockReductionStatuses)
      if (stockReductionStatuses.includes(status)) {
        await applyStockMovement(businessId, matchedProducts, 'deduct', orderRef, supabase, sharedHppMap, orderId, 'order', 'done', orderMoveDate)
      }

      // Check if it's a partial commit (tx exists but has 0 lines)
      const isPartialCommit = salesTx && salesTx.journal_lines && salesTx.journal_lines.length === 0
      const shouldCreateSalesLines = !salesTx || isPartialCommit

      if (shouldCreateSalesLines) {
        const sub = parseFloat(order.subtotal) || 0
        const ship = parseFloat(order.shipping_cost) || 0
        const fee = parseFloat(order.other_fees) || 0
        const disc = parseFloat(order.discount_amount) || 0
        const grand = parseFloat(order.grand_total) || 0

        const journalLines: any[] = []

        // Debit: Piutang
        if (grand > 0) journalLines.push({ account_id: accountMap['103000'], debit: grand, credit: 0 })
        else if (grand < 0) journalLines.push({ account_id: accountMap['103000'], debit: 0, credit: Math.abs(grand) })

        // Debit: Diskon
        if (disc > 0) journalLines.push({ account_id: accountMap['401100'], debit: disc, credit: 0 })

        // Credit: Pendapatan
        if (sub > 0) journalLines.push({ account_id: accountMap['401000'], debit: 0, credit: sub })

        // Credit: Ongkir
        if (ship > 0) journalLines.push({ account_id: accountMap['402000'], debit: 0, credit: ship })

        // Credit/Debit: Admin
        if (fee > 0) journalLines.push({ account_id: accountMap['403000'], debit: 0, credit: fee })
        else if (fee < 0) journalLines.push({ account_id: accountMap['403000'], debit: Math.abs(fee), credit: 0 })

        // HPP Lines — reuse sharedHppMap (tidak query ulang)
        if (journalHppStatuses.includes(status)) {
          const { journalLines: hppLines } = await generateItemizedHppJournalLines(
            matchedProducts,
            accountMap,
            'temp',
            supabase,
            sharedHppMap  // FIX: pass pre-computed hppMap, skip re-query
          )
          if (hppLines.length > 0) journalLines.push(...hppLines)
        }

        let salesDate = order.order_date_utc || order.order_date || new Date().toISOString()
        if (salesJournalDateBasis === 'processing_date') {
          if (paymentDate && !isCod) {
            salesDate = paymentDate
          } else if (orderMoveDate) {
            salesDate = orderMoveDate
          } else if (order.updated_at) {
            salesDate = new Date(order.updated_at).toISOString()
          }
        }

        if (isPartialCommit && salesTx) {
          const dbJournalLines = journalLines.map(line => ({
            transaction_id: salesTx.id,
            account_id: line.account_id,
            debit: line.debit || 0,
            credit: line.credit || 0
          }))
          await supabase.from('journal_lines').insert(dbJournalLines)
        } else {
          await postJournalTransaction(
            businessId, 
            orderId, 
            salesDate, 
            `Penjualan ${platform} #${orderNumber}`, 
            journalLines, 
            supabase,
            false // Always check existing to prevent duplicate transactions
          )
        }
      } else {
        // Fallback for HPP if salesTx exists but missed HPP lines
        const existingLines = salesTx.journal_lines || []
        const hasHppLine = existingLines.some((jl: any) => jl.account_id === accountMap['501000'])
        
        if (!hasHppLine && journalHppStatuses.includes(status)) {
          const { journalLines: hppLines } = await generateItemizedHppJournalLines(
            matchedProducts,
            accountMap,
            salesTx.id,
            supabase
          )
          if (hppLines.length > 0) {
            const dbHppLines = hppLines.map((line: any) => ({
              transaction_id: salesTx.id,
              account_id: line.account_id,
              debit: line.debit || 0,
              credit: line.credit || 0
            }))
            await supabase.from('journal_lines').insert(dbHppLines)
          }
        }

        // Align salesTx.date with setting if different
        let expectedSalesDate = order.order_date_utc || order.order_date || new Date().toISOString()
        if (salesJournalDateBasis === 'processing_date') {
          if (paymentDate && !isCod) {
            expectedSalesDate = paymentDate
          } else if (orderMoveDate) {
            expectedSalesDate = orderMoveDate
          } else if (order.updated_at) {
            expectedSalesDate = new Date(order.updated_at).toISOString()
          }
        }
        if (salesTx && expectedSalesDate && salesTx.date !== expectedSalesDate) {
          await supabase.from('transactions').update({ date: expectedSalesDate }).eq('id', salesTx.id)
          salesTx.date = expectedSalesDate
        }
      }

      // 6.2 PAYMENT POSTING
      const numGrandTotal = parseFloat(grand_total) || 0
      const rawOrderData = order.raw_source_data || {}
      const hasDatePaid = !!rawOrderData.date_paid
      const isWooNonCodPaid = platform === 'WooCommerce' && !isCod && (hasDatePaid || ['processing', 'shipped', 'completed'].includes(status))
      const isExplicitPaid = order.payment_status === 'paid' || (order.amount_paid !== undefined && Number(order.amount_paid) >= numGrandTotal - 0.01 && numGrandTotal > 0)
      const isCompletedPaid = status === 'completed'
      const isOrderPaid = isExplicitPaid || isCompletedPaid || isWooNonCodPaid

      if (isOrderPaid) {
        // Check if order_payments already has entries
        const { data: existingOrderPays } = await supabase
          .from('order_payments')
          .select('*')
          .eq('order_id', orderId)
          .eq('payment_kind', 'payment')

        let paymentLines: any[] = []
        let totalPaymentAmount = 0
        let effectivePostResult: any = null

        if (!paymentTx) {
          if (existingOrderPays && existingOrderPays.length > 0) {
            // Multi-tender / Split / Partial payment from order_payments
            for (const p of existingOrderPays) {
              const pAmt = Number(p.amount) || 0
              if (pAmt <= 0) continue
              const accId = p.payment_method_account_id || (p.payment_method === 'cash' ? accountMap['101000'] : accountMap['101200'])
              paymentLines.push({
                account_id: accId,
                debit: pAmt,
                credit: 0
              })
              totalPaymentAmount += pAmt
            }
            if (totalPaymentAmount > 0) {
              paymentLines.push({
                account_id: accountMap['103000'],
                debit: 0,
                credit: totalPaymentAmount
              })
            }
          } else {
            // Single-payment fallback (e.g. WooCommerce or legacy orders)
            const payAccountCode = isCod ? '101000' : '101200'
            const effectivePayAmount = numGrandTotal
            if (effectivePayAmount > 0) {
              paymentLines = [
                { account_id: accountMap[payAccountCode], debit: effectivePayAmount, credit: 0 },
                { account_id: accountMap['103000'], debit: 0, credit: effectivePayAmount }
              ]
              totalPaymentAmount = effectivePayAmount
            }
          }

          if (paymentLines.length > 0 && totalPaymentAmount > 0) {
            effectivePostResult = await postJournalTransaction(
              businessId,
              orderId,
              paymentDate,
              `Pembayaran ${platform} #${orderNumber}`,
              paymentLines,
              supabase,
              false // Always check existing to prevent duplicate transactions
            )

            // Link transaction_id back to order_payments if they existed without transaction_id
            if (effectivePostResult?.transactionId && existingOrderPays && existingOrderPays.length > 0) {
              const allPayIds = existingOrderPays.map((p: any) => p.id)
              if (allPayIds.length > 0) {
                await supabase
                  .from('order_payments')
                  .update({ 
                    transaction_id: effectivePostResult.transactionId,
                    created_at: paymentDate,
                    date: paymentDate ? paymentDate.split('T')[0] : undefined
                  })
                  .in('id', allPayIds)
              }
            }
          }
        } else if (paymentTx && existingOrderPays && existingOrderPays.length > 0) {
          // Align transaction_id and created_at if paymentTx exists
          const unlinkedIds = existingOrderPays.filter((p: any) => !p.transaction_id).map((p: any) => p.id)
          if (unlinkedIds.length > 0) {
            await supabase
              .from('order_payments')
              .update({ 
                transaction_id: paymentTx.id,
                created_at: paymentTx.date || paymentDate,
                date: (paymentTx.date || paymentDate).split('T')[0]
              })
              .in('id', unlinkedIds)
          }
        }

        // 6.3 RECORD UNIFIED ORDER PAYMENT ENTRY (Single Source of Truth)
        // If order_payments has 0 rows, ensure a line is inserted so Payment History is never blank
        let finalAmountPaid = numGrandTotal
        if (!existingOrderPays || existingOrderPays.length === 0) {
          try {
            const txId = effectivePostResult?.transactionId || paymentTx?.id || null
            const cashReceived = Number(order.cash_received || rawOrderData.cash_received || 0)
            const changeAmount = Number(order.change_amount || rawOrderData.change_amount || 0)
            const isCashMethod = String(order.payment_method || '').toLowerCase() === 'cash'
            const payAccountCode = isCod ? '101000' : '101200'
            const effectivePayAmount = totalPaymentAmount > 0 ? totalPaymentAmount : numGrandTotal

            await supabase.from('order_payments').insert({
              payment_kind: 'payment',
              business_id: businessId,
              order_id: orderId,
              transaction_id: txId,
              shift_id: order.shift_id || null,
              date: paymentDate ? paymentDate.split('T')[0] : new Date().toISOString().split('T')[0],
              amount: effectivePayAmount,
              payment_method: order.payment_method || (isCod ? 'Cash/COD' : 'Bank Transfer'),
              payment_method_account_id: accountMap[payAccountCode],
              cash_received: cashReceived || (isCashMethod ? effectivePayAmount : 0),
              change_amount: changeAmount,
              notes: `Pembayaran ${platform} #${orderNumber}`,
              created_at: paymentDate || new Date().toISOString()
            })
            finalAmountPaid = effectivePayAmount
          } catch (payErr) {
            console.warn('[orderLedger] Failed to record fallback order_payments entry:', payErr)
          }
        } else {
          finalAmountPaid = existingOrderPays.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
        }

        // 6.4 SYNCHRONIZE orders.payment_status & orders.amount_paid
        const finalPaymentStatus: 'paid' | 'partial' | 'unpaid' = 
          finalAmountPaid >= numGrandTotal - 0.01 ? 'paid' : (finalAmountPaid > 0 ? 'partial' : 'unpaid')

        if (order.payment_status !== finalPaymentStatus || Number(order.amount_paid) !== finalAmountPaid) {
          await supabase.from('orders').update({
            payment_status: finalPaymentStatus,
            amount_paid: finalAmountPaid
          }).eq('id', orderId)
        }
      } else if (isCod && status !== 'completed') {
        if (paymentTx && !reversalPaymentTx) {
          const reversalLines = paymentTx.journal_lines.map((line: any) => ({
            account_id: line.account_id,
            debit: line.credit,
            credit: line.debit
          }))
          await postJournalTransaction(
            businessId,
            orderId,
            new Date().toISOString(),
            `Pembatalan Pembayaran ${platform} #${orderNumber}`,
            reversalLines,
            supabase
          )
        }
      }
    }

    else if (status === 'cancelled' || status === 'failed') {
      if (salesTx && !reversalSalesTx) {
        await applyStockMovement(businessId, matchedProducts, 'restore', orderRef, supabase, undefined, orderId, 'order', 'pending')
        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Pembatalan Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Pembatalan Pembayaran ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
    }

    else if (status === 'refunded') {
      if (salesTx && !reversalSalesTx) {
        const nonCogsLines = salesTx.journal_lines.filter((line: any) => {
          return line.account_id !== accountMap['501000'] && line.account_id !== accountMap['102000']
        })
        const reversalLines = nonCogsLines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Refund Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Refund Pembayaran ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
    }

    else if (status === 'returned') {
      if (salesTx && !reversalSalesTx) {
        await applyStockMovement(businessId, matchedProducts, 'restore', orderRef, supabase, undefined, orderId, 'order', 'pending')
        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Retur Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Retur Pembayaran ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
    }

    // 6.4 RECORD REFUND EVENT (append-only) when a paid order is reversed
    const isReversalStatus = ['cancelled', 'failed', 'refunded', 'returned'].includes(status)
      || (isCod && status !== 'completed' && !!paymentTx)
    if (isReversalStatus) {
      try {
        const { data: pays } = await supabase
          .from('order_payments')
          .select('id, payment_kind, amount, payment_method, payment_method_account_id, shift_id, voided_payment_id')
          .eq('order_id', orderId)

        const allPayments = (pays || []).filter((p: any) => p.payment_kind === 'payment')
        const alreadyReversedIds = new Set(
          (pays || [])
            .filter((p: any) => p.payment_kind === 'refund' || p.payment_kind === 'void')
            .map((p: any) => p.voided_payment_id)
            .filter(Boolean)
        )

        // Find active payments not yet reversed/voided
        const paymentsToRefund = allPayments.filter((p: any) => !alreadyReversedIds.has(p.id))

        if (paymentsToRefund.length > 0) {
          const activeRefundShiftId = preloadedOrder?.current_shift_id || order.shift_id || null

          const refundInserts = paymentsToRefund.map((orig: any) => {
            const isCash = String(orig.payment_method || '').toLowerCase() === 'cash'
            return {
              payment_kind: 'refund',
              business_id: businessId,
              order_id: orderId,
              // Attribute cash refund to the currently active shift (current drawer payout)
              shift_id: (isCash && activeRefundShiftId) ? activeRefundShiftId : (orig.shift_id || null),
              date: new Date().toISOString().split('T')[0],
              amount: orig.amount,
              payment_method: orig.payment_method,
              payment_method_account_id: orig.payment_method_account_id,
              voided_payment_id: orig.id,
              notes: `Refund/Pembatalan ${platform} #${orderNumber}`
            }
          })

          const { error: refErr } = await supabase.from('order_payments').insert(refundInserts)
          if (refErr) console.warn('[orderLedger] order_payments refund insert error:', refErr.message)
        }

        // Update orders table payment status to unpaid and amount_paid to 0
        await supabase
          .from('orders')
          .update({
            payment_status: 'unpaid',
            amount_paid: 0
          })
          .eq('id', orderId)
      } catch (refundErr) {
        console.warn('[orderLedger] Failed to record refund event (non-fatal):', refundErr)
      }
    }

    // Loyalty Hooks
    if (order.customer_id) {
      try {
        if (status === 'completed') {
          await earnPointsForOrder(supabase, {
            businessId,
            customerId: order.customer_id,
            orderId,
            orderAmount: Math.round(parseFloat(grand_total) || 0),
            orderNumber: order.order_number || orderId,
          })
        } else if (status === 'cancelled' || status === 'failed' || status === 'refunded' || status === 'returned') {
          await reversePointsForOrder(supabase, {
            businessId,
            customerId: order.customer_id,
            orderId,
            orderNumber: order.order_number || orderId,
            reverseType: 'reversed',
          })
        }
      } catch (loyaltyErr) {
        console.warn('[LoyaltyPlugin] Non-critical error during loyalty hook:', loyaltyErr)
      }
    }

    return { success: true, message: 'Sync complete' }
  } catch (err: any) {
    console.error('syncOrderToLedger Error:', err)
    return { success: false, message: err.message || 'Internal server error' }
  }
}
