import { SupabaseClient } from '@supabase/supabase-js'
import { generateItemizedHppJournalLines } from './hppHelper'
import { earnPointsForOrder, reversePointsForOrder } from '@/plugins/loyalty/helpers/loyaltyApi'
import { getOrCreateDefaultAccounts } from './accountHelper'
import { resolveOrderProducts, applyStockMovement } from './inventoryHelper'
import { postJournalTransaction } from './journalHelper'

const isCodOrder = (order: any) => {
  return (order.payment_method || '').toUpperCase().includes('COD')
}

export async function syncOrderToLedger(
  orderId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Fetch the order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      throw new Error(`Order not found or error: ${orderErr?.message || 'unknown'}`)
    }

    const { business_id: businessId, order_number: orderNumber, status, grand_total } = order
    const platform = order.source_platform || 'WooCommerce'
    const isCod = isCodOrder(order)
    const items = Array.isArray(order.items_json) ? order.items_json : []

    // 2. Resolve Accounts
    const accountMap = await getOrCreateDefaultAccounts(businessId, supabase)

    // 3. Resolve Products (Auto-create & Cache)
    let defaultHppPct = 0
    try {
      const { data: globalInt } = await supabase
        .from('integrations')
        .select('api_credentials')
        .eq('platform_name', 'global')
        .filter('api_credentials->>business_id', 'eq', businessId)
        .limit(1)
      if (globalInt && globalInt.length > 0 && typeof globalInt[0].api_credentials?.global_default_hpp_percentage === 'number') {
        defaultHppPct = Math.max(0, Math.min(100, globalInt[0].api_credentials.global_default_hpp_percentage))
      }
    } catch (_) {}

    const matchedProducts = await resolveOrderProducts(items, businessId, defaultHppPct, supabase)

    // 4. Fetch existing transactions
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

    let salesTx = txs?.find(isSalesTx)
    const paymentTx = txs?.find(isPaymentTx)
    const reversalSalesTx = txs?.find(isReversalSalesTx)
    const reversalPaymentTx = txs?.find(isReversalPaymentTx)

    // Determine payment date
    let paymentDate = new Date().toISOString()
    if (platform === 'WooCommerce') {
      const raw = order.raw_source_data || {}
      if (isCod) {
        if (raw.date_completed_gmt) paymentDate = new Date(raw.date_completed_gmt + 'Z').toISOString()
        else if (raw.date_completed) paymentDate = new Date(raw.date_completed).toISOString()
        else paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
      } else {
        if (raw.date_paid_gmt) paymentDate = new Date(raw.date_paid_gmt + 'Z').toISOString()
        else if (raw.date_paid) paymentDate = new Date(raw.date_paid).toISOString()
        else paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
      }
    }

    // 5. Fetch Integration trigger settings
    let stockReductionStatuses = ['shipped', 'completed']
    let journalHppStatuses = ['shipped', 'completed']

    try {
      const { data: configRows } = await supabase
        .from('integrations')
        .select('platform_name, api_credentials')
        .in('platform_name', ['global', platform.toLowerCase()])
        .filter('api_credentials->>business_id', 'eq', businessId)

      const mapConfig: Record<string, any> = {}
      if (Array.isArray(configRows)) {
        configRows.forEach((row) => {
          mapConfig[row.platform_name] = row.api_credentials || {}
        })
      }
      const globalCreds = mapConfig['global'] || {}
      const platformCreds = mapConfig[platform.toLowerCase()] || {}
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
    } catch (cfgErr) {
      console.warn('Failed to load trigger settings hierarchy:', cfgErr)
    }

    const isSalesTriggered = stockReductionStatuses.includes(status) || 
                             journalHppStatuses.includes(status) || 
                             status === 'completed' || 
                             status === 'shipped' ||
                             status === 'processing'

    const orderRef = `Order #${orderNumber}`

    // 6. State Machine for Transitions
    if (isSalesTriggered) {
      // 6.1 SALES POSTING
      // Stock Deduction
      if (stockReductionStatuses.includes(status) || status === 'completed') {
        await applyStockMovement(businessId, matchedProducts, 'deduct', orderRef, supabase)
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

        // HPP Lines
        if (journalHppStatuses.includes(status) || status === 'completed') {
          const { journalLines: hppLines } = await generateItemizedHppJournalLines(
            matchedProducts,
            accountMap,
            'temp', 
            supabase
          )
          if (hppLines.length > 0) journalLines.push(...hppLines)
        }

        if (isPartialCommit && salesTx) {
          // Self heal: inject the missing lines directly to the existing transaction
          const dbJournalLines = journalLines.map(line => ({
            transaction_id: salesTx.id,
            account_id: line.account_id,
            debit: line.debit || 0,
            credit: line.credit || 0,
            description: line.description || null
          }))
          await supabase.from('journal_lines').insert(dbJournalLines)
        } else {
          // Normal creation
          await postJournalTransaction(
            businessId, 
            orderId, 
            order.order_date_utc || order.order_date || new Date().toISOString(), 
            `Penjualan ${platform} #${orderNumber}`, 
            journalLines, 
            supabase
          )
        }
      } else {
        // Fallback for HPP if salesTx exists but missed HPP lines
        const existingLines = salesTx.journal_lines || []
        const hasHppLine = existingLines.some((jl: any) => jl.account_id === accountMap['501000'])
        
        if (!hasHppLine && (journalHppStatuses.includes(status) || status === 'completed')) {
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
              credit: line.credit || 0,
              description: line.description || null
            }))
            await supabase.from('journal_lines').insert(dbHppLines)
          }
        }
      }

      // 6.2 PAYMENT POSTING
      const isOrderPaid = status === 'completed' || (platform === 'WooCommerce' && !isCod && status !== 'pending')
      if (isOrderPaid) {
        if (!paymentTx) {
          const payAccountCode = isCod ? '101000' : '101200'
          const paymentLines = [
            { account_id: accountMap[payAccountCode], debit: parseFloat(grand_total) || 0, credit: 0 },
            { account_id: accountMap['103000'], debit: 0, credit: parseFloat(grand_total) || 0 }
          ]
          await postJournalTransaction(
            businessId,
            orderId,
            paymentDate,
            `Pembayaran ${platform} #${orderNumber}`,
            paymentLines,
            supabase
          )
        }
      } else if (isCod && status !== 'completed') {
        if (paymentTx && !reversalPaymentTx) {
          const reversalLines = paymentTx.journal_lines.map((line: any) => ({
            account_id: line.account_id,
            debit: line.credit,
            credit: line.debit,
            description: line.description || null
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
        await applyStockMovement(businessId, matchedProducts, 'restore', orderRef, supabase)
        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
          description: line.description || null
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Pembatalan Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
          description: line.description || null
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
          credit: line.debit,
          description: line.description || null
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Refund Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
          description: line.description || null
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Refund Pembayaran ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
    }

    else if (status === 'returned') {
      if (salesTx && !reversalSalesTx) {
        await applyStockMovement(businessId, matchedProducts, 'restore', orderRef, supabase)
        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
          description: line.description || null
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Retur Penjualan ${platform} #${orderNumber}`, reversalLines, supabase
        )
      }
      if (paymentTx && !reversalPaymentTx) {
        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit,
          description: line.description || null
        }))
        await postJournalTransaction(
          businessId, orderId, new Date().toISOString(), `Retur Pembayaran ${platform} #${orderNumber}`, reversalLines, supabase
        )
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
