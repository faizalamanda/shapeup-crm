export interface QueueItem {
  id: string
  business_id?: string
  scenario_id?: string
  recipient: string
  payload: any
  retry_count: number
  [key: string]: any
}

export interface SendResult {
  [key: string]: any
}

export interface MessagingDriver {
  send(queue: QueueItem, supabase: any): Promise<SendResult>
}
