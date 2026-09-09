const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'app', 'settings', 'integrations', 'page.tsx')
let content = fs.readFileSync(filePath, 'utf-8')

// Fix variables
content = content.replace(/setIsSaving\(/g, 'setSaving(')
content = content.replace(/!isSaving /g, '!saving ')
content = content.replace(/disabled=\{isSaving\}/g, 'disabled={saving}')
content = content.replace(/\{isSaving \? 'Menyimpan\.\.\.' : 'Simpan Pengaturan'\}/g, "{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}")

// Fix fetchIntegrations
content = content.replace(/fetchIntegrations\(profile\.active_business_id\)/g, 'fetchIntegrations()')

// Fix toast
content = content.replace(/toast\.success\('Pengaturan Accurate berhasil disimpan!'\)/g, "alert('Pengaturan Accurate berhasil disimpan!')")
content = content.replace(/toast\.error\(err\.message \|\| 'Gagal menyimpan pengaturan Accurate\.'\)/g, "alert('Error: ' + (err.message || 'Gagal menyimpan pengaturan Accurate.'))")
content = content.replace(/toast\.success\(json\.message \|\| 'Sinkronisasi berhasil!'\)/g, "alert(json.message || 'Sinkronisasi berhasil!')")
content = content.replace(/toast\.error\(err\.message \|\| 'Gagal sinkronisasi\.'\)/g, "alert('Error: ' + (err.message || 'Gagal sinkronisasi.'))")

fs.writeFileSync(filePath, content, 'utf-8')
console.log('Fixed variables in page.tsx')
