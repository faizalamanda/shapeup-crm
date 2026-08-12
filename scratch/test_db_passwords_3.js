const net = require('net')
const { Client } = require('pg')
const dns = require('dns')
dns.setDefaultResultOrder('ipv4first')

const projectRef = 'jfflztwirjonhumcykay'
const passwords = ['postgres', 'Alamandaoke', 'Alamanda123', 'ShapeUp2026', 'ShapeUpCRM', 'faiz-jazuli']

async function test() {
  for (const pwd of passwords) {
    const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${projectRef}.supabase.co:5432/postgres`
    const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 3000 })
    try {
      await client.connect()
      console.log('CONGRATS! FOUND DIRECT DB PASSWORD:', pwd)
      const res = await client.query("SELECT 1 as connected")
      console.log('QueryResult:', res.rows)
      await client.end()
      return pwd
    } catch (e) {
      console.log('Failed pwd:', pwd, '->', e.message)
    }
  }
}

test()
