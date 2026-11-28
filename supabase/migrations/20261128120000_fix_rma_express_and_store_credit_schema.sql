-- ==============================================================================
-- MIGRATION: Fix Omnichannel RMA Express Mode v_rma Record & Store Credit Columns
-- Timestamp: 20261128120000_fix_rma_express_and_store_credit_schema.sql
-- Summary:
--   1. Adds missing `lifetime_issued` & `lifetime_redeemed` columns to
--      `public.customer_store_credits` (idempotent + backfilled from ledger).
--   2. Adds explicit SELECT grants to `authenticated` (RLS-enforced) and ALL to
--      `service_role` on RMA & Store Credit tables.
--   3. Updates `redeem_store_credit_v1` to atomically increment `lifetime_redeemed`.
--   4. Updates `process_rma_transition_v1`:
--      • Declares `v_rma public.rma_requests%ROWTYPE` instead of untyped `record`.
--      • Splits compound `IF v_mode = 'settle' AND v_rma.settlement_stage = 'settled'`
--        into nested `IF`s so PL/pgSQL never evaluates `v_rma` in `'express'` mode
--        (fixes `SQLSTATE 55000: record "v_rma" is not assigned yet`).
--      • Splits `IF FOUND` check on `v_target_order` into nested `IF`s.
--      • Completes all 5 physical dispositions (`restock`, `quarantine`, `writeoff`,
--        `rtv_vendor`, `lost_in_transit`) in `'express'` mode for 100% parity with
--        `'inspect'` mode and Pure Append-Only Event Sourcing (`inventory-ledger`).
-- ==============================================================================

-- 1. Ensure rma_requests constraint, FK columns, and customer_store_credits columns are up-to-date
ALTER TABLE public.rma_requests
  DROP CONSTRAINT IF EXISTS rma_requests_settlement_method_check;

ALTER TABLE public.rma_requests
  ADD CONSTRAINT rma_requests_settlement_method_check
  CHECK (
    settlement_method IS NULL
    OR settlement_method IN ('credit_memo', 'refund', 'store_credit', 'apply_other_invoice', 'exchange', 'none')
  );

ALTER TABLE public.order_payments
  ADD COLUMN IF NOT EXISTS rma_id uuid REFERENCES public.rma_requests(id) ON DELETE SET NULL;

ALTER TABLE public.store_credit_ledger
  ADD COLUMN IF NOT EXISTS rma_id uuid REFERENCES public.rma_requests(id) ON DELETE SET NULL;

ALTER TABLE public.customer_store_credits
  ADD COLUMN IF NOT EXISTS lifetime_issued numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_redeemed numeric NOT NULL DEFAULT 0;

-- Backfill lifetime totals idempotently for any existing store credit balances
UPDATE public.customer_store_credits csc
SET
  lifetime_issued = COALESCE(agg.sum_issued, csc.balance, 0),
  lifetime_redeemed = COALESCE(agg.sum_redeemed, 0)
FROM (
  SELECT
    business_id,
    customer_id,
    SUM(CASE WHEN entry_type = 'issued' AND amount > 0 THEN amount ELSE 0 END) AS sum_issued,
    SUM(CASE WHEN entry_type = 'redeemed' THEN ABS(amount) ELSE 0 END) AS sum_redeemed
  FROM public.store_credit_ledger
  GROUP BY business_id, customer_id
) agg
WHERE csc.business_id = agg.business_id
  AND csc.customer_id = agg.customer_id
  AND csc.lifetime_issued = 0
  AND csc.lifetime_redeemed = 0;

-- 2. Explicit Table Grants (Read-only via RLS for authenticated; writes strictly via service_role)
GRANT SELECT ON public.rma_requests TO authenticated;
GRANT SELECT ON public.rma_items TO authenticated;
GRANT SELECT ON public.customer_store_credits TO authenticated;
GRANT SELECT ON public.store_credit_ledger TO authenticated;

GRANT ALL ON public.rma_requests TO service_role;
GRANT ALL ON public.rma_items TO service_role;
GRANT ALL ON public.customer_store_credits TO service_role;
GRANT ALL ON public.store_credit_ledger TO service_role;

-- 3. Update redeem_store_credit_v1 to maintain lifetime_redeemed atomically
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
  -- Multi-Tenant Guard (AGENTS.md Rule 14)
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

  IF NOT FOUND OR COALESCE(v_balance, 0) < p_amount - 0.005 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STORE_CREDIT: saldo kredit toko tidak mencukupi' USING ERRCODE = 'P0001';
  END IF;

  v_new := GREATEST(0, v_balance - p_amount);

  UPDATE public.customer_store_credits
  SET balance = v_new,
      lifetime_redeemed = COALESCE(lifetime_redeemed, 0) + p_amount,
      updated_at = now()
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

