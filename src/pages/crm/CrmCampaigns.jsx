/**
 * ════════════════════════════════════════════════
 * FILE: CrmCampaigns.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Where email campaigns get built and sent — pick a group of customers
 *   (with filters, or by checking/unchecking people one at a time from the
 *   actual list), write a subject and message, see exactly who it'll reach,
 *   and send it. Anyone who's unsubscribed or asked not to be contacted is
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
 *                       referral_sources (get_referral_sources RPC),
 *                       contacts (preview_email_audience RPC — the actual
 *                       audience list, not just a count),
 *                       email_campaign_exclusions (get_campaign_exclusions RPC)
 *              writes → email_campaigns (upsert_email_campaign /
 *                       delete_email_campaign RPCs), email_campaign_exclusions
 *                       (set_campaign_exclusions RPC); POST
 *                       /api/send-email-campaign queues + sends
 *                       (email_campaign_recipients, worker_runs)
 *
 * NOTES / GOTCHAS:
 *   - Originally built into the pre-existing Marketing.jsx page (Phase 4c) —
 *     moved into the CRM shell here per owner feedback, since it was hard to
 *     discover outside the CRM sidebar. Marketing.jsx reverted to its
 *     pre-Phase-4c SMS-only stub; SMS/text-blast campaigns remain that page's
 *     job (Phase 4b) rather than living in this CRM shell.
 *   - Email campaigns use their OWN tables (email_campaigns/
 *     email_campaign_recipients/email_campaign_exclusions), not the legacy
 *     `campaigns`/`campaign_recipients` tables Marketing.jsx's SMS tab reads
 *     — see supabase/migrations/20260701_crm_phase4c_email_campaigns.sql for
 *     why (those are hard-wired for SMS).
 *   - The audience is never a frozen snapshot before send: it's always
 *     `preview_email_audience(filter) MINUS email_campaign_exclusions`. The
 *     `excludedIds` Set (of manually-unchecked contact_ids) is NOT reset when
 *     the filter is re-run — an excluded contact stays excluded even if they
 *     temporarily drop out of view under a narrower filter, and reappears
 *     already unchecked if a later, broader filter brings them back into
 *     view. Exclusions only persist to the database on Save (via
 *     set_campaign_exclusions), and only if the audience was actually loaded
 *     this session (`audienceRows !== null`) — a quick save without ever
 *     reviewing the audience behaves exactly like before this feature (full
 *     filter match, no exclusions).
 *   - The message field is a real rich-text editor (RichEmailEditor —
 *     bold/italic/lists/links, insert-variable incl. {{phone}}, emoji), not a
 *     raw-HTML textarea, with a live preview panel next to it rendered from
 *     the SAME branded wrapper (src/lib/emailTemplate.js) the actual send
 *     uses (functions/lib/email-template.js) — so what's shown while
 *     composing is what a recipient actually receives, not an
 *     approximation. The editor's "Design with AI" button calls
 *     POST /api/crm-campaign-ai-design (handleAiDesign, in CampaignForm) —
 *     the same getAuthHeader + fetch convention as handleSend below — to
 *     rewrite body_html via Claude, styled to match the brand shell.
 *   - Mobile CSS (`.crm-campaigns-page` + `.crm-campaign-*`/`.crm-audience-*`/
 *     `.crm-editor-*`/`.crm-email-preview*` selectors) lives in a single
 *     `@media (max-width: 768px)` block in src/index.css, per CLAUDE.md rule
 *     5 — stacks the name/subject and audience-filter rows, enlarges the
 *     rich-editor toolbar's touch targets, and re-centers its popovers so
 *     they don't overflow a phone-width screen. Desktop layout is untouched.
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

const AUDIENCE_LOAD_LIMIT = 500;

const EMPTY_FORM = {
  name: '', subject: '', body_html: '',
  referral_source: '', role: '', tag: '', city: '', company: '', search: '',
};

function buildAudienceFilter(form) {
  const filter = {};
  if (form.referral_source) filter.referral_source = form.referral_source;
  if (form.role) filter.role = form.role;
  if (form.tag) filter.tag = form.tag;
  if (form.city) filter.city = form.city;
  if (form.company) filter.company = form.company;
  if (form.search) filter.search = form.search;
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
  const [sendingId, setSendingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Audience: null = never loaded this session; [] = loaded, zero matches.
  const [audienceRows, setAudienceRows] = useState(null);
  const [excludedIds, setExcludedIds] = useState(() => new Set());
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceFilterAtLoad, setAudienceFilterAtLoad] = useState(null);

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

  const resetAudience = () => {
    setAudienceRows(null);
    setExcludedIds(new Set());
    setAudienceFilterAtLoad(null);
  };

  const startAdd = () => {
    setEditing('new'); setForm(EMPTY_FORM); resetAudience();
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const startEdit = async (c) => {
    setEditing(c.id);
    setForm({
      name: c.name, subject: c.subject, body_html: c.body_html,
      referral_source: c.audience_filter?.referral_source || '',
      role: c.audience_filter?.role || '',
      tag: c.audience_filter?.tag || '',
      city: c.audience_filter?.city || '',
      company: c.audience_filter?.company || '',
      search: c.audience_filter?.search || '',
    });
    setAudienceFilterAtLoad(c.audience_filter || {});
    setAudienceLoading(true);
    try {
      const [rows, exclusions] = await Promise.all([
        db.rpc('preview_email_audience', { p_filter: c.audience_filter || {}, p_limit: AUDIENCE_LOAD_LIMIT }),
        db.rpc('get_campaign_exclusions', { p_campaign_id: c.id }).catch(() => []),
      ]);
      setAudienceRows(rows || []);
      setExcludedIds(new Set((exclusions || []).map(e => e.contact_id)));
    } catch {
      err('Failed to load this campaign\'s audience');
      setAudienceRows([]);
    } finally {
      setAudienceLoading(false);
    }
  };

  const cancelEdit = () => { setEditing(null); setForm(EMPTY_FORM); resetAudience(); };

  const loadAudience = async () => {
    setAudienceLoading(true);
    try {
      const filter = buildAudienceFilter(form);
      const rows = await db.rpc('preview_email_audience', { p_filter: filter, p_limit: AUDIENCE_LOAD_LIMIT });
      setAudienceRows(rows || []);
      setAudienceFilterAtLoad(filter);
      // excludedIds is deliberately NOT reset here — see file header NOTES.
    } catch {
      err('Failed to load audience');
    } finally {
      setAudienceLoading(false);
    }
  };

  const toggleExcluded = (contactId) => setExcludedIds(prev => {
    const next = new Set(prev);
    if (next.has(contactId)) next.delete(contactId); else next.add(contactId);
    return next;
  });

  const toggleAllVisible = () => {
    if (!audienceRows || audienceRows.length === 0) return;
    const allIncluded = audienceRows.every(r => !excludedIds.has(r.contact_id));
    setExcludedIds(prev => {
      const next = new Set(prev);
      for (const r of audienceRows) {
        if (allIncluded) next.add(r.contact_id); else next.delete(r.contact_id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.subject.trim()) { err('Name and subject are required'); return; }
    setSaving(true);
    try {
      const saved = await db.rpc('upsert_email_campaign', {
        p_id: editing === 'new' ? null : editing,
        p_name: form.name.trim(),
        p_subject: form.subject.trim(),
        p_body_html: form.body_html,
        p_audience_filter: buildAudienceFilter(form),
        p_created_by: employee?.id || null,
      });
      if (audienceRows !== null) {
        await db.rpc('set_campaign_exclusions', {
          p_campaign_id: saved.id,
          p_contact_ids: Array.from(excludedIds),
        });
      }
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

  const campaignFormProps = {
    form, setForm, referralSources, onSave: handleSave, onCancel: cancelEdit, saving,
    audienceRows, excludedIds, audienceLoading, audienceFilterAtLoad,
    onLoadAudience: loadAudience, onToggleExcluded: toggleExcluded, onToggleAllVisible: toggleAllVisible,
    nameRef,
  };

  return (
    <div className="crm-page crm-campaigns-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Campaigns</h1>
          <p className="crm-page-subtitle">Segment your contacts, write a message, and send — unsubscribed or Do Not Disturb contacts are skipped automatically.</p>
        </div>
        <button className="crm-btn crm-btn-primary" onClick={startAdd} disabled={editing === 'new'}>+ New email campaign</button>
      </div>

      {editing === 'new' && (
        <CampaignForm {...campaignFormProps} editorResetKey="new" />
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
                    <CampaignForm {...campaignFormProps} editorResetKey={c.id} />
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

function CampaignForm({
  form, setForm, referralSources, onSave, onCancel, saving, editorResetKey,
  audienceRows, excludedIds, audienceLoading, audienceFilterAtLoad,
  onLoadAudience, onToggleExcluded, onToggleAllVisible,
  nameRef,
}) {
  const previewHtml = useMemo(() => wrapEmailBody({
    bodyHtml: renderVariables(form.body_html, SAMPLE_VARIABLES),
    unsubscribeUrl: '#',
  }), [form.body_html]);

  const handleAiDesign = useCallback(async (instruction, currentHtml) => {
    const auth = await getAuthHeader();
    const res = await fetch('/api/crm-campaign-ai-design', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, subject: form.subject, body_html: currentHtml }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data.body_html;
  }, [form.subject]);

  return (
    <>
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
      </div>

      <AudiencePanel
        form={form} setForm={setForm} referralSources={referralSources}
        rows={audienceRows} excludedIds={excludedIds} loading={audienceLoading}
        filterAtLoad={audienceFilterAtLoad}
        onLoad={onLoadAudience} onToggle={onToggleExcluded} onToggleAll={onToggleAllVisible}
      />

      <div className="crm-campaign-editor-layout">
        <div className="crm-card crm-campaign-form">
          <div className="crm-campaign-field">
            <label className="crm-integration-label">Message</label>
            <RichEmailEditor
              value={form.body_html}
              onChange={(html) => setForm(f => ({ ...f, body_html: html }))}
              placeholder="Hi {{name}}, ..."
              resetKey={editorResetKey}
              onAiDesign={handleAiDesign}
            />
          </div>

          <div className="crm-campaign-form-actions">
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
    </>
  );
}

function AudiencePanel({ form, setForm, referralSources, rows, excludedIds, loading, filterAtLoad, onLoad, onToggle, onToggleAll }) {
  const filterDirty = rows !== null && JSON.stringify(buildAudienceFilter(form)) !== JSON.stringify(filterAtLoad || {});
  const includedCount = rows ? rows.filter(r => !excludedIds.has(r.contact_id)).length : 0;
  const allIncluded = rows && rows.length > 0 && rows.every(r => !excludedIds.has(r.contact_id));

  return (
    <div className="crm-card crm-audience-panel">
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
        <div className="crm-campaign-field">
          <label className="crm-integration-label">Tag</label>
          <input className="crm-integration-input" value={form.tag} onChange={e => setForm(f => ({ ...f, tag: e.target.value }))} placeholder="e.g. vip" />
        </div>
      </div>
      <div className="crm-campaign-form-row">
        <div className="crm-campaign-field">
          <label className="crm-integration-label">City</label>
          <input className="crm-integration-input" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="e.g. Salt Lake City" />
        </div>
        <div className="crm-campaign-field">
          <label className="crm-integration-label">Company</label>
          <input className="crm-integration-input" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="e.g. Acme" />
        </div>
        <div className="crm-campaign-field">
          <label className="crm-integration-label">Search (name, email, phone)</label>
          <input
            className="crm-integration-input"
            value={form.search}
            onChange={e => setForm(f => ({ ...f, search: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') onLoad(); }}
            placeholder="Search…"
          />
        </div>
      </div>

      <div className="crm-audience-toolbar">
        <button className="crm-btn crm-btn-primary" onClick={onLoad} disabled={loading}>
          {loading ? 'Loading…' : rows === null ? 'Load audience' : 'Reload audience'}
        </button>
        {rows !== null && (
          <span className="crm-audience-count">
            Sending to {includedCount} of {rows.length} contact{rows.length === 1 ? '' : 's'}
          </span>
        )}
        {filterDirty && <span className="crm-audience-dirty-hint">Filters changed — reload to see updated matches</span>}
      </div>

      {rows !== null && (
        rows.length === 0 ? (
          <div className="crm-empty-state">No contacts match these filters.</div>
        ) : (
          <>
            <div className="crm-table-wrap crm-audience-table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th className="crm-audience-checkbox-col">
                      <input type="checkbox" checked={allIncluded} onChange={onToggleAll} />
                    </th>
                    <th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Referral source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.contact_id}>
                      <td className="crm-audience-checkbox-col">
                        <input type="checkbox" checked={!excludedIds.has(r.contact_id)} onChange={() => onToggle(r.contact_id)} />
                      </td>
                      <td>{r.name || '—'}</td>
                      <td>{r.email}</td>
                      <td>{r.phone || '—'}</td>
                      <td>{r.role || '—'}</td>
                      <td>{r.referral_source || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === AUDIENCE_LOAD_LIMIT && (
              <p className="crm-audience-cap-note">Showing the first {AUDIENCE_LOAD_LIMIT} matches — narrow your filters to see more.</p>
            )}
          </>
        )
      )}
    </div>
  );
}
