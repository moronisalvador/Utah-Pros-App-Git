/**
 * ════════════════════════════════════════════════
 * FILE: featureFlags.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the one master list of every on/off switch ("feature flag") the app
 *   knows about from its own code. Whenever we build a new feature that can be
 *   turned on or off, we add one short line here describing it. The Dev Tools
 *   "Feature Flags" screen reads this list and, the next time it's opened, quietly
 *   creates any switch that isn't in the database yet — already filled in with its
 *   name and description — so nobody ever has to type a flag's details in by hand
 *   again. New switches start ON, which is exactly how the app already treats a
 *   switch that was never created, so nothing changes for users; you just flip one
 *   OFF here whenever you want to hide that feature.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data + helper module, not a screen)
 *   Rendered by:  n/a — imported by DevTools.jsx (the Feature Flags tab)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/navItems (so pages already gated by a flag self-register too)
 *   Data:      reads  → none
 *              writes → none (DevTools performs the actual upsert into feature_flags)
 *
 * NOTES / GOTCHAS:
 *   - Auto-registration only ever ADDS a flag that is missing, and creates it
 *     ENABLED (on) — deliberately: AuthContext treats a missing flag as ON ("no
 *     row = unrestricted"), so a freshly-registered flag MUST start on or it would
 *     hide a feature that was already live. It never modifies a flag that already
 *     exists, so any on/off, dev-only, or force-off state set in the UI is safe.
 *   - To intentionally dark-launch a feature OFF, set `enabled: false` on its entry
 *     below — but know that this HIDES the feature until someone toggles it on.
 *   - Category is inferred from the key prefix: "page:" → page, "tool:" → tool,
 *     "feature:" → feature. Keep using those prefixes when you name a flag.
 *   - To add a new flag: append one entry to EXPLICIT_FLAGS below — or, for a new
 *     nav page, just set `featureFlag` on its navItems entry and it self-registers.
 * ════════════════════════════════════════════════
 */
import { NAV_ITEMS, PRIMARY_ITEMS, OVERFLOW_ITEMS } from '@/lib/navItems';

// ─── SECTION: Helpers ───
const VALID_CATEGORIES = ['page', 'tool', 'feature'];
// Infer the DevTools grouping from the key prefix (page:/tool:/feature:).
const categoryFor = (key) => {
  const prefix = String(key).split(':')[0];
  return VALID_CATEGORIES.includes(prefix) ? prefix : 'feature';
};

