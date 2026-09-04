-- Inventory Locations Table
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'internal', -- 'internal', 'vendor', 'customer', 'inventory_loss'
  code VARCHAR(50) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_locations_biz ON public.inventory_locations (business_id);

-- Stock Moves Table (Movement Log & Lot Tracking)
CREATE TABLE IF NOT EXISTS public.stock_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  product_id UUID NOT NULL,
  reference VARCHAR(150) NOT NULL,
  origin_location_id UUID NULL,
  destination_location_id UUID NULL,
  qty NUMERIC(15,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(15,2) NOT NULL DEFAULT 0,
  lot_number VARCHAR(100) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'done', -- 'done', 'pending', 'cancelled'
  type VARCHAR(50) NOT NULL DEFAULT 'transfer', -- 'receipt', 'delivery', 'transfer', 'adjustment'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_moves_biz_product ON public.stock_moves (business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_created ON public.stock_moves (created_at DESC);

-- FULL HYBRID ARCHITECTURE: Pre-Aggregated Metrics Table
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
