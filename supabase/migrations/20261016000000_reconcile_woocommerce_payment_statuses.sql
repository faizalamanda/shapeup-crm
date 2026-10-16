-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Reconcile WooCommerce Non-COD Payment Statuses & Backfill Ledger
-- Purpose:
--   1. Recognize that WooCommerce non-COD orders (Bank Transfer, Gateway, QRIS)
--      that are shipped, processing, or completed are PAID (Lunas), as payment
--      is collected upfront before fulfillment.
--   2. Update orders.payment_status to 'paid' and orders.amount_paid to grand_total.
--   3. Backfill order_payments ledger records for paid orders that lack entries.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Reconcile orders payment_status & amount_paid for WooCommerce non-COD orders
UPDATE public.orders
SET 
  payment_status = 'paid',
  amount_paid = COALESCE(grand_total, 0)
WHERE source_platform = 'WooCommerce'
  AND payment_method NOT ILIKE '%cod%'
  AND payment_method NOT ILIKE '%bayar di tempat%'
  AND status IN ('shipped', 'processing', 'completed')
  AND (payment_status = 'unpaid' OR payment_status IS NULL);

-- 2. Backfill order_payments records for any paid orders that lack payment ledger lines
INSERT INTO public.order_payments (
  business_id,
  order_id,
  transaction_id,
  payment_kind,
  date,
  amount,
  payment_method,
  cash_received,
  change_amount,
  notes
)
SELECT 
  o.business_id,
  o.id as order_id,
  (
    SELECT t.id 
    FROM public.transactions t 
    WHERE t.order_id = o.id 
      AND (t.description ILIKE '%Pembayaran%' OR t.description ILIKE '%Payment%')
    LIMIT 1
  ) as transaction_id,
  'payment' as payment_kind,
  COALESCE((o.raw_source_data->>'date_paid')::date, o.order_date::date, CURRENT_DATE) as date,
  o.amount_paid as amount,
  COALESCE(o.payment_method, 'Bank Transfer') as payment_method,
  0 as cash_received,
  0 as change_amount,
  'Pembayaran ' || COALESCE(o.source_platform, 'WooCommerce') || ' #' || COALESCE(o.order_number, o.id::text) as notes
FROM public.orders o
WHERE o.payment_status = 'paid'
  AND o.amount_paid > 0
  AND NOT EXISTS (
    SELECT 1 
    FROM public.order_payments op 
    WHERE op.order_id = o.id 
      AND op.payment_kind = 'payment'
  );
