const fetch = require('node-[#1C1C1A]' in process ? 'node:fetch' : 'node-fetch') || globalThis.fetch

async function testWebhook() {
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'
  
  // Test GET verification
  const verifyRes = await fetch(`http://localhost:3000/api/webhook/waba?bid=${businessId}&hub.mode=subscribe&hub.verify_token=faizganteng123&hub.challenge=CHALLENGE_12345`)
  console.log('GET Verify Status:', verifyRes.status, await verifyRes.text())

  // Test POST incoming message
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ENTRY_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '62812345678',
                phone_number_id: '981282405070900'
              },
              contacts: [
                {
                  profile: { name: 'Budi Test' },
                  wa_id: '6281234567890'
                }
              ],
              messages: [
                {
                  from: '6281234567890',
                  id: 'wamid.HBgMNjI4MTIzNDU2Nzg5MCEA',
                  timestamp: '1723456789',
                  text: { body: 'Halo min, tes pesan masuk WABA!' },
                  type: 'text'
                }
              ]
            }
          }
        ]
      }
    ]
  }

  const postRes = await fetch(`http://localhost:3000/api/webhook/waba?bid=${businessId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  console.log('POST Message Status:', postRes.status, await postRes.json())
}

testWebhook().catch(console.error)
