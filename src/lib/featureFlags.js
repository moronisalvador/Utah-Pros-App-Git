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
import { NAV_ITEMS, PRIMARY_ITEMS, OVERFLOW_ITEMS, SYSTEM_ITEMS } from '@/lib/navItems';

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
  for (const item of [...NAV_ITEMS, ...PRIMARY_ITEMS, ...OVERFLOW_ITEMS, ...SYSTEM_ITEMS]) {
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
