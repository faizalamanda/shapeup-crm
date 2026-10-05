-- Migration: Purchase Transaction RPCs for Zero Tolerance ACID Compliance

CREATE OR REPLACE FUNCTION public.create_purchase_transaction_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_business_id UUID;
  v_purchase_tx_id UUID;
  v_pay_tx_id UUID;
  v_purchase_id UUID;
  v_item jsonb;
  v_jl jsonb;
  v_current_qty NUMERIC;
  v_current_cost NUMERIC;
  v_new_qty NUMERIC;
  v_new_cost NUMERIC;
  v_move_timestamp TIMESTAMPTZ;
BEGIN
  v_business_id := (payload->>'business_id')::UUID;
  
  -- 1. Create Purchase Transaction
  INSERT INTO public.transactions (business_id, date, description)
  VALUES (v_business_id, (payload->>'date')::DATE, 'Pembelian: ' || (payload->>'purchase_number'))
  RETURNING id INTO v_purchase_tx_id;
  
  -- 2. Insert Purchase Journal Lines
  FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'journal_lines') LOOP
    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    VALUES (v_purchase_tx_id, (v_jl->>'account_id')::UUID, (v_jl->>'debit')::NUMERIC, (v_jl->>'credit')::NUMERIC);
  END LOOP;
  
  -- 3. Create Purchase Record
  INSERT INTO public.purchases (
    business_id, transaction_id, supplier_id, purchase_number, date, due_date,
    subtotal, discount_amount, other_fees, grand_total, amount_paid, payment_status,
    items_json, attachment_url
  ) VALUES (
    v_business_id, v_purchase_tx_id, 
    NULLIF(payload->>'supplier_id', '')::UUID, 
    payload->>'purchase_number', 
    (payload->>'date')::DATE, 
    NULLIF(payload->>'due_date', '')::DATE,
    (payload->>'subtotal')::NUMERIC, 
    (payload->>'discount_amount')::NUMERIC, 
    (payload->>'other_fees')::NUMERIC, 
    (payload->>'grand_total')::NUMERIC, 
    (payload->>'amount_paid')::NUMERIC, 
    payload->>'payment_status',
    payload->'items_json', 
    NULLIF(payload->>'attachment_url', '')
  ) RETURNING id INTO v_purchase_id;
  
  -- 4. Stock & WAC (Physical Items)
  v_move_timestamp := (payload->>'move_timestamp')::TIMESTAMPTZ;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'physical_items_aggregated') LOOP
    -- Lock the product row for update to prevent concurrent race conditions
    SELECT stock_quantity, cost_price INTO v_current_qty, v_current_cost 
    FROM public.products 
    WHERE id = (v_item->>'product_id')::UUID 
    FOR UPDATE;
    
    v_current_qty := COALESCE(v_current_qty, 0);
    v_current_cost := COALESCE(v_current_cost, 0);
    
    v_new_qty := v_current_qty + (v_item->>'qty')::NUMERIC;
    
    -- WAC Calculation
    IF v_new_qty > 0 AND v_current_qty > 0 THEN
      v_new_cost := ((v_current_qty * v_current_cost) + (v_item->>'net_cost')::NUMERIC) / v_new_qty;
    ELSIF (v_item->>'qty')::NUMERIC > 0 THEN
      v_new_cost := (v_item->>'net_cost')::NUMERIC / (v_item->>'qty')::NUMERIC;
    ELSE
      v_new_cost := v_current_cost;
    END IF;
    
    UPDATE public.products 
    SET cost_price = v_new_cost
    WHERE id = (v_item->>'product_id')::UUID;
    
    -- Insert stock_moves. Trigger will automatically handle products.stock_quantity.
    INSERT INTO public.stock_moves (
      business_id, product_id, reference, qty, unit_cost, type, source_type, source_id, status, created_at
    ) VALUES (
      v_business_id, 
      (v_item->>'product_id')::UUID, 
      COALESCE(NULLIF(payload->>'purchase_number', ''), 'PO-' || substring(v_purchase_tx_id::text from 1 for 6)),
      (v_item->>'qty')::NUMERIC,
      CASE WHEN (v_item->>'qty')::NUMERIC > 0 THEN (v_item->>'net_cost')::NUMERIC / (v_item->>'qty')::NUMERIC ELSE 0 END,
      'receipt', 'purchase', v_purchase_id, 'done', v_move_timestamp
    );
  END LOOP;
  
  -- 5. Payment Handling (if any)
  IF (payload->>'amount_paid')::NUMERIC > 0 THEN
    INSERT INTO public.transactions (business_id, date, description)
    VALUES (v_business_id, (payload->>'date')::DATE, 'Pembayaran Awal Pembelian: ' || (payload->>'purchase_number'))
    RETURNING id INTO v_pay_tx_id;
    
    IF payload ? 'payment_journal_lines' AND jsonb_array_length(payload->'payment_journal_lines') > 0 THEN
      FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'payment_journal_lines') LOOP
        INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
        VALUES (v_pay_tx_id, (v_jl->>'account_id')::UUID, (v_jl->>'debit')::NUMERIC, (v_jl->>'credit')::NUMERIC);
      END LOOP;
    END IF;
    
    INSERT INTO public.purchase_payments (
      business_id, purchase_id, transaction_id, date, amount, payment_method_account_id, notes, attachment_url
    ) VALUES (
      v_business_id, v_purchase_id, v_pay_tx_id, (payload->>'date')::DATE, 
      (payload->>'amount_paid')::NUMERIC, 
      (payload->>'payment_method_account_id')::UUID, 
      'Uang Muka / Pembayaran Awal', 
      NULLIF(payload->>'attachment_url', '')
    );
  END IF;
  
  RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'transaction_id', v_purchase_tx_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.update_purchase_transaction_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_business_id UUID;
  v_purchase_id UUID;
  v_main_tx_id UUID;
  v_pay_tx_id UUID;
  v_item jsonb;
  v_jl jsonb;
  v_current_qty NUMERIC;
  v_current_cost NUMERIC;
  v_new_qty NUMERIC;
  v_new_cost NUMERIC;
  v_move_timestamp TIMESTAMPTZ;
