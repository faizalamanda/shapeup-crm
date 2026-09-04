-- Migration: Full Hybrid Architecture Inventory Stock Summary Table

CREATE TABLE IF NOT EXISTS public.inventory_stock_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  product_id UUID NOT NULL,
  location_id UUID NULL,
  on_hand_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  available_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  reserved_qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  fifo_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  lifo_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  avco_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_biz_prod_loc UNIQUE (business_id, product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_summary_biz ON public.inventory_stock_summary (business_id);
