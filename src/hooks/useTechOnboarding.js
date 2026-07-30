/**
 * ════════════════════════════════════════════════
 * FILE: useTechOnboarding.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The tech shell's one gatekeeper for the first-run welcome tour. It answers
 *   "should this employee see the tour right now?" — instantly from the local
 *   note when possible, otherwise by asking the database once — and records
 *   completion when the tour finishes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (hook)
 *   Rendered by:  used by src/components/TechLayout.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/techOnboarding (dynamically imported — see NOTES)
 *   Data:      reads  → employee_onboarding_state via
 *                       get_my_onboarding_version_seen
 *              writes → employee_onboarding_state via ack_my_onboarding_seen
 *
 * NOTES / GOTCHAS:
 *   - Fails closed on any error (offline, migration not yet applied, chunk
 *     fetch failure): the tour stays hidden and is re-evaluated on a later
 *     launch. It can never flash over a veteran's screen by accident.
 *   - The gate lib is imported dynamically so this hook adds almost nothing
 *     to the entry graph — perf-budget.md has boot JS over target already,
 *     and the decision itself is async anyway (a server read).
 *   - No visibility/focus listeners — the decision keys only on the stable db
 *     client + employee id, so a minimize/resume re-runs nothing
 *     (page-lifecycle.md).
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useState } from 'react';

export function useTechOnboarding({ db, employee }) {
  const [show, setShow] = useState(false);
  const employeeId = employee?.id || null;

  useEffect(() => {
    if (!db || !employeeId) return undefined;
    let cancelled = false;

    (async () => {
      let lib;
      try {
        lib = await import('@/lib/techOnboarding');
      } catch {
        return; // chunk fetch failed (offline boot) — fail closed
      }
      if (cancelled) return;

      if (lib.mirrorShowsSeen(employeeId)) {
        // Already seen on this device. If that completion was recorded
        // offline, quietly retry the server acknowledgement so a future
        // re-install or second device still honours it.
        void lib.resyncTechOnboardingAck(db, employeeId);
        return;
      }

      try {
        const seen = await lib.fetchTechOnboardingVersionSeen(db);
        if (cancelled) return;
        if (seen >= lib.TECH_ONBOARDING_VERSION) {
          lib.writeTechOnboardingMirror({
            employeeId,
            version: seen,
            synced: true,
          });
        } else {
          setShow(true);
        }
      } catch {
        // Fail closed: offline or the RPC isn't live yet — never show the
        // tour on an unproven answer; the next launch re-evaluates.
      }
    })();

    return () => { cancelled = true; };
  }, [db, employeeId]);

  const complete = useCallback(() => {
    setShow(false);
    if (!db || !employeeId) return;
    void import('@/lib/techOnboarding')
      .then((lib) => lib.ackTechOnboardingSeen(db, employeeId))
      .catch(() => {});
  }, [db, employeeId]);

  return { show, complete };
}
