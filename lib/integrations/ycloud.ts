import { createClient } from '@supabase/supabase-js'

export interface YCloudConfig {
  id: string
  isActive: boolean
  apiKey: string
  whatsappNumber: string
  updatedAt?: string
}

export async function getYCloudConfig(businessId: string): Promise<YCloudConfig | null> {
  if (!businessId) return null

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('platform_name', 'ycloud')
    .filter('api_credentials->>business_id', 'eq', businessId)
    .maybeSingle()

  if (error || !data) return null

  return {
    id: data.id,
    isActive: Boolean(data.is_active),
    apiKey: data.api_credentials?.api_key || '',
    whatsappNumber: data.api_credentials?.whatsapp_number || '',
    updatedAt: data.api_credentials?.updated_at,
  }
}
