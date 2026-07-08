-- Register the 'meld.received' notification type so the inbound-meld worker can
-- push/bell the owner when a new restoration Meld arrives. Additive, idempotent
-- (data seed into the existing notification_types catalog — no schema change).

INSERT INTO notification_types
  (type_key, label, description, category, audience,
   bell_default, push_default, email_default, enabled, sort_order)
VALUES
  ('meld.received',
   'New Property Meld',
   'A new restoration meld arrived from Property Meld and needs review.',
   'operations',
   'Owner (Property Meld restoration melds)',
   true, true, false, true, 100)
ON CONFLICT (type_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  audience    = EXCLUDED.audience,
  enabled     = EXCLUDED.enabled;
