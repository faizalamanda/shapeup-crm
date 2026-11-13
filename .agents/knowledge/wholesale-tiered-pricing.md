# Wholesale Tiered Volume Pricing Architecture (Harga Grosir)

## Overview
ShapeUp CRM supports **All-Units Quantity Discount** (`>= min_qty -> unit price`) for both single products and variant SKUs, with zero extra database queries at POS/Invoice runtime.

## Data Schema
- `public.products.wholesale_tiers`: `JSONB NOT NULL DEFAULT '[]'::jsonb`
- `public.product_variants.wholesale_tiers`: `JSONB NOT NULL DEFAULT '[]'::jsonb`
- Entry format (sorted ascending by `min_qty`):
  ```json
  [
    { "min_qty": 10, "price": 45000 },
    { "min_qty": 50, "price": 40000 }
  ]
  ```
- **Legacy Schema Safety:** All CRUD writes (`ProductModal.tsx`) and reads (`lib/chunkedQueryHelper.ts`) include fallback paths without `wholesale_tiers` so deployments remain resilient before migrations are applied.

## Single Source of Truth (`lib/pricing/wholesalePricing.ts`)
All UI validation and runtime price resolution MUST use `@/lib/pricing/wholesalePricing`:
- `isDimensionUnit(unit)` — identifies `'m2'` and `'cm2'` products.
- `normalizeWholesaleTiers(raw)` — deduplicates `min_qty` (`>= 2`), filters invalid entries, sorts ascending.
- `validateWholesaleTiers(tiers, basePrice, costPrice)` — blocks duplicate `min_qty` / `min_qty < 2` / `price <= 0`, and warns on non-monotonic pricing or below-HPP pricing.
- `resolveWholesaleUnitPrice({ basePrice, wholesaleTiers, qty, isDimensionProduct })` — O(k) synchronous browser calculation returning `{ unitPrice, appliedTier, isWholesale }`.

## Mandatory Invariants & Guards
1. **Dimension / Metered Printing Exclusion:**
   - Products with `unit` in `['m2', 'cm2']` or `pricing_type === 'area'` MUST NOT trigger automatic wholesale pricing in POS or Invoice yet.
   - `ProductModal.tsx` displays an explicit informational banner in the **Harga Grosir** tab when editing a dimension product.
2. **Unsaved Variant Identity (`client_key`):**
   - Newly added or matrix-generated variants in `ProductModal.tsx` do not have database `id` UUIDs or guaranteed `sku`s before save.
   - Wholesale tiers attach directly to `VariantRow.wholesale_tiers` and the dropdown binds to `VariantRow.client_key` (never `id` or array `index`).
3. **POS Override & Special Item Guards (`POSWorkspace.tsx`):**
   - `recalculateCartItemPrice` MUST skip items with `item.authorization`, `item.isManualPriceOverride`, `item.dimension_spec`, or `id` starting with `'custom-'`.
   - Modifier add-on extras (`selectedModifiers`) are always added on top of the resolved wholesale unit price (`wholesaleUnitPrice + modExtra`).
4. **Invoice Manual Negotiation Guard (`invoices/new` & `invoices/[id]/edit`):**
   - Changing `quantity` autocorrects `price` unless `is_manual_price === true` (set when the user manually edits the `price` input).
   - Opening an existing invoice in edit mode does not re-evaluate historical prices until the user actively changes the product or `quantity`.
5. **Performance & Cache Coherence:**
   - `POS_SLIM_PRODUCT_SELECT_VARIANTS` (`*`) and `fetchAllBusinessProducts` (`selectWithVariants`) fetch `wholesale_tiers` in the single existing catalog query (0 extra DB roundtrips).
   - `ProductModal.tsx` calls `invalidatePosCatalogCache(businessId, true)` on save to sync open POS tabs via `BroadcastChannel`.

