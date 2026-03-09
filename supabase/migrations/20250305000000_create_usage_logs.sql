-- Rate limiting: one row per API call for counting daily usage per user_id (anon = IP, auth = JWT sub).
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_logs_user_id_created_at_idx
  ON public.usage_logs (user_id, created_at DESC);

COMMENT ON TABLE public.usage_logs IS 'Edge function call counts for rate limiting; user_id is JWT sub or ip:<addr> for anonymous.';
