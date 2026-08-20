# Confirmation Controls Standard

**Last verified:** 2026-08-19

Linked from `AGENTS.md` Rule 2. **The law for how the app asks "are you sure?"** — and for when it
should not ask at all.

**Supersedes** Rule 2's former clause *"Destructive actions use inline two-click confirm, never a
modal."* Owner-directed 2026-08-19: *"I hate this thing that we do in the entire software where we
click a button, and it opens a field or an option to click again to confirm. That's not the
behavior most softwares have. Like, why not just a pop up or a modal instead? That gives us more
control."*

The old clause conflated two different bans. One is right and unchanged: **`alert()` / `confirm()` /
`prompt()` stay forbidden** — blocking, unstyleable, untestable, inconsistent across platforms, and
invisible to the focus and reduced-motion rules the rest of the app obeys. The other was a taste
call wearing a safety argument, and two measurements retired it.

## Why it changed — both findings are measured, not argued

**1. The safety argument was false.** The inline pattern's whole justification is that it is harder
to hit by accident than a dialog. `useTwoClickConfirm` armed and became confirmable in the *same
tick*, so the second half of an ordinary double-tap — one gesture, ~150 ms, exactly how a thumb
slips on a phone, and how iOS delivers a double-tap — ran the destructive action. A probe rendering
the hook the way real callers use it and firing two consecutive clicks called the delete handler
**once**, with the label going `"Delete"` → `"Confirm"` in between. That is true of every caller —
**13** use the shared hook and a wider set hand-rolls the same two-state idiom with local state.

The mechanism to close it — `armDelayMs`, plus an `isPending` label gate so the button still
responds instantly — is in the hook, tested, and **OFF BY DEFAULT.** That is deliberate and it is
the honest state:

> Turning it on requires each caller to split two jobs it currently does with one function —
> `isPending` for the LABEL, `isArmed` for the ACTION. All **13** call sites use `isArmed` for
> both, frequently on the same line. Flipping the default without migrating them leaves every
> destructive button silent for 350 ms after the first tap, which reads as broken and is
> **measurably worse than the bug** — `AdminEstimateDetail.render.test.jsx` caught exactly that
> when the default was briefly 350 ms. The migration touches delete paths and needs per-surface
> verification, so it is its own change and was NOT bundled into the rules update that found the
> defect.

`src/hooks/useTwoClickConfirm.test.jsx` is the regression suite. It asserts the guard works when
opted in, asserts the wiring mistake that silently undoes it, **and asserts that today's default
still lets a double-tap through** — so the exposure is visible in CI rather than only in prose, and
flipping the default is a deliberate act that turns a test red.

**New code passes `armDelayMs` and uses the split.** Existing surfaces adopt it when touched.

**2. It shipped a broken feature.** The send-a-copy email field was built as an inline expand
*because the old rule pointed there*. An `<input>` inside a row whose component identity is unstable
loses focus on every keystroke — the owner could not type an address at all, so the first real send
never happened. A `<Modal>` portals to `document.body` and is structurally immune to that entire
class of bug. Detail: `src/pages/JobPage.sendCopyFocus.test.jsx`.

Neither finding is about taste. The pattern was less safe than the thing it replaced, and it was
being applied to a case it cannot serve.

## The rule — pick by consequence, not by surface

| The action | Control |
|---|---|
| **Needs INPUT of any kind** — an address, an amount, a reason, a choice | **`<Modal>`.** A form is not a confirmation. Non-negotiable; this is the case that broke. |
| **Irreversible**, or reaches beyond the row tapped, or has a consequence the button text cannot state (*"this also voids 3 invoices"*) | **`<Modal>`**, with the consequence written out in words |
| **Single item, obvious from context, recoverable in practice** — remove an equipment placement, delete a note, clear a task | **Inline two-click** via `useTwoClickConfirm` |
| **Not destructive** | **No confirmation.** Do not put friction in front of an undoable action — that is how people learn to click through prompts without reading them |

Both controls are first-class. Neither is a fallback for the other, and neither is "the modern one".

## Mechanics

- **`<Modal>`** is `src/components/ui/Modal.jsx`. It owns `role="dialog"`, the focus trap, ESC and
  overlay close, and exit animation. **Never hand-roll a dialog**, and never reach for a native
  `confirm()` because the shared one felt heavy.
  - Pass `initialFocusRef` so the caret starts where the user must act.
  - Pass `closeDisabled` while a request is in flight, so the dialog cannot be dismissed out from
    under its own side effect.
- **`useTwoClickConfirm`** gates the **action** on `isArmed` and the **label** on `isPending`, and
  new callers pass `armDelayMs` (~350 ms). Gating the action on `isPending` reopens the double-tap
  hole and is a review failure. Callers written before 2026-08-19 pass `isArmed` to both and run
  with `armDelayMs` at its 0 default — meaning **they are still double-tappable today.** That is
  named rather than papered over; see the box above.
- A destructive `<Modal>`'s primary button says what it does (**Delete photo**), never "OK". The
  same rule the inline pattern already followed.

## Field surfaces

`tech-mobile-ux.md`'s "no modals for field actions" is **narrowed, not repealed** — see that file.
Short version: its reason (a tech should not lose the card they are standing in) is real and still
governs the high-frequency in-place stuff, but it never justified sending a required *input* to an
inline expand, and it cannot. On a phone a dialog is a **bottom sheet** — thumb reach — not a
centred desktop modal.

## Migration is deliberate, not a sweep

**13 files** use `useTwoClickConfirm`; a wider set hand-rolls the same two-state idiom with local
state. None of them has the double-tap guard on yet. Re-classify a surface against the table above
**when you are already touching it**, and turn on `armDelayMs` + `isPending` at the same time.

A mass rewrite is its own reviewed change with its own verification, not a drive-by — doing it in a
hurry is how a working delete button becomes a broken one.

Nothing in this file authorizes changing what an action *does*, only how it is confirmed.
