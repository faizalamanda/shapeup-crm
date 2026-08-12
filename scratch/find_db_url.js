console.log('Process env keys:', Object.keys(process.env).filter(k => k.includes('DB') || k.includes('POSTGRES') || k.includes('SUPABASE') || k.includes('URL') || k.includes('PASS')))
