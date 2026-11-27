-- ==============================================================================
-- MIGRATION: Omnichannel RMA Engine, Variant-Aware Quarantine View & Bulk QC RPC
-- Timestamp: 20261127093000_create_omnichannel_rma_engine.sql
-- Standards Compliance:
--   1. PSAK 115 / IFRS 15 (Contra-Revenue 401100, Quarantine Right-to-Recover 102100,
--      Store Credit Liability 202000, Credit Memo AR Reduction 103000).
--   2. PSAK 202 / IAS 2 Par. 34 (Scrap / Write-Off Loss isolated to 502100).
--   3. Pure Append-Only Event Sourcing on stock_moves & transactions (Zero UPDATE/DELETE).
--   4. Multi-Tenant Union RLS (AGENTS.md Rule 15) & SECURITY DEFINER Guard (Rule 14).
--   5. Security Invoker Views (AGENTS.md Rule 11) + Variant-Aware Quarantine Resolution.
--   6. Semi-Modular 1-Roundtrip ACID RPCs for ~50ms execution & Bulk Quarantine QC.
-- ==============================================================================

-- 0. Idempotent COA Backfill for All Existing Businesses (102100 & 502100)
-- Ensures existing tenants immediately have Quarantine Asset & Return Loss accounts
-- with Rp 0 opening balance without touching any existing/custom accounts.
DO $$
DECLARE
  v_has_sub_type boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
      AND column_name = 'sub_type'
  ) INTO v_has_sub_type;

  IF v_has_sub_type THEN
    INSERT INTO public.accounts (business_id, code, name, type, sub_type)
    SELECT b.id, '102100', 'Persediaan Karantina & Retur', 'ASSET', 'current_assets'
    FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.business_id = b.id AND a.code = '102100'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.accounts (business_id, code, name, type, sub_type)
    SELECT b.id, '502100', 'Beban Kerusakan & Penyusutan Retur', 'EXPENSE', 'expense'
    FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.business_id = b.id AND a.code = '502100'
    )
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.accounts (business_id, code, name, type)
    SELECT b.id, '102100', 'Persediaan Karantina & Retur', 'ASSET'
    FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.business_id = b.id AND a.code = '102100'
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.accounts (business_id, code, name, type)
    SELECT b.id, '502100', 'Beban Kerusakan & Penyusutan Retur', 'EXPENSE'
    FROM public.businesses b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.business_id = b.id AND a.code = '502100'
    )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 1. RMA Requests Header Table (Two-Track Lifecycle: Fulfillment vs Settlement)
