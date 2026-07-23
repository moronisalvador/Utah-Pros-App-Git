# Optional Connector Contract

**Last verified:** 2026-07-23

This file repairs the shared dependency referenced by the tracked marketing skills. It is a
governance contract, not evidence that any connector, account, permission, or paid plan is present.

Before a skill uses a connector:

1. Confirm the exact tool is installed and connected in the current session.
2. Confirm the requested data source is authoritative for this task.
3. Classify the call as external read or external write and identify any cost or sensitive-data
   boundary.
4. Keep unavailable providers unavailable; never claim provider-backed evidence from a fallback.
5. Ask for explicit authorization before messages, uploads, publishing, submissions, account or
   permission changes, purchases, or other external writes.

Repository law and `docs/tooling-governance.md` always take precedence over connector-specific
instructions. A cached plugin manifest or a tool name in a prompt is not proof of connection or
authorization.
