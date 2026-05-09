export type TemplateVarSource = 'TAG' | 'MANUAL'
export type TemplateTagKey = 'customer_name' | 'ordered_products'

type OrderItem = {
  name?: string
  product_name?: string
  quantity?: number | string
}

type OrderTemplateData = {
  customer?: {
    name?: string
    full_name?: string
  }
  raw_source_data?: {
    billing?: {
      first_name?: string
      last_name?: string
    }
    line_items?: OrderItem[]
  }
  items_json?: OrderItem[]
}

export type TemplateTag = {
  key: TemplateTagKey
  label: string
  resolve: (order: OrderTemplateData) => string
}

export type TemplateVarDraft = {
  id: number
  value: string
  source: TemplateVarSource
}

export type TemplateVarPayload = {
  position: number
  parameter: string
  source: TemplateVarSource
  value: string
}

export const TEMPLATE_TAGS: TemplateTag[] = [
  {
    key: 'customer_name',
    label: 'Nama Customer',
    resolve: (order) => {
      const billing = order.raw_source_data?.billing
      const billingName = `${billing?.first_name || ''} ${billing?.last_name || ''}`.trim()

      return order.customer?.name || order.customer?.full_name || billingName || ''
    },
  },
  {
    key: 'ordered_products',
    label: 'Produk yang Diorder',
    resolve: (order) => {
      const items = Array.isArray(order.items_json)
        ? order.items_json
        : Array.isArray(order.raw_source_data?.line_items)
          ? order.raw_source_data.line_items
          : []

      return items
        .map((item) => {
          const name = item.name || item.product_name || ''
          const quantity = Number(item.quantity) || 0

          if (!name) return ''
          return quantity > 0 ? `${quantity}x ${name}` : name
        })
        .filter(Boolean)
        .join(', ')
    },
  },
]

const isTemplateVarSource = (value: unknown): value is TemplateVarSource => {
  return value === 'TAG' || value === 'MANUAL'
}

const isTemplateTagKey = (value: unknown): value is TemplateTagKey => {
  return TEMPLATE_TAGS.some((tag) => tag.key === value)
}

export const createTemplateVar = (): TemplateVarDraft => ({
  id: Date.now(),
  value: TEMPLATE_TAGS[0]?.key || '',
  source: 'TAG',
})

export const hydrateTemplateVarsForEditor = (vars: unknown): TemplateVarDraft[] => {
  if (!Array.isArray(vars)) return []

  return vars.map((item, index) => {
    const templateVar = item && typeof item === 'object' ? item as Record<string, unknown> : {}

    const source = isTemplateVarSource(templateVar.source) ? templateVar.source : 'TAG'
    const value = typeof templateVar.value === 'string' ? templateVar.value : ''

    return {
      id: typeof templateVar.id === 'number' ? templateVar.id : Date.now() + index,
      value: source === 'TAG' && !isTemplateTagKey(value) ? TEMPLATE_TAGS[0]?.key || '' : value,
      source,
    }
  })
}

export const formatTemplateVarsForSupabase = (vars: TemplateVarDraft[]): TemplateVarPayload[] => {
  return vars.map((item, index) => ({
    position: index + 1,
    parameter: `{{${index + 1}}}`,
    source: isTemplateVarSource(item.source) ? item.source : 'TAG',
    value: item.source === 'TAG' && !isTemplateTagKey(item.value)
      ? TEMPLATE_TAGS[0]?.key || ''
      : item.value.trim(),
  }))
}

export const resolveTemplateVarValue = (templateVar: TemplateVarPayload, order: OrderTemplateData): string => {
  if (templateVar.source === 'MANUAL') return templateVar.value

  const tag = TEMPLATE_TAGS.find((item) => item.key === templateVar.value)
  return tag?.resolve(order) || ''
}

export const resolveTemplateVarsForYCloud = (templateVars: TemplateVarPayload[], order: OrderTemplateData): string[] => {
  return templateVars
    .sort((a, b) => a.position - b.position)
    .map((templateVar) => resolveTemplateVarValue(templateVar, order))
}
