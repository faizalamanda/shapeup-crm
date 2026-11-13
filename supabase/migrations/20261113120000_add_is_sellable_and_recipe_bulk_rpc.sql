-- Migration: Fase 1 — Add is_sellable flag to products & Bulk Recipe Upsert RPC

-- 1. Add is_sellable flag to products (default true so all existing products remain visible in POS)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_sellable boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_biz_sellable
  ON public.products(business_id, is_sellable);

-- 2. Semi-Modular RPC for atomic Bulk Recipe Upsert (Replace or Merge)
CREATE OR REPLACE FUNCTION public.upsert_product_recipes_bulk_v1(payload jsonb)
RETURNS jsonb AS $$
DECLARE
  v_business_id UUID;
  v_mode TEXT;
  v_recipe jsonb;
  v_affected_product_ids UUID[];
  v_upserted_count INTEGER := 0;
BEGIN
  v_business_id := (payload->>'business_id')::UUID;
  v_mode := COALESCE(NULLIF(payload->>'mode', ''), 'replace');

  -- Tenant Ownership / Staff Guard (Rule 14)
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.businesses WHERE id = v_business_id AND owner_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.business_staff WHERE business_id = v_business_id AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied for business %', v_business_id;
  END IF;

  -- Collect distinct affected product_ids
  SELECT ARRAY_AGG(DISTINCT (r->>'product_id')::UUID)
  INTO v_affected_product_ids
  FROM jsonb_array_elements(payload->'recipes') AS r
  WHERE (r->>'product_id') IS NOT NULL;

  IF v_affected_product_ids IS NULL OR array_length(v_affected_product_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('success', true, 'upserted_count', 0, 'affected_products_count', 0);
  END IF;

  -- In 'replace' mode, clear old recipes only for the products included in this import
  IF v_mode = 'replace' THEN
    DELETE FROM public.product_recipes
    WHERE business_id = v_business_id
      AND product_id = ANY(v_affected_product_ids);
  END IF;

  -- Upsert all recipe lines atomically
  FOR v_recipe IN SELECT * FROM jsonb_array_elements(payload->'recipes') LOOP
    INSERT INTO public.product_recipes (
      business_id,
      product_id,
      ingredient_product_id,
      quantity,
      unit,
      notes,
      updated_at
    ) VALUES (
      v_business_id,
      (v_recipe->>'product_id')::UUID,
      (v_recipe->>'ingredient_product_id')::UUID,
      (v_recipe->>'quantity')::NUMERIC(15,4),
      COALESCE(NULLIF(v_recipe->>'unit', ''), 'pcs'),
      NULLIF(v_recipe->>'notes', ''),
      now()
    )
    ON CONFLICT (product_id, ingredient_product_id) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      unit = EXCLUDED.unit,
      notes = EXCLUDED.notes,
      updated_at = now();

    v_upserted_count := v_upserted_count + 1;
  END LOOP;

  -- Mark affected finished goods as variable HPP
  UPDATE public.products
  SET hpp_type = 'variable',
      updated_at = now()
  WHERE business_id = v_business_id
    AND id = ANY(v_affected_product_ids);

  RETURN jsonb_build_object(
    'success', true,
    'upserted_count', v_upserted_count,
    'affected_products_count', array_length(v_affected_product_ids, 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';

