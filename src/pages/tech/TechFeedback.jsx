/**
 * ════════════════════════════════════════════════
 * FILE: TechFeedback.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The field-tech form for reporting a bug or suggesting an improvement. Pick
 *   "Bug" or "Improvement", type a short title and optional details, and snap
 *   photos or one short video — each attachment uploads the moment it's picked
 *   (big photos are shrunk first), so nothing blocks the snap→save flow.
 *   Submitting sends it to the office feedback inbox and bounces back to the
 *   tech dashboard.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/feedback
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/contexts/AuthContext, @/lib/toast, @/lib/api,
 *              @/components/FeedbackAttachments
 *   Data:      All access goes through the db client from useAuth.
 *              reads  → none
 *              writes → tech_feedback (insert_tech_feedback, p_source:'tech',
 *                        p_attachments as a real JSON array)
 *                        + job-files storage bucket (the composer uploads
 *                          under feedback/… and DELETEs on remove)
 *
 * NOTES / GOTCHAS:
 *   - "Improvement" on screen maps to type 'feature' in the DB (the
 *     tech_feedback CHECK only allows 'bug' | 'feature').
 *   - p_attachments takes FeedbackAttachments' records as a REAL JSON array —
 *     never JSON.stringify (that double-encoding is the legacy bug the
 *     20260702_feedback_media migration had to normalize away).
 *   - Submit stays disabled while any attachment is still uploading OR being
 *     removed (onBusyChange) — snap-first, but never a half-attached submit.
 *   - After a successful submit we notify admins fire-and-forget via
 *     /api/feedback-notify; the success toast NEVER depends on it (push reaches
 *     nobody until APNs env + device tokens exist — the in-app bell works now).
 *   - The composer's reset contract: `value` seeds tiles on MOUNT ONLY. We
 *     don't need to remount here because we navigate away on success.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { api } from '@/lib/api';
import FeedbackAttachments from '@/components/FeedbackAttachments';

// ─── SECTION: Constants ──────────────
const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'var(--font-sans)',
};

const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export default function TechFeedback() {
  const navigate = useNavigate();
  const { employee, db } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [type, setType] = useState(null);            // 'bug' | 'feature'
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]); // records from FeedbackAttachments
  const [uploadsBusy, setUploadsBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = !!type && title.trim().length >= 3 && !submitting && !uploadsBusy;

  // ─── SECTION: Event handlers ──────────────
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const row = await db.rpc('insert_tech_feedback', {
        p_employee_id: employee.id,
        p_type: type,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_attachments: attachments, // real array — never JSON.stringify (see header)
        p_source: 'tech',
      });
      // Fire-and-forget: tell the admins. The submit is already saved; a
      // failure here must never surface to the tech (swallowed catch).
      const feedbackId = row?.id;
      if (feedbackId) api('feedback-notify', { body: { feedback_id: feedbackId } }).catch(() => {});
      toast('Feedback submitted — thank you!');
      navigate('/tech');
    } catch (err) {
      toast('Failed to submit: ' + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="tech-page" style={{ padding: 'var(--space-4)', paddingBottom: 'calc(var(--tech-nav-height) + 40px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate('/tech')}
          aria-label="Back to dashboard"
          style={{
            width: 48, height: 48, borderRadius: 'var(--tech-radius-button)',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, touchAction: 'manipulation',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <div style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Send Feedback
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Report a bug or suggest an improvement
          </div>
        </div>
      </div>

      {/* Type selector — two big tap targets */}
      <div style={{ ...labelStyle, marginBottom: 10 }}>What type of feedback?</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => setType('bug')}
          style={{
            height: 80, borderRadius: 'var(--tech-radius-card)',
            border: `2px solid ${type === 'bug' ? '#dc2626' : 'var(--border-color)'}`,
            background: type === 'bug' ? '#fef2f2' : 'var(--bg-primary)',
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            touchAction: 'manipulation', transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={type === 'bug' ? '#dc2626' : 'var(--text-tertiary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span style={{
            fontSize: 15, fontWeight: 700,
            color: type === 'bug' ? '#dc2626' : 'var(--text-secondary)',
          }}>
            Bug Report
          </span>
        </button>

        <button
          onClick={() => setType('feature')}
          style={{
            height: 80, borderRadius: 'var(--tech-radius-card)',
            border: `2px solid ${type === 'feature' ? '#2563eb' : 'var(--border-color)'}`,
            background: type === 'feature' ? '#eff6ff' : 'var(--bg-primary)',
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            touchAction: 'manipulation', transition: 'border-color 0.15s, background 0.15s',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={type === 'feature' ? '#2563eb' : 'var(--text-tertiary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span style={{
            fontSize: 15, fontWeight: 700,
            color: type === 'feature' ? '#2563eb' : 'var(--text-secondary)',
          }}>
            Improvement
          </span>
        </button>
      </div>

      {/* Title */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>
          {type === 'bug' ? "What's the problem?" : type === 'feature' ? "What would you like?" : 'Short title'}
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={type === 'bug' ? 'e.g. Photos not saving' : type === 'feature' ? 'e.g. Sort customers by recent job' : 'Give it a short title'}
          maxLength={120}
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Details (optional)</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={type === 'bug' ? 'What happened? What did you expect?' : 'Any extra details...'}
          maxLength={2000}
          rows={4}
          style={{
            ...inputStyle,
            height: 'auto', padding: '12px 14px',
            resize: 'vertical', minHeight: 100,
            lineHeight: 1.5,
          }}
        />
      </div>

      {/* Attachments — snap-first shared composer (photos + one short video) */}
      <div style={{ marginBottom: 28 }}>
        <label style={labelStyle}>Photos / video (optional)</label>
        <FeedbackAttachments
          value={attachments}
          onChange={setAttachments}
          onBusyChange={setUploadsBusy}
          disabled={submitting}
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          width: '100%', height: 56, borderRadius: 'var(--tech-radius-button)',
          background: canSubmit ? 'var(--accent)' : 'var(--bg-tertiary)',
          color: canSubmit ? '#fff' : 'var(--text-tertiary)',
          border: 'none', fontSize: 17, fontWeight: 700,
          cursor: canSubmit ? 'pointer' : 'default',
          fontFamily: 'var(--font-sans)', touchAction: 'manipulation',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {submitting ? 'Sending...' : uploadsBusy ? 'Uploading attachments...' : 'Submit Feedback'}
      </button>
    </div>
  );
}
