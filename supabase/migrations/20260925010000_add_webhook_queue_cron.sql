-- Migration: 20260925010000_add_webhook_queue_cron.sql
-- Description:
--   Setup pg_cron untuk memanggil Edge Function process-webhook-queue setiap 1 menit.
--   Edge Function berjalan co-located dengan Supabase DB sehingga round-trip DB ~10–30ms.
--
-- CATATAN: Jalankan migration ini SETELAH Edge Function process-webhook-queue
--          sudah di-deploy ke Supabase (supabase functions deploy process-webhook-queue)
--
-- Untuk enable pg_cron di Supabase: Dashboard → Database → Extensions → pg_cron

-- 1. Enable pg_cron extension (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Drop existing cron job jika ada (untuk idempotent re-run)
SELECT cron.unschedule('process-webhook-queue')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-webhook-queue'
);

-- 3. Schedule Edge Function process-webhook-queue setiap 1 menit
-- Edge Function URL akan berbeda per project — ganti <PROJECT_REF> dengan Supabase project ref Anda
-- atau gunakan SUPABASE_URL environment variable
SELECT cron.schedule(
  'process-webhook-queue',           -- nama job (unik)
  '* * * * *',                       -- setiap 1 menit
  $$
    SELECT net.http_post(
      url := 'https://shapeup-crm.vercel.app/api/webhook/woo/process-queue',
      headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODkwMTc4ODIsImV4cCI6MTk0NjY5Nzg4Mn0.W3KA5K-6fKXlu4Kqi_96f8l9BmMfOnU373IB7Bx_-7M", "Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

-- ALTERNATIF: Jika menggunakan Supabase CLI dengan environment variables:
-- SELECT cron.schedule(
--   'process-webhook-queue',
--   '* * * * *',
--   format(
--     $sql$
--       SELECT net.http_post(
--         url := %L || '/functions/v1/process-webhook-queue',
--         headers := format('{"Authorization": "Bearer %s", "Content-Type": "application/json"}', current_setting('app.anon_key', true))::jsonb,
--         body := '{}'::jsonb
--       );
--     $sql$,
--     current_setting('app.supabase_url', true)
--   )
-- );

-- 4. Verifikasi cron job terdaftar
-- SELECT * FROM cron.job WHERE jobname = 'process-webhook-queue';
