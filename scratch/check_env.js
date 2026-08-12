const fs = require('fs')
const path = require('path')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
console.log('Env keys:', envContent.split('\n').map(l => l.split('=')[0]))
