/**
 * ════════════════════════════════════════════════
 * FILE: oopPricingRollout.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Names the visible rollout state of the OOP Pricing Calculator flag and
 *   builds the existing upsert RPC arguments without dropping preview or
 *   force-disable fields.
 *
 * DEPENDS ON:
 *   Packages: none
 *   Data: none — receives an already-authorized feature_flags row.
 *
 * NOTES / GOTCHAS:
 *   - force_disabled wins over enabled and dev_only_user_id.
 *   - DevTools retains dev_only_user_id when enabling globally, so it is the
 *     owner preview again if global access is later turned off.
 * ════════════════════════════════════════════════
 */

export function oopPricingRolloutState(flag, employeeId) {
  if (flag.force_disabled) return 'force_disabled';
  if (flag.enabled) return 'global';
  if (flag.dev_only_user_id === employeeId) return 'preview';
  return 'hidden';
}

export function featureFlagUpsertArgs(flag, { enabled, updatedBy }) {
  return {
    p_key: flag.key,
    p_enabled: enabled,
    p_dev_only_user_id: flag.dev_only_user_id,
    p_category: flag.category,
    p_label: flag.label,
    p_description: flag.description,
    p_updated_by: updatedBy,
    p_force_disabled: flag.force_disabled ?? false,
  };
}