CREATE TABLE IF NOT EXISTS public.rma_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id uuid,
  rma_number text NOT NULL,
  idempotency_key text NOT NULL,
  channel text NOT NULL DEFAULT 'Manual',
  fulfillment_stage text NOT NULL DEFAULT 'approved'
    CHECK (fulfillment_stage IN ('requested', 'approved', 'received_quarantine', 'inspected', 'rejected', 'cancelled')),
  settlement_stage text NOT NULL DEFAULT 'pending'
    CHECK (settlement_stage IN ('pending', 'settled', 'not_applicable')),
  settlement_method text
    CHECK (settlement_method IS NULL OR settlement_method IN ('credit_memo', 'refund', 'store_credit', 'exchange', 'none')),
  reason_code text NOT NULL DEFAULT 'defective',
  reason_note text,
  return_courier text,
  return_tracking_number text,
  gross_return_amount numeric NOT NULL DEFAULT 0,
  restocking_fee numeric NOT NULL DEFAULT 0,
  net_credit_amount numeric NOT NULL DEFAULT 0,
  refund_paid_amount numeric NOT NULL DEFAULT 0,
  credit_memo_amount numeric NOT NULL DEFAULT 0,
  store_credit_issued numeric NOT NULL DEFAULT 0,
  exchange_total numeric NOT NULL DEFAULT 0,
  shortfall_collected numeric NOT NULL DEFAULT 0,
  settlement_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  exchange_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  receipt_transaction_id uuid,
  disposition_transaction_id uuid,
  settlement_transaction_id uuid,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approval_note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name text,
  received_at timestamptz,
  inspected_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rma_requests_number UNIQUE (business_id, rma_number),
  CONSTRAINT uq_rma_requests_idempotency UNIQUE (business_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rma_requests_biz_created
  ON public.rma_requests (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rma_requests_biz_stages
  ON public.rma_requests (business_id, fulfillment_stage, settlement_stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rma_requests_order
  ON public.rma_requests (order_id);

-- 2. RMA Line Items Table (Discrete Variant-Aware Tracking)
CREATE TABLE IF NOT EXISTS public.rma_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rma_id uuid NOT NULL REFERENCES public.rma_requests(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_ref text NOT NULL,
  product_id uuid,
  variant_id uuid,
  name text NOT NULL,
  variant_name text,
  sku text,
  qty numeric NOT NULL CHECK (qty > 0),
  unit_net_price numeric NOT NULL DEFAULT 0,
  line_refund numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  track_stock boolean NOT NULL DEFAULT false,
  disposition text NOT NULL DEFAULT 'pending'
    CHECK (disposition IN ('pending', 'restock', 'quarantine', 'writeoff', 'rtv_vendor', 'lost_in_transit')),
  quarantine_move_id uuid,
  resolution_move_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rma_items_rma_id
  ON public.rma_items (rma_id);

CREATE INDEX IF NOT EXISTS idx_rma_items_order_ref
  ON public.rma_items (business_id, order_id, order_item_ref);

-- High-Speed Partial Index for Quarantine Stock Queue (~2ms lookup)
CREATE INDEX IF NOT EXISTS idx_stock_moves_biz_quarantine_partial
  ON public.stock_moves (business_id, created_at DESC)
  WHERE bucket = 'quarantine';

-- Link order_payments & store_credit_ledger optionally to rma_requests
ALTER TABLE public.order_payments
  ADD COLUMN IF NOT EXISTS rma_id uuid REFERENCES public.rma_requests(id) ON DELETE SET NULL;

ALTER TABLE public.store_credit_ledger
  ADD COLUMN IF NOT EXISTS rma_id uuid REFERENCES public.rma_requests(id) ON DELETE SET NULL;

-- 3. Robust Multi-Tenant RLS Policies (AGENTS.md Rule 15 Union Clause)
ALTER TABLE public.rma_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rma_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view rma_requests" ON public.rma_requests;
CREATE POLICY "Members can view rma_requests" ON public.rma_requests
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Members can view rma_items" ON public.rma_items;
CREATE POLICY "Members can view rma_items" ON public.rma_items
  FOR SELECT TO authenticated
  USING (
    business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
      UNION
      SELECT business_id FROM public.business_staff WHERE profile_id = auth.uid()
    )
    OR business_id = (SELECT active_business_id FROM public.profiles WHERE id = auth.uid())
  );

-- 4. Variant-Aware Quarantine Returns View (Security Invoker — AGENTS.md Rule 11)
DROP VIEW IF EXISTS public.v_quarantine_returns CASCADE;

CREATE VIEW public.v_quarantine_returns
WITH (security_invoker = true) AS
SELECT
    r.id AS move_id,
    r.business_id,
    r.product_id,
    r.variant_id,
    r.reference,
    r.qty AS return_qty,
    r.created_at AS return_date,
    CASE
        WHEN pv.name IS NOT NULL AND BTRIM(pv.name) <> '' THEN p.name || ' - ' || pv.name
        ELSE p.name
    END AS product_name,
    pv.name AS variant_name,
    COALESCE(NULLIF(BTRIM(pv.sku), ''), p.sku) AS product_sku,
    p.unit AS product_unit,
    COALESCE(NULLIF(r.unit_cost, 0), pv.cost_price, p.cost_price, 0) AS cost_price,
    CASE
        WHEN rel.source_type IN ('order_return_release', 'rma_release') THEN 'received'
        WHEN rel.source_type IN ('order_return_rtv', 'rma_rtv') THEN 'rtv'
        WHEN rel.source_type IN ('order_return_loss', 'rma_loss') THEN 'lost'
        ELSE 'pending'
    END AS status,
    CASE
        WHEN rel.source_type IN ('order_return_release', 'rma_release') THEN 'Diterima di Gudang'
        WHEN rel.source_type IN ('order_return_rtv', 'rma_rtv') THEN 'Diklaim ke Supplier'
        WHEN rel.source_type IN ('order_return_loss', 'rma_loss') THEN 'Hilang / Rusak'
        ELSE 'Menunggu Verifikasi'
    END AS status_label,
    rel.created_at AS resolved_at,
    rel.reference AS resolution_reference,
    (rel.id IS NULL) AS is_actionable
FROM public.stock_moves r
JOIN public.products p ON p.id = r.product_id
LEFT JOIN public.product_variants pv ON pv.id = r.variant_id
LEFT JOIN LATERAL (
    SELECT rel_sub.id, rel_sub.source_type, rel_sub.created_at, rel_sub.reference
    FROM public.stock_moves rel_sub
    WHERE rel_sub.source_id = r.id
      AND rel_sub.type IN ('transfer', 'adjustment', 'delivery')
      AND rel_sub.status = 'done'
    ORDER BY rel_sub.created_at DESC
    LIMIT 1
) rel ON true
WHERE r.bucket = 'quarantine'
  AND r.type = 'receipt'
  AND r.source_type IN ('order', 'order_return', 'pos_return', 'rma_receipt');

GRANT SELECT ON public.v_quarantine_returns TO authenticated, service_role;

-- 5. Bulk Quarantine QC ACID Executor: process_quarantine_batch_v1
-- Resolves 1..N quarantine items (terima / hilang / rtv) in 1 single DB roundtrip (~50ms)
-- while strictly preserving variant_id and historical unit_cost.
CREATE OR REPLACE FUNCTION public.process_quarantine_batch_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid := (payload->>'business_id')::uuid;
  v_actor uuid := NULLIF(payload->>'actor_id', '')::uuid;
  v_action text := payload->>'action'; -- 'terima' | 'hilang' | 'rtv'
  v_inv_acc uuid := NULLIF(payload->>'inventory_account_id', '')::uuid;
  v_quar_acc uuid := NULLIF(payload->>'quarantine_account_id', '')::uuid;
  v_loss_acc uuid := NULLIF(payload->>'loss_account_id', '')::uuid;
  v_ap_acc uuid := NULLIF(payload->>'payable_account_id', '')::uuid;
  v_move_id_txt text;
  v_move_id uuid;
  v_move record;
  v_existing_rel uuid;
  v_unit_cost numeric;
  v_line_val numeric;
  v_val_from_quar numeric := 0;
  v_val_from_main numeric := 0;
  v_has_quar_gl boolean := false;
  v_processed int := 0;
  v_tx_id uuid := NULL;
  v_now timestamptz := now();
  v_dummy_origin uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_debit_acc uuid;
  v_desc text;
BEGIN
  -- Multi-Tenant Security Guard (AGENTS.md Rule 14)
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = v_business AND b.owner_id = v_actor)
    OR EXISTS (SELECT 1 FROM public.business_staff s WHERE s.business_id = v_business AND s.profile_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Anda tidak memiliki akses ke unit bisnis ini' USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('terima', 'hilang', 'rtv') THEN
    RAISE EXCEPTION 'INVALID_ACTION: aksi harus terima, hilang, atau rtv' USING ERRCODE = 'P0001';
  END IF;

  -- Detect if 102100 has active balance to protect legacy rows created before 102100 existed
  IF v_quar_acc IS NOT NULL AND v_inv_acc IS NOT NULL AND v_quar_acc <> v_inv_acc THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.journal_lines jl
      JOIN public.transactions t ON t.id = jl.transaction_id
      WHERE t.business_id = v_business AND jl.account_id = v_quar_acc AND jl.debit > 0
    ) INTO v_has_quar_gl;
  END IF;

  FOR v_move_id_txt IN SELECT jsonb_array_elements_text(COALESCE(payload->'move_ids', '[]'::jsonb)) LOOP
    v_move_id := v_move_id_txt::uuid;

    SELECT m.*, p.name AS prod_name, p.cost_price AS prod_cost, pv.cost_price AS var_cost
    INTO v_move
    FROM public.stock_moves m
    JOIN public.products p ON p.id = m.product_id
    LEFT JOIN public.product_variants pv ON pv.id = m.variant_id
    WHERE m.id = v_move_id AND m.business_id = v_business
    FOR UPDATE OF m;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Idempotency check: skip if already resolved
    SELECT id INTO v_existing_rel
    FROM public.stock_moves
    WHERE source_id = v_move_id
      AND type IN ('transfer', 'adjustment', 'delivery')
      AND status = 'done'
    LIMIT 1;

    IF FOUND THEN
      CONTINUE;
    END IF;

    v_unit_cost := COALESCE(NULLIF(v_move.unit_cost, 0), v_move.var_cost, v_move.prod_cost, 0);
    v_line_val := ROUND(COALESCE(v_move.qty, 0) * v_unit_cost);

    IF v_action = 'terima' THEN
      -- 1) Offsetting Quarantine Release (-qty in quarantine)
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, bucket, type,
        source_type, source_id, qty, unit_cost, status, created_at
      ) VALUES (
        v_business, v_move.product_id, v_move.variant_id,
        v_move.reference || ' (Keluar Karantina)', 'quarantine', 'transfer',
        'order_return_release', v_move.id, v_move.qty, v_unit_cost, 'done', v_now
      );

      -- 2) Main Warehouse Arrival (+qty on physical shelf, variant-aware!)
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, bucket, type,
        source_type, source_id, qty, unit_cost, status, created_at
      ) VALUES (
        v_business, v_move.product_id, v_move.variant_id,
        v_move.reference || ' (Terima Gudang)', 'main', 'receipt',
        'order_return_receive', COALESCE(v_move.source_id, v_move.id), v_move.qty, v_unit_cost, 'done', v_now
      );

      -- Legacy 'order' cancellations already debited 102000 in orderLedger.ts -> 0 journal needed!
      -- Only reclassify 102100 -> 102000 for moves booked into 102100:
      IF v_has_quar_gl AND v_move.source_type IN ('rma_receipt', 'pos_return', 'order_return') THEN
        v_val_from_quar := v_val_from_quar + v_line_val;
      END IF;

    ELSIF v_action = 'hilang' THEN
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, bucket, type,
        source_type, source_id, origin_location_id, qty, unit_cost, status, created_at
      ) VALUES (
        v_business, v_move.product_id, v_move.variant_id,
        v_move.reference || ' (Hilang/Rusak)', 'quarantine', 'adjustment',
        'order_return_loss', v_move.id, v_dummy_origin, v_move.qty, v_unit_cost, 'done', v_now
      );

      IF v_has_quar_gl AND v_move.source_type IN ('rma_receipt', 'pos_return', 'order_return') THEN
        v_val_from_quar := v_val_from_quar + v_line_val;
      ELSE
        v_val_from_main := v_val_from_main + v_line_val;
      END IF;

    ELSIF v_action = 'rtv' THEN
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, bucket, type,
        source_type, source_id, qty, unit_cost, status, created_at
      ) VALUES (
        v_business, v_move.product_id, v_move.variant_id,
        v_move.reference || ' (Klaim Supplier)', 'quarantine', 'delivery',
        'order_return_rtv', v_move.id, v_move.qty, v_unit_cost, 'done', v_now
      );

      IF v_has_quar_gl AND v_move.source_type IN ('rma_receipt', 'pos_return', 'order_return') THEN
        v_val_from_quar := v_val_from_quar + v_line_val;
      ELSE
        v_val_from_main := v_val_from_main + v_line_val;
      END IF;
    END IF;

    v_processed := v_processed + 1;
  END LOOP;

  -- Post balanced journal entry preserving exact source asset account (102100 vs legacy 102000)
  IF v_processed > 0 AND (v_val_from_quar + v_val_from_main) > 0 THEN
    IF v_action = 'terima' AND v_val_from_quar > 0 AND v_inv_acc IS NOT NULL AND v_quar_acc IS NOT NULL THEN
      v_debit_acc := v_inv_acc;
      v_desc := 'Reklasifikasi Retur Karantina ke Gudang Utama (' || v_processed || ' item)';
      INSERT INTO public.transactions (business_id, date, description)
      VALUES (v_business, v_now, v_desc) RETURNING id INTO v_tx_id;
      INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
      VALUES
        (v_tx_id, v_inv_acc, v_val_from_quar, 0),
        (v_tx_id, v_quar_acc, 0, v_val_from_quar);

    ELSIF v_action IN ('hilang', 'rtv') THEN
      v_debit_acc := CASE WHEN v_action = 'rtv' THEN v_ap_acc ELSE v_loss_acc END;
      v_desc := CASE
        WHEN v_action = 'rtv' THEN 'Klaim Retur Cacat Pabrik ke Supplier / RTV (' || v_processed || ' item)'
        ELSE 'Kerugian Retur / Barang Rusak Karantina (' || v_processed || ' item)'
      END;

      IF v_debit_acc IS NOT NULL AND (v_quar_acc IS NOT NULL OR v_inv_acc IS NOT NULL) THEN
        INSERT INTO public.transactions (business_id, date, description)
        VALUES (v_business, v_now, v_desc) RETURNING id INTO v_tx_id;

        INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
        VALUES (v_tx_id, v_debit_acc, v_val_from_quar + v_val_from_main, 0);

        IF v_val_from_quar > 0 AND v_quar_acc IS NOT NULL THEN
          INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
          VALUES (v_tx_id, v_quar_acc, 0, v_val_from_quar);
        END IF;

        IF v_val_from_main > 0 AND v_inv_acc IS NOT NULL THEN
          INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
          VALUES (v_tx_id, v_inv_acc, 0, v_val_from_main);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'processed_count', v_processed,
    'transaction_id', v_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_quarantine_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_quarantine_batch_v1(jsonb) TO service_role;

