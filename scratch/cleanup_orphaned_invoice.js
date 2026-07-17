const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const envPath = path.join('/home/faiz-jazuli/shapeup-crm', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
  if (match) {
    const key = match[1]
    let value = match[2] || ''
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '')
    }
    env[key] = value
  }
})

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const orderId = '4a1d8a97-2b56-4906-9915-ac9357d10964'; // INV-09072026-001
  const txId = 'a423f040-5b1d-4f7a-ad5b-a2a9266a10a6';

  console.log(`Starting cleanup for order ID ${orderId}...`);

  // 1. Fetch the order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (orderErr) {
    console.error("Error fetching order:", orderErr.message);
    return;
  }

  console.log(`Order found: Code/Number=${order.order_number}, Status=${order.status}, Items=`, order.items_json);

  // 2. Restore stock for items in the order
  const items = Array.isArray(order.items_json) ? order.items_json : [];
  const productIds = items.map(i => i.product_id).filter(Boolean);

  if (productIds.length > 0) {
    console.log("Restoring stock for products:", productIds);
    const { data: dbProducts, error: prodErr } = await supabase
      .from('products')
      .select('id, name, stock_type, stock_quantity')
      .in('id', productIds);

    if (prodErr) {
      console.error("Error fetching products:", prodErr.message);
      return;
    }

    const productMap = new Map();
    dbProducts.forEach(p => productMap.set(p.id, p));

    for (const item of items) {
      const dbProd = productMap.get(item.product_id);
      if (dbProd) {
        if (dbProd.stock_type === 'tracked') {
          const newQty = dbProd.stock_quantity + Number(item.quantity);
          console.log(`Restoring stock for product ${dbProd.name}: ${dbProd.stock_quantity} -> ${newQty}`);
          const { error: updErr } = await supabase
            .from('products')
            .update({ stock_quantity: newQty })
            .eq('id', dbProd.id);

          if (updErr) {
            console.error(`Failed to update stock for ${dbProd.name}:`, updErr.message);
          }
        } else {
          console.log(`Product ${dbProd.name} is not tracked. Skipping restock.`);
        }
      }
    }
  }

  // 3. Delete journal lines
  console.log(`Deleting journal lines for transaction ID ${txId}...`);
  const { error: jlDelErr } = await supabase
    .from('journal_lines')
    .delete()
    .eq('transaction_id', txId);

  if (jlDelErr) {
    console.error("Error deleting journal lines:", jlDelErr.message);
    return;
  }
  console.log("Journal lines deleted successfully.");

  // 4. Delete transaction
  console.log(`Deleting transaction ID ${txId}...`);
  const { error: txDelErr } = await supabase
    .from('transactions')
    .delete()
    .eq('id', txId);

  if (txDelErr) {
    console.error("Error deleting transaction:", txDelErr.message);
    return;
  }
  console.log("Transaction deleted successfully.");

  console.log("Cleanup completed successfully!");
}

run()
