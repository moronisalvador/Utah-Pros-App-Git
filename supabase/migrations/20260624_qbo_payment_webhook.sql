-- QBO inbound webhook event idempotency (mirrors stripe_events / claim_stripe_event).
-- One row per processed Intuit data-change event. RLS-locked to the service role
-- (the webhook worker), like integration_credentials — NO anon/authenticated policies.
CREATE TABLE IF NOT EXISTS qbo_events (
  id           text PRIMARY KEY,                  -- synthetic: sha256(realm:entity:id:op:lastUpdated)
  entity       text,
  operation    text,
  status       text NOT NULL DEFAULT 'processing', -- processing | processed | error
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE qbo_events ENABLE ROW LEVEL SECURITY;

-- Atomically claim an event: returns TRUE only when this call created the row.
-- A duplicate Intuit delivery hits the conflict and returns FALSE so the worker no-ops.
CREATE OR REPLACE FUNCTION claim_qbo_event(p_id text, p_entity text, p_operation text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO qbo_events (id, entity, operation, status)
  VALUES (p_id, p_entity, p_operation, 'processing')
  ON CONFLICT (id) DO NOTHING;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION claim_qbo_event(text, text, text) TO service_role;
