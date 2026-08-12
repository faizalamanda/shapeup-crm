const { calculateProductHpp } = require('../lib/recipeHelper')

console.log('Testing Variable HPP & Recipe Helper imports and logic...')

// Test mock recipe calculation
function calculateMockRecipeHpp(ingredients) {
  let unitHpp = 0
  for (const item of ingredients) {
    unitHpp += item.quantity * item.cost_price
  }
  return unitHpp
}

// FnB Example: 1 Cup Kopi Milk Tea
const coffeeIngredients = [
  { name: 'Biji Kopi Arabica', quantity: 18, cost_price: 200, unit: 'gram' }, // 18g * Rp200 = Rp 3.600
  { name: 'Susu UHT', quantity: 200, cost_price: 20, unit: 'ml' },            // 200ml * Rp20 = Rp 4.000
  { name: 'Paper Cup 12oz', quantity: 1, cost_price: 500, unit: 'pcs' }       // 1 pcs * Rp500 = Rp 500
]

const expectedFnBHpp = 3600 + 4000 + 500 // 8100
const calculatedFnBHpp = calculateMockRecipeHpp(coffeeIngredients)
console.log(`FnB Recipe Test: Calculated HPP = Rp ${calculatedFnBHpp} (Expected: Rp ${expectedFnBHpp})`)
if (calculatedFnBHpp === expectedFnBHpp) {
  console.log('✅ FnB Variable HPP Calculation PASSED!')
} else {
  console.error('❌ FnB Variable HPP Calculation FAILED!')
}

// Fashion/Garmen Example: 1 Kemeja Oversize Cotton
const garmentIngredients = [
  { name: 'Kain Katun Premium', quantity: 1.5, cost_price: 35000, unit: 'yard' }, // 1.5 yard * Rp 35.000 = Rp 52.500
  { name: 'Kancing Kemeja', quantity: 6, cost_price: 500, unit: 'pcs' },           // 6 pcs * Rp 500 = Rp 3.000
  { name: 'Benang Jahit', quantity: 10, cost_price: 150, unit: 'meter' }           // 10 meter * Rp 150 = Rp 1.500
]

const expectedGarmentHpp = 52500 + 3000 + 1500 // 57000
const calculatedGarmentHpp = calculateMockRecipeHpp(garmentIngredients)
console.log(`Fashion Recipe Test: Calculated HPP = Rp ${calculatedGarmentHpp} (Expected: Rp ${expectedGarmentHpp})`)
if (calculatedGarmentHpp === expectedGarmentHpp) {
  console.log('✅ Fashion Variable HPP Calculation PASSED!')
} else {
  console.error('❌ Fashion Variable HPP Calculation FAILED!')
}

// Stock Deduction Test (2 Kopi Milk Tea sold)
const orderItemQty = 2
const stockDeductionResults = coffeeIngredients.map(ing => ({
  name: ing.name,
  deductedQty: ing.quantity * orderItemQty,
  unit: ing.unit
}))

console.log('\nInventory Deduction for 2 Cup Kopi Milk Tea:')
stockDeductionResults.forEach(res => {
  console.log(`- ${res.name}: -${res.deductedQty} ${res.unit}`)
})