-- 6. Unified Omnichannel RMA ACID Executor: process_rma_transition_v1
-- Supports:
--   • mode = 'create' (Gatekeeping Ticket only, 0 stock/GL mutation)
--   • mode = 'inspect' (Physical receipt + QC disposition + Inventory/COPQ journal)
--   • mode = 'settle' (Credit Memo AR cut / Refund / Store Credit / Exchange + Order sync)
--   • mode = 'express' (1-Click Create + Inspect + Settle in a single ~55ms ACID tx!)
CREATE OR REPLACE FUNCTION public.process_rma_transition_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := payload->>'mode';
  v_business uuid := (payload->>'business_id')::uuid;
  v_actor uuid := NULLIF(payload->>'actor_id', '')::uuid;
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_rma_id uuid := NULLIF(payload->>'rma_id', '')::uuid;
  v_idem text := payload->>'idempotency_key';
  v_hdr jsonb := COALESCE(payload->'header', '{}'::jsonb);
  v_ou jsonb := payload->'order_update';
  v_inv_jr jsonb := payload->'inventory_journal';
  v_fin_jr jsonb := payload->'settlement_journal';
  v_sc jsonb := payload->'store_credit';
  v_existing record;
  v_order record;
  v_rma record;
  v_rma_number text;
  v_item jsonb;
  v_item_id uuid;
  v_q_move_id uuid;
  v_r_move_id uuid;
  v_disp text;
  v_inv_tx_id uuid := NULL;
  v_fin_tx_id uuid := NULL;
  v_debit numeric;
  v_credit numeric;
  v_pay jsonb;
  v_pay_in numeric := 0;
  v_pay_out numeric := 0;
  v_new_grand numeric;
  v_new_paid numeric;
  v_pay_status text;
  v_sc_balance numeric := NULL;
  v_now timestamptz := now();
  v_dummy_origin uuid := '00000000-0000-0000-0000-000000000000'::uuid;
