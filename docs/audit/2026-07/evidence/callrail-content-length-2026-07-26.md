# CallRail outbound content length — live probe evidence

**Date:** 2026-07-26 · **Authorized by:** owner, in session, per probe · **Destination:** owner handset

Dated evidence, not project law. Supersedes the "Content is limited to 140 characters" line in
`docs/messaging-transport-roadmap.md` §"Provider documentation verified 2026-07-23".

## Why this was run

A staff message failed in production with `CallRail message content cannot exceed 140 characters.`
The refusal came from our own adapter (`functions/lib/callrail-messaging.js`), not from CallRail —
the request never left. The 140 had been read from CallRail's published API v3 documentation on
2026-07-23 and encoded as a hard guard without ever being exercised against the live API.

## Method

Three `POST /v3/a/{account}/text-messages.json` calls made directly against the CallRail API,
deliberately bypassing `/api/send-message` so the probe measured CallRail's behaviour and not ours.

- Company `COMd573839d05ad4137a614870938a481c3` (Utah Pros Restoration)
- Tracking number `+13853604121` ("Organic Website - Calls and Text", `sms_enabled: true`)
- Bodies restricted to the GSM-7 basic alphabet so encoding could not confound the result
- Position markers every 100 characters plus a unique tail token, so any truncation point would be
  identifiable from the received message alone

## Result

| Probe | Characters | GSM-7 segments | API response | Delivered to handset |
|---|---|---|---|---|
| 1 | 200 | 2 | accepted, full content echoed | complete, one message |
| 2 | 630 | 5 | accepted, full content echoed | complete, one message |
| 3 | 1591 | 11 | accepted, full content echoed | complete, one message |

Owner confirmed receipt of all three, each intact and reassembled into a single message, tail token
present. No truncation at any length tested. No 4xx at any length tested.

**Conclusion:** the documented 140-character limit is not enforced at CallRail's API layer, and
messages far exceeding it are segmented by the carrier and reassembled by the handset normally.

## What changed as a result

- `functions/lib/callrail-messaging.js` caps at **10 SMS segments** instead of 140 characters.
  10 matches Twilio's own ceiling, so the number survives the planned migration off CallRail, and
  it sits inside proven territory (probe 3 delivered 11 segments).
- Segment math moved to `functions/lib/sms-segments.js` and is shared with the composer, so the
  guard now accounts for GSM-7 vs UCS-2 and for 2-unit GSM extension characters. The previous check
  counted code points, which is neither.

## Explicitly NOT established by this evidence

- **The person-to-person restriction is untouched.** CallRail's prohibition on automated, bulk and
  blast messaging is a policy term, not a technical limit. That the API does not enforce the
  character limit says nothing about permission to send automated traffic, and no probe of that
  restriction was run or should be. UPR's own rule (`AGENTS.md` §14, roadmap §137) forbids it
  independently of CallRail's terms.
- **The true ceiling is unknown.** 1591 characters delivered; nothing above that was tested. The
  10-segment cap is a deliberate conservative choice, not a measured maximum.
- **Emoji outside the BMP are under-counted.** `computeSmsSegments` counts UCS-2 units as code
  points, so a non-BMP emoji (surrogate pair) is charged 1 unit where a carrier charges 2. At the
  10-segment cap the worst case is an emoji-dense message reaching roughly twice the intended
  segment count. Pre-existing in the helper, unchanged here, worth closing separately.
- These probes wrote no `messages` row and appear in no UPR inbox.
