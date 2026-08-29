const { generateItemizedHppJournalLines } = require('../lib/hppHelper')

async function testItemizedHppModule() {
  console.log('--- Testing World-Class Odoo-Style Itemized HPP Module ---')

  const mockItems = [
    {
      item: {
        name: 'Kemeja Flanel Soft Cotton',
        sku: 'KMF-001',
        quantity: 2,
        price: 150000
      },
      dbProduct: {
        id: 'prod-uuid-1',
        name: 'Kemeja Flanel Soft Cotton',
        sku: 'KMF-001',
        type: 'physical',
        stock_type: 'tracked',
        cost_price: 65000,
        unit: 'Pcs'
      }
    },
    {
      item: {
        name: 'Celana Chino Slim Fit',
        sku: 'CHN-002',
        quantity: 1,
        price: 220000
      },
      dbProduct: {
        id: 'prod-uuid-2',
        name: 'Celana Chino Slim Fit',
        sku: 'CHN-002',
        type: 'physical',
        stock_type: 'tracked',
        cost_price: 95000,
        unit: 'Pcs'
      }
    }
  ]

  const mockAccountMap = {
    '501000': 'acc-hpp-uuid',
    '102000': 'acc-inventory-uuid'
  }

  const mockTxId = 'tx-sales-1001'

  const result = await generateItemizedHppJournalLines(
    mockItems,
    mockAccountMap,
    mockTxId
  )

  console.log('Result Total COGS:', result.totalCogs, '(Expected: 225000)')
  console.log('Journal Lines Count:', result.journalLines.length, '(Expected: 4)')
  console.log('\nGenerated Journal Lines (Odoo ERP Standard):')
  result.journalLines.forEach((line, i) => {
    console.log(`[Line ${i + 1}] Acc: ${line.account_id} | Debit: ${line.debit} | Credit: ${line.credit} | Desc: "${line.description}"`)
  })

  if (result.totalCogs === 225000 && result.journalLines.length === 4) {
    console.log('\n✅ TEST PASSED! Itemized HPP & Odoo-style journal lines generated successfully.')
  } else {
    console.error('\n❌ TEST FAILED!')
    process.exit(1)
  }
}

testItemizedHppModule()
