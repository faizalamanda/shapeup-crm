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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function test() {
  const { data: conv, error: convErr } = await supabase.from('waba_conversations').select('*').limit(1)
  console.log('waba_conversations table check:', conv, convErr?.message || 'OK')

  const { data: msg, error: msgErr } = await supabase.from('waba_messages').select('*').limit(1)
  console.log('waba_messages table check:', msg, msgErr?.message || 'OK')
}

test()
