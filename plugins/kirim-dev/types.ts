// ============================================================
// kirim.dev Plugin — TypeScript Interfaces
// ============================================================

export type ConversationStatus = 'open' | 'resolved' | 'pending'
export type MessageDirection = 'incoming' | 'outgoing'
export type MessageStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed'
export type MessageType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'template'
  | 'unsupported'

// ---- Database Entities ----

export interface KirimDevConversation {
  id: string
  business_id: string
  customer_id?: string | null
  wa_id: string              // E.164 number without +
  contact_name: string
  last_message_text?: string | null
  last_message_at: string    // ISO timestamp
  unread_count: number
  status: ConversationStatus
  assigned_to?: string | null
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
  // Expanded joins
  customers?: {
    id: string
    name: string
    phone: string
    email?: string | null
    category?: string | null
    address_data?: any
  } | null
}

export interface KirimDevMessage {
  id: string
  business_id: string
  conversation_id: string
  wamid?: string | null       // WhatsApp message ID
  direction: MessageDirection
  sender_phone?: string | null
  recipient_phone?: string | null
  message_type: MessageType
  text_body?: string | null
  media_url?: string | null
  media_mime_type?: string | null
  media_caption?: string | null
  interactive_payload?: Record<string, any> | null
  template_name?: string | null
  status: MessageStatus
  error_message?: string | null
  raw_payload?: Record<string, any> | null
  created_at: string
}

// ---- kirim.dev API / Webhook Payloads (Meta Cloud API shape) ----

export interface KirimDevWebhookPayload {
  object: 'whatsapp_business_account'
  entry: KirimDevWebhookEntry[]
}

export interface KirimDevWebhookEntry {
  id: string             // WABA ID
  changes: KirimDevWebhookChange[]
}

export interface KirimDevWebhookChange {
  field: string          // 'messages' | 'statuses' etc.
  value: KirimDevWebhookValue
}

export interface KirimDevWebhookValue {
  messaging_product: 'whatsapp'
  metadata?: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: {
    profile: { name: string }
    wa_id: string
  }[]
  messages?: KirimDevIncomingMessage[]
  statuses?: KirimDevStatusUpdate[]
}

export interface KirimDevIncomingMessage {
  id: string             // wamid
  from: string           // sender phone (E.164)
  timestamp: string      // unix timestamp string
  type: MessageType
  text?: { body: string }
  image?: { id: string; mime_type: string; sha256: string; caption?: string }
  document?: { id: string; mime_type: string; sha256: string; filename?: string; caption?: string }
  audio?: { id: string; mime_type: string; sha256: string; voice?: boolean }
  video?: { id: string; mime_type: string; sha256: string; caption?: string }
  sticker?: { id: string; mime_type: string; sha256: string; animated?: boolean }
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  context?: {
    from: string
    id: string           // quoted message wamid
  }
  errors?: { code: number; title: string }[]
}

export interface KirimDevStatusUpdate {
  id: string             // wamid of the message
  recipient_id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string
  conversation?: {
    id: string
    expiration_timestamp?: string
    origin: { type: string }
  }
  pricing?: { billable: boolean; pricing_model: string; category: string }
  errors?: { code: number; title: string; message?: string; error_data?: { details: string } }[]
}

// ---- UI State ----

export interface KirimDevInboxState {
  conversations: KirimDevConversation[]
  selectedConversationId: string | null
  messages: KirimDevMessage[]
  searchQuery: string
  filterTab: 'all' | 'unread' | 'resolved'
  isConfigured: boolean
  isActive: boolean
  loading: {
    conversations: boolean
    messages: boolean
    sending: boolean
  }
}

// ---- Plugin Config ----

export interface KirimDevPluginConfig {
  id: 'kirimdev'
  name: string
  version: string
  description: string
  icon: string
  category: string
  enabled: boolean       // default false; user must configure in Settings
  author: string
}
