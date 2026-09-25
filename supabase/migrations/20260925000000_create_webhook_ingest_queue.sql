-- Migration: 20260925000000_create_webhook_ingest_queue.sql
-- Description:
--   Buat tabel webhook_ingest_queue untuk antrian pemrosesan webhook WooCommerce
--   secara async via Supabase Edge Function.
--
--   Flow:
--     1. POST /api/webhook/woo → INSERT payload ke tabel ini → 200 OK ke WooCommerce (~15ms)
--     2. Supabase Cron (1 menit) → process-webhook-queue Edge Function
--        → upsert customer, upsert order, syncOrderToLedger, loyalty
--        → mark as done / dead (dengan retry otomatis hingga 3x)
--
--   Pattern mengikuti marketing_queue yang sudah ada.

-- ══════════════════════════════════════════════════════════════
-- 1. TABLE: webhook_ingest_queue
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.webhook_ingest_queue (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL,       -- FK ke businesses.id (uuid, bukan text!)
  source         text        NOT NULL DEFAULT 'woocommerce',
  payload        jsonb       NOT NULL,       -- raw WooCommerce order JSON
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  retry_count    integer     NOT NULL DEFAULT 0,
  error_log      text,
  scheduled_at   timestamptz NOT NULL DEFAULT now(),
  processing_at  timestamptz,
  done_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- 2. INDEXES (mengikuti pola marketing_queue)
-- ══════════════════════════════════════════════════════════════

-- Index utama untuk fetch batch pending
CREATE INDEX IF NOT EXISTS idx_wiq_status_sched
  ON public.webhook_ingest_queue (status, scheduled_at ASC)
  WHERE status = 'pending';

-- Index untuk stuck recovery (processing > 15 menit)
CREATE INDEX IF NOT EXISTS idx_wiq_status_proc
  ON public.webhook_ingest_queue (status, processing_at)
  WHERE status = 'processing';

-- Index untuk monitoring & cleanup
CREATE INDEX IF NOT EXISTS idx_wiq_created_at
  ON public.webhook_ingest_queue (created_at DESC);

-- Index untuk lookup per business
CREATE INDEX IF NOT EXISTS idx_wiq_business_status
  ON public.webhook_ingest_queue (business_id, status);

-- ══════════════════════════════════════════════════════════════
-- 3. RLS — hanya service_role yang bisa akses (webhook + edge fn)
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.webhook_ingest_queue ENABLE ROW LEVEL SECURITY;

-- Tidak ada policy untuk authenticated user — hanya service_role via supabaseAdmin
-- Edge Function dan webhook handler menggunakan SUPABASE_SERVICE_ROLE_KEY
-- sehingga RLS bypass secara otomatis (service role melewati semua RLS)

-- ══════════════════════════════════════════════════════════════
-- 4. FUNCTION: fetch_webhook_queue_batch
--    Atomic: ambil batch + set status 'processing' sekaligus
--    Menghindari double-processing jika dua cron berjalan bersamaan
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fetch_webhook_queue_batch(batch_size integer DEFAULT 20)
-- RETURNS SETOF: kembalikan baris-baris yang berhasil di-claim
RETURNS SETOF public.webhook_ingest_queue
LANGUAGE sql
SECURITY DEFINER  -- PENTING: jalankan sebagai owner (bypass RLS), karena Edge Fn pakai service role
SET search_path = public
AS $$
  UPDATE public.webhook_ingest_queue
  SET
    status        = 'processing',
    processing_at = now()
  WHERE id IN (
    SELECT id
    FROM public.webhook_ingest_queue
    WHERE status = 'pending'
      AND scheduled_at <= now()
    ORDER BY scheduled_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED  -- hindari lock contention jika ada concurrent worker
  )
  RETURNING *;
$$;

-- Grant eksekusi ke service_role (dipakai Edge Function via SUPABASE_SERVICE_ROLE_KEY)
GRANT EXECUTE ON FUNCTION public.fetch_webhook_queue_batch(integer) TO service_role;

-- ══════════════════════════════════════════════════════════════
-- 5. AUTO-CLEANUP: hapus item 'done' yang sudah lebih dari 7 hari
--    (opsional, jalankan manual atau tambah ke cron)
-- ══════════════════════════════════════════════════════════════
-- CREATE OR REPLACE FUNCTION public.cleanup_webhook_queue()
-- RETURNS void LANGUAGE sql AS $$
--   DELETE FROM public.webhook_ingest_queue
--   WHERE status = 'done' AND done_at < now() - INTERVAL '7 days';
-- $$;

NOTIFY pgrst, 'reload schema';
