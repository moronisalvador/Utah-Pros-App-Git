# Settings Overhaul — File & RPC Ownership Manifest

**Committed by Phase F (Foundation). Binding for every Settings-Overhaul wave session.**
Linked from `docs/settings-overhaul-roadmap.md` (the plan of record) and its dispatch blocks
(`docs/settings-overhaul-dispatch.md`). Each wave session's read scope = `CLAUDE.md` + its phase
block in the roadmap + **this file** (+ `UPR-Design-System.md` for the polish work). Where the
roadmap prose and this manifest disagree on a name or path, **this manifest is authoritative**
(it reflects what Foundation actually shipped).

Isolation in this wave is **not** the branch — it is this ownership split. There is **no feature
flag** for the reorg (permanent redirects + git-revert are the insurance). Stay inside your owned
files and no two sessions collide.

---

## 1. Frozen for the wave — Foundation owns these; NOBODY edits them in-wave

- `src/App.jsx` — the full `/settings/*` route tree + the 5 permanent redirects are wired. A wave
  session does NOT add/move routes. (P2's worker-redirect change is a *worker* edit, not App.jsx.)
- `src/lib/navItems.jsx` — `SETTINGS_GROUPS`, `isSettingsItemVisible`, `anySettingsChildVisible`,
  the settings-hub icons, the single `settingsHub` NAV_ITEMS entry, and `isItemVisible`. Import
  only; adding a settings page to the hub is an F-owner follow-up.
- `src/lib/settingsRedirects.js` — the retired-URL redirect map. Import only.
- `src/components/SettingsLayout.jsx`, `src/pages/settings/SettingsHome.jsx` — the hub shell +
  index. Consume; do not edit.
- `src/components/settings/{SettingsPageHeader,SettingsSection,LookupTable}.jsx`,
  `src/components/settings/{NotificationPrefsMatrix,PushDevicesList}.jsx` (shared with
  `/tech/settings`), `src/components/TabLoading.jsx` — shared primitives. Import only; a needed
  change is a disclosed copy-in to your own file or an F-owner follow-up PR.
- `src/lib/{navKeys,owner,toast,featureFlags,realtime}.js`,
  `src/components/{Layout,Sidebar,TopNav,OverflowDrawer,Icons}.jsx` — shared nav/auth surface.
  P3 CONSUMES `navKeys.js` in its own pages only (rewiring other consumers is an F-owner change).
- `src/pages/settings/templates/{templateData.jsx,TemplateEditor.jsx}` — the templates module.
  P4 owns the templates *pages* (`Templates.jsx`, `TemplatesEditor.jsx`) but treats the module's
  `TemplateEditor`/data as a frozen import (a needed change is an F-owner follow-up).
- `functions/lib/*` (also omni-inbox / CRM-frozen), `package.json` + lockfile, **all
  `supabase/migrations/`** (wave ships ZERO migrations — F shipped the one additive migration incl.
  `delete_demo_schema`), and `src/index.css` OUTSIDE your own reserved marker.

---

## 2. Ownership matrix

| Session | Phase | Owns exclusively (edit only these) | Schema/RPC |
|---|---|---|---|
| A | P1 Payments | `src/pages/settings/Payments.jsx`, new `src/lib/useBillingSettings.js`, `src/pages/Collections.jsx` (ONLY the payment-settings gear-link retarget to `/settings/payments`), css §P1 | none (calls `get_billing_settings`/`set_billing_setting`) |
| B | P2 Integrations | `src/pages/settings/Integrations.jsx`, `functions/api/quickbooks-callback.js` (+ `quickbooks-connect.js` only if the 302 lives there), css §P2 | none |
| C | P3 Team & Access | `src/pages/settings/{Team,Roles,PageAccess,NotificationDefaults}.jsx`, css §P3 | none |
| D | P4 Workspace + Personal | `src/pages/settings/{Carriers,Referrals,Templates,TemplatesEditor,Commissions,MyAccount}.jsx`, `functions/api/google-drive-callback.js` (retarget the 302 to `/settings/my-account?gdrive=`), css §P4 | none |
| E | P5 Feedback Inbox | `src/pages/settings/FeedbackInbox.jsx`, `functions/api/feedback-notify.js` (+ its test), css §P5 | none |
| G | P6 Scope Sheets | `src/pages/settings/ScopeSheets.jsx`, new `src/lib/demoSchemaUtils.js`, css §P6 | none (calls F's `delete_demo_schema`) |
| H | P7-lite DevTools dedup | `src/pages/DevTools.jsx` (delete exactly the Integrations tab + the Employees tab and their now-dead `?qbo=` handling — nothing else) | none |

**Merge preference** (never a gate; throttle to review bandwidth): B → A → C → rest.
**Serial:** H launches only after BOTH B (P2) and C (P3) merge (it deletes the surfaces they replace).

---

## 3. Migration rule (this wave)

Foundation owns 100% of schema/RPC. **Every wave session ships ZERO migrations.** F's single
additive migration already shipped: the `demo_sheet_schemas` drift-capture + `published_at` column
+ `delete_demo_schema(p_id)`. If a phase discovers it needs a migration or an RPC change: **stop and
flag** for a separate reviewed change — do not add one in-wave.

## 4. index.css rule

Write CSS ONLY inside your phase's reserved marker
(`/* ─── SETTINGS OVERHAUL RESERVED — P<n> (Session <X>) ─── */`) near the end of `src/index.css`.
Never edit Foundation's settings-hub / SettingsHome base styles or another phase's section. Existing
`.settings-*` / `.lookup-*` / `.admin-*` selectors may be re-used; new polish classes are yours.
Mobile-only rules use `@media (max-width: 768px)`.

## 5. Gate rule

Foundation shipped the only sanctioned effective-access changes (GC3-GC8; GC8 owner-approved
2026-07-04). **No wave session changes any route guard or nav-visibility gate.** P1's Payments page
keeps its in-component `canEditBilling` block as its ONLY barrier (verbatim). All Team/Access pages
stay `AdminRoute`. Two-click-confirm conversions (Rule 2) are UI changes, not gate changes.

## 6. Foundation artifacts the wave consumes (frozen contracts)

- `delete_demo_schema(p_id) → boolean` — RAISEs on active/ever-published/sheet-referenced (P6).
- `SETTINGS_GROUPS` + `isSettingsItemVisible` + `anySettingsChildVisible` (navItems.jsx) — the hub IA.
- `SETTINGS_REDIRECTS` (settingsRedirects.js) — permanent retired-URL map.
- `SettingsHome`'s `?gdrive=` forwarder — stays a permanent shim after P4 retargets the worker.
- The shared primitives in §1 (LookupTable / SettingsSection / SettingsPageHeader / TabLoading /
  templates module / navKeys / owner).

## 7. Close-out (every wave session)

Commit → `npm run test` + `npm run build` + `npx eslint` (changed files) → `upr-pattern-checker`
+ `settings-phase-reviewer` (money/consent-weighted where relevant) → visual check desktop+mobile
→ update `UPR-Web-Context.md` (your pre-seeded sub-header) + reconcile your roadmap checklist block
(both directions) → push `-u` → open a **ready-to-merge** PR into `dev` → **STOP** (the owner merges;
do not subscribe to / babysit / click-merge your PR).
