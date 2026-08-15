/**
 * ════════════════════════════════════════════════
 * FILE: ActionIcons.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small line drawings that sit next to buttons — a pencil for signing, a
 *   speech bubble for texting, an envelope for emailing, a page for documents.
 *   They replaced the emoji that used to sit in those buttons. Emoji are drawn
 *   by the operating system, so they change shape between an iPhone, an Android
 *   and a browser, they arrive in someone else's colour, and they never match
 *   the weight of the icons already in the app. These are drawn by us, inherit
 *   the button's own colour, and look the same everywhere.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/components/tech/EsignRequestSheet.jsx,
 *                 src/pages/tech/TechJobDocuments.jsx,
 *                 src/components/SendEsignModal.jsx,
 *                 src/pages/SignPage.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (plain inline SVG — no icon library is used in this project)
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Follows the idiom already in the codebase, verbatim: 24×24 viewBox,
 *     `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, round caps and
 *     joins. That is what the "Request signature" pencil and the "View PDF" eye
 *     already use, so these sit at the same visual weight beside them.
 *   - `stroke="currentColor"` is the load-bearing part: it makes an icon adopt
 *     its button's colour automatically, including the disabled and danger
 *     states, so no icon needs a colour prop and none can drift out of theme.
 *   - `size` defaults to 16, matching the inline button icons. The primary
 *     bottom-bar action uses 20.
 *   - **Stroke thins at display sizes.** `strokeWidth={2}` is the idiom for a
 *     16px inline icon; the viewBox scales the stroke with the icon, so the same
 *     2 becomes a 4px slab at the 44-48px status sizes on the signing page.
 *     Those call sites pass `strokeWidth={1.5}` — spread after `base()`, so any
 *     attribute can be overridden per call. Optical weight is what is being kept
 *     constant here, not the literal number.
 *   - Decorative by design: each carries `aria-hidden="true"` because every call
 *     site already has a visible text label beside it. An icon-only use would
 *     need its own accessible name on the control, not here.
 *   - Same-file module, not `@/components/ui`: that barrel is leased by
 *     UX-Quality F-S2 ("wave sessions IMPORT these; they do not edit them").
 *     `DivisionIcons.jsx` is the house precedent for an icon module beside it.
 * ════════════════════════════════════════════════
 */

/** Shared attributes so every icon lands at identical weight. */
const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
});

/** Pencil — signing, in person or otherwise. */
export function SignatureIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/** Speech bubble — send or resend by text message. */
export function TextIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Envelope — send or resend by email. */
export function EmailIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

/** Page with a folded corner — a document, or the absence of one. */
export function DocumentIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/** Capital T on a baseline — typing a name, as opposed to drawing it.
 *  Deliberately NOT `TextIcon`: that one is the speech bubble and means "send an
 *  SMS". These two live one screen apart on the e-sign surfaces, so the names
 *  have to carry the difference. */
export function TypeIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 7V4h16v3" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </svg>
  );
}

/** Triangle with a bang — something is wrong, or a field needs attention. */
export function AlertTriangleIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Closed padlock — a link that is no longer open to be used. */
export function LockIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Tick inside a ring — a whole thing finished. Use `CheckIcon` instead when the
 *  call site already draws its own disc, or the two circles fight. */
export function CheckCircleIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 6-6" />
    </svg>
  );
}

/** Bare tick — confirmation, where the surrounding shape carries the emphasis. */
export function CheckIcon({ size = 16, ...rest }) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}