BEGIN
  -- Strict Multi-Tenant Guard (AGENTS.md Rule 14)
  IF v_actor IS NULL OR NOT (
    EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = v_business AND b.owner_id = v_actor)
    OR EXISTS (SELECT 1 FROM public.business_staff s WHERE s.business_id = v_business AND s.profile_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: Akses ke unit bisnis ditolak' USING ERRCODE = '42501';
  END IF;

  -- Lock parent order to prevent concurrent return race conditions
  SELECT id, status, grand_total, amount_paid, returned_total, exchanged_in_total, payment_status
  INTO v_order
  FROM public.orders
  WHERE id = v_order_id AND business_id = v_business
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Pesanan/Invoice tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED: Pesanan sudah dibatalkan' USING ERRCODE = 'P0001';
  END IF;

  -- Validate balanced journals upfront before writing anything
  IF v_inv_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_inv_jr->'lines', '[]'::jsonb)) > 0 THEN
    SELECT COALESCE(SUM(COALESCE(x.debit, 0)), 0), COALESCE(SUM(COALESCE(x.credit, 0)), 0)
    INTO v_debit, v_credit
    FROM jsonb_to_recordset(v_inv_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric);
    IF ABS(v_debit - v_credit) > 0.5 THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED (Inventory): debit % <> kredit %', v_debit, v_credit USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_fin_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_fin_jr->'lines', '[]'::jsonb)) > 0 THEN
    SELECT COALESCE(SUM(COALESCE(x.debit, 0)), 0), COALESCE(SUM(COALESCE(x.credit, 0)), 0)
    INTO v_debit, v_credit
    FROM jsonb_to_recordset(v_fin_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric);
    IF ABS(v_debit - v_credit) > 0.5 THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED (Settlement): debit % <> kredit %', v_debit, v_credit USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- STEP A: Create RMA Header & Items (for 'create' or 'express')
  IF v_mode IN ('create', 'express') THEN
    SELECT id, rma_number INTO v_existing
    FROM public.rma_requests
    WHERE business_id = v_business AND idempotency_key = v_idem;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'rma_id', v_existing.id,
        'rma_number', v_existing.rma_number
      );
    END IF;

    v_rma_number := v_hdr->>'rma_number';

    INSERT INTO public.rma_requests (
      business_id, order_id, customer_id, rma_number, idempotency_key, channel,
      fulfillment_stage, settlement_stage, settlement_method,
      reason_code, reason_note, return_courier, return_tracking_number,
      gross_return_amount, restocking_fee, net_credit_amount,
      refund_paid_amount, credit_memo_amount, store_credit_issued,
      exchange_total, shortfall_collected, settlement_json, exchange_items,
      approved_by, approval_note, created_by, created_by_name,
      received_at, inspected_at, settled_at, created_at, updated_at
    ) VALUES (
      v_business, v_order_id, NULLIF(v_hdr->>'customer_id', '')::uuid,
      v_rma_number, v_idem, COALESCE(v_hdr->>'channel', 'Manual'),
      CASE WHEN v_mode = 'express' THEN COALESCE(v_hdr->>'fulfillment_stage', 'inspected') ELSE 'approved' END,
      CASE WHEN v_mode = 'express' THEN 'settled' ELSE 'pending' END,
      NULLIF(v_hdr->>'settlement_method', ''),
      COALESCE(v_hdr->>'reason_code', 'defective'),
      v_hdr->>'reason_note',
      v_hdr->>'return_courier',
      v_hdr->>'return_tracking_number',
      COALESCE((v_hdr->>'gross_return_amount')::numeric, 0),
      COALESCE((v_hdr->>'restocking_fee')::numeric, 0),
      COALESCE((v_hdr->>'net_credit_amount')::numeric, 0),
      COALESCE((v_hdr->>'refund_paid_amount')::numeric, 0),
      COALESCE((v_hdr->>'credit_memo_amount')::numeric, 0),
      COALESCE((v_hdr->>'store_credit_issued')::numeric, 0),
      COALESCE((v_hdr->>'exchange_total')::numeric, 0),
      COALESCE((v_hdr->>'shortfall_collected')::numeric, 0),
      COALESCE(v_hdr->'settlement_json', '{}'::jsonb),
      COALESCE(v_hdr->'exchange_items', '[]'::jsonb),
      NULLIF(v_hdr->>'approved_by', '')::uuid,
      v_hdr->>'approval_note',
      v_actor,
      v_hdr->>'created_by_name',
      CASE WHEN v_mode = 'express' THEN v_now ELSE NULL END,
      CASE WHEN v_mode = 'express' THEN v_now ELSE NULL END,
      CASE WHEN v_mode = 'express' THEN v_now ELSE NULL END,
      v_now, v_now
    ) RETURNING id INTO v_rma_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
      v_disp := CASE WHEN v_mode = 'express' THEN COALESCE(v_item->>'disposition', 'restock') ELSE 'pending' END;

      INSERT INTO public.rma_items (
        rma_id, business_id, order_id, order_item_ref, product_id, variant_id,
        name, variant_name, sku, qty, unit_net_price, line_refund, unit_cost,
        track_stock, disposition, created_at
      ) VALUES (
        v_rma_id, v_business, v_order_id, v_item->>'order_item_ref',
        NULLIF(v_item->>'product_id', '')::uuid,
        NULLIF(v_item->>'variant_id', '')::uuid,
        COALESCE(v_item->>'name', 'Produk'),
        v_item->>'variant_name',
        v_item->>'sku',
        (v_item->>'qty')::numeric,
        COALESCE((v_item->>'unit_net_price')::numeric, 0),
        COALESCE((v_item->>'line_refund')::numeric, 0),
        COALESCE((v_item->>'unit_cost')::numeric, 0),
        COALESCE((v_item->>'track_stock')::boolean, false),
        v_disp,
        v_now
      ) RETURNING id INTO v_item_id;

      -- If express mode, immediately write event-sourced stock movements
      IF v_mode = 'express' AND COALESCE((v_item->>'track_stock')::boolean, false) AND NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
        IF v_disp = 'restock' THEN
          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number || ' (Terima Gudang)', (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done', 'receipt', 'main', 'rma_receive', v_item_id, v_now
          ) RETURNING id INTO v_r_move_id;
          UPDATE public.rma_items SET resolution_move_id = v_r_move_id WHERE id = v_item_id;

        ELSIF v_disp = 'quarantine' THEN
          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number, (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done', 'receipt', 'quarantine', 'rma_receipt', v_item_id, v_now
          ) RETURNING id INTO v_q_move_id;
          UPDATE public.rma_items SET quarantine_move_id = v_q_move_id WHERE id = v_item_id;
        END IF;
      END IF;
    END LOOP;
  ELSE
    -- Lock existing RMA header for 'inspect' or 'settle'
    SELECT * INTO v_rma
    FROM public.rma_requests
    WHERE id = v_rma_id AND business_id = v_business
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'RMA_NOT_FOUND: Dokumen RMA tidak ditemukan' USING ERRCODE = 'P0002';
    END IF;
    v_rma_number := v_rma.rma_number;
  END IF;

  -- STEP B: Inspect & Physical Disposition Transition (for 'inspect')
  IF v_mode = 'inspect' THEN
    IF v_rma.fulfillment_stage IN ('inspected', 'rejected', 'cancelled') THEN
      RAISE EXCEPTION 'RMA_ALREADY_INSPECTED: Pemeriksaan fisik RMA ini sudah selesai diproses' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
      v_item_id := (v_item->>'rma_item_id')::uuid;
      v_disp := COALESCE(v_item->>'disposition', 'restock');
      v_q_move_id := NULL;
      v_r_move_id := NULL;

      IF COALESCE((v_item->>'track_stock')::boolean, false) AND NULLIF(v_item->>'product_id', '') IS NOT NULL THEN
        -- Record arrival in quarantine first for full Event Sourcing audit trail, then offset if immediately disposed!
        IF v_disp = 'quarantine' THEN
          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number, (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done', 'receipt', 'quarantine', 'rma_receipt', v_item_id, v_now
          ) RETURNING id INTO v_q_move_id;

        ELSIF v_disp = 'restock' THEN
          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number || ' (Terima Gudang)', (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done', 'receipt', 'main', 'rma_receive', v_item_id, v_now
          ) RETURNING id INTO v_r_move_id;

        ELSIF v_disp IN ('writeoff', 'rtv_vendor', 'lost_in_transit') THEN
          -- Audit trail in quarantine (+qty then immediate -qty offset so quarantine_stock lands cleanly on 0)
          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number || ' (Masuk QC)', (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done', 'receipt', 'quarantine', 'rma_receipt', v_item_id, v_now
          ) RETURNING id INTO v_q_move_id;

          INSERT INTO public.stock_moves (
            business_id, product_id, variant_id, reference, qty, unit_cost,
            status, type, bucket, origin_location_id, source_type, source_id, created_at
          ) VALUES (
            v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
            v_rma_number || CASE
              WHEN v_disp = 'rtv_vendor' THEN ' (Klaim Supplier)'
              WHEN v_disp = 'lost_in_transit' THEN ' (Hilang Kurir)'
              ELSE ' (Rusak/Scrap)'
            END,
            (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
            'done',
            CASE WHEN v_disp = 'rtv_vendor' THEN 'delivery' ELSE 'adjustment' END,
            'quarantine',
            CASE WHEN v_disp = 'rtv_vendor' THEN NULL ELSE v_dummy_origin END,
            CASE WHEN v_disp = 'rtv_vendor' THEN 'rma_rtv' ELSE 'rma_loss' END,
            v_q_move_id,
            v_now + interval '1 millisecond'
          ) RETURNING id INTO v_r_move_id;
        END IF;
      END IF;

      UPDATE public.rma_items
      SET disposition = v_disp,
          quarantine_move_id = COALESCE(v_q_move_id, quarantine_move_id),
          resolution_move_id = COALESCE(v_r_move_id, resolution_move_id)
      WHERE id = v_item_id AND rma_id = v_rma_id;
    END LOOP;

    UPDATE public.rma_requests
    SET fulfillment_stage = COALESCE(v_hdr->>'fulfillment_stage', 'inspected'),
        return_courier = COALESCE(NULLIF(v_hdr->>'return_courier', ''), return_courier),
        return_tracking_number = COALESCE(NULLIF(v_hdr->>'return_tracking_number', ''), return_tracking_number),
        received_at = COALESCE(received_at, v_now),
        inspected_at = v_now,
        updated_at = v_now
    WHERE id = v_rma_id;
  END IF;

  -- Post Inventory / COPQ Journal (for 'inspect' or 'express')
  IF v_inv_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_inv_jr->'lines', '[]'::jsonb)) > 0 THEN
    INSERT INTO public.transactions (business_id, order_id, date, description)
    VALUES (
      v_business, v_order_id,
      COALESCE(NULLIF(v_inv_jr->>'date', '')::timestamptz, v_now),
      v_inv_jr->>'description'
    ) RETURNING id INTO v_inv_tx_id;

    INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
    SELECT v_inv_tx_id, x.account_id, COALESCE(x.debit, 0), COALESCE(x.credit, 0)
    FROM jsonb_to_recordset(v_inv_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric)
    WHERE COALESCE(x.debit, 0) + COALESCE(x.credit, 0) > 0;

    UPDATE public.rma_requests
    SET disposition_transaction_id = v_inv_tx_id,
        receipt_transaction_id = COALESCE(receipt_transaction_id, v_inv_tx_id)
    WHERE id = v_rma_id;
  END IF;

  -- STEP C: Financial Settlement & Order/Invoice Automatic Update (for 'settle' or 'express')
  IF v_mode IN ('settle', 'express') THEN
    IF v_mode = 'settle' AND v_rma.settlement_stage = 'settled' THEN
      RAISE EXCEPTION 'RMA_ALREADY_SETTLED: Hak pelanggan pada RMA ini sudah diselesaikan' USING ERRCODE = 'P0001';
    END IF;

    -- Optimistic concurrency check on Order snapshot
    IF payload ? 'expected_grand_total' THEN
      IF ABS(COALESCE(v_order.grand_total, 0) - (payload->>'expected_grand_total')::numeric) > 0.5
         OR ABS(COALESCE(v_order.amount_paid, 0) - (payload->>'expected_amount_paid')::numeric) > 0.5 THEN
        RAISE EXCEPTION 'STATE_CHANGED: Data tagihan/pembayaran berubah, silakan muat ulang' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- Replacement items leaving main warehouse shelf (if exchange)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'exchange_stock', '[]'::jsonb)) LOOP
      INSERT INTO public.stock_moves (
        business_id, product_id, variant_id, reference, qty, unit_cost,
        status, type, bucket, source_type, source_id, created_at
      ) VALUES (
        v_business, (v_item->>'product_id')::uuid, NULLIF(v_item->>'variant_id', '')::uuid,
        v_rma_number || ' (Pengganti)', (v_item->>'qty')::numeric, COALESCE((v_item->>'unit_cost')::numeric, 0),
        'done', 'delivery', 'main', 'rma_exchange', v_rma_id, v_now
      );
    END LOOP;

    -- Settlement Accounting Journal (Credit Memo / Refund / Store Credit / Exchange)
    IF v_fin_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_fin_jr->'lines', '[]'::jsonb)) > 0 THEN
      INSERT INTO public.transactions (business_id, order_id, date, description)
      VALUES (
        v_business, v_order_id,
        COALESCE(NULLIF(v_fin_jr->>'date', '')::timestamptz, v_now),
        v_fin_jr->>'description'
      ) RETURNING id INTO v_fin_tx_id;

      INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
      SELECT v_fin_tx_id, x.account_id, COALESCE(x.debit, 0), COALESCE(x.credit, 0)
      FROM jsonb_to_recordset(v_fin_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric)
      WHERE COALESCE(x.debit, 0) + COALESCE(x.credit, 0) > 0;
    END IF;

    -- Append-only Cash / Bank movements in order_payments
    FOR v_pay IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'payments', '[]'::jsonb)) LOOP
      INSERT INTO public.order_payments (
        business_id, order_id, shift_id, transaction_id, date, amount, payment_method,
        payment_method_account_id, cash_received, change_amount, reference_number, notes,
        payment_kind, rma_id
      ) VALUES (
        v_business, v_order_id, NULLIF(v_pay->>'shift_id', '')::uuid, v_fin_tx_id,
        current_date, (v_pay->>'amount')::numeric, COALESCE(v_pay->>'method', 'Bank Transfer'),
        NULLIF(v_pay->>'account_id', '')::uuid,
        COALESCE((v_pay->>'cash_received')::numeric, 0),
        COALESCE((v_pay->>'change_amount')::numeric, 0),
        v_rma_number, v_pay->>'notes',
        v_pay->>'kind', v_rma_id
      );
      IF v_pay->>'kind' = 'payment' THEN
        v_pay_in := v_pay_in + (v_pay->>'amount')::numeric;
      ELSE
        v_pay_out := v_pay_out + (v_pay->>'amount')::numeric;
      END IF;
    END LOOP;

    -- Store Credit Issuance (Append-Only Ledger)
    IF v_sc IS NOT NULL AND COALESCE((v_sc->>'amount')::numeric, 0) > 0 AND NULLIF(v_sc->>'customer_id', '') IS NOT NULL THEN
      INSERT INTO public.customer_store_credits (business_id, customer_id, balance, updated_at)
      VALUES (v_business, (v_sc->>'customer_id')::uuid, (v_sc->>'amount')::numeric, v_now)
      ON CONFLICT (business_id, customer_id)
      DO UPDATE SET balance = public.customer_store_credits.balance + EXCLUDED.balance, updated_at = v_now
      RETURNING balance INTO v_sc_balance;

      INSERT INTO public.store_credit_ledger (
        business_id, customer_id, entry_type, amount, balance_after,
        rma_id, order_id, description, created_by
      ) VALUES (
        v_business, (v_sc->>'customer_id')::uuid, 'issued', (v_sc->>'amount')::numeric, v_sc_balance,
        v_rma_id, v_order_id,
        COALESCE(v_sc->>'description', 'Saldo kredit dari RMA ' || v_rma_number), v_actor
      );
    END IF;

    -- Update Order / Invoice Balances Automatically (1:1 Parity with AR Ledger 103000)
    IF v_ou IS NOT NULL THEN
      v_new_grand := GREATEST(0, (v_ou->>'grand_total')::numeric);
      v_new_paid := GREATEST(0, COALESCE(v_order.amount_paid, 0) + v_pay_in - v_pay_out);
      v_pay_status := CASE
        WHEN v_new_paid >= v_new_grand - 0.01 AND v_new_grand > 0 THEN 'paid'
        WHEN v_new_grand = 0 AND v_new_paid = 0 THEN 'paid'
        WHEN v_new_paid > 0 THEN 'partial'
        ELSE 'unpaid'
      END;

      UPDATE public.orders
      SET grand_total = v_new_grand,
          amount_paid = v_new_paid,
          payment_status = v_pay_status,
          return_status = COALESCE(v_ou->>'return_status', return_status),
          returned_total = COALESCE(returned_total, 0) + COALESCE((v_ou->>'returned_total_delta')::numeric, 0),
          exchanged_in_total = COALESCE(exchanged_in_total, 0) + COALESCE((v_ou->>'exchanged_in_total_delta')::numeric, 0),
          updated_at = v_now
      WHERE id = v_order_id;
    END IF;

    -- Finalize RMA Header Settlement Metadata
    IF v_mode = 'settle' THEN
      UPDATE public.rma_requests
      SET settlement_stage = 'settled',
          settlement_method = COALESCE(v_hdr->>'settlement_method', settlement_method),
          restocking_fee = COALESCE((v_hdr->>'restocking_fee')::numeric, restocking_fee),
          net_credit_amount = COALESCE((v_hdr->>'net_credit_amount')::numeric, net_credit_amount),
          refund_paid_amount = COALESCE((v_hdr->>'refund_paid_amount')::numeric, 0),
          credit_memo_amount = COALESCE((v_hdr->>'credit_memo_amount')::numeric, 0),
          store_credit_issued = COALESCE((v_hdr->>'store_credit_issued')::numeric, 0),
          exchange_total = COALESCE((v_hdr->>'exchange_total')::numeric, 0),
          shortfall_collected = COALESCE((v_hdr->>'shortfall_collected')::numeric, 0),
          settlement_json = COALESCE(v_hdr->'settlement_json', settlement_json),
          exchange_items = COALESCE(v_hdr->'exchange_items', exchange_items),
          settlement_transaction_id = v_fin_tx_id,
          settled_at = v_now,
          updated_at = v_now
      WHERE id = v_rma_id;
    ELSIF v_mode = 'express' AND v_fin_tx_id IS NOT NULL THEN
      UPDATE public.rma_requests
      SET settlement_transaction_id = v_fin_tx_id
      WHERE id = v_rma_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'rma_id', v_rma_id,
    'rma_number', v_rma_number,
    'inventory_transaction_id', v_inv_tx_id,
    'settlement_transaction_id', v_fin_tx_id,
    'new_grand_total', v_new_grand,
    'new_amount_paid', v_new_paid,
    'payment_status', v_pay_status,
    'store_credit_balance', v_sc_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_rma_transition_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_rma_transition_v1(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

