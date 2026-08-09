/**
 * ════════════════════════════════════════════════
 * FILE: LeadStageMover.jsx  (Admin Mobile — move a lead along the board)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The row of stage buttons on a lead's screen. Whichever stage the lead is
 *   in is filled in; tapping another one moves it there straight away. It is
 *   the same sales board the office kanban drives, so a move here shows up
 *   there and the other way round.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a presentational control)
 *   Rendered by:  src/pages/tech/admin/AdminLeadDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/nativeHaptics (selection)
 *   Data:      reads → none · writes → none directly (the move is handed up)
 *
 * NOTES / GOTCHAS:
 *   - Chips, not a <select>. A native picker is two taps plus a wheel and hides
 *     where the lead currently is behind a closed control; the whole point of
 *     this screen is answering "where is it" without opening anything. The strip
 *     scrolls horizontally when there are more stages than fit.
 *   - HIGH-FREQUENCY CONTROL, so the selection is INSTANT — no sliding pill, no
 *     cross-fade (motion-standard.md §3: an instant high-frequency control is
 *     correct, not a miss). The only motion is the standard press scale, which
 *     every interactive control in this shell carries.
 *   - `busy` disables the whole strip during the write so a double tap can't
 *     queue two moves; the page still updates optimistically, so the chip fills
 *     before the round trip finishes.
 * ════════════════════════════════════════════════
 */
import { selection } from '@/lib/nativeHaptics';

export default function LeadStageMover({ stages = [], currentStageId, onMove, busy = false }) {
  if (!stages.length) return null;

  const move = (stageId) => {
    if (busy || stageId === currentStageId) return;
    selection();
    onMove(stageId);
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="am-stage-mover">
      <div className="am-stage-mover-label" id="am-stage-mover-label">Stage</div>
      <div className="am-stage-chips" role="group" aria-labelledby="am-stage-mover-label">
        {stages.map((s) => {
          const active = s.id === currentStageId;
          return (
            <button
              key={s.id}
              type="button"
              className="am-stage-chip"
              data-active={active ? 'true' : undefined}
              style={s.color ? { '--am-stage-color': s.color } : undefined}
              aria-pressed={active}
              disabled={busy}
              onClick={() => move(s.id)}
            >
              {s.name}
            </button>
          );
        })}
      </div>
      {!currentStageId && (
        <div className="am-stage-mover-hint">Not on the board yet — pick a stage to add it.</div>
      )}
    </div>
  );
}
