/**
 * ════════════════════════════════════════════════
 * FILE: AiReplySuggestions.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small helper panel for the Conversations screen that offers a few ready-to-
 *   edit reply drafts based on what the customer last said. It NEVER sends
 *   anything — tapping a suggestion only drops that text into the message box for
 *   a person to read, edit, and send themselves. Think of it as a head start on
 *   the wording, not an auto-responder.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmConversations.jsx (via the shared
 *                 Conversations `replyAssist` render-prop slot)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none (pure UI; an AI-backed generator can be injected via `generate`)
 *   Data:      reads → none · writes → none (draft-only; the human sends)
 *
 * PROPS:
 *   context     — { lastMessage, contactName, leadStatus, channel } describing the
 *                 conversation the drafts are for.
 *   onUseDraft  — (text) => void. Called when a person picks a draft; the parent
 *                 drops `text` into its composer. This is the ONLY output — the
 *                 component never sends, and never touches twilio/email.
 *   generate    — OPTIONAL async (context) => string[]. Dependency-injection seam
 *                 for a future AI endpoint. When omitted, the built-in contextual
 *                 templates are used, so the component is useful with no network
 *                 and its drafts are deterministic.
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 9 (.claude/rules/crm-wave-ownership.md). Wired into
 *     CrmConversations.jsx after Phases 7 & 9 merged, through an optional
 *     `replyAssist(context, insertDraft)` render-prop on the shared Conversations
 *     inbox — the main app passes no slot, so this stays CRM-only.
 *   - Draft-only by construction: there is deliberately no send path here. When a
 *     staff SMS is eventually sent from Conversations it goes through Phase 7's
 *     call-only send-message.js path (never skip_compliance) — not this file.
 * ════════════════════════════════════════════════
 */
import { useState, useCallback } from 'react';

// ─── SECTION: Helpers ──────────────
const has = (text, words) => {
  const t = String(text || '').toLowerCase();
  return words.some(w => t.includes(w));
};

/**
 * Pure, contextual draft templates — no network, no AI key needed. Returns up to
 * three short reply drafts tailored to the last customer message and lead stage.
 * Module-private (keeps this file a single-component export for fast-refresh);
 * the offline fallback whenever no `generate` prop is injected.
 */
function buildDraftSuggestions(context = {}) {
  const { lastMessage = '', contactName = '' } = context;
  const first = String(contactName || '').trim().split(/\s+/)[0] || 'there';
  const drafts = [];

  // Emergency / active loss — restoration urgency.
  if (has(lastMessage, ['water', 'flood', 'leak', 'fire', 'smoke', 'mold', 'sewage', 'burst', 'emergency', 'damage'])) {
    drafts.push(`Hi ${first}, so sorry you're dealing with this. We can have a crew out to assess the damage today — what's the property address and the best time for us to come by?`);
  }
  // Pricing / estimate intent.
  if (has(lastMessage, ['quote', 'estimate', 'price', 'cost', 'how much', 'ballpark'])) {
    drafts.push(`Hi ${first}, happy to put together an estimate for you. The most accurate way is a quick on-site look — are you available this week for a free assessment?`);
  }
  // Scheduling.
  if (has(lastMessage, ['schedule', 'appointment', 'available', 'when can', 'time', 'tomorrow', 'today'])) {
    drafts.push(`Hi ${first}, we'd be glad to get you on the schedule. We have openings this week — what day and time works best for you?`);
  }
  // Insurance.
  if (has(lastMessage, ['insurance', 'claim', 'adjuster', 'deductible', 'policy'])) {
    drafts.push(`Hi ${first}, we work with insurance claims all the time and can coordinate directly with your adjuster. Do you have a claim number started yet, or would you like help getting that going?`);
  }

  // Always offer a friendly general follow-up so there are never zero drafts.
  drafts.push(`Hi ${first}, thanks for reaching out to Utah Pros Restoration! How can we help — and what's the best number and time to reach you?`);

  // De-duplicate and cap at three.
  return [...new Set(drafts)].slice(0, 3);
}

// ─── SECTION: Component ──────────────
export default function AiReplySuggestions({ context = {}, onUseDraft, generate }) {
  const [drafts, setDrafts] = useState(() => buildDraftSuggestions(context));
  const [loading, setLoading] = useState(false);

  const regenerate = useCallback(async () => {
    if (!generate) {
      setDrafts(buildDraftSuggestions(context));
      return;
    }
    setLoading(true);
    try {
      const out = await generate(context);
      setDrafts(Array.isArray(out) && out.length ? out.slice(0, 3) : buildDraftSuggestions(context));
    } catch {
      setDrafts(buildDraftSuggestions(context));
    } finally {
      setLoading(false);
    }
  }, [generate, context]);

  return (
    <div className="crm-reply-suggest">
      <div className="crm-reply-suggest-head">
        <span className="crm-reply-suggest-title">Suggested replies</span>
        <span className="crm-reply-suggest-note">Draft only — review before sending</span>
      </div>

      {loading ? (
        <div className="crm-note">Drafting…</div>
      ) : (
        <div className="crm-reply-suggest-list">
          {drafts.map((text, i) => (
            <button
              key={i}
              type="button"
              className="crm-reply-suggest-item"
              onClick={() => onUseDraft?.(text)}
              title="Insert this draft into the message box (does not send)"
            >
              {text}
            </button>
          ))}
        </div>
      )}

      <button type="button" className="crm-reply-suggest-refresh" onClick={regenerate} disabled={loading}>
        Refresh suggestions
      </button>
    </div>
  );
}
