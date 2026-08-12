const { Client } = require('pg')

const passwords = [
  'Alamandaoke', 'Alamanda123', 'ShapeUp2026', 'ShapeUpCRM', 'faizalamanda', 'faiz-jazuli', 'postgres', 'root', 'admin123', 'Jazuli123', 'Jazuli2026', 'shapeup2026', 'alamanda2026', 'Shapeup123', 'Shapeup2026!'
]

async function run() {
  const hosts = [
    'aws-0-ap-southeast-1.pooler.supabase.com',
    'db.jfflztwirjonhumcykay.supabase.co'
  ]

  for (const host of hosts) {
    for (const pwd of passwords) {
      const user = host.includes('pooler') ? 'postgres.jfflztwirjonhumcykay' : 'postgres'
      const port = host.includes('pooler') ? 5432 : 5432
      const connStr = `postgresql://${user}:${encodeURIComponent(pwd)}@${host}:${port}/postgres`
      const client = new Client({
        connectionString: connStr,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 3000
      })
      try {
        await client.connect()
        console.log('SUCCESS CONNECTED!', host, 'PWD:', pwd)
        await client.end()
        return pwd
      } catch (e) {
        if (!e.message.includes('ENOTFOUND') && !e.message.includes('ENETUNREACH')) {
          console.log(`Host ${host} Pwd "${pwd}" ->`, e.message)
        }
      }
    }
  }
  console.log("Finished password check")
}
run()
