-- ==============================================================================
-- MIGRATION: POS Returns Engine (Sales Return Documents, Store Credit, ACID RPC)
-- Timestamp: 20261101160000_pos_returns_engine.sql
-- Description:
--   1. orders: return_status / returned_total / exchanged_in_total (derived dimension,
--      orders.status is NOT overloaded for partial returns).
--   2. pos_return_settings: per-business return policy (window, approval, fee, ...).
--   3. pos_returns + pos_return_items: append-only return documents (credit notes).
--   4. customer_store_credits + store_credit_ledger: store credit (append-only ledger).
--   5. order_payments.return_id: link refund / exchange payment rows to a return doc.
--   6. process_pos_return_v1(jsonb): single-transaction (ACID) executor.
--   7. redeem_store_credit_v1(...): row-locked store credit redemption.
--   8. v_pos_return_items_report (security_invoker) for analytics, and
--      v_quarantine_returns extended to include POS return quarantine moves.
-- ==============================================================================

-- 1. Orders: derived return dimension --------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS return_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS returned_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchanged_in_total numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_return_status_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_return_status_check
      CHECK (return_status IN ('none', 'partial', 'full'));
  END IF;
END $$;

-- 2. Return policy settings (1 row per business) ---------------------------------
CREATE TABLE IF NOT EXISTS public.pos_return_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  return_window_days integer NOT NULL DEFAULT 0 CHECK (return_window_days >= 0),
  require_reason boolean NOT NULL DEFAULT true,
  approval_mode text NOT NULL DEFAULT 'off'
    CHECK (approval_mode IN ('off', 'always', 'above_amount', 'non_admin')),
  approval_threshold numeric NOT NULL DEFAULT 0 CHECK (approval_threshold >= 0),
  restocking_fee_pct numeric NOT NULL DEFAULT 0 CHECK (restocking_fee_pct >= 0 AND restocking_fee_pct <= 100),
  allow_store_credit boolean NOT NULL DEFAULT true,
  default_disposition text NOT NULL DEFAULT 'restock'
    CHECK (default_disposition IN ('restock', 'quarantine', 'writeoff')),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Return documents (append-only) ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.pos_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  idempotency_key text NOT NULL,
  return_kind text NOT NULL DEFAULT 'return' CHECK (return_kind IN ('return', 'exchange')),
  is_full boolean NOT NULL DEFAULT false,
  shift_id uuid REFERENCES public.pos_shifts(id) ON DELETE SET NULL,
  cashier_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cashier_name text,
  customer_id uuid,
  reason_code text NOT NULL DEFAULT 'other',
  reason_note text,
  gross_refund numeric NOT NULL DEFAULT 0,
  restocking_fee numeric NOT NULL DEFAULT 0,
  credit_value numeric NOT NULL DEFAULT 0,
  exchange_total numeric NOT NULL DEFAULT 0,
  refund_total numeric NOT NULL DEFAULT 0,
  payment_in_total numeric NOT NULL DEFAULT 0,
  store_credit_issued numeric NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approval_note text,
  settlement_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  exchange_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pos_returns_number UNIQUE (business_id, return_number),
  CONSTRAINT uq_pos_returns_idempotency UNIQUE (business_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_pos_returns_business_created ON public.pos_returns (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_returns_order ON public.pos_returns (order_id);
CREATE INDEX IF NOT EXISTS idx_pos_returns_shift ON public.pos_returns (shift_id) WHERE shift_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pos_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.pos_returns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_ref text NOT NULL,
  product_id uuid,
  variant_id uuid,
  name text NOT NULL,
  variant_name text,
  qty numeric NOT NULL CHECK (qty > 0),
  unit_net_price numeric NOT NULL DEFAULT 0,
  line_refund numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  disposition text NOT NULL DEFAULT 'restock' CHECK (disposition IN ('restock', 'quarantine', 'writeoff')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_return_items_order_ref ON public.pos_return_items (business_id, order_id, order_item_ref);
CREATE INDEX IF NOT EXISTS idx_pos_return_items_return ON public.pos_return_items (return_id);

-- 4. Store credit -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_store_credits (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, customer_id)
);

CREATE TABLE IF NOT EXISTS public.store_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('issued', 'redeemed', 'adjusted', 'reversed')),
  amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  return_id uuid REFERENCES public.pos_returns(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  description text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_credit_ledger_customer ON public.store_credit_ledger (business_id, customer_id, created_at DESC);

-- 5. Link refund / exchange payment rows to the return document ---------------------
ALTER TABLE public.order_payments
  ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.pos_returns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_payments_return_id
  ON public.order_payments (return_id) WHERE return_id IS NOT NULL;

-- 6. Row Level Security (Rule 15 union clause; writes only via service-role RPC) ----
ALTER TABLE public.pos_return_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_store_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view pos_return_settings" ON public.pos_return_settings;
CREATE POLICY "Members can view pos_return_settings" ON public.pos_return_settings
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners and admins can manage pos_return_settings" ON public.pos_return_settings;
CREATE POLICY "Owners and admins can manage pos_return_settings" ON public.pos_return_settings
  FOR ALL TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Members can view pos_returns" ON public.pos_returns;
CREATE POLICY "Members can view pos_returns" ON public.pos_returns
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can view pos_return_items" ON public.pos_return_items;
CREATE POLICY "Members can view pos_return_items" ON public.pos_return_items
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can view customer_store_credits" ON public.customer_store_credits;
CREATE POLICY "Members can view customer_store_credits" ON public.customer_store_credits
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can view store_credit_ledger" ON public.store_credit_ledger;
CREATE POLICY "Members can view store_credit_ledger" ON public.store_credit_ledger
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 7. ACID executor: process_pos_return_v1 -------------------------------------------
-- Node.js computes values (net refund, journal lines, stock rows, settlement) and sends
-- one JSON payload. This function only validates invariants and writes everything inside
-- a single transaction. Any exception rolls back ALL writes.
CREATE OR REPLACE FUNCTION public.process_pos_return_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid := (payload->>'business_id')::uuid;
  v_actor uuid := (payload->>'actor_id')::uuid;
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_idem text := payload->>'idempotency_key';
  v_ret jsonb := payload->'return';
  v_ou jsonb := payload->'order_update';
  v_jr jsonb := payload->'journal';
  v_sc jsonb := payload->'store_credit';
  v_existing record;
  v_order record;
  v_return_id uuid;
  v_return_number text := v_ret->>'return_number';
  v_item jsonb;
  v_item_id uuid;
  v_tx_id uuid;
  v_debit numeric;
  v_credit numeric;
  v_pay jsonb;
  v_pay_in numeric := 0;
  v_pay_out numeric := 0;
  v_new_paid numeric;
  v_new_grand numeric;
  v_pay_status text;
  v_new_status text;
  v_sc_balance numeric := NULL;
  v_sc_customer uuid;
  v_sc_amount numeric;
  v_now timestamptz := now();
BEGIN
  -- Guard (Rule 14): caller identity must be owner or staff of the business.
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = v_business AND b.owner_id = v_actor)
    OR EXISTS (SELECT 1 FROM public.business_staff s WHERE s.business_id = v_business AND s.profile_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: aktor bukan pemilik/staf unit bisnis ini' USING ERRCODE = '42501';
  END IF;

  -- Idempotency: same key => return the original result without re-posting.
  SELECT id, return_number, transaction_id INTO v_existing
  FROM public.pos_returns
  WHERE business_id = v_business AND idempotency_key = v_idem;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'idempotent', true,
      'return_id', v_existing.id, 'return_number', v_existing.return_number,
      'transaction_id', v_existing.transaction_id
    );
  END IF;

  -- Serialize concurrent returns on the same order.
  SELECT id, status, grand_total, amount_paid, returned_total, exchanged_in_total
  INTO v_order
  FROM public.orders
  WHERE id = v_order_id AND business_id = v_business
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: pesanan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED: pesanan sudah dibatalkan' USING ERRCODE = 'P0001';
  END IF;

  -- Optimistic concurrency: payload was computed from a snapshot; reject if it moved.
  IF abs(COALESCE(v_order.grand_total, 0) - (payload->>'expected_grand_total')::numeric) > 0.5
     OR abs(COALESCE(v_order.returned_total, 0) - (payload->>'expected_returned_total')::numeric) > 0.5
     OR abs(COALESCE(v_order.exchanged_in_total, 0) - (payload->>'expected_exchanged_in_total')::numeric) > 0.5
     OR abs(COALESCE(v_order.amount_paid, 0) - (payload->>'expected_amount_paid')::numeric) > 0.5 THEN
    RAISE EXCEPTION 'STATE_CHANGED: data pesanan berubah, muat ulang lalu coba lagi' USING ERRCODE = 'P0001';
  END IF;

  -- Journal must balance before anything is written.
  SELECT COALESCE(SUM(COALESCE(x.debit, 0)), 0), COALESCE(SUM(COALESCE(x.credit, 0)), 0)
  INTO v_debit, v_credit
  FROM jsonb_to_recordset(COALESCE(v_jr->'lines', '[]'::jsonb)) AS x(account_id uuid, debit numeric, credit numeric);
  IF abs(v_debit - v_credit) > 0.5 THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: debit % <> kredit %', v_debit, v_credit USING ERRCODE = 'P0001';
  END IF;

  -- Return header
  INSERT INTO public.pos_returns (
    business_id, order_id, return_number, idempotency_key, return_kind, is_full,
    shift_id, cashier_id, cashier_name, customer_id, reason_code, reason_note,
    gross_refund, restocking_fee, credit_value, exchange_total, refund_total,
    payment_in_total, store_credit_issued, approved_by, approval_note,
    settlement_json, exchange_items, created_at
  ) VALUES (
    v_business, v_order_id, v_return_number, v_idem,
    COALESCE(v_ret->>'return_kind', 'return'),
    COALESCE((v_ret->>'is_full')::boolean, false),
    NULLIF(v_ret->>'shift_id', '')::uuid,
    v_actor,
    v_ret->>'cashier_name',
    NULLIF(v_ret->>'customer_id', '')::uuid,
    COALESCE(v_ret->>'reason_code', 'other'),
    v_ret->>'reason_note',
    COALESCE((v_ret->>'gross_refund')::numeric, 0),
    COALESCE((v_ret->>'restocking_fee')::numeric, 0),
    COALESCE((v_ret->>'credit_value')::numeric, 0),
    COALESCE((v_ret->>'exchange_total')::numeric, 0),
    COALESCE((v_ret->>'refund_total')::numeric, 0),
    COALESCE((v_ret->>'payment_in_total')::numeric, 0),
    COALESCE((v_ret->>'store_credit_issued')::numeric, 0),
    NULLIF(v_ret->>'approved_by', '')::uuid,
    v_ret->>'approval_note',
    COALESCE(v_ret->'settlement_json', '{}'::jsonb),
    COALESCE(v_ret->'exchange_items', '[]'::jsonb),
    v_now
  ) RETURNING id INTO v_return_id;

  -- Return items + stock movements (event-sourced; source_id = return item id)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
    INSERT INTO public.pos_return_items (
      return_id, business_id, order_id, order_item_ref, product_id, variant_id,
      name, variant_name, qty, unit_net_price, line_refund, unit_cost, disposition, created_at
    ) VALUES (
      v_return_id, v_business, v_order_id, v_item->>'order_item_ref',
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      COALESCE(v_item->>'name', 'Produk'), v_item->>'variant_name',
      (v_item->>'qty')::numeric,
      COALESCE((v_item->>'unit_net_price')::numeric, 0),
      COALESCE((v_item->>'line_refund')::numeric, 0),
      COALESCE((v_item->>'unit_cost')::numeric, 0),
      COALESCE(v_item->>'disposition', 'restock'),
      v_now
    ) RETURNING id INTO v_item_id;

    IF COALESCE((v_item->>'track_stock')::boolean, false)
       AND (v_item->>'disposition') IN ('restock', 'quarantine')
       AND NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, qty, unit_cost, status, type,
        bucket, source_type, source_id, created_at
      ) VALUES (
        v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
        v_return_number, (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
        'done', 'receipt',
        CASE WHEN v_item->>'disposition' = 'quarantine' THEN 'quarantine' ELSE 'main' END,
        'order_return', v_item_id, v_now
      );
    END IF;
  END LOOP;

  -- Replacement items leaving the shelf (exchange)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'exchange_stock', '[]'::jsonb)) LOOP
    INSERT INTO public.stock_moves (
      business_id, product_id, variant_id, reference, qty, unit_cost, status, type,
      bucket, source_type, source_id, created_at
    ) VALUES (
      v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
      v_return_number, (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
      'done', 'delivery', 'main', 'order_exchange', v_return_id, v_now
    );
  END LOOP;

  -- Accounting journal (one header, balanced lines)
  IF v_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_jr->'lines', '[]'::jsonb)) > 0 THEN
    INSERT INTO public.transactions (business_id, order_id, date, description)
    VALUES (v_business, v_order_id, COALESCE(NULLIF(v_jr->>'date', '')::timestamptz, v_now), v_jr->>'description')
    RETURNING id INTO v_tx_id;

    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    SELECT v_tx_id, x.account_id, COALESCE(x.debit, 0), COALESCE(x.credit, 0)
    FROM jsonb_to_recordset(v_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric)
    WHERE COALESCE(x.debit, 0) + COALESCE(x.credit, 0) > 0;

    UPDATE public.pos_returns SET transaction_id = v_tx_id WHERE id = v_return_id;
  END IF;

  -- Cash / bank / store credit movements (append-only order_payments)
  FOR v_pay IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'payments', '[]'::jsonb)) LOOP
    INSERT INTO public.order_payments (
      business_id, order_id, shift_id, transaction_id, date, amount, payment_method,
      payment_method_account_id, cash_received, change_amount, reference_number, notes,
      payment_kind, return_id
    ) VALUES (
      v_business, v_order_id, NULLIF(v_ret->>'shift_id', '')::uuid, v_tx_id,
      current_date, (v_pay->>'amount')::numeric, COALESCE(v_pay->>'method', 'cash'),
      NULLIF(v_pay->>'account_id', '')::uuid,
      COALESCE((v_pay->>'cash_received')::numeric, 0),
      COALESCE((v_pay->>'change_amount')::numeric, 0),
      v_pay->>'reference_number', v_pay->>'notes',
      v_pay->>'kind', v_return_id
    );
    IF v_pay->>'kind' = 'payment' THEN
      v_pay_in := v_pay_in + (v_pay->>'amount')::numeric;
    ELSE
      v_pay_out := v_pay_out + (v_pay->>'amount')::numeric;
    END IF;
  END LOOP;

  -- Store credit issuance
  IF v_sc IS NOT NULL AND COALESCE((v_sc->>'amount')::numeric, 0) > 0 THEN
    v_sc_customer := (v_sc->>'customer_id')::uuid;
    v_sc_amount := (v_sc->>'amount')::numeric;

    INSERT INTO public.customer_store_credits (business_id, customer_id, balance, updated_at)
    VALUES (v_business, v_sc_customer, v_sc_amount, v_now)
    ON CONFLICT (business_id, customer_id)
    DO UPDATE SET balance = public.customer_store_credits.balance + EXCLUDED.balance, updated_at = v_now
    RETURNING balance INTO v_sc_balance;

    INSERT INTO public.store_credit_ledger (
      business_id, customer_id, entry_type, amount, balance_after, return_id, order_id, description, created_by
    ) VALUES (
      v_business, v_sc_customer, 'issued', v_sc_amount, v_sc_balance, v_return_id, v_order_id,
      COALESCE(v_sc->>'description', 'Saldo kredit dari retur ' || v_return_number), v_actor
    );
  END IF;

  -- Order update (derived dimensions; original line items are never rewritten)
  v_new_grand := GREATEST(0, (v_ou->>'grand_total')::numeric);
  v_new_paid := GREATEST(0, COALESCE(v_order.amount_paid, 0) + v_pay_in - v_pay_out);
  v_new_status := CASE WHEN v_ou->>'status' = 'cancelled' THEN 'cancelled' ELSE v_order.status END;
  v_pay_status := CASE
    WHEN v_new_status = 'cancelled' AND v_new_paid <= 0.01 THEN 'unpaid'
    WHEN v_new_paid >= v_new_grand - 0.01 THEN 'paid'
    WHEN v_new_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.orders
  SET grand_total = v_new_grand,
      amount_paid = v_new_paid,
      payment_status = v_pay_status,
      status = v_new_status,
      return_status = COALESCE(v_ou->>'return_status', return_status),
      returned_total = COALESCE(returned_total, 0) + COALESCE((v_ou->>'returned_total_delta')::numeric, 0),
      exchanged_in_total = COALESCE(exchanged_in_total, 0) + COALESCE((v_ou->>'exchanged_in_total_delta')::numeric, 0),
      items_json = COALESCE(to_jsonb(items_json), '[]'::jsonb) || COALESCE(v_ou->'items_json_append', '[]'::jsonb),
      updated_at = v_now
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'transaction_id', v_tx_id,
    'new_grand_total', v_new_grand,
    'new_amount_paid', v_new_paid,
    'payment_status', v_pay_status,
    'order_status', v_new_status,
    'store_credit_balance', v_sc_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_pos_return_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_pos_return_v1(jsonb) TO service_role;

