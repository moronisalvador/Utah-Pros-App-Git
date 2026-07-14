# Tech PWA Redesign — Design-Standards Session Brief

**Purpose of THIS session:** choose + document the design standard for the field-tech mobile PWA
(`/tech/*`). **Design only — no implementation.** A later session executes the redesign against the
standard locked here, fully behind a feature flag.

---

## Standing decisions (inherited — do not relitigate)

- **Scope:** the mobile PWA `/tech/*` (the field-tech app) ONLY. Desktop + backend are **frozen**.
- **Two sessions:** (1) THIS = decide + standardize the design; (2) next = build the redesign,
  **behind a feature flag** (owner-only until flipped, like `page:tech_dash_v2`), one screen per
  focused agent, each gated by the reviewer gauntlet + `review-animations` + this standard as the
  acceptance test.
- **Motion is already standardized** — `.claude/rules/motion-standard.md` v2 (frequency-tier,
  exit animations, spring token, reduced-motion, scoped gestures). This session CONFIRMS/tunes the
  feel against the new look; it does not re-author motion.
- **Foundation exists** — F-S2 shipped the token system + shared primitives. Design decisions here
  become **token values + component styles**, so they propagate everywhere in one place.
- **No emojis** — a proper **SVG icon system**. Extend/replace `src/components/Icons.jsx` +
  `src/components/tech/v2/*` icons. Style (stroke weight, outline vs filled vs duotone) TBD here.
- **Persona (binding UX constraint):** a 64-year-old field tech, in gloves, in a flooded basement
  or direct sunlight, one-handed. See `.claude/rules/tech-mobile-ux.md`. "Native/premium feel" must
  not cost legibility or tap-target size. Reconcile the tension deliberately.
- **Skills to use:** `impeccable` (design authority), `apple-design`, `emil-design-eng`,
  `improve-animations`/`review-animations` (motion), `artifact-design` (for the mockups). `impeccable`
  owns product-UI; the brand/marketing skills are for the public site, NOT this internal app.
- **In-flight to reconcile:** the tech app has open redesign initiatives (Job Hub v2, tech-messages-v2).
  Decide per surface: fold-in / supersede / build-around — so nothing gets clobbered.

## The design decisions to make (owner input required)

1. **Direction & feeling** — which products feel the way you want the tech app to feel (e.g. Linear,
   Apple first-party apps, Things, Stripe dashboard, Superhuman…), and the one-word feeling
   (premium-calm? bold-fast? dead-simple/utilitarian?).
2. **The persona balance** — how far toward "premium/refined" vs "rugged/high-legibility"? (A dial,
   not either/or — but the answer drives density, contrast, and type size.)
3. **Brand** — is there a UPR brand color / logo / mark to honor and build the palette around, or is
   the palette open? Any element that must stay?
4. **Color** — keep today's status-color semantics (amber=OMW, green=working, red=paused,
   blue=scheduled, gray=done — `tech-mobile-ux.md`) or rethink? Accent hue?
5. **Light + dark** — the tech app currently supports dark. Keep both (designed with equal care), or
   commit to one?
6. **Typography** — keep Inter, or adopt a new face? (Willing to self-host a subsetted woff2 — the
   perf budget requires it.) Any brand font?
7. **Density** — spacious/airy (premium) vs compact/information-dense (pro-tool)? (Persona leans
   larger targets; premium leans airy — these can agree.)
8. **Icon system** — SVG confirmed. Style: outline vs filled vs duotone; stroke weight; corner
   character. Match the existing set's geometry or redesign it?
9. **Depth/materials** — flat, or layered with shadow/translucency (the "materials" question — note
   the verified iOS-Safari limits: frosted blur works, true liquid-glass refraction does not; blur is
   GPU-costly over scrolling lists).
10. **Your involvement** — react to 2–3 full-screen mockups and pick (recommended), or a lighter
    token-level direction you approve in the abstract?

## Process (this session)

1. Answer the questions above (or a rough steer → I propose).
2. I generate **2–3 visual directions of a real tech screen** (the dashboard "mission control":
   greeting header · attention strip · now/next hero with clock controls · color-coded day timeline ·
   rest-of-today list · hours/tasks/photos numbers · completed visits · next 7 days · create FAB) as
   phone-openable artifacts, plus a second screen (an appointment detail) in the front-runner.
3. You pick / refine ("that one, but calmer").
4. I **standardize** the winner: update `UPR-Design-System.md` (or a new tech design-standard doc) —
   palette + tokens, type scale + faces, spacing/density, radius/elevation, the SVG icon spec,
   component looks (button/card/input/modal/nav/list/status), and confirm the motion feel. This
   documented standard is the acceptance spec the build session executes against.

## Deliverable

A **decided, documented design standard** (doc + tokens + icon spec + chosen mockups) for `/tech/*` —
nothing implemented in the app. The build session starts from it.
