-- Migration: 20260903000000_add_queue_and_reporting_indexes.sql
-- Description: Add composite B-Tree indexes to accelerate background queue batching, status recovery, and financial report queries.

-- 1. Marketing Queue indexes (for fetchQueueBatch and recoverStuckQueue)
CREATE INDEX IF NOT EXISTS idx_marketing_queue_status_sched ON public.marketing_queue (status, scheduled_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_marketing_queue_status_proc ON public.marketing_queue (status, processing_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_marketing_queue_sent_at ON public.marketing_queue (sent_at DESC);

-- 2. Transactions & Journal Lines indexes (for get_cash_flow_summary and reporting RPCs)
CREATE INDEX IF NOT EXISTS idx_transactions_biz_date ON public.transactions (business_id, date ASC);
CREATE INDEX IF NOT EXISTS idx_journal_lines_tx_account ON public.journal_lines (transaction_id, account_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account_debit_credit ON public.journal_lines (account_id, debit, credit);

-- 3. Marketing logs index
CREATE INDEX IF NOT EXISTS idx_marketing_logs_sent_at ON public.marketing_logs (sent_at DESC);