BEGIN
  v_business_id := (payload->>'business_id')::UUID;
  v_purchase_id := (payload->>'id')::UUID;
  
  -- 1. Check existing purchase
  SELECT transaction_id INTO v_main_tx_id FROM public.purchases WHERE id = v_purchase_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  -- 2. Delete old stock moves. 
  -- The trg_sync_product_stock_from_moves trigger will automatically revert products.stock_quantity
  DELETE FROM public.stock_moves WHERE source_type = 'purchase' AND source_id = v_purchase_id;

  -- 3. Update or Create Main Transaction
  IF v_main_tx_id IS NOT NULL THEN
    UPDATE public.transactions 
    SET date = (payload->>'date')::DATE, description = 'Pembelian: ' || (payload->>'purchase_number')
    WHERE id = v_main_tx_id;
    
    DELETE FROM public.journal_lines WHERE transaction_id = v_main_tx_id;
  ELSE
    INSERT INTO public.transactions (business_id, date, description)
    VALUES (v_business_id, (payload->>'date')::DATE, 'Pembelian: ' || (payload->>'purchase_number'))
    RETURNING id INTO v_main_tx_id;
  END IF;
  
  -- Insert new journal lines
  FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'journal_lines') LOOP
    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    VALUES (v_main_tx_id, (v_jl->>'account_id')::UUID, (v_jl->>'debit')::NUMERIC, (v_jl->>'credit')::NUMERIC);
  END LOOP;

  -- 4. Update Purchase Record
  UPDATE public.purchases SET
    transaction_id = v_main_tx_id,
    supplier_id = NULLIF(payload->>'supplier_id', '')::UUID,
    purchase_number = payload->>'purchase_number',
    date = (payload->>'date')::DATE,
    due_date = NULLIF(payload->>'due_date', '')::DATE,
    subtotal = (payload->>'subtotal')::NUMERIC,
    discount_amount = (payload->>'discount_amount')::NUMERIC,
    other_fees = (payload->>'other_fees')::NUMERIC,
    grand_total = (payload->>'grand_total')::NUMERIC,
    amount_paid = (payload->>'amount_paid')::NUMERIC,
    payment_status = payload->>'payment_status',
    items_json = payload->'items_json',
    attachment_url = NULLIF(payload->>'attachment_url', '')
  WHERE id = v_purchase_id;

  -- 5. Stock & WAC (Physical Items)
  v_move_timestamp := (payload->>'move_timestamp')::TIMESTAMPTZ;
  FOR v_item IN SELECT * FROM jsonb_array_elements(payload->'physical_items_aggregated') LOOP
    -- Lock the product row for update to prevent concurrent race conditions
    SELECT stock_quantity, cost_price INTO v_current_qty, v_current_cost 
    FROM public.products 
    WHERE id = (v_item->>'product_id')::UUID 
    FOR UPDATE;
    
    v_current_qty := COALESCE(v_current_qty, 0);
    v_current_cost := COALESCE(v_current_cost, 0);
    
    v_new_qty := v_current_qty + (v_item->>'qty')::NUMERIC;
    
    -- WAC Calculation
    IF v_new_qty > 0 AND v_current_qty > 0 THEN
      v_new_cost := ((v_current_qty * v_current_cost) + (v_item->>'net_cost')::NUMERIC) / v_new_qty;
    ELSIF (v_item->>'qty')::NUMERIC > 0 THEN
      v_new_cost := (v_item->>'net_cost')::NUMERIC / (v_item->>'qty')::NUMERIC;
    ELSE
      v_new_cost := v_current_cost;
    END IF;
    
    UPDATE public.products 
    SET cost_price = v_new_cost
    WHERE id = (v_item->>'product_id')::UUID;
    
    -- Insert new stock_moves. Trigger will automatically handle products.stock_quantity.
    INSERT INTO public.stock_moves (
      business_id, product_id, reference, qty, unit_cost, type, source_type, source_id, status, created_at
    ) VALUES (
      v_business_id, 
      (v_item->>'product_id')::UUID, 
      COALESCE(NULLIF(payload->>'purchase_number', ''), 'PO-' || substring(v_main_tx_id::text from 1 for 6)),
      (v_item->>'qty')::NUMERIC,
      CASE WHEN (v_item->>'qty')::NUMERIC > 0 THEN (v_item->>'net_cost')::NUMERIC / (v_item->>'qty')::NUMERIC ELSE 0 END,
      'receipt', 'purchase', v_purchase_id, 'done', v_move_timestamp
    );
  END LOOP;

  -- 6. Initial Payment (If applicable during edit)
  IF (payload->>'amount_paid')::NUMERIC > 0 THEN
    INSERT INTO public.transactions (business_id, date, description)
    VALUES (v_business_id, (payload->>'date')::DATE, 'Pembayaran Awal Pembelian: ' || (payload->>'purchase_number'))
    RETURNING id INTO v_pay_tx_id;
    
    IF payload ? 'payment_journal_lines' AND jsonb_array_length(payload->'payment_journal_lines') > 0 THEN
      FOR v_jl IN SELECT * FROM jsonb_array_elements(payload->'payment_journal_lines') LOOP
        INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
        VALUES (v_pay_tx_id, (v_jl->>'account_id')::UUID, (v_jl->>'debit')::NUMERIC, (v_jl->>'credit')::NUMERIC);
      END LOOP;
    END IF;
    
    INSERT INTO public.purchase_payments (
      business_id, purchase_id, transaction_id, date, amount, payment_method_account_id, notes, attachment_url
    ) VALUES (
      v_business_id, v_purchase_id, v_pay_tx_id, (payload->>'date')::DATE, 
      (payload->>'amount_paid')::NUMERIC, 
      (payload->>'payment_method_account_id')::UUID, 
      'Uang Muka / Pembayaran Awal', 
      NULLIF(payload->>'attachment_url', '')
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'purchase_id', v_purchase_id, 'transaction_id', v_main_tx_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