-- 4. Update Unified Omnichannel RMA ACID Executor: process_rma_transition_v1
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
  v_dep_jr jsonb := payload->'deposit_transfer_journal';
  v_alloc jsonb := payload->'cross_invoice_allocation';
  v_sc jsonb := payload->'store_credit';
  v_existing record;
  v_order record;
  v_target_order record;
  v_rma public.rma_requests%ROWTYPE;
  v_rma_number text;
  v_item jsonb;
  v_item_id uuid;
  v_q_move_id uuid;
  v_r_move_id uuid;
  v_disp text;
  v_inv_tx_id uuid := NULL;
  v_fin_tx_id uuid := NULL;
  v_dep_tx_id uuid := NULL;
  v_alloc_tx_id uuid := NULL;
  v_alloc_amt numeric := 0;
  v_alloc_target_id uuid := NULL;
  v_alloc_target_num text := NULL;
  v_target_new_paid numeric := 0;
  v_target_pay_status text := NULL;
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

  IF v_mode IS NULL OR v_mode NOT IN ('create', 'inspect', 'settle', 'express') THEN
    RAISE EXCEPTION 'INVALID_MODE: mode harus create, inspect, settle, atau express' USING ERRCODE = 'P0001';
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

  IF v_dep_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_dep_jr->'lines', '[]'::jsonb)) > 0 THEN
    SELECT COALESCE(SUM(COALESCE(x.debit, 0)), 0), COALESCE(SUM(COALESCE(x.credit, 0)), 0)
    INTO v_debit, v_credit
    FROM jsonb_to_recordset(v_dep_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric);
    IF ABS(v_debit - v_credit) > 0.5 THEN
      RAISE EXCEPTION 'JOURNAL_UNBALANCED (DepositTransfer): debit % <> kredit %', v_debit, v_credit USING ERRCODE = 'P0001';
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
      v_q_move_id := NULL;
      v_r_move_id := NULL;

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

      -- If express mode, immediately write event-sourced stock movements across all 5 dispositions
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

        ELSIF v_disp IN ('writeoff', 'rtv_vendor', 'lost_in_transit') THEN
          -- Full Event Sourcing audit trail (+qty arrival in QC quarantine, immediately offset by -qty so quarantine_stock nets to 0)
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

          UPDATE public.rma_items
          SET quarantine_move_id = v_q_move_id,
              resolution_move_id = v_r_move_id
          WHERE id = v_item_id;
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
    -- Nested IF prevents PL/pgSQL from evaluating v_rma when v_mode = 'express'
    IF v_mode = 'settle' THEN
      IF v_rma.settlement_stage = 'settled' THEN
        RAISE EXCEPTION 'RMA_ALREADY_SETTLED: Hak pelanggan pada RMA ini sudah diselesaikan' USING ERRCODE = 'P0001';
      END IF;
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

    -- Optional Deposit Transfer Journal (Dr 103000 / Cr 202000 on source order so Cash-Basis P&L nets cleanly to 0)
    IF v_dep_jr IS NOT NULL AND jsonb_array_length(COALESCE(v_dep_jr->'lines', '[]'::jsonb)) > 0 THEN
      INSERT INTO public.transactions (business_id, order_id, date, description)
      VALUES (
        v_business, v_order_id,
        COALESCE(NULLIF(v_dep_jr->>'date', '')::timestamptz, v_now),
        v_dep_jr->>'description'
      ) RETURNING id INTO v_dep_tx_id;

      INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
      SELECT v_dep_tx_id, x.account_id, COALESCE(x.debit, 0), COALESCE(x.credit, 0)
      FROM jsonb_to_recordset(v_dep_jr->'lines') AS x(account_id uuid, debit numeric, credit numeric)
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
      INSERT INTO public.customer_store_credits (business_id, customer_id, balance, lifetime_issued, updated_at)
      VALUES (v_business, (v_sc->>'customer_id')::uuid, (v_sc->>'amount')::numeric, (v_sc->>'amount')::numeric, v_now)
      ON CONFLICT (business_id, customer_id)
      DO UPDATE SET
        balance = public.customer_store_credits.balance + EXCLUDED.balance,
        lifetime_issued = COALESCE(public.customer_store_credits.lifetime_issued, 0) + EXCLUDED.lifetime_issued,
        updated_at = v_now
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

    -- Zoho-Style 1-Click Direct Allocation to Another Unpaid Invoice (1-Roundtrip Atomic!)
    IF v_alloc IS NOT NULL AND NULLIF(v_alloc->>'target_order_id', '') IS NOT NULL THEN
      SELECT id, order_number, grand_total, amount_paid, status
      INTO v_target_order
      FROM public.orders
      WHERE id = (v_alloc->>'target_order_id')::uuid AND business_id = v_business
      FOR UPDATE;

      IF FOUND THEN
        IF v_target_order.status <> 'cancelled' THEN
          v_alloc_amt := LEAST(
            COALESCE((v_alloc->>'amount')::numeric, 0),
            GREATEST(0, COALESCE(v_target_order.grand_total, 0) - COALESCE(v_target_order.amount_paid, 0))
          );

          IF v_alloc_amt > 0.01 THEN
            v_alloc_target_id := v_target_order.id;
            v_alloc_target_num := v_target_order.order_number;

            -- 1. Post Payment Journal on Target Invoice (Dr 202000 Saldo Kredit / Cr 103000 Piutang Usaha)
            INSERT INTO public.transactions (business_id, order_id, date, description)
            VALUES (
              v_business, v_target_order.id, v_now,
              'Pembayaran Invoice #' || v_target_order.order_number || ' via Saldo Kredit RMA ' || v_rma_number
            ) RETURNING id INTO v_alloc_tx_id;

            INSERT INTO public.journal_lines (transaction_id, account_id, debit, credit)
            VALUES
              (v_alloc_tx_id, (v_alloc->>'store_credit_account_id')::uuid, v_alloc_amt, 0),
              (v_alloc_tx_id, (v_alloc->>'receivable_account_id')::uuid, 0, v_alloc_amt);

            -- 2. Record in order_payments of Target Invoice
            INSERT INTO public.order_payments (
              business_id, order_id, transaction_id, date, amount, payment_method,
              payment_method_account_id, cash_received, change_amount, reference_number,
              notes, payment_kind, rma_id
            ) VALUES (
              v_business, v_target_order.id, v_alloc_tx_id, current_date, v_alloc_amt,
              'Saldo Kredit Pelanggan', (v_alloc->>'store_credit_account_id')::uuid,
              0, 0, v_rma_number,
              'Potong tagihan dari Saldo Kredit RMA ' || v_rma_number,
              'payment', v_rma_id
            );

            -- 3. Deduct from customer_store_credits & log redemption in store_credit_ledger
            IF NULLIF(v_alloc->>'customer_id', '') IS NOT NULL THEN
              UPDATE public.customer_store_credits
              SET balance = GREATEST(0, balance - v_alloc_amt),
                  lifetime_redeemed = COALESCE(lifetime_redeemed, 0) + v_alloc_amt,
                  updated_at = v_now
              WHERE business_id = v_business AND customer_id = (v_alloc->>'customer_id')::uuid
              RETURNING balance INTO v_sc_balance;

              INSERT INTO public.store_credit_ledger (
                business_id, customer_id, entry_type, amount, balance_after,
                rma_id, order_id, description, created_by
              ) VALUES (
                v_business, (v_alloc->>'customer_id')::uuid, 'redeemed', -v_alloc_amt, COALESCE(v_sc_balance, 0),
                v_rma_id, v_target_order.id,
                'Alokasi langsung ke piutang #' || v_target_order.order_number || ' dari RMA ' || v_rma_number,
                v_actor
              );
            END IF;

            -- 4. Update Target Invoice amount_paid & payment_status
            v_target_new_paid := COALESCE(v_target_order.amount_paid, 0) + v_alloc_amt;
            v_target_pay_status := CASE
              WHEN v_target_new_paid >= COALESCE(v_target_order.grand_total, 0) - 0.01 THEN 'paid'
              WHEN v_target_new_paid > 0 THEN 'partial'
              ELSE 'unpaid'
            END;

            UPDATE public.orders
            SET amount_paid = v_target_new_paid,
                payment_status = v_target_pay_status,
                payment_method = 'Saldo Kredit Pelanggan',
                updated_at = v_now
            WHERE id = v_target_order.id;
          END IF;
        END IF;
      END IF;
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
    'deposit_transfer_transaction_id', v_dep_tx_id,
    'new_grand_total', v_new_grand,
    'new_amount_paid', v_new_paid,
    'payment_status', v_pay_status,
    'store_credit_balance', v_sc_balance,
    'allocated_amount', v_alloc_amt,
    'allocated_target_order_id', v_alloc_target_id,
    'allocated_target_order_number', v_alloc_target_num
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_rma_transition_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_rma_transition_v1(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

