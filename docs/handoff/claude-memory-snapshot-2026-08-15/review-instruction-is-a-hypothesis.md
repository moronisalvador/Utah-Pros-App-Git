---
name: review-instruction-is-a-hypothesis
description: "A reviewer's proposed fix must have its blast radius traced before applying — twice on PR #644 the literal instruction would have caused a regression"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 86b437a6-dc0d-4c25-aa2e-9d3ac15959fd
  modified: 2026-08-14T19:42:59.977Z
---

A review finding and its **proposed fix** are two different things. The finding is usually
right; the fix is a hypothesis. Trace every caller of what it touches before applying it.

Established on PR #644 (2026-08-14, multi-photo MMS), where applying two review instructions
verbatim would have shipped defects:

1. **"Require `client_request_id` for any outbound send"** — the finding (a split loop's
   concurrency invariant rested on an optional field) was real. But the reviewer had checked
   only the two frontend callers. `functions/api/send-esign.js` and
   `functions/api/resend-esign.js` also POST to `/api/send-message`, **without** that field,
   so the literal fix would have 400'd "text the signing link" and the signing reminder in
   production. Fix shipped scoped to the multi-photo path, which is where the amplification
   (N duplicate texts, not one) actually lives and where nothing deployed depends on it.
2. **"Reuse `summarizeSendResult` from the tech-v2 module in the office page"** — the finding
   (office inbox silently reported partly-failed sends as clean) was real. But the two
   composers are copy-paste twins and *that* is why the reporting drifted; importing across
   surfaces would have added chunk coupling and left the wording duplicated, free to diverge
   again. Extracted to `src/lib/sendResult.js` instead, with a source-contract test that fails
   when a third send surface ships without reporting.

**Why:** the owner's coordination lane stated it directly — "a review instruction is a
hypothesis, and you traced the callers I hadn't… I'd rather be corrected twice than merge
something wrong."

**How to apply:** accept the finding, then independently derive the fix and its blast radius.
When you diverge, push back with file:line evidence for *why* the literal instruction breaks
something — not a bare assertion. Fixing the mechanism that let the defect happen (a contract
test) usually beats fixing the instance. See [[close-out-ends-in-pr-and-notification]].
