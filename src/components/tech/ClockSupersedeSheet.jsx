/**
 * ════════════════════════════════════════════════
 * FILE: ClockSupersedeSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A red warning sheet that slides up from the bottom when a tech tries to go
 *   "On My Way" to a new job while still clocked in on another one. In the normal
 *   case it asks "you're still clocked in on {job} — clock out of it and continue?"
 *   In the stricter (office-enforced) case it tells the tech they must clock out of
 *   the other job first, with a button that jumps to that job.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bottom sheet rendered inside the clock UIs)
 *   Rendered by:  src/components/tech/TimeTracker.jsx, src/pages/tech/TechDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/clockPrecheck (jobLabel, fmtElapsed)
 *   Data:      none (pure presentational — parent owns the RPC calls)
 *
 * NOTES / GOTCHAS:
 *   - Structure mirrors PhotoNoteSheet/AddRoomSheet (fixed backdrop + slide-up,
 *     safe-area bottom padding). z-index 1050 so it sits above page content.
 *   - `precheck` null → sheet hidden. `precheck.enforce_explicit` → hard-block mode.
 *   - All buttons are >=48px tall per the tech touch-target rule.
 * ════════════════════════════════════════════════
 */
import { jobLabel, fmtElapsed } from '@/lib/clockPrecheck';

// Declared ABOVE the component that uses them (they previously sat at the foot
// of the file, which read as three no-use-before-define findings). Module-level
// constants, so hoisting them is a pure move — no behaviour change.
const primaryBtn = {
  width: '100%', minHeight: 48,
  borderRadius: 'var(--tech-radius-button)',
  fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
  // Identity swap: #dc2626 IS --danger, so this is byte-identical in light and
  // now re-tones with the theme. White on --danger is 4.83:1 — the label stays
  // AA, which is why the alarm lives on a filled button rather than in the band.
  background: 'var(--danger)', color: '#fff', border: '1px solid transparent',
  cursor: 'pointer', touchAction: 'manipulation',
};

const secondaryBtn = {
  width: '100%', minHeight: 48,
  borderRadius: 'var(--tech-radius-button)',
  fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans)',
  background: 'transparent', color: 'var(--text-primary)',
  border: '1.5px solid var(--border-color)',
  cursor: 'pointer', touchAction: 'manipulation',
};

export default function ClockSupersedeSheet({ precheck, busy, onConfirm, onCancel, onGoToJob }) {
  if (!precheck || !precheck.open_entry) return null;

  const open = precheck.open_entry;
  const hardBlock = !!precheck.enforce_explicit;
  const label = jobLabel(open);
  const elapsed = fmtElapsed(open.elapsed_minutes);
  const statusWord = open.status === 'on_site' ? 'working' : open.status === 'paused' ? 'paused' : 'en route';

  // ─── SECTION: Render ──────────────
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1050,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Still clocked in elsewhere"
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        {/* Red header band. The band's TEXT is --text-primary/--text-secondary,
            not --danger: --danger on --danger-bg is 4.41:1 in light and 3.52:1
            in dark, under the 4.5:1 floor in both. The tint and the border carry
            the alarm (both clear 3:1 as non-text), and the red primary button
            below carries the action. Precedent: TimeTracker's save-error banner. */}
        <div style={{
          background: 'var(--danger-bg)', borderBottom: '1px solid var(--danger-border)',
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          padding: '16px 18px',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
            Still clocked in
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
            You're {statusWord} on {label} · {elapsed}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px' }}>
          <div style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.4 }}>
            {hardBlock
              ? <>You must clock out of <strong>{label}</strong> before starting another job.</>
              : <>Continuing will <strong>clock you out</strong> of {label} as of now.</>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
            {hardBlock ? (
              <button
                onClick={() => onGoToJob && onGoToJob(open.appointment_id)}
                disabled={busy}
                style={primaryBtn}
              >
                Go to {label}
              </button>
            ) : (
              <button
                onClick={onConfirm}
                disabled={busy}
                style={primaryBtn}
              >
                {busy ? 'Working…' : 'Clock out & continue'}
              </button>
            )}
            <button
              onClick={onCancel}
              disabled={busy}
              style={secondaryBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
