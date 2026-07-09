/**
 * ════════════════════════════════════════════════
 * FILE: DeliverabilityHealth.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A read-only ops dashboard for text messaging health. It answers three
 *   questions an admin would ask when texting seems broken: "Are the texting
 *   workers actually running?", "Is our A2P sender (the thing that lets us send
 *   bulk business texts without being flagged as spam) configured?", and "Which
 *   texts failed recently, and why?" Nothing here can send a message or change a
 *   setting — it only reads and displays.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (embedded as a sub-tab, not its own route)
 *   Rendered by:  src/pages/DevTools.jsx (Messaging tab → "Deliverability" sub-tab)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              ../../functions/lib/twilio-errors.js (classifyTwilioError — the
 *              frozen error-code → label/uiClass map; import-only per
 *              sms-experience-wave-ownership.md §7/§9.5 — same file
 *              src/components/conversations/messageUtils.js already imports)
 *   Data:      reads  → worker_runs (via get_worker_runs RPC), messages (direct
 *              table read, failed/undelivered rows only), get_managed_credentials_status
 *              RPC (twilio row only — booleans/phone number, never the secret)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - No new RPC/migration ships with this component (sms-experience wave
 *     ownership §4 — Phase G ships zero schema). Worker health reuses the
 *     existing get_worker_runs RPC (DevTools' WorkersTab already calls it);
 *     failed-message visibility reads the messages table directly, the same
 *     pattern Conversations.jsx already uses for authenticated reads.
 *   - A2P/messaging-service health reuses get_managed_credentials_status()
 *     (Settings Overhaul P9) — it already returns has_messaging_service /
 *     has_account_sid / phone_number for the 'twilio' provider without ever
 *     exposing the secret value itself.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { classifyTwilioError } from '../../functions/lib/twilio-errors.js';

const SMS_WORKER_NAMES = ['twilio-webhook', 'twilio-status', 'process-scheduled'];
const FAILED_STATUSES = ['failed', 'undelivered'];
const FAILED_LOOKBACK_LIMIT = 200;

const STATUS_TONE = {
  completed: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  error:     { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  started:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
};

const UICLASS_TONE = {
  blocked:     { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  unreachable: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  carrier:     { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  config:      { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  error:       { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
};

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Pill({ children, tone }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
      background: tone.bg, color: tone.color, border: `1px solid ${tone.border}`,
      textTransform: 'uppercase', display: 'inline-block', width: 'fit-content',
    }}>{children}</span>
  );
}

/* ── Worker health: latest run + recent error rate per SMS worker ── */
function WorkerHealthSection({ db }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.rpc('get_worker_runs', { p_limit: 100 });
        setRuns(rows || []);
      } catch (e) {
        setError(e.message || 'Failed to load worker runs');
      }
    })();
  }, [db]);

  if (error) return <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>;
  if (runs === null) return <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading worker health…</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
      {SMS_WORKER_NAMES.map(name => {
        const workerRuns = runs.filter(r => r.worker_name === name);
        const latest = workerRuns[0];
        const recentErrors = workerRuns.filter(r => r.status === 'error').length;
        const tone = latest ? (STATUS_TONE[latest.status] || STATUS_TONE.started) : STATUS_TONE.error;
        return (
          <div key={name} style={{
            padding: 14, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>{name}</div>
            <div style={{ marginBottom: 8 }}>
              <Pill tone={tone}>{latest ? latest.status : 'no runs'}</Pill>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Last run: {latest ? fmtAgo(latest.started_at) : '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Errors (last {workerRuns.length || 0}): <span style={{ color: recentErrors > 0 ? '#dc2626' : 'var(--text-secondary)', fontWeight: 600 }}>{recentErrors}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── A2P / messaging-service config health (booleans only — never the secret) ── */
function A2pHealthSection({ db }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.rpc('get_managed_credentials_status', {});
        setStatus((rows || []).find(r => r.provider === 'twilio') || null);
      } catch (e) {
        setError(e.message || 'Failed to load credential status');
      }
    })();
  }, [db]);

  if (error) return <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>;
  if (status === null) return <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading A2P status…</div>;

  const rows = [
    { label: 'Twilio credential connected', ok: !!status.connected },
    { label: 'Account SID configured', ok: !!status.has_account_sid },
    { label: 'Messaging Service SID configured (A2P sender)', ok: !!status.has_messaging_service },
  ];

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ fontSize: 14 }}>{r.ok ? '✅' : '❌'}</span>
            <span style={{ color: 'var(--text-primary)' }}>{r.label}</span>
          </div>
        ))}
      </div>
      {!status.has_messaging_service && (
        <div style={{
          marginTop: 12, padding: 10, borderRadius: 'var(--radius-md)',
          background: '#fffbeb', border: '1px solid #fde68a', fontSize: 11, color: '#92400e',
        }}>
          No Messaging Service SID configured — outbound texts fall back to <code>From=&lt;long code&gt;</code>,
          not the registered A2P 10DLC sender. Configure it on <strong>/settings/integrations</strong> before
          relying on automated/bulk sends.
        </div>
      )}
      {status.phone_number && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>Sending number: {status.phone_number}</div>
      )}
    </div>
  );
}

