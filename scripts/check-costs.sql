-- =============================================================================
-- QuickWit API usage & cost monitoring
-- Paste into Supabase SQL Editor. Run optional setup once to enable breakdown by function.
-- =============================================================================

-- Optional: run once to enable "Breakdown by function" below (then update Edge Functions
-- to insert function_name: 'ai-proxy' | 'speech-to-text' | 'text-to-speech' on each insert).
-- ALTER TABLE public.usage_logs ADD COLUMN IF NOT EXISTS function_name text;


-- -----------------------------------------------------------------------------
-- Totals
-- -----------------------------------------------------------------------------

SELECT
  (SELECT count(*) FROM public.usage_logs WHERE created_at > now() - interval '24 hours')  AS total_calls_24h,
  (SELECT count(*) FROM public.usage_logs WHERE created_at > now() - interval '7 days')     AS total_calls_7d,
  (SELECT count(*) FROM public.usage_logs WHERE created_at > now() - interval '30 days')    AS total_calls_30d;


-- -----------------------------------------------------------------------------
-- Breakdown by function (requires function_name column; see optional setup above)
-- -----------------------------------------------------------------------------

-- Last 24 hours by function
SELECT
  coalesce(function_name, '(unknown)') AS function_name,
  count(*) AS calls_24h
FROM public.usage_logs
WHERE created_at > now() - interval '24 hours'
GROUP BY function_name
ORDER BY calls_24h DESC;

-- Last 7 days by function
SELECT
  coalesce(function_name, '(unknown)') AS function_name,
  count(*) AS calls_7d
FROM public.usage_logs
WHERE created_at > now() - interval '7 days'
GROUP BY function_name
ORDER BY calls_7d DESC;

-- Last 30 days by function
SELECT
  coalesce(function_name, '(unknown)') AS function_name,
  count(*) AS calls_30d
FROM public.usage_logs
WHERE created_at > now() - interval '30 days'
GROUP BY function_name
ORDER BY calls_30d DESC;


-- -----------------------------------------------------------------------------
-- Top 10 user_ids by call volume (last 24 hours)
-- -----------------------------------------------------------------------------

SELECT
  user_id,
  count(*) AS calls_24h
FROM public.usage_logs
WHERE created_at > now() - interval '24 hours'
GROUP BY user_id
ORDER BY calls_24h DESC
LIMIT 10;
