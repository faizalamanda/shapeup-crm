-- Migration: 20260921000000_add_preview_marketing_audience.sql
-- Description: Add RPCs to dynamically count and preview marketing audience using sql_filter

CREATE OR REPLACE FUNCTION public.count_marketing_audience(
    p_business_id UUID,
    p_sql_filter TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
    v_sql TEXT;
BEGIN
    v_sql := format('
        SELECT count(DISTINCT o.customer_id)
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.business_id = %L
        AND (%s)
        AND o.customer_id IS NOT NULL
    ', p_business_id, COALESCE(NULLIF(trim(p_sql_filter), ''), 'TRUE'));
    
    EXECUTE v_sql INTO v_count;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_marketing_audience(
    p_business_id UUID,
    p_sql_filter TEXT,
    p_limit INT DEFAULT 10,
    p_offset INT DEFAULT 0
) RETURNS TABLE (
    customer_id UUID,
    name TEXT,
    ltv NUMERIC,
    total_order_count BIGINT,
    last_order_status TEXT,
    last_order_date TIMESTAMPTZ,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sql TEXT;
BEGIN
    v_sql := format('
        WITH matched_customers AS (
            SELECT DISTINCT o.customer_id
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id
            LEFT JOIN businesses b ON b.id = o.business_id
            WHERE o.business_id = %L
            AND (%s)
            AND o.customer_id IS NOT NULL
        )
        SELECT 
            mc.customer_id,
            COALESCE(c.name, ''Customer'') AS name,
            cm.ltv,
            cm.total_order_count,
            cm.last_order_status,
            cm.last_order_date,
            c.created_at AS joined_at
        FROM matched_customers mc
        LEFT JOIN customers c ON c.id = mc.customer_id
        LEFT JOIN customer_metrics cm ON cm.customer_id = mc.customer_id AND cm.business_id = %L
        ORDER BY cm.ltv DESC NULLS LAST
        LIMIT %s OFFSET %s
    ', p_business_id, COALESCE(NULLIF(trim(p_sql_filter), ''), 'TRUE'), p_business_id, p_limit, p_offset);
    
    RETURN QUERY EXECUTE v_sql;
END;
$$;
