const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read env file manually
const envPath = '.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    const key = match[1];
    let value = match[2] || '';
    if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.replace(/^"|"/g, '');
    }
    env[key] = value;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const anonClient = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  console.log("=== START PAYROLL E2E ACCOUNTING TEST ===");

  // 1. Sign in as user to get cookie credentials
  console.log("Signing in as user...");
  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email: 'alamandatoko@gmail.com',
    password: 'Alamandaoke'
  });

  if (authError) {
    console.error("Sign in error:", authError);
    return;
  }

  const token = authData.session.access_token;
  const projectId = supabaseUrl.split('//')[1].split('.')[0];
  const sessionData = {
    access_token: token,
    refresh_token: authData.session.refresh_token,
    user: authData.user
  };
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(sessionData)).toString('base64');
  const cookieHeader = `sb-${projectId}-auth-token=${cookieValue}`;
  const businessId = 'b32d3ec3-e2e5-48f0-8074-7dc7fe7ef53d'; // TOKO ALAMANDA

  // Set active business
  await supabase
    .from('profiles')
    .update({ active_business_id: businessId })
    .eq('id', authData.user.id);

  // 2. Retrieve active employee and Kas/Bank account
  const { data: employees } = await supabase
    .from('employees')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('status', 'active')
    .limit(1);

  const employee = employees[0];
  if (!employee) {
    console.error("No active employee found!");
    return;
  }
  console.log(`Using Employee: ${employee.name} (${employee.id})`);

  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, name, code')
    .eq('business_id', businessId)
    .eq('type', 'ASSET')
    .limit(1);

  const paymentAccount = accounts[0];
  if (!paymentAccount) {
    console.error("No payment account found!");
    return;
  }
  console.log(`Using Payment Account: ${paymentAccount.name} (${paymentAccount.id})`);

  let salaryId = null;
  let txId = null;

  try {
    // TEST 1: Create Unpaid Salary (POST)
    console.log("\n--- TEST 1: Creating Unpaid Salary (POST) ---");
    const createRes = await fetch('http://localhost:3000/api/employees/salary', {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        employee_id: employee.id,
        amount: 1500000,
        period: '2026-07',
        payment_status: 'pending'
      })
    });

    console.log("Create status:", createRes.status);
    const createdSal = await createRes.json();
    if (createdSal.error) throw new Error(createdSal.error);

    salaryId = createdSal.id;
    txId = createdSal.transaction_id;
    console.log(`Created Salary Record ID: ${salaryId}, Transaction ID: ${txId}`);

    // Verify journal entries for unpaid salary
    const { data: jlines } = await supabase
      .from('journal_lines')
      .select('*, accounts(code, name)')
      .eq('transaction_id', txId);

    console.log("Journal Lines created on POST:");
    console.log(JSON.stringify(jlines, null, 2));

    const debitLine = jlines.find(jl => jl.debit > 0);
    const creditLine = jlines.find(jl => jl.credit > 0);

    if (debitLine.accounts.code !== '503300' || debitLine.debit !== 1500000) {
      throw new Error("Debit line is incorrect! Expected code 503300 and amount 1500000");
    }
    if (creditLine.accounts.code !== '201100' || creditLine.credit !== 1500000) {
      throw new Error("Credit line is incorrect! Expected liability code 201100 and amount 1500000");
    }
    console.log("✅ TEST 1 PASSED: Unpaid salary created with correct debit/credit lines.");

    // TEST 2: Pay the Salary (PUT status to paid)
    console.log("\n--- TEST 2: Settling Salary to Paid (PUT) ---");
    const payRes = await fetch(`http://localhost:3000/api/employees/salary?id=${salaryId}`, {
      method: 'PUT',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payment_status: 'paid',
        payment_account_id: paymentAccount.id
      })
    });

    console.log("Pay status:", payRes.status);
    const paidSal = await payRes.json();
    if (paidSal.error) throw new Error(paidSal.error);

    // Verify updated journal lines
    const { data: updatedJlines } = await supabase
      .from('journal_lines')
      .select('*, accounts(code, name)')
      .eq('transaction_id', txId);

    console.log("Journal Lines after Quick Pay:");
    console.log(JSON.stringify(updatedJlines, null, 2));

    const payDebitLine = updatedJlines.find(jl => jl.debit > 0);
    const payCreditLine = updatedJlines.find(jl => jl.credit > 0);

    if (payDebitLine.accounts.code !== '503300' || payDebitLine.debit !== 1500000) {
      throw new Error("Debit line incorrect after payment!");
    }
    if (payCreditLine.account_id !== paymentAccount.id || payCreditLine.credit !== 1500000) {
      throw new Error("Credit line incorrect after payment! Expected credit to Kas/Bank account.");
    }
    console.log("✅ TEST 2 PASSED: Salary paid and credit correctly switched to Kas/Bank.");

    // TEST 3: Edit details (PUT new period and amount)
    console.log("\n--- TEST 3: Editing Details (PUT) ---");
    const editRes = await fetch(`http://localhost:3000/api/employees/salary?id=${salaryId}`, {
      method: 'PUT',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: 1800000,
        period: '2026-08'
      })
    });

    console.log("Edit status:", editRes.status);
    const editedSal = await editRes.json();
    if (editedSal.error) throw new Error(editedSal.error);

    // Verify updated transaction and journal lines
    const { data: editedTx } = await supabase
      .from('transactions')
      .select('description')
      .eq('id', txId)
      .single();

    if (!editedTx.description.includes('2026-08')) {
      throw new Error(`Transaction description was not updated: ${editedTx.description}`);
    }

    const { data: editedJlines } = await supabase
      .from('journal_lines')
      .select('*, accounts(code, name)')
      .eq('transaction_id', txId);

    console.log("Journal Lines after Edit:");
    console.log(JSON.stringify(editedJlines, null, 2));

    const editDebitLine = editedJlines.find(jl => jl.debit > 0);
    const editCreditLine = editedJlines.find(jl => jl.credit > 0);

    if (editDebitLine.debit !== 1800000 || editCreditLine.credit !== 1800000) {
      throw new Error("Journal amounts were not updated to 1800000!");
    }
    console.log("✅ TEST 3 PASSED: Details and amounts updated correctly in ledger.");

    // TEST 4: Cancel Salary (PUT status to cancelled)
    console.log("\n--- TEST 4: Cancelling Salary (PUT to cancelled) ---");
    const cancelRes = await fetch(`http://localhost:3000/api/employees/salary?id=${salaryId}`, {
      method: 'PUT',
      headers: {
        'Cookie': cookieHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        payment_status: 'cancelled'
      })
    });

    console.log("Cancel status:", cancelRes.status);
    const cancelledSal = await cancelRes.json();
    if (cancelledSal.error) throw new Error(cancelledSal.error);

    // Check that a reversal transaction is created
    const reversalDesc = `Pembatalan Gaji Karyawan: ${employee.name} (2026-08)`;
    const { data: revTxs } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('business_id', businessId)
      .eq('description', reversalDesc);

    if (revTxs.length !== 1) {
      throw new Error(`Expected exactly 1 reversal transaction, found: ${revTxs.length}`);
    }

    const revTxId = revTxs[0].id;
    console.log(`Reversal Transaction ID: ${revTxId}`);

    // Verify reversal journal lines (Debit Kas/Bank, Credit Beban Gaji)
    const { data: revJlines } = await supabase
      .from('journal_lines')
      .select('*, accounts(code, name)')
      .eq('transaction_id', revTxId);

    console.log("Reversal Journal Lines:");
    console.log(JSON.stringify(revJlines, null, 2));

    const revDebitLine = revJlines.find(jl => jl.debit > 0);
    const revCreditLine = revJlines.find(jl => jl.credit > 0);

    if (revDebitLine.account_id !== paymentAccount.id || revDebitLine.debit !== 1800000) {
      throw new Error("Reversal debit line incorrect! Expected debit to Kas/Bank for 1800000");
    }
    if (revCreditLine.accounts.code !== '503300' || revCreditLine.credit !== 1800000) {
      throw new Error("Reversal credit line incorrect! Expected credit to 503300 for 1800000");
    }
    console.log("✅ TEST 4 PASSED: Reversal entry successfully created for cancelled salary.");

    // TEST 5: Delete Salary (DELETE)
    console.log("\n--- TEST 5: Deleting Salary (DELETE) ---");
    const deleteRes = await fetch(`http://localhost:3000/api/employees/salary?id=${salaryId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': cookieHeader
      }
    });

    console.log("Delete status:", deleteRes.status);
    const deletedResult = await deleteRes.json();
    if (deletedResult.error) throw new Error(deletedResult.error);

    // Verify deletion in database
    const { data: checkSal } = await supabase
      .from('employee_salaries')
      .select('*')
      .eq('id', salaryId);

    if (checkSal.length > 0) throw new Error("Salary record was not deleted!");

    const { data: checkTx } = await supabase
      .from('transactions')
      .select('*')
      .in('id', [txId, revTxId]);

    if (checkTx.length > 0) throw new Error("Transactions were not cleaned up on delete!");

    console.log("✅ TEST 5 PASSED: Salary and transactions fully cleaned up.");
    console.log("\n=== ALL E2E ACCOUNTING TESTS PASSED SUCCESSFULLY ===");

  } catch (err) {
    console.error("❌ TEST FAILED:", err.message);
  }
}

run();
