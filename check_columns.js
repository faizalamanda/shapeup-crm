async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const res = await fetch(url, {
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
  });
  const data = await res.json();
  const def = data.definitions || data.components?.schemas;
  console.log("Keys in def:", def ? Object.keys(def).filter(k => k.includes('pipeline')) : 'Not found');
  console.log(def?.pipeline_members?.properties || "pipeline_members not found");
}
main();
