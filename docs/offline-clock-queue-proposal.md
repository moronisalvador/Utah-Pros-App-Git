# Offline clock events — design proposal (NOT built)

**Status:** proposal for owner decision · **Date:** 2026-08-07 · **Scope:** the three clock taps only
(On My Way, Start Work, Finish). Nothing here is implemented. It exists so the offline question can
be decided on evidence rather than instinct.

**Related:** `.claude/rules/tech-mobile-ux.md` (offline amendment — currently ratified online-only),
`AGENTS.md` §15 (idempotency), `.claude/rules/database-standard.md` §3 (additive-only /
frontend-contract freeze).

---

## 1. Recommendation first: don't build this yet

**The measured evidence does not currently support building an offline queue.**

The 2026-08-07 investigation into "techs tap and nothing records" found the database completely
clean — zero orphaned open entries, zero completed visits with an unclosed entry, two auto-splits in
120 days. The failures left *no server trace*, which means the taps never reached the server. But
the cause was not the network:

- `db.rpc` already throws on network failure and on a 30s timeout, and the handler already toasted
  that error. **A tech with no signal was told.** Offline was never silent.
- The actual causes were client-side hangs and a self-disarming confirm — all four are fixed in
  commit `17f1a5f2`.

Before spending this design on real code, **let the shipped fix instrument the question.** The new
persistent failure banner is the measurement: it stays on screen until the tech deals with it, and
it only appears when a write genuinely failed. If techs start reporting that banner frequently, the
network hypothesis is confirmed and this proposal becomes worth building. If the reports stop
entirely, the cause was the hangs, and an offline payroll queue would be significant risk bought for
nothing.

**Suggested decision: revisit in 2–4 weeks of field use.** What follows is the design to build *if*
that evidence arrives.

---

## 2. The central tension, stated plainly

Time entries are payroll. The clock RPC stamps `v_now := NOW()` **server-side, deliberately** — a
tech cannot assert what time they arrived. That is a fraud control, not an implementation detail.

**Offline replay requires the client to supply the time.** Any offline design therefore has to decide
how much client-asserted time it will trust, and make that trust visible downstream. This is the
whole problem; everything else is plumbing.

---

## 3. Design sketch

### 3.1 Idempotency key — client-generated, minted at tap
Per `AGENTS.md` §15 a money/payroll mutation carries a **stable content-derived or client-supplied
key — never `Date.now()`**. Mint `crypto.randomUUID()` at the moment of the tap and persist it
*with* the queued event, so every retry of that tap carries the same key forever.

### 3.2 Queue store — IndexedDB, not localStorage
Must survive an app kill and an iOS eviction; localStorage is too small and synchronous. Record
shape:

```
{ key, appointment_id, employee_id, action, tapped_at, device_id, coords, attempts, created_at }
```

`tapped_at` is the device clock at tap time — the value that makes this whole feature both useful
and dangerous.

### 3.3 RPC change — additive only
```sql
clock_appointment_action(..., p_idempotency_key uuid DEFAULT NULL,
                              p_client_tapped_at timestamptz DEFAULT NULL)
```
New params take `DEFAULT` so the currently deployed frontend keeps working unchanged
(`database-standard.md` §3). Server behaviour:

- **Replay safety:** if `p_idempotency_key` already exists in a new `clock_event_log`, return the
  existing entry and do nothing. This is the guarantee that a double-drain cannot double-clock.
- **Effective time:** `COALESCE(p_client_tapped_at, now())`, **clamped** — never in the future,
  never more than N hours stale (suggest 12h), and always ≤ `now()`.
- **Provenance:** stamp `source = 'offline_replay'` and a `client_asserted_time = true` flag so
  payroll can see, per row, which times the server witnessed and which the device asserted.

### 3.4 Replay semantics
- Drain **in tap order, serialized per employee**. Order is load-bearing: `omw → start → finish`
  against the same entry.
- Stop on the first hard failure that isn't an idempotency hit; surface it rather than skipping.
- **Conflict rule (the sharp edge):** the existing one-open-clock guard means a replayed OMW can
  auto-close an entry the tech has since closed correctly by hand. A replayed event that would
  rewrite an already-closed entry must become a **flagged exception for office review**, never a
  silent overwrite. Silent overwrite of a closed payroll row is worse than the bug we started with.

### 3.5 The tech must see the queue
A pending clock is **not** a confirmed clock and must never be drawn as one. Show a count ("2 taps
waiting to send") and let them tap it to see what is pending. A queue the tech cannot see is how you
turn one lost tap into a week of unexplained payroll.

---

## 4. What law would have to change

| Document | Change required |
|---|---|
| `.claude/rules/tech-mobile-ux.md` | The offline bullet is a **ratified owner decision** (2026-07-27) that the initial release does not admit or replay field mutations. It would need an explicit, narrow carve-out naming *only* the three clock taps — not photos, notes, readings, equipment or task toggles. |
| `AGENTS.md` §15 | No change — the client-supplied-key requirement is already satisfied by design 3.1. |
| `.claude/rules/database-standard.md` §3 | No change — `DEFAULT` params keep the deployed contract callable. Ships with a paired rollback and a behavioural proof per §5b. |

---

## 5. Risks, ranked

1. **Client-asserted time on payroll.** A device with a wrong (or deliberately changed) clock writes
   billable hours. The clamp and the `client_asserted_time` flag reduce this to "visible and
   auditable", not "prevented".
2. **Replay against changed state** — §3.4's conflict rule is the mitigation, and it needs the
   office-review surface to exist before the queue ships, not after.
3. **Scope creep.** Once a queue exists for clock taps, every other failed field write will be asked
   to use it. The carve-out has to stay narrow and enforced by review.
4. **Silent success illusion.** If a queued tap is drawn like a saved tap, techs stop trusting the
   screen entirely — the failure mode this whole effort is trying to end.

---

## 6. Rough shape of the work

Five reviewed lanes, roughly in order: additive migration + rollback + behavioural proof → the
IndexedDB queue module and its tests → the drain/conflict logic → the tech-visible pending surface →
the office exception-review surface. Each is small; the risk is concentrated in the migration and the
conflict rule, and neither should be rushed to land with the others.