-- 8. Store credit redemption (row-locked) ------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_store_credit_v1(
  p_business_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_order_id uuid,
  p_actor_id uuid,
  p_description text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_new numeric;
BEGIN
  IF p_actor_id IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id AND b.owner_id = p_actor_id)
    OR EXISTS (SELECT 1 FROM public.business_staff s WHERE s.business_id = p_business_id AND s.profile_id = p_actor_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: aktor bukan pemilik/staf unit bisnis ini' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: nominal harus lebih besar dari 0' USING ERRCODE = 'P0001';
  END IF;

  SELECT balance INTO v_balance
  FROM public.customer_store_credits
  WHERE business_id = p_business_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND OR v_balance < p_amount - 0.005 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STORE_CREDIT: saldo kredit toko tidak mencukupi' USING ERRCODE = 'P0001';
  END IF;

  v_new := GREATEST(0, v_balance - p_amount);

  UPDATE public.customer_store_credits
  SET balance = v_new, updated_at = now()
  WHERE business_id = p_business_id AND customer_id = p_customer_id;

  INSERT INTO public.store_credit_ledger (
    business_id, customer_id, entry_type, amount, balance_after, order_id, description, created_by
  ) VALUES (
    p_business_id, p_customer_id, 'redeemed', -p_amount, v_new, p_order_id,
    COALESCE(p_description, 'Pemakaian saldo kredit toko'), p_actor_id
  );

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_store_credit_v1(uuid, uuid, numeric, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_store_credit_v1(uuid, uuid, numeric, uuid, uuid, text) TO service_role;

-- 9. Reporting view (CQRS read model; RLS enforced through security_invoker) ---------
CREATE OR REPLACE VIEW public.v_pos_return_items_report
WITH (security_invoker = true) AS
SELECT
  i.id AS item_id,
  i.business_id,
  i.return_id,
  r.return_number,
  r.return_kind,
  r.created_at,
  r.order_id,
  o.order_number,
  r.cashier_id,
  r.cashier_name,
  r.reason_code,
  r.shift_id,
  i.product_id,
  i.variant_id,
  i.name,
  i.variant_name,
  i.qty,
  i.line_refund,
  i.unit_cost,
  i.disposition
FROM public.pos_return_items i
JOIN public.pos_returns r ON r.id = i.return_id
LEFT JOIN public.orders o ON o.id = r.order_id;

GRANT SELECT ON public.v_pos_return_items_report TO authenticated, service_role;

-- 10. Quarantine inbox must also list POS return quarantine moves -------------------
CREATE OR REPLACE VIEW public.v_quarantine_returns
WITH (security_invoker = true) AS
SELECT
    r.id AS move_id,
    r.business_id,
    r.product_id,
    r.reference,
    r.qty AS return_qty,
    r.created_at AS return_date,
    p.name AS product_name,
    p.sku AS product_sku,
    p.unit AS product_unit,
    p.cost_price,
    CASE
        WHEN rel.source_type = 'order_return_release' THEN 'received'
        WHEN rel.source_type = 'order_return_loss' THEN 'lost'
        ELSE 'pending'
    END AS status,
    CASE
        WHEN rel.source_type = 'order_return_release' THEN 'Diterima di Gudang'
        WHEN rel.source_type = 'order_return_loss' THEN 'Hilang di Ekspedisi'
        ELSE 'Menunggu Verifikasi'
    END AS status_label,
    rel.created_at AS resolved_at,
    rel.reference AS resolution_reference,
    (rel.id IS NULL) AS is_actionable
FROM public.stock_moves r
JOIN public.products p ON p.id = r.product_id
LEFT JOIN LATERAL (
    SELECT rel_sub.id, rel_sub.source_type, rel_sub.created_at, rel_sub.reference
    FROM public.stock_moves rel_sub
    WHERE rel_sub.source_id = r.id
      AND rel_sub.type IN ('transfer', 'adjustment')
      AND rel_sub.status = 'done'
    ORDER BY rel_sub.created_at DESC
    LIMIT 1
) rel ON true
WHERE r.bucket = 'quarantine'
  AND r.type = 'receipt'
  AND r.source_type IN ('order', 'order_return');

GRANT SELECT ON public.v_quarantine_returns TO authenticated, anon, service_role;
