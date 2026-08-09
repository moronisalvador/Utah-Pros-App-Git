# Native Lead Center — plan and dispatch

**Written:** 2026-08-08 · **Status:** planned, not started · **Tier:** 1 (sequenced)
**Owner decisions recorded below are current.** Supersedes nothing; this is the remaining
work of *Native office surfaces — Phase 5 step 5*.

Lead Center is the fourth and last office surface. New Estimate, Collections and Dashboard
are live on `main`. This document is the plan for bringing Lead Center to the phone, plus a
self-contained prompt for a cold session at the bottom.

---

## What is already done — do not redo

| Commit | What |
|---|---|
| `14304aff` | Lead Center reads the **kanban stage**, not `inbound_leads.lead_status` |
| `51d97ad5` | The CRM Call Log's lead-status dropdown removed |
| `20260808210324` | `get_estimates` gated to `billing_edit_access()` (the pattern to copy) |

`lead_status` is never advanced: measured on live 2026-08-08, **206 of 210 leads read `new`**,
including 17 the board shows as **Won** and 28 it shows as **Lost**. A screen built on it
labels won jobs "new". Lead Center now groups by stage flags — Working / Won / Lost / All —
and every row carries its exact stage as a coloured chip. The barrel import in
`AdminLeadCenter.jsx` is already fixed.

---

## Owner decisions (2026-08-08, in conversation)

1. **Lead RPC access: office roles** — `admin`, `office`, `project_manager`
   (`billing_edit_access()`), *subject to the `crm_partner` split in Risk 1 below.*
2. **Full scope this round** — leads, transcripts, contact info **and** activity history.
3. **Stage moves from the phone: yes.** Native drag-and-drop between stages is wanted
   *eventually* and explicitly **not now**.
4. **Design is part of the work, not polish afterwards.** Invoke the skills; match the
   existing native shell. Restraint over impressiveness — see the design section.

---

## Evidence ledger

| Claim | State | Evidence |
|---|---|---|
| Screen reads the kanban stage | **HAVE** | `14304aff`, pushed in `e73b4e1d` |
| Leads, transcripts, contact in the payload | **HAVE** | `get_inbound_leads` returns `transcription`, `transcript_analysis`, embedded `contact` |
| Activity history exists already | **HAVE** | `src/components/crm/ActivityTimeline.jsx:201` accepts a `leadId` and calls `get_lead_activity` |
| Notes exist already | **HAVE** | `CrmLeads.jsx` — `get_lead_notes` (1438), `add_lead_note` (685, 1460) |
| Not native | **MISSING** | No route in `buildTargetPages.native.jsx`; allowlists are PAGE 95 / ADMIN_MOBILE 27, none are leads |
| Five lead RPCs ungated | **HAVE** | `get_pipeline_stages`, `move_lead_to_stage`, `get_lead_activity`, `get_lead_notes`, `add_lead_note` are all `SECURITY DEFINER`, granted `authenticated`, **no role check** |
| Recording playback on device | **UNKNOWN** | `/api/callrail-recording` blob fetch, unverified under WKWebView |

---

## The three risks, in order of how badly they bite

### Risk 1 — gating the shared RPCs would lock `crm_partner` out of the kanban

`get_pipeline_stages` and `move_lead_to_stage` are **also called by
`src/pages/crm/CrmLeads.jsx`** — the desktop board. Gating those two to
`billing_edit_access()` would break the board for **6 active `crm_partner` users** who work
leads there daily.

This is the `get_pipeline_summary` mistake in a new costume: a boundary drawn around the
screen you are thinking about, silently breaking the screen you are not.

| RPC | Gate |
|---|---|
| `get_lead_activity`, `get_lead_notes`, `add_lead_note` | office roles |
| `get_pipeline_stages`, `move_lead_to_stage` | office roles **+ `crm_partner`** |
| `get_inbound_leads` | already has a role check — **verify what it actually is** before assuming |

### Risk 2 — the activity timeline lives in a directory native forbids outright

`src/components/crm/` is in `FORBIDDEN_NATIVE_PREFIXES` (`native-bundle-boundary.mjs:234`).
That is a hard prefix ban, not a missing allowlist entry, so `ActivityTimeline.jsx` cannot
enter the native graph as things stand.

Carve it out the way `src/components/collections/` and `src/components/admin-mobile/` were —
both began as blanket prefix bans and became named allowlists. Add a `NATIVE_CRM_ALLOWLIST`
naming **only** the files the lead card composes, keeping deny-by-default for the rest.

Its imports are already native-safe: `AuthContext`, `@/lib/transcript`, `toast`,
`TabLoading`, `ui/ErrorState`. So the carve-out should stay small — but let `build:ios` name
the transitive pulls rather than guessing.

### Risk 3 — the lead card is about to become an accordion wall

It will carry a stage mover, transcript toggle, recording player, contact details **and** an
activity timeline. Stacked inline that is unusable. The desktop solves it with a detail
panel. Choose a **bottom sheet** or a **pushed detail screen** deliberately; do not arrive at
a sixth collapsible section by accretion.

---

## Phases

1. **Migration first.** Gate the five RPCs with the Risk 1 split. Ship it exactly the way
   `20260808210000_estimate_read_boundary.sql` did: drift guard pinning each live body md5,
   postconditions, paired rollback, a `database-standard.md` §5b behavioural proof on a
   disposable local stack with per-role ALLOW **and** DENY including `crm_partner` and
   `field_tech`, plus a CI-visible static contract test. **Apply is separately authorized.**
2. **Port activity history and notes.** Reuse `ActivityTimeline` and the existing notes RPCs.
   Do not write a second timeline — cross-shell duplication is the exact problem the
   reconciliation plan exists to stop. Requires the Risk 2 carve-out.
3. **Native carve-out for the screen.** `AdminLeadCenter.jsx` into `NATIVE_PAGE_ALLOWLIST`;
   `leads/{LeadRow,RecordingPlayer,TranscriptView,leadFormat}` into
   `NATIVE_ADMIN_MOBILE_ALLOWLIST`. Sorted. Both boundary-assert files together. Route +
   registry entry.
4. **Verify.** `build:ios` + `assert-native-dist`, full suite, `test:tooling`, bundle report,
   simulator on **both** accounts. Test recording playback specifically — it is the one
   genuinely unknown thing.

---

## Out of scope

- **Retiring `lead_status`.** It has live readers: `upsert_lead_from_callrail` writes it on
  every inbound call and six database functions reference it. A `DROP` would break lead
  intake and violate additive-only on a live table.
- **The "Not a Lead" stage flag.** It carries neither `is_won` nor `is_lost`, so its 24 leads
  group as Working. Fixable by the owner in CRM → Settings (tick **Lost**), but that merges
  non-opportunities into the lost column and changes conversion math — owner's call, and
  deliberately not hardcoded by stage name here.
- **Native drag-and-drop between stages.** Wanted later; recorded, not built.

---

## Honest caveat about this plan

I was wrong twice about step 2 in a single planning pass: first calling activity history new
work when it already exists, then not checking whether the existing component could cross the
native boundary (it cannot). The owner caught the first. Treat the module lists here as a
starting point and let **`build:ios` be the authority**, the way it was for Collections — it
named a transitive `icons.jsx` that reading the imports had missed.

---

## Cold-session prompt

The prompt lives in `docs/handoff/native-lead-center-prompt-2026-08-08.md` so it can be
pasted without carrying this document's commentary.
