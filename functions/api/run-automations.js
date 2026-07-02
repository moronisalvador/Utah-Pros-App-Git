// Phase 4d — fixed automations worker. Stub committed test-first; body follows.
export const AUTOMATION_EVENT_TYPES = {};
export const AUTOMATION_CHANNELS = {};
export function isStale() { return false; }
export function isFreshInboundLead() { return false; }
export function isMissedCall() { return false; }
export function isJobCompletion() { return false; }
export async function runSpeedToLead() { return 0; }
export async function runMissedCallTextback() { return 0; }
export async function runNoResponseFollowup() { return 0; }
export async function runReviewRequest() { return 0; }
export async function runAutomations() { return { ok: false }; }
