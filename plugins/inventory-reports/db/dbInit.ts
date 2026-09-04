import { SupabaseClient } from '@supabase/supabase-js'

export async function ensureInventoryTablesExist(supabase: SupabaseClient, businessId: string) {
  try {
    // Check if inventory_locations table exists & query default locations
    const { data: locations, error: locError } = await supabase
      .from('inventory_locations')
      .select('id, name, is_default, type')
      .eq('business_id', businessId)

    if (locError && locError.message?.includes('does not exist')) {
      console.warn('[InventoryPlugin] Table inventory_locations does not exist yet. Relying on fallback auto-seeding.')
      return { initialized: false, locations: [] }
    }

    if (!locations || locations.length === 0) {
      // Seed default locations for the business
      const defaultLocations = [
        {
          business_id: businessId,
          name: 'Gudang Utama (WH-MAIN)',
          type: 'internal',
          code: 'WH-MAIN',
          is_default: true,
        },
        {
          business_id: businessId,
          name: 'Toko / Display Outlet (STORE-1)',
          type: 'internal',
          code: 'STORE-1',
          is_default: false,
        },
        {
          business_id: businessId,
          name: 'Lokasi Pemasok / Supplier (VENDOR)',
          type: 'vendor',
          code: 'VENDOR',
          is_default: false,
        },
        {
          business_id: businessId,
          name: 'Transit Pelanggan (CUSTOMER)',
          type: 'customer',
          code: 'CUSTOMER',
          is_default: false,
        },
      ]

      const { data: inserted, error: insertErr } = await supabase
        .from('inventory_locations')
        .insert(defaultLocations)
        .select('*')

      if (!insertErr && inserted) {
        return { initialized: true, locations: inserted }
      }
    }

    return { initialized: true, locations: locations || [] }
  } catch (err) {
    console.error('[InventoryPlugin] DB Init exception:', err)
    return { initialized: false, locations: [] }
  }
}
