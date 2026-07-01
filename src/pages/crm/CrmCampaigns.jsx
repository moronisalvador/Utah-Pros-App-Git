/**
 * ════════════════════════════════════════════════
 * FILE: CrmCampaigns.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Where email campaigns get built and sent — pick a group of customers,
 *   write a subject and message, see how many people it'll reach, and send
 *   it. Anyone who's unsubscribed or asked not to be contacted is
 *   automatically skipped, never emailed.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/campaigns
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime
 *              (getAuthHeader, for the authenticated send-email-campaign call)
 *   Data:      reads  → email_campaigns (get_email_campaigns RPC),
 *                       referral_sources (get_referral_sources RPC)
 *              writes → email_campaigns (upsert_email_campaign /
 *                       delete_email_campaign RPCs); POST /api/send-email-campaign
 *                       queues + sends (email_campaign_recipients, worker_runs)
 *
 * NOTES / GOTCHAS:
 *   - Originally built into the pre-existing Marketing.jsx page (Phase 4c) —
 *     moved into the CRM shell here per owner feedback, since it was hard to
 *     discover outside the CRM sidebar. Marketing.jsx reverted to its
 *     pre-Phase-4c SMS-only stub; SMS/text-blast campaigns remain that page's
 *     job (Phase 4b) rather than living in this CRM shell.
 *   - Email campaigns use their OWN tables (email_campaigns/
 *     email_campaign_recipients), not the legacy `campaigns`/
 *     `campaign_recipients` tables Marketing.jsx's SMS tab reads — see
 *     supabase/migrations/20260701_crm_phase4c_email_campaigns.sql for why
 *     (those are hard-wired for SMS: a CHECK constraint with no
 *     'email_blast' value, and a NOT NULL `phone` column).
 *   - Segmentation is intentionally simple (referral source + role) per the
 *     roadmap's "simple template UI" scope — not a full query builder.
 *   - The message field is a real rich-text editor (RichEmailEditor —
 *     bold/italic/lists/links, insert-variable, emoji), not a raw-HTML
 *     textarea, with a live preview panel next to it rendered from the SAME
 *     branded wrapper (src/lib/emailTemplate.js) the actual send uses
 *     (functions/lib/email-template.js) — so what's shown while composing is
 *     what a recipient actually receives, not an approximation. An "AI
 *     design" button in the editor toolbar is a disabled placeholder for a
 *     planned follow-up, not built yet.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';
import { IconCampaigns } from '@/lib/crmIcons';
import RichEmailEditor from '@/components/RichEmailEditor';
import { wrapEmailBody, renderVariables, SAMPLE_VARIABLES } from '@/lib/emailTemplate';

const ok  = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));
const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

const ROLE_OPTIONS = [
  { value: '', label: 'Any role' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'property_manager', label: 'Property manager' },
];

const EMPTY_FORM = { name: '', subject: '', body_html: '', referral_source: '', role: '' };

function buildAudienceFilter(form) {
  const filter = {};
  if (form.referral_source) filter.referral_source = form.referral_source;
  if (form.role) filter.role = form.role;
  return filter;
}

function statusBadgeClass(status) {
  if (status === 'sent') return 'crm-badge-won';
  if (status === 'failed') return 'crm-badge-lost';
  if (status === 'sending') return 'crm-badge-sending';
  return 'crm-badge-draft'; // draft
}

export default function CrmCampaigns() {
  const { db, employee } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [referralSources, setReferralSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | campaign id
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [previewCount, setPreviewCount] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        db.rpc('get_email_campaigns', {}),
        db.rpc('get_referral_sources', {}).catch(() => []),
      ]);
      setCampaigns(c || []);
      setReferralSources(r || []);
    } catch {
      err('Failed to load email campaigns');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const startAdd = () => {
    setEditing('new'); setForm(EMPTY_FORM); setPreviewCount(null);
    setTimeout(() => nameRef.current?.focus(), 50);
  };
  const startEdit = (c) => {
    setEditing(c.id);
    setForm({
      name: c.name, subject: c.subject, body_html: c.body_html,
      referral_source: c.audience_filter?.referral_source || '',
      role: c.audience_filter?.role || '',
    });
    setPreviewCount(c.audience_count);
  };
  const cancelEdit = () => { setEditing(null); setForm(EMPTY_FORM); setPreviewCount(null); };

  const previewAudience = async () => {
    setPreviewing(true);
    try {
      const rows = await db.rpc('preview_email_audience', { p_filter: buildAudienceFilter(form) });
      setPreviewCount((rows || []).length);
    } catch {
      err('Failed to preview audience');
    } finally {
      setPreviewing(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.subject.trim()) { err('Name and subject are required'); return; }
    setSaving(true);
    try {
      await db.rpc('upsert_email_campaign', {
        p_id: editing === 'new' ? null : editing,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_html: form.body_html,
        p_audience_filter: buildAudienceFilter(form),
        p_created_by: employee?.id || null,
      });
      ok(editing === 'new' ? 'Campaign saved as draft' : 'Campaign updated');
      cancelEdit();
      load();
    } catch (e) {
      err(e.message || 'Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await db.rpc('delete_email_campaign', { p_id: id });
      ok('Campaign deleted');
      setConfirmDeleteId(null);
      load();
    } catch (e) {
      err(e.message || 'Failed to delete campaign');
      setConfirmDeleteId(null);
    }
  };

  const handleSend = async (id) => {
    setSendingId(id);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/send-email-campaign', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok(`Sent ${data.sent}, skipped ${data.suppressed}, failed ${data.failed}`);
      load();
    } catch (e) {
      err(e.message || 'Failed to send campaign');
    } finally {
      setSendingId(null);
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Campaigns</h1>
          <p className="crm-page-subtitle">Segment your contacts, write a message, and send — unsubscribed or Do Not Disturb contacts are skipped automatically.</p>
        </div>
        <button className="crm-btn crm-btn-primary" onClick={startAdd} disabled={editing === 'new'}>+ New email campaign</button>
      </div>

      {editing === 'new' && (
        <CampaignForm
          form={form} setForm={setForm} referralSources={referralSources}
          onSave={handleSave} onCancel={cancelEdit} saving={saving}
          onPreview={previewAudience} previewing={previewing} previewCount={previewCount}
          nameRef={nameRef} editorResetKey="new"
        />
      )}

      {campaigns.length === 0 && editing !== 'new' ? (
        <div className="crm-empty-state">
          <IconCampaigns className="crm-empty-icon" />
          <p>No email campaigns yet. Start one to reach a segment of your contacts.</p>
        </div>
      ) : (
        <div className="crm-card">
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Sent</th><th>Suppressed</th><th>Failed</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {campaigns.map(c => editing === c.id ? (
                  <tr key={c.id}><td colSpan={8} style={{ padding: 0 }}>
                    <CampaignForm
                      form={form} setForm={setForm} referralSources={referralSources}
                      onSave={handleSave} onCancel={cancelEdit} saving={saving}
                      onPreview={previewAudience} previewing={previewing} previewCount={previewCount}
                      nameRef={nameRef} editorResetKey={c.id}
                    />
                  </td></tr>
                ) : (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td><span className={`crm-badge ${statusBadgeClass(c.status)}`}>{c.status}</span></td>
                    <td className="num">{c.audience_count}</td>
                    <td className="num">{c.total_sent}</td>
                    <td className="num">{c.total_suppressed}</td>
                    <td className="num">{c.total_failed}</td>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                        {c.status === 'draft' && (
                          <>
                            <button className="crm-btn crm-btn-ghost" onClick={() => startEdit(c)}>Edit</button>
                            <button className="crm-btn crm-btn-primary" onClick={() => handleSend(c.id)} disabled={sendingId === c.id}>
                              {sendingId === c.id ? 'Sending…' : 'Send now'}
                            </button>
                          </>
                        )}
                        {['draft', 'failed'].includes(c.status) && (
                          confirmDeleteId === c.id ? (
                            <button className="crm-btn crm-btn-danger" onClick={() => handleDelete(c.id)} onBlur={() => setConfirmDeleteId(null)}>Confirm delete?</button>
                          ) : (
                            <button className="crm-btn crm-btn-ghost" onClick={() => setConfirmDeleteId(c.id)}>Delete</button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignForm({ form, setForm, referralSources, onSave, onCancel, saving, onPreview, previewing, previewCount, nameRef, editorResetKey }) {
  const previewHtml = useMemo(() => wrapEmailBody({
    bodyHtml: renderVariables(form.body_html, SAMPLE_VARIABLES),
    unsubscribeUrl: '#',
  }), [form.body_html]);

  return (
    <div className="crm-campaign-editor-layout">
      <div className="crm-card crm-campaign-form">
        <div className="crm-campaign-form-row">
          <div className="crm-campaign-field">
            <label className="crm-integration-label">Campaign name</label>
            <input ref={nameRef} className="crm-integration-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Spring reactivation" />
          </div>
          <div className="crm-campaign-field">
            <label className="crm-integration-label">Subject line</label>
            <input className="crm-integration-input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject the recipient sees" />
          </div>
        </div>

        <div className="crm-campaign-form-row">
          <div className="crm-campaign-field">
            <label className="crm-integration-label">Referral source</label>
            <select className="crm-integration-input" value={form.referral_source} onChange={e => setForm(f => ({ ...f, referral_source: e.target.value }))}>
              <option value="">Any referral source</option>
              {referralSources.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div className="crm-campaign-field">
            <label className="crm-integration-label">Contact role</label>
            <select className="crm-integration-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>

        <div className="crm-campaign-field">
          <label className="crm-integration-label">Message</label>
          <RichEmailEditor
            value={form.body_html}
            onChange={(html) => setForm(f => ({ ...f, body_html: html }))}
            placeholder="Hi {{name}}, ..."
            resetKey={editorResetKey}
          />
        </div>

        <div className="crm-campaign-form-actions">
          <button className="crm-btn crm-btn-ghost" onClick={onPreview} disabled={previewing}>
            {previewing ? 'Checking…' : 'Preview audience'}
          </button>
          {previewCount !== null && <span className="crm-campaign-audience-count">{previewCount} contact{previewCount === 1 ? '' : 's'} will receive this</span>}
          <div style={{ flex: 1 }} />
          <button className="crm-btn crm-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="crm-btn crm-btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>

      <div className="crm-card crm-email-preview">
        <div className="crm-email-preview-chrome">
          <div className="crm-email-preview-row"><span>To</span><span>Jane Smith &lt;jane.smith@example.com&gt;</span></div>
          <div className="crm-email-preview-row"><span>Subject</span><span>{form.subject || <em>(no subject yet)</em>}</span></div>
        </div>
        <iframe
          className="crm-email-preview-frame"
          title="Email preview"
          srcDoc={previewHtml}
          sandbox=""
        />
      </div>
    </div>
  );
}
