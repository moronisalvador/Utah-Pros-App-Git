-- Property Meld melds — inbound restoration work parsed from Property Meld emails.
-- Additive-only. RLS enabled + explicit policy at creation (CLAUDE.md Rule 7).
-- One row per Meld, keyed by the Meld number (present in every email type);
-- assign / message / cancel events all upsert the same row idempotently.

-- ── Table ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS property_meld_melds (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meld_number             TEXT NOT NULL UNIQUE,          -- e.g. "TFTBCQP" — stable de-dup key
  meld_internal_id        TEXT,                          -- numeric id from the URL (absent on cancels)
  org_id                  TEXT,                          -- Property Meld org (e.g. "2156")
  vendor_account_id       TEXT NOT NULL,                 -- classifier: 83074 = restoration
  business                TEXT NOT NULL DEFAULT 'restoration',
  pm_brand                TEXT,                          -- display name in the email (rebrands; not trusted)
  is_emergency            BOOLEAN NOT NULL DEFAULT FALSE,
  meld_type               TEXT,                          -- "Reconstruction", "Mold check", …
  status                  TEXT,                          -- Property Meld's status text
  due_date_text           TEXT,                          -- raw due-date string (PM's own format)
  appointment_window      TEXT,
  address_street          TEXT,
  address_unit            TEXT,
  address_city_state_zip  TEXT,
  address_full            TEXT,
  description             TEXT,
  description_clipped   BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_from       TEXT,
  last_message_text       TEXT,
  thread_reply_address    TEXT,                          -- per-Meld reply address (email threading back)
  portal_url              TEXT,                          -- deep link (photos/report live here)
  state                   TEXT NOT NULL DEFAULT 'open'
                            CHECK (state IN ('open', 'canceled', 'imported', 'archived')),
  imported_job_id         UUID REFERENCES jobs(id),      -- set when converted to a UPR job
  received_at             TIMESTAMPTZ,                   -- when the Meld first arrived
  last_event              TEXT,
  last_event_at           TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE property_meld_melds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_meld_melds_all" ON property_meld_melds
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_property_meld_melds_state
  ON property_meld_melds (state, is_emergency DESC, received_at DESC);

-- ── Upsert RPC (idempotent by meld_number) ─────────────────────────────────────
-- Assign / message / cancel events all land here. Later events enrich the same
-- row without wiping earlier fields (COALESCE keeps a value when the new one is
-- NULL). A cancel closes the row; an already-imported row is never reverted.

CREATE OR REPLACE FUNCTION upsert_property_meld_meld(
  p_meld_number            TEXT,
  p_event                  TEXT,
  p_vendor_account_id      TEXT,
  p_business               TEXT DEFAULT 'restoration',
  p_org_id                 TEXT DEFAULT NULL,
  p_meld_internal_id       TEXT DEFAULT NULL,
  p_pm_brand               TEXT DEFAULT NULL,
  p_is_emergency           BOOLEAN DEFAULT FALSE,
  p_meld_type              TEXT DEFAULT NULL,
  p_status                 TEXT DEFAULT NULL,
  p_due_date_text          TEXT DEFAULT NULL,
  p_appointment_window     TEXT DEFAULT NULL,
  p_address_street         TEXT DEFAULT NULL,
  p_address_unit           TEXT DEFAULT NULL,
  p_address_city_state_zip TEXT DEFAULT NULL,
  p_address_full           TEXT DEFAULT NULL,
  p_description            TEXT DEFAULT NULL,
  p_description_clipped  BOOLEAN DEFAULT FALSE,
  p_message_from           TEXT DEFAULT NULL,
  p_message_text           TEXT DEFAULT NULL,
  p_thread_reply_address   TEXT DEFAULT NULL,
  p_portal_url             TEXT DEFAULT NULL,
  p_received_at            TIMESTAMPTZ DEFAULT now()
)
RETURNS property_meld_melds
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  result property_meld_melds;
BEGIN
  INSERT INTO property_meld_melds (
    meld_number, meld_internal_id, org_id, vendor_account_id, business, pm_brand,
    is_emergency, meld_type, status, due_date_text, appointment_window,
    address_street, address_unit, address_city_state_zip, address_full,
    description, description_clipped,
    last_message_from, last_message_text, thread_reply_address, portal_url,
    state, received_at, last_event, last_event_at
  )
  VALUES (
    p_meld_number, p_meld_internal_id, p_org_id, p_vendor_account_id,
    COALESCE(p_business, 'restoration'), p_pm_brand,
    COALESCE(p_is_emergency, FALSE), p_meld_type, p_status, p_due_date_text, p_appointment_window,
    p_address_street, p_address_unit, p_address_city_state_zip, p_address_full,
    CASE WHEN p_event = 'message' THEN NULL ELSE p_description END,
    COALESCE(p_description_clipped, FALSE),
    CASE WHEN p_event = 'message' THEN p_message_from END,
    CASE WHEN p_event = 'message' THEN p_message_text END,
    p_thread_reply_address, p_portal_url,
    CASE WHEN p_event = 'canceled' THEN 'canceled' ELSE 'open' END,
    COALESCE(p_received_at, now()), p_event, COALESCE(p_received_at, now())
  )
  ON CONFLICT (meld_number) DO UPDATE SET
    meld_internal_id       = COALESCE(EXCLUDED.meld_internal_id, property_meld_melds.meld_internal_id),
    org_id                 = COALESCE(EXCLUDED.org_id, property_meld_melds.org_id),
    vendor_account_id      = COALESCE(EXCLUDED.vendor_account_id, property_meld_melds.vendor_account_id),
    pm_brand               = COALESCE(EXCLUDED.pm_brand, property_meld_melds.pm_brand),
    is_emergency           = property_meld_melds.is_emergency OR EXCLUDED.is_emergency,
    meld_type              = COALESCE(EXCLUDED.meld_type, property_meld_melds.meld_type),
    -- Cancel forces status; otherwise take the newest non-null status.
    status                 = CASE WHEN p_event = 'canceled' THEN 'Canceled'
                                  ELSE COALESCE(EXCLUDED.status, property_meld_melds.status) END,
    due_date_text          = COALESCE(EXCLUDED.due_date_text, property_meld_melds.due_date_text),
    appointment_window     = COALESCE(EXCLUDED.appointment_window, property_meld_melds.appointment_window),
    address_street         = COALESCE(EXCLUDED.address_street, property_meld_melds.address_street),
    address_unit           = COALESCE(EXCLUDED.address_unit, property_meld_melds.address_unit),
    address_city_state_zip = COALESCE(EXCLUDED.address_city_state_zip, property_meld_melds.address_city_state_zip),
    address_full           = COALESCE(EXCLUDED.address_full, property_meld_melds.address_full),
    -- Only an assignment carries the description; a message must not wipe it.
    description            = CASE WHEN p_event = 'message' THEN property_meld_melds.description
                                  ELSE COALESCE(EXCLUDED.description, property_meld_melds.description) END,
    description_clipped  = CASE WHEN p_event = 'message' THEN property_meld_melds.description_clipped
                                  ELSE EXCLUDED.description_clipped END,
    last_message_from      = COALESCE(EXCLUDED.last_message_from, property_meld_melds.last_message_from),
    last_message_text      = COALESCE(EXCLUDED.last_message_text, property_meld_melds.last_message_text),
    thread_reply_address   = COALESCE(EXCLUDED.thread_reply_address, property_meld_melds.thread_reply_address),
    portal_url             = COALESCE(EXCLUDED.portal_url, property_meld_melds.portal_url),
    -- Never revert an imported row; a cancel closes it; otherwise keep current state.
    state                  = CASE
                               WHEN property_meld_melds.state = 'imported' THEN 'imported'
                               WHEN p_event = 'canceled' THEN 'canceled'
                               ELSE property_meld_melds.state
                             END,
    received_at            = LEAST(property_meld_melds.received_at, COALESCE(EXCLUDED.received_at, now())),
    last_event             = p_event,
    last_event_at          = COALESCE(EXCLUDED.received_at, now()),
    updated_at             = now()
  RETURNING * INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_property_meld_meld TO anon, authenticated;

-- ── List RPC (page reads this) ─────────────────────────────────────────────────
-- Open (and, optionally, closed) restoration melds, emergencies first, newest first.

CREATE OR REPLACE FUNCTION get_property_meld_melds(p_include_closed BOOLEAN DEFAULT FALSE)
RETURNS SETOF json
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
    SELECT row_to_json(m)
    FROM property_meld_melds m
    WHERE p_include_closed OR m.state IN ('open', 'imported')
    ORDER BY m.is_emergency DESC, m.received_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_property_meld_melds TO anon, authenticated;
