import { SupabaseClient } from '@supabase/supabase-js'

export type RecipeIngredient = {
  id?: string
  business_id?: string
  product_id?: string
  ingredient_product_id: string
  quantity: number
  unit: string
  notes?: string | null
  ingredient?: {
    id: string
    name: string
    cost_price: number
    stock_type: string
    stock_quantity: number
    unit: string
  }
}

/**
 * Calculates dynamic HPP for a product based on its recipe ingredients.
 * Returns { isVariable: boolean, unitHpp: number, ingredients: RecipeIngredient[] }
 */
export async function calculateProductHpp(
  productId: string,
  supabase: SupabaseClient
): Promise<{ isVariable: boolean; unitHpp: number; ingredients: RecipeIngredient[] }> {
  if (!productId) return { isVariable: false, unitHpp: 0, ingredients: [] }

  try {
    const { data: recipes, error } = await supabase
      .from('product_recipes')
      .select('id, business_id, product_id, ingredient_product_id, quantity, unit, notes, ingredient:products!ingredient_product_id(id, name, cost_price, stock_type, stock_quantity, unit)')
      .eq('product_id', productId)

    if (error || !recipes || recipes.length === 0) {
      return { isVariable: false, unitHpp: 0, ingredients: [] }
    }

    let unitHpp = 0
    const formattedRecipes: RecipeIngredient[] = []

    for (const r of recipes) {
      const ingObj = Array.isArray(r.ingredient) ? r.ingredient[0] : r.ingredient
      const ingCost = Number(ingObj?.cost_price || 0)
      const qty = Number(r.quantity || 0)
      unitHpp += ingCost * qty

      formattedRecipes.push({
        id: r.id,
        business_id: r.business_id,
        product_id: r.product_id,
        ingredient_product_id: r.ingredient_product_id,
        quantity: qty,
        unit: r.unit || 'pcs',
        notes: r.notes,
        ingredient: ingObj ? {
          id: ingObj.id,
          name: ingObj.name,
          cost_price: Number(ingObj.cost_price || 0),
          stock_type: ingObj.stock_type,
          stock_quantity: Number(ingObj.stock_quantity || 0),
          unit: ingObj.unit || 'pcs'
        } : undefined
      })
    }

    return { isVariable: true, unitHpp, ingredients: formattedRecipes }
  } catch (err) {
    console.error(`Error calculating recipe HPP for product ${productId}:`, err)
    return { isVariable: false, unitHpp: 0, ingredients: [] }
  }
}

/**
 * Deducts inventory for an ordered item.
 * If the product is Variable HPP, deducts raw materials according to recipe.
 * If the product is Fixed HPP and tracked, deducts product stock.
 */
export async function processOrderInventoryDeduction(
  productId: string,
  itemQuantity: number,
  supabase: SupabaseClient
): Promise<{ success: boolean; itemCogs: number }> {
  if (!productId || itemQuantity <= 0) return { success: true, itemCogs: 0 }

  try {
    // 1. Fetch main product details
    const { data: mainProd, error: prodErr } = await supabase
      .from('products')
      .select('id, name, type, cost_price, hpp_type, stock_type, stock_quantity')
      .eq('id', productId)
      .single()

    if (prodErr || !mainProd) return { success: false, itemCogs: 0 }

    // 2. Check if product has recipes (Variable HPP)
    const { isVariable, unitHpp, ingredients } = await calculateProductHpp(productId, supabase)

    if (isVariable && ingredients.length > 0) {
      // Deduct stock for each raw material / ingredient
      for (const recipe of ingredients) {
        const ingProd = recipe.ingredient
        if (ingProd && ingProd.stock_type === 'tracked') {
          const neededQty = Number(recipe.quantity) * Number(itemQuantity)
          const newStock = Math.max(0, Number(ingProd.stock_quantity || 0) - neededQty)

          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', ingProd.id)
        }
      }

      // Sync computed HPP onto main product cost_price
      if (unitHpp > 0) {
        const updatePayload: Record<string, any> = { cost_price: unitHpp }
        if (mainProd.stock_type === 'tracked') {
          updatePayload.stock_quantity = Math.max(0, Number(mainProd.stock_quantity || 0) - Number(itemQuantity))
        }
        await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', mainProd.id)
      }

      return { success: true, itemCogs: unitHpp * itemQuantity }
    }

    // Standard / Fixed HPP handling
    if (mainProd.stock_type === 'tracked') {
      const newProdStock = Math.max(0, Number(mainProd.stock_quantity || 0) - Number(itemQuantity))
      await supabase
        .from('products')
        .update({ stock_quantity: newProdStock })
        .eq('id', mainProd.id)
    }

    const itemCogs = (Number(mainProd.cost_price) || 0) * itemQuantity
    return { success: true, itemCogs }
  } catch (err) {
    console.error(`Error in processOrderInventoryDeduction for product ${productId}:`, err)
    return { success: false, itemCogs: 0 }
  }
}

/**
 * Restocks inventory upon refund/cancellation of an order.
 * Restocks raw materials for Variable HPP products, or product stock for Fixed HPP.
 */
export async function processOrderInventoryRestock(
  productId: string,
  refundQuantity: number,
  supabase: SupabaseClient
): Promise<void> {
  if (!productId || refundQuantity <= 0) return

  try {
    const { isVariable, ingredients } = await calculateProductHpp(productId, supabase)

    if (isVariable && ingredients.length > 0) {
      for (const recipe of ingredients) {
        const ingProd = recipe.ingredient
        if (ingProd && ingProd.stock_type === 'tracked') {
          const addQty = Number(recipe.quantity) * Number(refundQuantity)
          const newStock = Number(ingProd.stock_quantity || 0) + addQty
          await supabase
            .from('products')
            .update({ stock_quantity: newStock })
            .eq('id', ingProd.id)
        }
      }
    } else {
      const { data: mainProd } = await supabase
        .from('products')
        .select('id, stock_type, stock_quantity')
        .eq('id', productId)
        .single()

      if (mainProd && mainProd.stock_type === 'tracked') {
        const newStock = Number(mainProd.stock_quantity || 0) + Number(refundQuantity)
        await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', mainProd.id)
      }
    }
  } catch (err) {
    console.error(`Error in processOrderInventoryRestock for product ${productId}:`, err)
  }
}
