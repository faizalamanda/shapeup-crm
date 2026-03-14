// Tambahkan fungsi ini di dalam komponen StaffSettings Anda
async function handleCreateStaff(e: React.FormEvent) {
  e.preventDefault();
  setLoading(true);

  const res = await fetch('/api/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email, // dari state input
      password: password, // dari state input
      full_name: name // dari state input
    })
  });

  const result = await res.json();
  if (res.ok) {
    alert("Berhasil! Berikan Email & Password ini ke staff Anda.");
    setEmail(''); setPassword(''); setName('');
    fetchStaff(); // Refresh list
  } else {
    alert(result.error);
  }
  setLoading(false);
}