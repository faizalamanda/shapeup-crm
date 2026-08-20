import { SupabaseClient } from '@supabase/supabase-js'
import { calculateProductHpp } from './recipeHelper'

// Memory caches to optimize performance during batch operations
const accountCache: Record<string, Record<string, string>> = {}
const productCacheBySku: Record<string, Record<string, any>> = {}
const productCacheByName: Record<string, Record<string, any>> = {}

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
    
    let accountMap = accountCache[businessId]

    if (!accountMap) {
      // 2. Resolve/Create Default Accounts
      const defaultAccounts = [
        { code: '101000', name: 'Kas POS (Tunai)', type: 'ASSET', business_id: businessId },
        { code: '101200', name: 'Bank / QRIS POS', type: 'ASSET', business_id: businessId },
        { code: '103000', name: 'Piutang Usaha', type: 'ASSET', business_id: businessId },
        { code: '401000', name: 'Pendapatan Penjualan POS', type: 'REVENUE', business_id: businessId },
        { code: '401100', name: 'Potongan Penjualan / Diskon', type: 'REVENUE', business_id: businessId },
        { code: '402000', name: 'Pendapatan Ongkir', type: 'REVENUE', business_id: businessId },
        { code: '403000', name: 'Pendapatan Lain-lain / Admin', type: 'REVENUE', business_id: businessId },
        { code: '501000', name: 'Harga Pokok Penjualan (HPP)', type: 'EXPENSE', business_id: businessId },
        { code: '102000', name: 'Persediaan Barang', type: 'ASSET', business_id: businessId }
      ]

      // Fetch existing accounts for this business to respect multi-tenant unique constraint on (business_id, code)
      const { data: existingAccounts } = await supabase
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)

      const existingCodes = existingAccounts ? existingAccounts.map(a => a.code) : []
      const accountsToCreate = defaultAccounts.filter(a => !existingCodes.includes(a.code))

      if (accountsToCreate.length > 0) {
        const { error: insAccErr } = await supabase.from('accounts').insert(accountsToCreate)
        if (insAccErr && !insAccErr.message.includes('duplicate key')) {
          throw new Error(`Failed to create default accounts: ${insAccErr.message}`)
        }
      }

      // Refetch all accounts for this business by code to build the mapping
      const targetCodes = ['101000', '101200', '103000', '401000', '401100', '402000', '403000', '501000', '102000']
      const { data: allAccounts, error: refetchAccErr } = await supabase
        .from('accounts')
        .select('id, code')
        .eq('business_id', businessId)
        .in('code', targetCodes)

      if (refetchAccErr || !allAccounts) {
        throw new Error(`Failed to refetch ledger accounts: ${refetchAccErr?.message || 'unknown'}`)
      }

      accountMap = {}
      allAccounts.forEach(a => {
        accountMap[a.code] = a.id
      })
      accountCache[businessId] = accountMap
    }

    // Helper to check if COD
    const isCod = isCodOrder(order)

    // 3. Process products mapping & auto-creation & stock/COGS calculation
    const items = Array.isArray(order.items_json) ? order.items_json : []
    let totalCogs = 0
    const matchedProducts: { item: any; dbProduct: any }[] = []

    for (const item of items) {
      let dbProd = null
      const sku = item.sku ? String(item.sku).trim() : ''
      const name = item.name ? String(item.name).trim() : ''

      // Check cache first
      if (sku && productCacheBySku[businessId]?.[sku]) {
        dbProd = productCacheBySku[businessId][sku]
      } else if (name && productCacheByName[businessId]?.[name.toLowerCase()]) {
        dbProd = productCacheByName[businessId][name.toLowerCase()]
      }

      if (!dbProd) {
        // 3.1. Priority 1: SKU
        if (sku) {
          const { data } = await supabase
            .from('products')
            .select('*')
            .eq('business_id', businessId)
            .eq('sku', sku)
            .limit(1)
          if (data && data.length > 0) {
            dbProd = data[0]
          }
        }

        // 3.2. Priority 2: Name
        if (!dbProd && name) {
          const { data } = await supabase
            .from('products')
            .select('*')
            .eq('business_id', businessId)
            .ilike('name', name)
            .limit(1)
          if (data && data.length > 0) {
            dbProd = data[0]
          }
        }
      }

      // Resolve HPP/cost price from WooCommerce metadata, item fields, or default to 50%
      let extractedCostPrice = 0
      let isFallback = false

      // 1. Check if cost_of_goods_sold object exists on the item
      if (item.cost_of_goods_sold && typeof item.cost_of_goods_sold === 'object') {
        const val = parseFloat(item.cost_of_goods_sold.value)
        if (!isNaN(val) && val > 0) {
          extractedCostPrice = val
        }
      }

      // 2. Check metadata
      if (extractedCostPrice <= 0 && Array.isArray(item.meta_data)) {
        const cogMeta = item.meta_data.find((m: any) => 
          ['_wc_cog_item_cost', '_cog_item_cost', 'cost_price', 'cost', 'hpp'].includes(m.key)
        )
        if (cogMeta) {
          const val = parseFloat(cogMeta.value)
          if (!isNaN(val) && val > 0) extractedCostPrice = val
        }
      }

      const itemPrice = parseFloat(item.price || item.total || 0) || 0
      if (extractedCostPrice <= 0) {
        extractedCostPrice = itemPrice * 0.5
        isFallback = true
      }

      // 3.3. Auto-creation if not found
      if (!dbProd && name) {
        // Create new product
        const { data: newProd, error: newProdErr } = await supabase
          .from('products')
          .insert({
            business_id: businessId,
            name: name,
            sku: sku || null,
            price: itemPrice,
            cost_price: extractedCostPrice,
            type: 'physical',
            stock_type: 'tracked',
            stock_quantity: 0
          })
          .select('*')
          .single()

        if (newProdErr) {
          console.error(`Failed to auto-create product: ${newProdErr.message}`)
        } else {
          dbProd = newProd
        }
      } else if (
        dbProd && 
        !isFallback && 
        (dbProd.cost_price <= 0 || dbProd.cost_price === dbProd.price * 0.5) && 
        extractedCostPrice > 0
      ) {
        // Update product in DB if its cost_price was 0 OR was exactly the 50% fallback price, 
        // and we have found a valid real cost_price.
        const { error: updErr } = await supabase
          .from('products')
          .update({ cost_price: extractedCostPrice })
          .eq('id', dbProd.id)
        
        if (!updErr) {
          dbProd.cost_price = extractedCostPrice
          // Update cache so subsequent loops for this product use the corrected real HPP
          if (dbProd.sku && productCacheBySku[businessId]?.[dbProd.sku]) {
            productCacheBySku[businessId][dbProd.sku].cost_price = extractedCostPrice
          }
          if (dbProd.name && productCacheByName[businessId]?.[dbProd.name.toLowerCase()]) {
            productCacheByName[businessId][dbProd.name.toLowerCase()].cost_price = extractedCostPrice
          }
        }
      }

      if (dbProd) {
        // Add/Update Cache
        if (!productCacheBySku[businessId]) productCacheBySku[businessId] = {}
        if (!productCacheByName[businessId]) productCacheByName[businessId] = {}
        if (dbProd.sku) productCacheBySku[businessId][dbProd.sku] = dbProd
        if (dbProd.name) productCacheByName[businessId][dbProd.name.toLowerCase()] = dbProd

        matchedProducts.push({ item, dbProduct: dbProd })
        const itemQty = parseFloat(item.quantity) || 1

        // Check if product has Variable HPP (Recipe / Ingredients)
        const { isVariable, unitHpp, ingredients } = await calculateProductHpp(dbProd.id, supabase)
        let effectiveCost = Number(dbProd.cost_price) || 0

        if (isVariable && ingredients.length > 0) {
          effectiveCost = unitHpp
          // Deduct stock for raw material ingredients
          for (const recipe of ingredients) {
            const ingProd = recipe.ingredient
            if (ingProd && ingProd.stock_type === 'tracked') {
              const neededQty = Number(recipe.quantity) * itemQty
              const newStock = Math.max(0, Number(ingProd.stock_quantity || 0) - neededQty)
              await supabase
                .from('products')
                .update({ stock_quantity: newStock })
                .eq('id', ingProd.id)
            }
          }
        } else if (dbProd.stock_type === 'tracked') {
          // Deduct product stock for standard tracked physical product
          const newStock = Math.max(0, Number(dbProd.stock_quantity || 0) - itemQty)
          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', dbProd.id)
        }

        if (dbProd.type === 'physical' && effectiveCost > 0) {
          totalCogs += effectiveCost * itemQty
        }
      }
    }

    // 4. Fetch existing transactions for this order
    const { data: txs, error: txsErr } = await supabase
      .from('transactions')
      .select('*, journal_lines(*)')
      .eq('order_id', orderId)

    if (txsErr) {
      throw new Error(`Failed to fetch existing transactions: ${txsErr.message}`)
    }

    // Helper patterns to identify transactions
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

    const salesTx = txs?.find(isSalesTx)
    const paymentTx = txs?.find(isPaymentTx)
    const reversalSalesTx = txs?.find(isReversalSalesTx)
    const reversalPaymentTx = txs?.find(isReversalPaymentTx)

    const platform = order.source_platform || 'WooCommerce'
    
    // Determine payment date
    let paymentDate = new Date().toISOString()
    if (platform === 'WooCommerce') {
      const isCod = (order.payment_method || '').toUpperCase().includes('COD')
      const raw = order.raw_source_data || {}
      if (isCod) {
        if (raw.date_completed_gmt) {
          paymentDate = new Date(raw.date_completed_gmt + 'Z').toISOString()
        } else if (raw.date_completed) {
          paymentDate = new Date(raw.date_completed).toISOString()
        } else {
          paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
        }
      } else {
        if (raw.date_paid_gmt) {
          paymentDate = new Date(raw.date_paid_gmt + 'Z').toISOString()
        } else if (raw.date_paid) {
          paymentDate = new Date(raw.date_paid).toISOString()
        } else {
          paymentDate = order.order_date_utc || order.order_date || new Date().toISOString()
        }
      }
    }

    // Helper to adjust stock
    const adjustStock = async (direction: 'deduct' | 'restore') => {
      for (const { item, dbProduct } of matchedProducts) {
        if (dbProduct.stock_type === 'tracked') {
          const qty = parseInt(item.quantity) || 1
          const delta = direction === 'deduct' ? -qty : qty
          const { error: stockErr } = await supabase
            .from('products')
            .update({ stock_quantity: dbProduct.stock_quantity + delta })
            .eq('id', dbProduct.id)

          if (stockErr) {
            console.error(`Failed to adjust stock for product ${dbProduct.id}: ${stockErr.message}`)
          } else {
            dbProduct.stock_quantity += delta
            
            // Sync cache
            if (dbProduct.sku && productCacheBySku[businessId]?.[dbProduct.sku]) {
              productCacheBySku[businessId][dbProduct.sku].stock_quantity = dbProduct.stock_quantity
            }
            if (dbProduct.name && productCacheByName[businessId]?.[dbProduct.name.toLowerCase()]) {
              productCacheByName[businessId][dbProduct.name.toLowerCase()].stock_quantity = dbProduct.stock_quantity
            }
          }
        }
      }
    }

    // 5. Handle transitions based on current status
    if (status === 'processing' || status === 'shipped') {
      // 5.1. SALES POSTING
      if (!salesTx) {
        // Deduct stock
        await adjustStock('deduct')

        // Insert transaction
        const { data: newSalesTx, error: insSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: order.order_date_utc || order.order_date || new Date().toISOString(),
            description: `Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insSalesErr) throw insSalesErr

        // Insert journal lines
        const sub = parseFloat(order.subtotal) || 0
        const ship = parseFloat(order.shipping_cost) || 0
        const fee = parseFloat(order.other_fees) || 0
        const disc = parseFloat(order.discount_amount) || 0
        const grand = parseFloat(order.grand_total) || 0

        const journalLines: any[] = []

        // Debit: Piutang Usaha
        if (grand > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'],
            debit: grand,
            credit: 0
          })
        } else if (grand < 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'],
            debit: 0,
            credit: Math.abs(grand)
          })
        }

        // Debit: Potongan Penjualan / Diskon
        if (disc > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['401100'],
            debit: disc,
            credit: 0
          })
        }

        // Credit: Pendapatan Penjualan POS
        if (sub > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['401000'],
            debit: 0,
            credit: sub
          })
        }

        // Credit: Pendapatan Ongkir
        if (ship > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['402000'],
            debit: 0,
            credit: ship
          })
        }

        // Credit/Debit: Pendapatan Lain-lain / Admin
        if (fee > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['403000'],
            debit: 0,
            credit: fee
          })
        } else if (fee < 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['403000'],
            debit: Math.abs(fee),
            credit: 0
          })
        }

        if (totalCogs > 0) {
          journalLines.push(
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['501000'], // HPP
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['102000'], // Persediaan Barang
              debit: 0,
              credit: totalCogs
            }
          )
        }

        const { error: insLinesErr } = await supabase.from('journal_lines').insert(journalLines)
        if (insLinesErr) throw insLinesErr
      }

      // 5.2. PAYMENT POSTING
      if (!isCod) {
        // Transfer/Online payment: should record payment immediately
        if (!paymentTx) {
          const { data: newPayTx, error: insPayErr } = await supabase
            .from('transactions')
            .insert({
              business_id: businessId,
              order_id: orderId,
              date: paymentDate,
              description: `Pembayaran ${platform} #${orderNumber}`
            })
            .select('id')
            .single()

          if (insPayErr) throw insPayErr

          const paymentLines = [
            {
              transaction_id: newPayTx.id,
              account_id: accountMap['101200'], // Bank
              debit: parseFloat(grand_total) || 0,
              credit: 0
            },
            {
              transaction_id: newPayTx.id,
              account_id: accountMap['103000'], // Piutang
              debit: 0,
              credit: parseFloat(grand_total) || 0
            }
          ]

          const { error: insPayLinesErr } = await supabase.from('journal_lines').insert(paymentLines)
          if (insPayLinesErr) throw insPayLinesErr
        }
      } else {
        // COD should NOT have payment posting in processing
        // If it exists (e.g. status was moved completed -> processing), reverse it!
        if (paymentTx && !reversalPaymentTx) {
          const { data: revPayTx, error: revPayErr } = await supabase
            .from('transactions')
            .insert({
              business_id: businessId,
              order_id: orderId,
              date: new Date().toISOString(),
              description: `Pembatalan Pembayaran ${platform} #${orderNumber}`
            })
            .select('id')
            .single()

          if (revPayErr) throw revPayErr

          const reversalLines = paymentTx.journal_lines.map((line: any) => ({
            transaction_id: revPayTx.id,
            account_id: line.account_id,
            debit: line.credit,
            credit: line.debit
          }))

          const { error: insRevLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
          if (insRevLinesErr) throw insRevLinesErr
        }
      }
    } 
    
    else if (status === 'completed') {
      // 5.1. Ensure Sales Posting exists
      if (!salesTx) {
        await adjustStock('deduct')

        const { data: newSalesTx, error: insSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: order.order_date_utc || order.order_date || new Date().toISOString(),
            description: `Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insSalesErr) throw insSalesErr

        const sub = parseFloat(order.subtotal) || 0
        const ship = parseFloat(order.shipping_cost) || 0
        const fee = parseFloat(order.other_fees) || 0
        const disc = parseFloat(order.discount_amount) || 0
        const grand = parseFloat(order.grand_total) || 0

        const journalLines: any[] = []

        // Debit: Piutang Usaha
        if (grand > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'],
            debit: grand,
            credit: 0
          })
        } else if (grand < 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['103000'],
            debit: 0,
            credit: Math.abs(grand)
          })
        }

        // Debit: Potongan Penjualan / Diskon
        if (disc > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['401100'],
            debit: disc,
            credit: 0
          })
        }

        // Credit: Pendapatan Penjualan POS
        if (sub > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['401000'],
            debit: 0,
            credit: sub
          })
        }

        // Credit: Pendapatan Ongkir
        if (ship > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['402000'],
            debit: 0,
            credit: ship
          })
        }

        // Credit/Debit: Pendapatan Lain-lain / Admin
        if (fee > 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['403000'],
            debit: 0,
            credit: fee
          })
        } else if (fee < 0) {
          journalLines.push({
            transaction_id: newSalesTx.id,
            account_id: accountMap['403000'],
            debit: Math.abs(fee),
            credit: 0
          })
        }

        if (totalCogs > 0) {
          journalLines.push(
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['501000'],
              debit: totalCogs,
              credit: 0
            },
            {
              transaction_id: newSalesTx.id,
              account_id: accountMap['102000'],
              debit: 0,
              credit: totalCogs
            }
          )
        }

        const { error: insLinesErr } = await supabase.from('journal_lines').insert(journalLines)
        if (insLinesErr) throw insLinesErr
      }

      // 5.2. Ensure Payment Posting exists
      if (!paymentTx) {
        const payAccountCode = isCod ? '101000' : '101200'
        const { data: newPayTx, error: insPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: paymentDate,
            description: `Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (insPayErr) throw insPayErr

        const paymentLines = [
          {
            transaction_id: newPayTx.id,
            account_id: accountMap[payAccountCode], // Kas/Bank
            debit: parseFloat(grand_total) || 0,
            credit: 0
          },
          {
            transaction_id: newPayTx.id,
            account_id: accountMap['103000'], // Piutang
            debit: 0,
            credit: parseFloat(grand_total) || 0
          }
        ]

        const { error: insPayLinesErr } = await supabase.from('journal_lines').insert(paymentLines)
        if (insPayLinesErr) throw insPayLinesErr
      }
    }

    else if (status === 'cancelled' || status === 'failed') {
      // Full Reversal: Restores stock, reverses Sales Posting (including COGS), reverses Payment Posting
      if (salesTx && !reversalSalesTx) {
        // Restore stock
        await adjustStock('restore')

        // Insert reversal sales transaction
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Pembatalan Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Pembatalan Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    else if (status === 'refunded') {
      // Refund: Money returned, goods NOT returned. Stock is NOT restored, HPP is NOT reversed (HPP remains).
      if (salesTx && !reversalSalesTx) {
        // Insert reversal sales transaction (excluding COGS/inventory)
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Refund Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        // Filter to ONLY reverse non-COGS lines (exclude HPP 501000 and Persediaan 102000)
        const nonCogsLines = salesTx.journal_lines.filter((line: any) => {
          return line.account_id !== accountMap['501000'] && line.account_id !== accountMap['102000']
        })

        const reversalLines = nonCogsLines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Refund Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    else if (status === 'returned') {
      // Return: Money returned, goods ARE returned. Stock IS restored, HPP IS reversed (full reversal).
      if (salesTx && !reversalSalesTx) {
        // Restore stock
        await adjustStock('restore')

        // Insert reversal sales transaction (full reversal)
        const { data: revSalesTx, error: revSalesErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Retur Penjualan ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revSalesErr) throw revSalesErr

        const reversalLines = salesTx.journal_lines.map((line: any) => ({
          transaction_id: revSalesTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevSalesLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevSalesLinesErr) throw insRevSalesLinesErr
      }

      if (paymentTx && !reversalPaymentTx) {
        // Insert reversal payment transaction
        const { data: revPayTx, error: revPayErr } = await supabase
          .from('transactions')
          .insert({
            business_id: businessId,
            order_id: orderId,
            date: new Date().toISOString(),
            description: `Retur Pembayaran ${platform} #${orderNumber}`
          })
          .select('id')
          .single()

        if (revPayErr) throw revPayErr

        const reversalLines = paymentTx.journal_lines.map((line: any) => ({
          transaction_id: revPayTx.id,
          account_id: line.account_id,
          debit: line.credit,
          credit: line.debit
        }))

        const { error: insRevPayLinesErr } = await supabase.from('journal_lines').insert(reversalLines)
        if (insRevPayLinesErr) throw insRevPayLinesErr
      }
    }

    return { success: true, message: 'Sync complete' }
  } catch (err: any) {
    console.error('syncOrderToLedger Error:', err)
    return { success: false, message: err.message || 'Internal server error' }
  }
}

function isCodOrder(order: any): boolean {
  const method = (order.payment_method || '').toLowerCase()
  const rawMethod = (order.raw_source_data?.payment_method || '').toLowerCase()
  return (
    method.includes('cod') ||
    method.includes('cash on delivery') ||
    method.includes('bayar di tempat') ||
    method.includes('tunai') ||
    method === 'cash' ||
    rawMethod === 'cod' ||
    rawMethod.includes('cod')
  )
}
