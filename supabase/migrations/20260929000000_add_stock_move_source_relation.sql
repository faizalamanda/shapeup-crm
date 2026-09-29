-- A stock movement belongs to the immutable document that created it.
-- Reference remains a display field and must not be used as the relational key.
ALTER TABLE public.stock_moves
  ADD CONSTRAINT stock_moves_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) NOT VALID;

ALTER TABLE public.stock_moves
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS source_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_stock_moves_source
  ON public.stock_moves (business_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- New writes carry the purchase UUID. This prevents a document from
-- inserting the same product/type movement twice without touching legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_moves_document_product_type
  ON public.stock_moves (business_id, source_type, source_id, product_id, type)
  WHERE source_id IS NOT NULL;

-- High performance composite indexes for fast Move History queries (~1ms)
CREATE INDEX IF NOT EXISTS idx_stock_moves_biz_prod_created
  ON public.stock_moves (business_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_moves_biz_created
  ON public.stock_moves (business_id, created_at DESC);
