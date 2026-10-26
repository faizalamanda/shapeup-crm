-- Migration: 20261026000000_bulk_delete_products_rpc.sql
-- Description: RPC for bulk deleting products (selected or all) with RBAC permissions and ledger safety.
-- Security: Hardened multi-tenant isolation with granular role & permission checks.

CREATE OR REPLACE FUNCTION public.bulk_delete_products(
  p_business_id uuid,
  p_product_ids uuid[] DEFAULT NULL,
  p_purge_all boolean DEFAULT false,
  p_force_stock_cleanup boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_caller_id uuid;
  v_is_authorized boolean;
  v_target_ids uuid[];
  v_blocked_ids uuid[];
  v_blocked_count integer := 0;
  v_deleted_count integer := 0;
  v_blocked_products jsonb := '[]'::jsonb;
BEGIN
  v_caller_id := auth.uid();

  -- 1. Security Check: caller must be authenticated and have appropriate role/permissions
  -- Bypass only if called internally by PostgreSQL service role or superuser
  IF current_user != 'service_role' AND current_user != 'postgres' THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION 'Akses ditolak: Autentikasi diperlukan.';
    END IF;

    -- Owner has unrestricted access
    -- Admin has unrestricted access
    -- Staff with 'manage_products' can delete selected products, but CANNOT purge all products
    SELECT EXISTS (
      SELECT 1 FROM public.businesses WHERE id = p_business_id AND owner_id = v_caller_id
      UNION
      SELECT 1 FROM public.business_staff 
      WHERE business_id = p_business_id 
        AND profile_id = v_caller_id 
        AND (
          role = 'admin' OR 
          'full_access' = ANY(permissions) OR
          (NOT p_purge_all AND 'manage_products' = ANY(permissions))
        )
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      IF p_purge_all THEN
        RAISE EXCEPTION 'Akses ditolak: Hanya pemilik bisnis atau admin yang berhak mereset seluruh produk katalog.';
      ELSE
        RAISE EXCEPTION 'Akses ditolak: Anda tidak memiliki izin kelola produk (manage_products).';
      END IF;
    END IF;
  END IF;

  -- 2. Determine target product IDs (strictly scoped to p_business_id)
  IF p_purge_all THEN
    SELECT array_agg(id) INTO v_target_ids
    FROM public.products
    WHERE business_id = p_business_id;
  ELSE
    IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL OR array_length(p_product_ids, 1) = 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'deleted_count', 0,
        'blocked_count', 0,
        'message', 'Tidak ada produk yang dipilih.'
      );
    END IF;

    -- Strict multi-tenant containment: only target IDs that truly belong to p_business_id
    SELECT array_agg(id) INTO v_target_ids
    FROM public.products
    WHERE business_id = p_business_id AND id = ANY(p_product_ids);
  END IF;

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL OR array_length(v_target_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'deleted_count', 0,
      'blocked_count', 0,
      'message', 'Tidak ada produk yang ditemukan untuk dihapus.'
    );
  END IF;

  -- 3. Check for stock moves constraint if force cleanup is FALSE
  IF NOT p_force_stock_cleanup THEN
    -- Find which products have stock_moves within this business
    SELECT 
      array_agg(DISTINCT sm.product_id),
      count(DISTINCT sm.product_id),
      jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku))
    INTO v_blocked_ids, v_blocked_count, v_blocked_products
    FROM public.stock_moves sm
    JOIN public.products p ON p.id = sm.product_id
    WHERE sm.business_id = p_business_id AND sm.product_id = ANY(v_target_ids);

    IF v_blocked_ids IS NOT NULL AND array_length(v_blocked_ids, 1) > 0 THEN
      -- Filter out blocked IDs from target_ids
      SELECT array_agg(t) INTO v_target_ids
      FROM unnest(v_target_ids) AS t
      WHERE NOT (t = ANY(v_blocked_ids));
    END IF;
  END IF;

  -- 4. If target_ids is empty after blocking
  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL OR array_length(v_target_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'deleted_count', 0,
      'blocked_count', v_blocked_count,
      'blocked_products', COALESCE(v_blocked_products, '[]'::jsonb),
      'message', format('%s produk tidak dapat dihapus karena memiliki riwayat mutasi stok. Aktifkan opsi "Paksa hapus riwayat stok" jika Anda ingin menghapusnya secara permanen.', v_blocked_count)
    );
  END IF;

  -- 5. If force_stock_cleanup is TRUE, delete dependent stock_moves & inventory_stock_summary
  -- NEVER touches any other tenant or any other table (e.g. businesses, orders, customers are untouched)
  IF p_force_stock_cleanup THEN
    DELETE FROM public.inventory_stock_summary
    WHERE business_id = p_business_id AND product_id = ANY(v_target_ids);

    DELETE FROM public.stock_moves
    WHERE business_id = p_business_id AND product_id = ANY(v_target_ids);
  END IF;

  -- Also clean up inventory_stock_summary for unblocked target_ids to prevent orphaned records
  DELETE FROM public.inventory_stock_summary
  WHERE business_id = p_business_id AND product_id = ANY(v_target_ids);

  -- 6. Perform the product deletion
  -- Note: product_variants, product_modifiers, product_recipes will CASCADE delete automatically
  DELETE FROM public.products
  WHERE business_id = p_business_id AND id = ANY(v_target_ids);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'blocked_count', v_blocked_count,
    'blocked_products', COALESCE(v_blocked_products, '[]'::jsonb),
    'message', CASE 
      WHEN v_blocked_count > 0 THEN 
        format('%s produk berhasil dihapus. %s produk dilewati karena memiliki riwayat mutasi stok.', v_deleted_count, v_blocked_count)
      ELSE 
        format('%s produk berhasil dihapus.', v_deleted_count)
    END
  );
END;
$function$;

-- Revoke public/anon execute and grant strictly to authenticated and service_role
REVOKE EXECUTE ON FUNCTION public.bulk_delete_products(uuid, uuid[], boolean, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.bulk_delete_products(uuid, uuid[], boolean, boolean) TO authenticated, service_role;
