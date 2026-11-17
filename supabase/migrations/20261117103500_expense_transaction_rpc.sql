-- Migration: 20261117103500_expense_transaction_rpc.sql
-- Description: Semi-Modular ACID RPCs for creating and updating expenses (transactions + journal_lines + expenses + expense_payments) in 1 roundtrip.

CREATE OR REPLACE FUNCTION public.create_expense_transaction_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_business_id UUID;
  v_tx_id UUID;
  v_expense_id UUID;
  v_amount_paid NUMERIC;
  v_jl jsonb;
  v_expense_row jsonb;
BEGIN
  v_business_id := (payload->>'business_id')::UUID;

  -- Tenant Ownership / Staff Guard (Rule 14)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.businesses WHERE id = v_business_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.business_staff WHERE business_id = v_business_id AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied for business %', v_business_id;
  END IF;

  -- 1. Create Ledger Transaction
  INSERT INTO public.transactions (business_id, date, description)
  VALUES (
    v_business_id,
    (payload->>'tx_date')::TIMESTAMPTZ,
    payload->>'tx_description'
  )
  RETURNING id INTO v_tx_id;

  -- 2. Insert Balancing Journal Lines
  FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'journal_lines') LOOP
    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    VALUES (
      v_tx_id,
      (v_jl->>'account_id')::UUID,
      (v_jl->>'debit')::NUMERIC,
      (v_jl->>'credit')::NUMERIC
    );
  END LOOP;

  -- 3. Insert Expense Record
  v_amount_paid := COALESCE((payload->>'amount_paid')::NUMERIC, 0);

  INSERT INTO public.expenses (
    business_id,
    transaction_id,
    category_account_id,
    payment_account_id,
    amount,
    date,
    description,
    vendor_name,
    attachment_url,
    payment_status,
    due_date,
    amount_paid,
    outstanding_amount
  ) VALUES (
    v_business_id,
    v_tx_id,
    (payload->>'category_account_id')::UUID,
    (payload->>'payment_account_id')::UUID,
    (payload->>'amount')::NUMERIC,
    (payload->>'date')::DATE,
    NULLIF(payload->>'description', ''),
    NULLIF(payload->>'vendor_name', ''),
    NULLIF(payload->>'attachment_url', ''),
    payload->>'payment_status',
    NULLIF(payload->>'due_date', '')::DATE,
    v_amount_paid,
    COALESCE((payload->>'outstanding_amount')::NUMERIC, 0)
  )
  RETURNING id, to_jsonb(expenses.*) INTO v_expense_id, v_expense_row;

  -- 4. Record Initial Payment Log if amount_paid > 0
  IF v_amount_paid > 0 THEN
    INSERT INTO public.expense_payments (
      business_id,
      expense_id,
      transaction_id,
      date,
      amount,
      payment_method_account_id,
      notes
    ) VALUES (
      v_business_id,
      v_expense_id,
      v_tx_id,
      (payload->>'date')::DATE,
      v_amount_paid,
      (payload->>'payment_method_account_id')::UUID,
      CASE
        WHEN payload->>'payment_status' = 'paid' THEN 'Pembayaran Lunas Saat Pengeluaran Dibuat'
        ELSE 'Uang Muka / DP'
      END
    );
  END IF;

  RETURN v_expense_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION public.update_expense_transaction_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_business_id UUID;
  v_expense_id UUID;
  v_tx_id UUID;
  v_old_status TEXT;
  v_jl jsonb;
  v_expense_row jsonb;
BEGIN
  v_business_id := (payload->>'business_id')::UUID;
  v_expense_id := (payload->>'expense_id')::UUID;

  -- Tenant Ownership / Staff Guard (Rule 14)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.businesses WHERE id = v_business_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.business_staff WHERE business_id = v_business_id AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied for business %', v_business_id;
  END IF;

  -- 1. Lock & Fetch Existing Expense
  SELECT transaction_id, payment_status
  INTO v_tx_id, v_old_status
  FROM public.expenses
  WHERE id = v_expense_id AND business_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXPENSE_NOT_FOUND';
  END IF;

  IF v_old_status = 'paid' THEN
    RAISE EXCEPTION 'EXPENSE_ALREADY_PAID';
  END IF;

  IF EXISTS (SELECT 1 FROM public.expense_payments WHERE expense_id = v_expense_id) THEN
    RAISE EXCEPTION 'EXPENSE_HAS_PAYMENTS';
  END IF;

  -- 2. Create or Update Ledger Transaction
  IF v_tx_id IS NULL THEN
    INSERT INTO public.transactions (business_id, date, description)
    VALUES (
      v_business_id,
      (payload->>'tx_date')::TIMESTAMPTZ,
      payload->>'tx_description'
    )
    RETURNING id INTO v_tx_id;
  ELSE
    UPDATE public.transactions
    SET
      date = (payload->>'tx_date')::TIMESTAMPTZ,
      description = payload->>'tx_description'
    WHERE id = v_tx_id AND business_id = v_business_id;

    DELETE FROM public.journal_lines WHERE transaction_id = v_tx_id;
  END IF;

  -- 3. Insert Rebuilt Balancing Journal Lines
  FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'journal_lines') LOOP
    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    VALUES (
      v_tx_id,
      (v_jl->>'account_id')::UUID,
      (v_jl->>'debit')::NUMERIC,
      (v_jl->>'credit')::NUMERIC
    );
  END LOOP;

  -- 4. Update Expense Record
  UPDATE public.expenses
  SET
    transaction_id = v_tx_id,
    category_account_id = (payload->>'category_account_id')::UUID,
    payment_account_id = (payload->>'payment_account_id')::UUID,
    amount = (payload->>'amount')::NUMERIC,
    date = (payload->>'date')::DATE,
    description = NULLIF(payload->>'description', ''),
    vendor_name = NULLIF(payload->>'vendor_name', ''),
    attachment_url = NULLIF(payload->>'attachment_url', ''),
    payment_status = payload->>'payment_status',
    due_date = NULLIF(payload->>'due_date', '')::DATE,
    amount_paid = COALESCE((payload->>'amount_paid')::NUMERIC, 0),
    outstanding_amount = COALESCE((payload->>'outstanding_amount')::NUMERIC, 0),
    updated_at = now()
  WHERE id = v_expense_id AND business_id = v_business_id
  RETURNING to_jsonb(expenses.*) INTO v_expense_row;

  RETURN v_expense_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

