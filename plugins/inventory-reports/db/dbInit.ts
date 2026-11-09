import { SupabaseClient } from '@supabase/supabase-js'

export async function ensureInventoryTablesExist(supabase: SupabaseClient, businessId: string) {
  try {
    // Proactively clean up legacy STORE-1 if exists
    await supabase
      .from('inventory_locations')
      .delete()
      .eq('business_id', businessId)
      .eq('code', 'STORE-1')

    // Check if inventory_locations table exists & query default locations
    const { data: locations, error: locError } = await supabase
      .from('inventory_locations')
      .select('id, name, is_default, type, code')
      .eq('business_id', businessId)
      .neq('code', 'STORE-1')

    if (locError && locError.message?.includes('does not exist')) {
      console.warn('[InventoryPlugin] Table inventory_locations does not exist yet. Relying on fallback auto-seeding.')
      return { initialized: false, locations: [] }
    }

    if (!locations || locations.length === 0) {
      // Seed default locations for the business (WH-MAIN, VENDOR, CUSTOMER)
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

    return { initialized: true, locations: (locations || []).filter((l: any) => l.code !== 'STORE-1') }
  } catch (err) {
    console.error('[InventoryPlugin] DB Init exception:', err)
    return { initialized: false, locations: [] }
  }
}
