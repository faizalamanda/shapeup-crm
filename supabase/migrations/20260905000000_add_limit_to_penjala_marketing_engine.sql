-- Migration: 20260905000000_add_limit_to_penjala_marketing_engine.sql
-- Description: Add LIMIT per-scenario to penjala_marketing_engine dynamic INSERT
-- to prevent WAL spike when sql_filter matches a large number of orders.
-- Also adds ORDER BY o.created_at ASC for FIFO fairness.

CREATE OR REPLACE FUNCTION public.penjala_marketing_engine()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    rec_scenario RECORD;
    dynamic_query TEXT;

    schedule_window INTERVAL := INTERVAL '5 minutes';
    business_timezone TEXT;
    local_now TIMESTAMP;
    scheduled_at_local TIMESTAMP;
    scheduled_at_sql TEXT;

    time_type TEXT;
    frequency TEXT;
    hour_value INT;
    minute_value INT;
    weekday_value INT;
    month_day_value INT;
    last_month_day INT;
BEGIN
    FOR rec_scenario IN
        SELECT * FROM marketing_scenarios WHERE is_active = true
    LOOP
        SELECT COALESCE(timezone, 'Asia/Jakarta')
        INTO business_timezone
        FROM businesses
        WHERE id = rec_scenario.business_id;

        business_timezone := COALESCE(business_timezone, 'Asia/Jakarta');
        local_now := NOW() AT TIME ZONE business_timezone;
        time_type := rec_scenario.trigger_config->>'timeType';

        IF rec_scenario.trigger_type = 'TIME' AND time_type = 'SCHEDULED' THEN
            frequency := COALESCE(rec_scenario.trigger_config->'schedule'->>'frequency', 'DAILY');
            hour_value := COALESCE((rec_scenario.trigger_config->'schedule'->>'hour')::int, 9);
            minute_value := COALESCE((rec_scenario.trigger_config->'schedule'->>'minute')::int, 0);

            IF frequency = 'DAILY' THEN
                scheduled_at_local := date_trunc('day', local_now) + make_time(hour_value, minute_value, 0);

            ELSIF frequency = 'WEEKLY' THEN
                weekday_value := COALESCE((rec_scenario.trigger_config->'schedule'->>'weekday')::int, 1);

                IF EXTRACT(DOW FROM local_now)::int <> weekday_value THEN
                    CONTINUE;
                END IF;

                scheduled_at_local := date_trunc('day', local_now) + make_time(hour_value, minute_value, 0);

            ELSIF frequency = 'MONTHLY' THEN
                month_day_value := COALESCE((rec_scenario.trigger_config->'schedule'->>'monthDay')::int, 1);
                last_month_day := EXTRACT(day FROM (date_trunc('month', local_now) + INTERVAL '1 month - 1 day'))::int;
                month_day_value := LEAST(month_day_value, last_month_day);

                IF EXTRACT(day FROM local_now)::int <> month_day_value THEN
                    CONTINUE;
                END IF;

                scheduled_at_local := date_trunc('day', local_now) + make_time(hour_value, minute_value, 0);
            ELSE
                CONTINUE;
            END IF;

            IF NOT (
                local_now >= scheduled_at_local
                AND local_now < scheduled_at_local + schedule_window
            ) THEN
                CONTINUE;
            END IF;
        END IF;

        IF rec_scenario.trigger_type = 'TIME' AND time_type = 'SPECIFIC' THEN
            scheduled_at_local := NULL;

            IF rec_scenario.trigger_config->'oneTime'->>'mode' = 'SPECIFIC_DATETIME' THEN
                scheduled_at_local := (
                    (rec_scenario.trigger_config->'oneTime'->>'date')::date
                    + make_time(
                        COALESCE((rec_scenario.trigger_config->'oneTime'->>'hour')::int, 9),
                        COALESCE((rec_scenario.trigger_config->'oneTime'->>'minute')::int, 0),
                        0
                    )
                );

                IF NOT (
                    local_now >= scheduled_at_local
                    AND local_now < scheduled_at_local + schedule_window
                ) THEN
                    CONTINUE;
                END IF;
            END IF;
        END IF;

        scheduled_at_sql := CASE
            WHEN rec_scenario.scheduling_logic IS NULL
              OR trim(rec_scenario.scheduling_logic) = ''
              OR upper(trim(rec_scenario.scheduling_logic)) = 'NOW()'
            THEN
                'NOW()'
            ELSE
                format(
                    '((%s) AT TIME ZONE %L)',
                    rec_scenario.scheduling_logic,
                    business_timezone
                )
        END;

        -- LIMIT 200 per scenario per run: prevents WAL spike when sql_filter
        -- matches thousands of orders. Orders are processed FIFO (oldest first).
        dynamic_query := format(
            'INSERT INTO marketing_queue (
                scenario_id, business_id, order_id, customer_id, channel, recipient, unique_key, payload, scheduled_at
            )
            SELECT
                %L,
                %L,
                o.id::text,
                COALESCE(o.customer_id::text, ''guest''),
                %L,

                CASE
                    WHEN %L = ''whatsapp'' THEN regexp_replace(c.phone, ''^0'', ''62'')
                    WHEN %L = ''email'' THEN lower(c.email)
                    ELSE ''unknown''
                END,

                %L || ''_'' ||
                CASE
                    WHEN %L = ''whatsapp'' THEN regexp_replace(c.phone, ''^0'', ''62'')
                    WHEN %L = ''email'' THEN lower(c.email)
                    ELSE ''unknown''
                END
                || ''_'' || COALESCE(o.id::text, ''''),

                jsonb_build_object(
                    ''platform'', %L,
                    ''template_name'', %L,
                    ''order_id'', o.id,
                    ''template_vars'', COALESCE(%L::jsonb, ''[]''::jsonb),
                    ''template_params'',
                    COALESCE((
                        SELECT jsonb_agg(resolved.value ORDER BY resolved.position)
                        FROM (
                            SELECT
                                COALESCE((tv->>''position'')::int, 0) AS position,
                                CASE
                                    WHEN tv->>''source'' = ''MANUAL'' THEN
                                        COALESCE(tv->>''value'', '''')

                                    WHEN tv->>''source'' = ''TAG'' AND tv->>''value'' = ''customer_name'' THEN
                                        COALESCE(c.name, '''')

                                    WHEN tv->>''source'' = ''TAG'' AND tv->>''value'' = ''ordered_products'' THEN
                                        COALESCE((
                                            SELECT string_agg(
                                                CASE
                                                    WHEN NULLIF(item->>''quantity'', '''') IS NOT NULL
                                                    THEN (item->>''quantity'') || ''x '' || COALESCE(item->>''name'', item->>''product_name'', '''')
                                                    ELSE COALESCE(item->>''name'', item->>''product_name'', '''')
                                                END,
                                                '', ''
                                            )
                                            FROM jsonb_array_elements(COALESCE(o.items_json::jsonb, ''[]''::jsonb)) AS item
                                        ), '''')

                                    ELSE ''''
                                END AS value
                            FROM jsonb_array_elements(COALESCE(%L::jsonb, ''[]''::jsonb)) AS tv
                        ) resolved
                    ), ''[]''::jsonb)
                ),

                %s

            FROM orders o

            LEFT JOIN customers c
                ON c.id = o.customer_id

            LEFT JOIN businesses b
                ON b.id = o.business_id

            WHERE (%s)

            AND o.business_id = %L

            AND (
                (%L = ''whatsapp'' AND c.phone IS NOT NULL)
                OR
                (%L = ''email'' AND c.email IS NOT NULL)
            )

            ORDER BY o.created_at ASC

            LIMIT 200

            ON CONFLICT (unique_key) DO NOTHING',

            rec_scenario.id,
            rec_scenario.business_id,
            rec_scenario.channel_type,

            rec_scenario.channel_type,
            rec_scenario.channel_type,

            rec_scenario.id,
            rec_scenario.channel_type,
            rec_scenario.channel_type,

            rec_scenario.platform,
            rec_scenario.template_name,
            rec_scenario.template_vars,
            rec_scenario.template_vars,

            scheduled_at_sql,
            COALESCE(rec_scenario.sql_filter, 'FALSE'),

            rec_scenario.business_id,

            rec_scenario.channel_type,
            rec_scenario.channel_type
        );

        EXECUTE dynamic_query;
    END LOOP;
END;$function$;
