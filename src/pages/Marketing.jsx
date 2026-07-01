/**
 * ════════════════════════════════════════════════
 * FILE: Marketing.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Marketing page. Two tabs: SMS blasts (still "coming soon" — blocked
 *   on Twilio carrier approval, Phase 4b) and Email campaigns (built this
 *   phase) — pick a group of customers, write a subject and message, see how
 *   many people it'll reach, and send it. Anyone who's unsubscribed or asked
 *   not to be contacted is automatically skipped, never emailed.
 *
 * WHERE IT LIVES:
 *   Route:        /marketing
 *   Rendered by:  src/App.jsx, behind <FeatureRoute flag="page:marketing">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/realtime
 *              (getAuthHeader, for the authenticated send-email-campaign call)
 *   Data:      reads  → campaigns (legacy SMS list, unchanged), email_campaigns
 *                       (get_email_campaigns RPC), referral_sources
 *                       (get_referral_sources RPC)
 *              writes → email_campaigns (upsert_email_campaign /
 *                       delete_email_campaign RPCs); POST /api/send-email-campaign
 *                       queues + sends (email_campaign_recipients, worker_runs)
 *
 * NOTES / GOTCHAS:
 *   - The SMS tab is unchanged from before this phase — still reads the
 *     pre-existing `campaigns` table and shows "coming soon" until Phase 4b.
 *   - Email campaigns use their OWN tables (email_campaigns/
 *     email_campaign_recipients), not `campaigns`/`campaign_recipients` —
 *     see supabase/migrations/20260701_crm_phase4c_email_campaigns.sql for
 *     why (the legacy tables are hard-wired for SMS: a CHECK constraint with
 *     no 'email_blast' value, and a NOT NULL `phone` column).
 *   - Segmentation is intentionally simple (referral source + role) per the
 *     roadmap's "simple template UI" scope — not a full query builder.
 *   - `page:marketing` gained a `dev_only_user_id` (Moroni) this phase so
 *     this page is previewable while still invisible to every other
 *     employee (`enabled` stays false for everyone else, unchanged).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

const ok  = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));
const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

const ROLE_OPTIONS = [
  { value: '', label: 'Any role' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'property_manager', label: 'Property manager' },
];

export default function Marketing() {
  const [tab, setTab] = useState('email');

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Marketing</h1>
          <p className="page-subtitle">Campaigns and outreach</p>
        </div>
      </div>

      <div className="marketing-tabs">
        <button className={`btn btn-sm ${tab === 'email' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('email')}>Email</button>
        <button className={`btn btn-sm ${tab === 'sms' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('sms')}>SMS</button>
      </div>

      {tab === 'email' ? <EmailCampaignsTab /> : <SmsCampaignsTab />}
    </div>
  );
}

// ─── SECTION: SMS tab (unchanged — Phase 4b still builds the real send path) ──
function SmsCampaignsTab() {
  const { db } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('campaigns', 'order=created_at.desc&select=id,name,campaign_type,status,audience_count,total_sent,total_delivered,total_replied,created_at&limit=50')
      .then(setCampaigns)
      .catch(() => setCampaigns([]))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 0 }}>
        {campaigns.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">No campaigns yet</p>
            <p className="empty-state-text">Create SMS/MMS campaigns to reach your customer base. Coming in Phase 4b (blocked on Twilio carrier approval).</p>
          </div>
        ) : (
          <table>
            <thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Replies</th><th>Created</th></tr></thead>
            <tbody>
              {campaigns.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.campaign_type || '—'}</td>
                  <td><span className={`status-badge status-${c.status === 'sent' ? 'resolved' : c.status === 'draft' ? 'waiting' : 'active'}`}>{c.status}</span></td>
                  <td>{c.total_sent ?? '—'}</td>
                  <td>{c.total_delivered ?? '—'}</td>
                  <td>{c.total_replied ?? '—'}</td>
                  <td style={{ color: 'var(--text-tertiary)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── SECTION: Email tab (Phase 4c) ────────────────────────────────────────────
const EMPTY_FORM = { name: '', subject: '', body_html: '', referral_source: '', role: '' };

function buildAudienceFilter(form) {
  const filter = {};
  if (form.referral_source) filter.referral_source = form.referral_source;
  if (form.role) filter.role = form.role;
  return filter;
}

function statusBadgeClass(status) {
  if (status === 'sent') return 'status-resolved';
  if (status === 'draft') return 'status-waiting';
  if (status === 'failed') return 'status-waiting';
  return 'status-active'; // sending
}

function EmailCampaignsTab() {
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

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div>
      <div className="marketing-section-header">
        <button className="btn btn-primary" onClick={startAdd} disabled={editing === 'new'}>+ New email campaign</button>
      </div>

      {editing === 'new' && (
        <EmailCampaignForm
          form={form} setForm={setForm} referralSources={referralSources}
          onSave={handleSave} onCancel={cancelEdit} saving={saving}
          onPreview={previewAudience} previewing={previewing} previewCount={previewCount}
          nameRef={nameRef}
        />
      )}

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {campaigns.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No email campaigns yet</p>
              <p className="empty-state-text">Segment your contacts, write a message, and send — unsubscribed or Do Not Disturb contacts are skipped automatically.</p>
            </div>
          ) : (
            <table>
              <thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Sent</th><th>Suppressed</th><th>Failed</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {campaigns.map(c => editing === c.id ? (
                  <tr key={c.id}><td colSpan={8} style={{ padding: 0 }}>
                    <EmailCampaignForm
                      form={form} setForm={setForm} referralSources={referralSources}
                      onSave={handleSave} onCancel={cancelEdit} saving={saving}
                      onPreview={previewAudience} previewing={previewing} previewCount={previewCount}
                      nameRef={nameRef}
                    />
                  </td></tr>
                ) : (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name}</td>
                    <td><span className={`status-badge ${statusBadgeClass(c.status)}`}>{c.status}</span></td>
                    <td>{c.audience_count}</td>
                    <td>{c.total_sent}</td>
                    <td>{c.total_suppressed}</td>
                    <td>{c.total_failed}</td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                        {c.status === 'draft' && (
                          <>
                            <button className="btn btn-sm btn-ghost" onClick={() => startEdit(c)}>Edit</button>
                            <button className="btn btn-sm btn-primary" onClick={() => handleSend(c.id)} disabled={sendingId === c.id}>
                              {sendingId === c.id ? 'Sending…' : 'Send now'}
                            </button>
                          </>
                        )}
                        {['draft', 'failed'].includes(c.status) && (
                          confirmDeleteId === c.id ? (
                            <button className="btn btn-sm btn-ghost" onClick={() => handleDelete(c.id)} onBlur={() => setConfirmDeleteId(null)}>Confirm delete?</button>
                          ) : (
                            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDeleteId(c.id)}>Delete</button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailCampaignForm({ form, setForm, referralSources, onSave, onCancel, saving, onPreview, previewing, previewCount, nameRef }) {
  return (
    <div className="card marketing-campaign-form">
      <div className="card-body">
        <div className="marketing-form-row">
          <div className="marketing-form-field">
            <label className="marketing-form-label">Campaign name</label>
            <input ref={nameRef} className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Spring reactivation" />
          </div>
          <div className="marketing-form-field">
            <label className="marketing-form-label">Subject line</label>
            <input className="input" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Subject the recipient sees" />
          </div>
        </div>

        <div className="marketing-form-row">
          <div className="marketing-form-field">
            <label className="marketing-form-label">Referral source</label>
            <select className="input" value={form.referral_source} onChange={e => setForm(f => ({ ...f, referral_source: e.target.value }))}>
              <option value="">Any referral source</option>
              {referralSources.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          </div>
          <div className="marketing-form-field">
            <label className="marketing-form-label">Contact role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>

        <div className="marketing-form-field">
          <label className="marketing-form-label">Message ({'{{name}}'} inserts the recipient's name)</label>
          <textarea className="input" rows={6} value={form.body_html} onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))} placeholder="<p>Hi {{name}}, ...</p>" />
        </div>

        <div className="marketing-form-actions">
          <button className="btn btn-sm btn-ghost" onClick={onPreview} disabled={previewing}>
            {previewing ? 'Checking…' : 'Preview audience'}
          </button>
          {previewCount !== null && <span className="marketing-audience-count">{previewCount} contact{previewCount === 1 ? '' : 's'} will receive this</span>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
    </div>
  );
}
