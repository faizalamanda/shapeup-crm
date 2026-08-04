import { createClient } from '@supabase/supabase-js'
import { INTEGRATION_PLUGINS, IntegrationCategory, IntegrationPlugin } from './registry'

export interface BusinessIntegrationConfig {
  id: string
  platformName: string
  isActive: boolean
  businessId: string
  credentials: Record<string, any>
  updatedAt?: string
}

/**
 * Get active integration plugins by category for a business
 */
export async function getActiveIntegrationsByCategory(
  businessId: string,
  category: IntegrationCategory
): Promise<IntegrationPlugin[]> {
  if (!businessId) return []

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('platform_name, is_active')
    .eq('is_active', true)
    .filter('api_credentials->>business_id', 'eq', businessId)

  if (error || !data) return []

  const activePlatforms = new Set(data.map((item: any) => item.platform_name))

  return INTEGRATION_PLUGINS.filter(
    (plugin) => plugin.category === category && activePlatforms.has(plugin.id)
  )
}

/**
 * Get raw integration configuration by platform name
 */
export async function getIntegrationConfig(
  businessId: string,
  platformName: string
): Promise<BusinessIntegrationConfig | null> {
  if (!businessId || !platformName) return null

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('platform_name', platformName)
    .filter('api_credentials->>business_id', 'eq', businessId)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    platformName: data.platform_name,
    isActive: Boolean(data.is_active),
    businessId: data.api_credentials?.business_id || businessId,
    credentials: data.api_credentials || {},
    updatedAt: data.api_credentials?.updated_at || data.updated_at,
  }
}
