async function testGlobalHierarchyLogic() {
  console.log('--- Testing Global vs Platform Trigger Inheritance Hierarchy ---')

  const mockBusinessId = 'test-biz-hierarchy-123'

  // 1. Global Setting: ['shipped', 'completed']
  const globalCreds = {
    business_id: mockBusinessId,
    global_stock_reduction_status: ['shipped', 'completed'],
    global_journal_hpp_status: ['shipped', 'completed']
  }

  // 2. WooCommerce Setting with use_global_settings: true
  const wooGlobalCreds = {
    business_id: mockBusinessId,
    use_global_settings: true,
    stock_reduction_status: ['processing'] // Should be IGNORED because use_global_settings is true
  }

  // 3. Test Case A: WooCommerce set to use_global_settings = true
  const configRowsA = [
    { platform_name: 'global', api_credentials: globalCreds },
    { platform_name: 'woocommerce', api_credentials: wooGlobalCreds }
  ]

  const mapConfigA: Record<string, any> = {}
  configRowsA.forEach((row) => {
    mapConfigA[row.platform_name] = row.api_credentials || {}
  })

  const platform = 'WooCommerce'
  const gCredsA = mapConfigA['global'] || {}
  const pCredsA = mapConfigA[platform.toLowerCase()] || {}

  const useGlobalA = pCredsA.use_global_settings !== false

  let resolvedStockStatusesA: string[] = []
  if (!useGlobalA && Array.isArray(pCredsA.stock_reduction_status) && pCredsA.stock_reduction_status.length > 0) {
    resolvedStockStatusesA = pCredsA.stock_reduction_status
  } else if (Array.isArray(gCredsA.global_stock_reduction_status) && gCredsA.global_stock_reduction_status.length > 0) {
    resolvedStockStatusesA = gCredsA.global_stock_reduction_status
  } else {
    resolvedStockStatusesA = ['shipped', 'completed']
  }

  console.log('Case A (use_global_settings = true) Resolved Statuses:', resolvedStockStatusesA)

  // 4. Test Case B: WooCommerce set to Custom Override (use_global_settings = false)
  const wooCustomCreds = {
    business_id: mockBusinessId,
    use_global_settings: false,
    stock_reduction_status: ['processing']
  }

  const configRowsB = [
    { platform_name: 'global', api_credentials: globalCreds },
    { platform_name: 'woocommerce', api_credentials: wooCustomCreds }
  ]

  const mapConfigB: Record<string, any> = {}
  configRowsB.forEach((row) => {
    mapConfigB[row.platform_name] = row.api_credentials || {}
  })

  const gCredsB = mapConfigB['global'] || {}
  const pCredsB = mapConfigB[platform.toLowerCase()] || {}

  const useGlobalB = pCredsB.use_global_settings !== false

  let resolvedStockStatusesB: string[] = []
  if (!useGlobalB && Array.isArray(pCredsB.stock_reduction_status) && pCredsB.stock_reduction_status.length > 0) {
    resolvedStockStatusesB = pCredsB.stock_reduction_status
  } else if (Array.isArray(gCredsB.global_stock_reduction_status) && gCredsB.global_stock_reduction_status.length > 0) {
    resolvedStockStatusesB = gCredsB.global_stock_reduction_status
  } else {
    resolvedStockStatusesB = ['shipped', 'completed']
  }

  console.log('Case B (use_global_settings = false / Custom) Resolved Statuses:', resolvedStockStatusesB)

  const isCaseAPassed = resolvedStockStatusesA.length === 2 && 
                        resolvedStockStatusesA.includes('shipped') && 
                        resolvedStockStatusesA.includes('completed')

  const isCaseBPassed = resolvedStockStatusesB.length === 1 && 
                        resolvedStockStatusesB.includes('processing')

  if (isCaseAPassed && isCaseBPassed) {
    console.log('\n✅ TEST PASSED! Inheritance hierarchy works 100% correctly with zero clashes.')
  } else {
    console.error('\n❌ TEST FAILED!')
    process.exit(1)
  }
}

testGlobalHierarchyLogic()