/* ── Failed-message visibility: recent failures grouped by Twilio error code ── */
function FailedMessagesSection({ db }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.select('messages',
          `select=id,body,error_code,error_message,status,channel,created_at,conversation_id,conversations(title)` +
          `&status=in.(${FAILED_STATUSES.join(',')})&order=created_at.desc&limit=${FAILED_LOOKBACK_LIMIT}`
        );
        setMessages(rows || []);
      } catch (e) {
        setError(e.message || 'Failed to load failed messages');
      }
    })();
  }, [db]);

  if (error) return <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>;
  if (messages === null) return <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading failed messages…</div>;

  const byCode = new Map();
  for (const m of messages) {
    const cls = classifyTwilioError(m.error_code);
    const key = cls.code;
    const entry = byCode.get(key) || { ...cls, count: 0 };
    entry.count += 1;
    byCode.set(key, entry);
  }
  const summary = [...byCode.values()].sort((a, b) => b.count - a.count);

  if (messages.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
        No failed or undelivered messages in the recent window. 🎉
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {summary.map(s => (
          <Pill key={s.code} tone={UICLASS_TONE[s.uiClass] || UICLASS_TONE.error}>{s.label} · {s.count}</Pill>
        ))}
      </div>
      <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 100px', padding: '8px 16px',
          background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)',
          fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <span>Thread</span><span>Reason</span><span>Body</span><span>Time</span>
        </div>
        {messages.map((m, i) => {
          const cls = classifyTwilioError(m.error_code);
          const isExp = expanded === m.id;
          return (
            <div key={m.id}>
              <div style={{
                display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 100px', alignItems: 'center',
                padding: '9px 16px', borderBottom: i < messages.length - 1 ? '1px solid var(--border-light)' : 'none',
                background: 'var(--bg-primary)', cursor: 'pointer',
              }} onClick={() => setExpanded(isExp ? null : m.id)}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.conversations?.title || 'Unknown thread'}
                </span>
                <span><Pill tone={UICLASS_TONE[cls.uiClass] || UICLASS_TONE.error}>{cls.label}</Pill></span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(m.body || '').slice(0, 40)}{(m.body || '').length > 40 ? '…' : ''}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmtTime(m.created_at)}</span>
              </div>
              {isExp && (
                <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                  {m.body || '(empty)'}
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
                    error_code: {m.error_code || '—'} · {m.error_message || cls.label}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Top-level export ── */
export default function DeliverabilityHealth() {
  const { db } = useAuth();

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Deliverability</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
          Read-only health check for texting: workers, A2P sender config, and recent failures.
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Workers
      </div>
      <WorkerHealthSection db={db} />

      <div style={{ margin: '24px 0 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        A2P Sender
      </div>
      <A2pHealthSection db={db} />

      <div style={{ margin: '24px 0 12px', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Recent Failures
      </div>
      <FailedMessagesSection db={db} />
    </div>
  );
}
