-- Migration: Delete Purchase Transaction RPC

CREATE OR REPLACE FUNCTION public.delete_purchase_transaction_v1(p_business_id UUID, p_purchase_id UUID)
RETURNS boolean AS $$
DECLARE
  v_main_tx_id UUID;
  v_pay_tx_id UUID;
  r RECORD;
BEGIN
  -- 1. Get Main Transaction ID
  SELECT transaction_id INTO v_main_tx_id 
  FROM public.purchases 
  WHERE id = p_purchase_id AND business_id = p_business_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  -- 2. Delete Stock Moves (Trigger handles stock_quantity)
  DELETE FROM public.stock_moves 
  WHERE source_type = 'purchase' AND source_id = p_purchase_id AND business_id = p_business_id;

  -- 3. Delete Payment Transactions
  FOR r IN SELECT transaction_id FROM public.purchase_payments WHERE purchase_id = p_purchase_id AND business_id = p_business_id LOOP
    IF r.transaction_id IS NOT NULL THEN
      DELETE FROM public.transactions WHERE id = r.transaction_id;
    END IF;
  END LOOP;
  
  -- Delete payments explicitly (though cascade might handle it)
  DELETE FROM public.purchase_payments WHERE purchase_id = p_purchase_id AND business_id = p_business_id;

  -- 4. Delete Main Transaction (Cascades to purchases and journal_lines)
  IF v_main_tx_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_main_tx_id;
  ELSE
    DELETE FROM public.purchases WHERE id = p_purchase_id AND business_id = p_business_id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
