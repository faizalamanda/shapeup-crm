const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const projectRef = 'jfflztwirjonhumcykay'

// Test passwords
const passwords = [
  'postgres',
  'Alamandaoke',
  'Alamanda123',
  'ShapeUp2026',
  'ShapeUpCRM',
  'root',
  'admin'
]

async function test() {
  for (const pwd of passwords) {
    const connStr = `postgresql://postgres.${projectRef}:${encodeURIComponent(pwd)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
    const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 3000 })
    try {
      await client.connect()
      console.log('CONGRATS! FOUND PASSWORD:', pwd)
      await client.end()
      return pwd
    } catch (e) {
      console.log('Failed pwd:', pwd, '->', e.message)
    }
  }
  
  // Try direct db endpoint
  for (const pwd of passwords) {
    const connStr = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${projectRef}.supabase.co:5432/postgres`
    const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 3000 })
    try {
      await client.connect()
      console.log('CONGRATS! FOUND DIRECT DB PASSWORD:', pwd)
      await client.end()
      return pwd
    } catch (e) {
      console.log('Failed direct db pwd:', pwd, '->', e.message)
    }
  }
}

test()
