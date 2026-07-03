/**
 * ════════════════════════════════════════════════
 * FILE: Feedback.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The desktop "Send Feedback" page for office staff. Anyone logged in can
 *   report a bug or suggest an improvement: pick the type, give it a short
 *   title, optionally describe it and attach photos or a short video, then
 *   submit. It lands in the same feedback inbox the admins already review.
 *
 * WHERE IT LIVES:
 *   Route:        /feedback
 *   Rendered by:  src/App.jsx (inside the authenticated Layout shell — no
 *                 admin gate on purpose: every employee may send feedback)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext, @/lib/toast,
 *              @/components/FeedbackAttachments
 *   Data:      reads  → none
 *              writes → tech_feedback (insert_tech_feedback, with
 *                        p_source: 'desktop' and p_attachments)
 *
 * NOTES / GOTCHAS:
 *   - "Improvement" on screen maps to type 'feature' in the DB (the
 *     tech_feedback CHECK only allows 'bug' | 'feature').
 *   - p_attachments takes FeedbackAttachments' records as a real JSON array —
 *     do NOT JSON.stringify (that double-encoding is exactly the legacy bug
 *     the 20260702_feedback_media migration had to normalize away).
 *   - Submit stays disabled while any attachment is still uploading
 *     (onBusyChange) — snap-first uploads, but never a half-attached submit.
 *   - Feedback Media Phase F (docs/feedback-media-roadmap.md). The admin
 *     review surface stays AdminFeedback.jsx (Session C rebuilds it).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import FeedbackAttachments from '@/components/FeedbackAttachments';

// ─── SECTION: Constants ──────────────

const TYPES = [
  {
    key: 'bug',
    label: 'Bug Report',
    hint: 'Something is broken or wrong',
    titleLabel: "What's the problem?",
    placeholder: 'e.g. Invoice totals look wrong on the Jobs page',
  },
  {
    key: 'feature', // DB CHECK value — shown as "Improvement"
    label: 'Improvement',
    hint: 'An idea to make the app better',
    titleLabel: 'What would you like?',
    placeholder: 'e.g. Sort customers by most recent job',
  },
];

export default function Feedback() {
  const { db, employee } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [type, setType] = useState(null);          // 'bug' | 'feature'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]); // records from FeedbackAttachments
  const [uploadsBusy, setUploadsBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selected = TYPES.find(t => t.key === type);
  const canSubmit = !!type && title.trim().length >= 3 && !submitting && !uploadsBusy;

  // ─── SECTION: Event handlers ──────────────
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await db.rpc('insert_tech_feedback', {
        p_employee_id: employee.id,
        p_type: type,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_attachments: attachments, // real array — never JSON.stringify (see header)
        p_source: 'desktop',
      });
      toast('Feedback sent — thank you!');
      setType(null);
      setTitle('');
      setDescription('');
      setAttachments([]); // FeedbackAttachments drops its done tiles via value-sync
    } catch (err) {
      toast('Failed to send: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="fbm-page">
      <div className="fbm-page-header">
        <h1>Send Feedback</h1>
        <p>Spotted a bug or have an idea? It goes straight to the team.</p>
      </div>

      <div className="card fbm-form-card">
        {/* Type selector */}
        <span className="label">What kind of feedback?</span>
        <div className="fbm-type-row">
          {TYPES.map(t => (
            <button
              key={t.key}
              type="button"
              className={`fbm-type-btn${type === t.key ? ` fbm-type-${t.key} active` : ''}`}
              onClick={() => setType(t.key)}
            >
              <span className="fbm-type-label">{t.label}</span>
              <span className="fbm-type-hint">{t.hint}</span>
            </button>
          ))}
        </div>

        {/* Title */}
        <div className="form-group">
          <label className="label" htmlFor="fbm-title">{selected?.titleLabel || 'Short title'}</label>
          <input
            id="fbm-title"
            className="input"
            type="text"
            value={title}
            maxLength={120}
            placeholder={selected?.placeholder || 'Give it a short title'}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="label" htmlFor="fbm-desc">Details (optional)</label>
          <textarea
            id="fbm-desc"
            className="textarea"
            rows={5}
            value={description}
            maxLength={2000}
            placeholder={type === 'bug'
              ? 'What happened? What did you expect instead? Which page were you on?'
              : 'Any extra details…'}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {/* Attachments */}
        <div className="form-group">
          <span className="label">Photos / video (optional)</span>
          <FeedbackAttachments
            value={attachments}
            onChange={setAttachments}
            onBusyChange={setUploadsBusy}
            disabled={submitting}
          />
        </div>

        <button
          type="button"
          className="btn btn-primary fbm-submit-btn"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {submitting ? 'Sending…' : uploadsBusy ? 'Uploading attachments…' : 'Send Feedback'}
        </button>
      </div>
    </div>
  );
}
