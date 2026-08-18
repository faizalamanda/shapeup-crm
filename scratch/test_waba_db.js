const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function testWabaInsert() {
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'
  
  // 1. Fetch config
  const { data: rows, error } = await admin
    .from('integrations')
    .select('*')
    .eq('platform_name', 'waba_official')
    .filter('api_credentials->>business_id', 'eq', businessId)

  console.log('Fetch WABA Config:', rows, error)

  // 2. Test Customer Insert/Select
  const fromPhone = '6281234567890'
  const senderName = 'Budi Test'

  let customerId = null
  const { data: existingCustomer } = await admin
    .from('customers')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('phone', fromPhone)
    .maybeSingle()

  if (existingCustomer) {
    customerId = existingCustomer.id
    console.log('Found existing customer:', customerId)
  } else {
    const { data: newCustomer, error: custErr } = await admin
      .from('customers')
      .insert({
        business_id: businessId,
        name: senderName,
        phone: fromPhone,
        category: 'General',
      })
      .select('id')
      .single()

    console.log('Inserted customer:', newCustomer, custErr)
    if (newCustomer) customerId = newCustomer.id
  }

  // 3. Test Conversation Insert/Select
  const { data: existingConv } = await admin
    .from('waba_conversations')
    .select('id, unread_count')
    .eq('business_id', businessId)
    .eq('wa_id', fromPhone)
    .maybeSingle()

  let convId
  const msgDate = new Date().toISOString()
  const textBody = 'Halo min, tes pesan masuk WABA!'

  if (existingConv) {
    convId = existingConv.id
    const { error: updateErr } = await admin
      .from('waba_conversations')
      .update({
        customer_id: customerId || undefined,
        contact_name: senderName,
        last_message_text: textBody,
        last_message_at: msgDate,
        unread_count: (existingConv.unread_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', convId)
    console.log('Updated conversation:', convId, updateErr)
  } else {
    const { data: newConv, error: convErr } = await admin
      .from('waba_conversations')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        wa_id: fromPhone,
        contact_name: senderName,
        last_message_text: textBody,
        last_message_at: msgDate,
        unread_count: 1,
      })
      .select('id')
      .single()

    console.log('Inserted conversation:', newConv, convErr)
    if (newConv) convId = newConv.id
  }

  // 4. Test Message Insert
  const wamid = 'wamid.HBgMNjI4MTIzNDU2Nzg5MCEA'
  const { data: insertedMsg, error: msgErr } = await admin.from('waba_messages').insert({
    business_id: businessId,
    conversation_id: convId,
    wamid: wamid,
    direction: 'incoming',
    sender_phone: fromPhone,
    recipient_phone: '981282405070900',
    message_type: 'text',
    text_body: textBody,
    status: 'received',
    raw_payload: { test: true },
    created_at: msgDate,
  }).select('*')

  console.log('Inserted message:', insertedMsg, msgErr)
}

testWabaInsert().catch(console.error)
