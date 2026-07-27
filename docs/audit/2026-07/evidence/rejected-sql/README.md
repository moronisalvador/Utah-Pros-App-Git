# Rejected S1h SQL provenance

The first S1h draft was rejected on 2026-07-26 because it preserved anonymous
employee authority and raw browser access to native device tokens, and because
its upserts could reassign a token or endpoint owned by another employee.

The exact rejected draft had SHA-256
`16a83c10d99aa337eaeb47c3887b2c9e129fa9d1e34486375fa24470f88d6e62`.
It was moved back into migration discovery only after its stop conditions and
unsafe behavior were replaced. Git history for the reviewed source commit is
the authoritative byte-for-byte record; this directory intentionally does not
duplicate an active migration.
