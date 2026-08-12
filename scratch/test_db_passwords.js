const { Client } = require('pg')
const fs = require('fs')

// Try local postgres or supabase database connections
async function checkConns() {
  const connStrings = [
    'postgresql://postgres:postgres@localhost:5432/postgres',
    'postgresql://postgres:postgres@localhost:54322/postgres', // Supabase CLI local default
    'postgresql://postgres.jfflztwirjonhumcykay:postgres@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
    'postgresql://postgres.jfflztwirjonhumcykay:postgres@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'
  ]

  for (const connStr of connStrings) {
    try {
      const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 2000 })
      await client.connect()
      console.log('SUCCESS CONNECTING:', connStr)
      const res = await client.query('SELECT current_database(), version()')
      console.log('DB Info:', res.rows[0])
      await client.end()
      return client
    } catch (err) {
      console.log('Failed:', connStr, '->', err.message)
    }
  }
}

checkConns()