// ─── SECTION: Explicit flags (features not tied to a nav item) ───
// Add ONE entry here whenever you ship a feature gated by isFeatureEnabled('…').
// key + label + description is all you need; category is inferred from the prefix.
// (Optional `enabled: false` dark-launches it OFF — that HIDES it until toggled on.)
const EXPLICIT_FLAGS = [
  {
    key: 'feature:ai_xactimate',
    label: 'AI Xactimate Import',
    description: 'Upload an Xactimate PDF; AI reads it and pre-fills the invoice draft with the insurance-billable total (RCV).',
  },
  // ── Notification Center — Web Push (Phase F1) ────────────────────────────────
  // enabled:false is LOAD-BEARING. DevTools auto-seeds any missing registry key
  // ENABLED; without the explicit false this would seed ON and register the push
  // service worker for everyone. The live row is also seeded enabled:false +
  // dev_only_user_id (owner) so push is owner-only until the F1 owner gate passes
  // (VAPID env set + a real push confirmed on the owner's iPhone PWA + desktop).
  {
    key: 'feature:web_push',
    label: 'Web Push Notifications',
    description: 'Browser/PWA push notifications (installed iPhone home screen + desktop). Gates the push service worker + the "Enable push on this device" control. Owner-only during the Notification Center rollout.',
    enabled: false,
  },
  // ── Tech Mobile v2 rollout flags (Phase F) ───────────────────────────────────
  // enabled:false is LOAD-BEARING here. The DevTools auto-seed creates any missing
  // registry key ENABLED; without the explicit false these would seed ON and swap
  // every tech onto the unfinished v2 pages. The live rows are also seeded
  // enabled:false + dev_only_user_id (owner) so v2 is owner-only during the wave.
  {
    key: 'page:tech_dash_v2',
    label: 'Tech Dashboard v2',
    description: 'Rebuilt field-tech dashboard (mission control). Owner-only during the Tech Mobile v2 wave; legacy dashboard shows for everyone else.',
    enabled: false,
  },
  {
    key: 'page:tech_sched_v2',
    label: 'Tech Schedule v2',
    description: 'Rebuilt field-tech schedule/calendar. Owner-only during the Tech Mobile v2 wave; legacy schedule shows for everyone else.',
    enabled: false,
  },
  // ── Tech Mobile v2 — Phase M1 (Job Hub) ──────────────────────────────────────
  // enabled:false is LOAD-BEARING (same reason as the two flags above). The live
  // row is seeded enabled:false + dev_only_user_id (owner) so the merged Job Hub
  // at /tech/job/:jobId?appt= is owner-only during M1; every other tech keeps the
  // legacy TechAppointment + TechJobDetail pages (nav still points at them until M2).
  {
    key: 'page:tech_job_hub',
    label: 'Tech Job Hub',
    description: 'Merged job + appointment field surface (Job Hub) at /tech/job/:jobId?appt=. Owner-only during Tech Mobile v2 M1; legacy appointment/job detail pages show for everyone else.',
    enabled: false,
  },
  // ── CRM per-screen rollout sub-flags (Phase 6b) ──────────────────────────────
  // One switch per CRM screen. These are the rollout kill-switches CrmLayout ANDs
  // with each employee's page access (canAccess('crm_<screen>')): a screen shows
  // only when its sub-flag is open AND the employee has access. Left ON here so
  // they default open (isFeatureEnabled treats a missing/enabled flag as
  // unrestricted); flip one OFF to hide that screen from everyone during rollout.
  // The whole /crm/* tree still sits behind page:crm — these gate WITHIN it.
  ...[
    ['feature:crm_leads',         'CRM · Leads'],
    ['feature:crm_contacts',      'CRM · Contacts'],
    ['feature:crm_conversations', 'CRM · Conversations'],
    ['feature:crm_call_log',      'CRM · Call Log'],
    ['feature:crm_tasks',         'CRM · Tasks'],
    ['feature:crm_sequences',     'CRM · Sequences'],
    ['feature:crm_forms',         'CRM · Forms'],
    ['feature:crm_attribution',   'CRM · Attribution'],
    ['feature:crm_reports',       'CRM · Reports'],
    ['feature:crm_campaigns',     'CRM · Campaigns'],
    ['feature:crm_integrations',  'CRM · Integrations'],
    ['feature:crm_settings',      'CRM · Settings'],
  ].map(([key, label]) => ({
    key, label,
    description: `Per-screen access sub-flag for the ${label.replace('CRM · ', '')} CRM screen — combined with each employee's page access.`,
  })),
];

// ─── SECTION: Nav-derived flags (pages already gated in navItems) ───
// Any nav item carrying a `featureFlag` registers itself, reusing its nav label —
// so adding a flag-gated page needs zero extra bookkeeping here.
function navDerivedFlags() {
  const byKey = new Map();
  for (const item of [...NAV_ITEMS, ...PRIMARY_ITEMS, ...OVERFLOW_ITEMS]) {
    const key = item?.featureFlag;
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { key, label: item.label || key, description: `Controls the ${item.label || key} page.` });
  }
  return [...byKey.values()];
}

// ─── SECTION: Merged registry (explicit entries win on key collision) ───
export const FEATURE_FLAG_REGISTRY = (() => {
  const byKey = new Map();
  for (const f of navDerivedFlags()) byKey.set(f.key, f);
  for (const f of EXPLICIT_FLAGS)    byKey.set(f.key, f); // explicit overrides nav-derived
  return [...byKey.values()].map((f) => ({ ...f, category: f.category || categoryFor(f.key) }));
})();
