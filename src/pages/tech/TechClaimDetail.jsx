import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_PILL_COLORS, DIV_BORDER_COLORS, CLAIM_STATUS_COLORS } from './techConstants';
import { DIV_EMOJI } from '@/lib/claimUtils';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';
import { isNativeCamera, takeNativePhoto, isUserCancelled } from '@/lib/nativeCamera';
import { impact } from '@/lib/nativeHaptics';

function openMap(address) {
  if (!address) return;
  const encoded = encodeURIComponent(address);
  const url = /iPhone|iPad/.test(navigator.userAgent)
    ? `maps://?q=${encoded}`
    : `https://maps.google.com/?q=${encoded}`;
  window.open(url);
}

function formatLossDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T12:00:00'); target.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return target.toLocaleDateString('en-US', { weekday: 'long' });
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Returns { ctxType: 'now_active'|'today'|'next', appt } or null.
// Mirrors the logic spec'd in TECH-CLAIM-DETAIL-TASK.md § "Now / Next module".
function pickNowNext(appointments, employeeId) {
  if (!appointments?.length) return null;
  const today = new Date().toISOString().split('T')[0];
  const crewHas = (a) => (a.crew || []).some(c => c.employee_id === employeeId);
  const live = ['en_route', 'in_progress', 'paused'];

  const active = appointments.find(a => live.includes(a.status) && crewHas(a));
  if (active) return { ctxType: 'now_active', appt: active };

  const todayMine = appointments.find(a =>
    a.date === today && crewHas(a) &&
    a.status !== 'completed' && a.status !== 'cancelled'
  );
  if (todayMine) return { ctxType: 'today', appt: todayMine };

  const upcoming = appointments
    .filter(a => a.date >= today && a.status !== 'completed' && a.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''));
  if (upcoming.length > 0) return { ctxType: 'next', appt: upcoming[0] };

  return null;
}

// ───────────────────────────────────────────────────────────────
// Hero — division-gradient header. Candidate for future extraction
// to components/tech/ once TechJobDetail needs the same shape.
// ───────────────────────────────────────────────────────────────
function Hero({
  division, claimNumber, insuredName, address, status, jobCount,
  lossDate, lossType, insuranceClaimNumber,
  onBack, showMenu, onMenu,
}) {
  const gradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const statusColors = CLAIM_STATUS_COLORS[status] || CLAIM_STATUS_COLORS.open;
  const emoji = DIV_EMOJI[division] || DIV_EMOJI.general;

  return (
    <div className="tech-hero" style={{ background: gradient, color: '#fff' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px var(--space-4)',
      }}>
        <button
          onClick={onBack}
          aria-label="Back to claims"
          style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center',
            minWidth: 48, minHeight: 48, WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: '#fff', color: statusColors.color,
            textTransform: 'capitalize', letterSpacing: '0.02em',
          }}>
            {status || 'open'}
          </span>
          {showMenu && (
            <button
              onClick={onMenu}
              aria-label="More actions"
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 36, minHeight: 36, borderRadius: 'var(--radius-full)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '4px var(--space-5) 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
          <span style={{
            fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)',
            color: 'rgba(255,255,255,0.72)', letterSpacing: '0.02em',
          }}>
            {claimNumber || '—'}
          </span>
        </div>

        <div style={{
          fontSize: 24, fontWeight: 700, color: '#fff',
          lineHeight: 1.2, marginBottom: 6,
        }}>
          {insuredName || 'Unknown'}
        </div>

        {address && (
          <button
            onClick={() => openMap(address)}
            style={{
              background: 'none', border: 'none', padding: 0,
              color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: 500,
              textAlign: 'left', cursor: 'pointer', textDecoration: 'underline',
              textUnderlineOffset: 3, textDecorationColor: 'rgba(255,255,255,0.4)',
              fontFamily: 'var(--font-sans)', WebkitTapHighlightColor: 'transparent',
              minHeight: 24,
            }}
          >
            {address}
          </button>
        )}

        {/* Meta row: loss date · loss type · ins# · job count */}
        <div style={{
          marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.72)',
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        }}>
          {lossDate && <span>Loss: {formatLossDate(lossDate)}</span>}
          {lossType && <><span>·</span><span style={{ textTransform: 'capitalize' }}>{lossType}</span></>}
          {insuranceClaimNumber && <><span>·</span><span style={{ fontFamily: 'var(--font-mono)' }}>Ins# {insuranceClaimNumber}</span></>}
          {jobCount > 0 && <><span>·</span><span>{jobCount} job{jobCount !== 1 ? 's' : ''}</span></>}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// ActionBar — Call · Navigate · Message
// Candidate for extraction once TechJobDetail reuses it.
// ───────────────────────────────────────────────────────────────
function ActionBar({ phone, address }) {
  const btnBase = {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 4, padding: '6px 0', minWidth: 64, minHeight: 56,
    fontFamily: 'var(--font-sans)',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
  };
  const enabledStyle = { color: 'var(--text-secondary)', cursor: 'pointer' };
  const disabledStyle = { color: 'var(--text-tertiary)', opacity: 0.45, cursor: 'not-allowed' };

  return (
    <div style={{
      display: 'flex', background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-light)', padding: '8px 0',
    }}>
      {/* Call */}
      {phone ? (
        <a href={`tel:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Call</span>
        </button>
      )}

      {/* Navigate */}
      {address ? (
        <button onClick={() => openMap(address)} style={{ ...btnBase, ...enabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Navigate</span>
        </button>
      )}

      {/* Message — TODO: switch to in-app SMS when available */}
      {phone ? (
        <a href={`sms:${phone}`} style={{ ...btnBase, ...enabledStyle, textDecoration: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </a>
      ) : (
        <button disabled style={{ ...btnBase, ...disabledStyle, background: 'none', border: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Message</span>
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// NowNextTile — context-aware "what's happening on this claim"
// Shown when the tech has live work, a today appt, or the claim
// has any upcoming appt. Hidden otherwise. Reusable on TechJobDetail.
// ───────────────────────────────────────────────────────────────
function NowNextTile({ appt, ctxType, onOpen }) {
  let label, bg, border, color;
  if (ctxType === 'now_active') {
    if (appt.status === 'en_route')         { label = 'ON MY WAY'; color = '#d97706'; bg = '#fffbeb'; border = '#fde68a'; }
    else if (appt.status === 'in_progress') { label = 'WORKING';   color = '#059669'; bg = '#ecfdf5'; border = '#a7f3d0'; }
    else                                     { label = 'PAUSED';    color = '#dc2626'; bg = '#fef2f2'; border = '#fecaca'; }
  } else if (ctxType === 'today') {
    label = 'TODAY'; color = '#2563eb'; bg = '#eff6ff'; border = '#bfdbfe';
  } else {
    label = 'NEXT'; color = 'var(--text-secondary)'; bg = 'var(--bg-secondary)'; border = 'var(--border-color)';
  }

  const time = formatTime(appt.time_start);
  const dateRel = ctxType === 'next' ? relativeDate(appt.date) : '';
  const title = appt.title || (appt.type || '').replace(/_/g, ' ') || 'Appointment';
  const crewNames = (appt.crew || []).map(c => (c.full_name || '').split(' ')[0]).filter(Boolean).join(', ');

  const headerPieces = [label];
  if (ctxType === 'next' && dateRel) headerPieces.push(dateRel);
  if (time) headerPieces.push(time);

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'relative', display: 'block', width: 'calc(100% - 2 * var(--space-4))',
        margin: '14px var(--space-4) 0', padding: '14px 44px 14px 16px',
        borderRadius: 16, border: `1px solid ${border}`, background: bg,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', minHeight: 72,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.08em' }}>
        {headerPieces.join(' · ')}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, textTransform: 'capitalize' }}>
        {title}
      </div>
      {(appt.job_number || crewNames) && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
          {[appt.job_number, crewNames && `Crew: ${crewNames}`].filter(Boolean).join(' · ')}
        </div>
      )}
      <span style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-tertiary)', display: 'flex',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}

function fileUrl(db, filePath) {
  if (!filePath) return null;
  return `${db.baseUrl}/storage/v1/object/public/${filePath}`;
}

function nextApptForJob(jobId, appointments) {
  if (!jobId || !appointments?.length) return null;
  const today = new Date().toISOString().split('T')[0];
  return appointments
    .filter(a => a.job_id === jobId && a.date >= today && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''))[0] || null;
}

// ───────────────────────────────────────────────────────────────
// JobTile — one large tile per job under the claim.
// Reusable on TechJobDetail? No — job page IS a single job.
// But the internal layout (division-bordered card + progress + next appt)
// mirrors patterns we may want on the job page's appointments section.
// ───────────────────────────────────────────────────────────────
function JobTile({ job, taskSummary, nextAppt, onOpen }) {
  const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
  const divPill = DIV_PILL_COLORS[job.division] || DIV_PILL_COLORS.water;
  const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
  const divLabel = (job.division || '').charAt(0).toUpperCase() + (job.division || '').slice(1);
  const total = taskSummary?.total || 0;
  const completed = taskSummary?.completed || 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = total > 0 && completed === total;
  const phase = (job.phase || '').replace(/_/g, ' ');
  const status = job.status || 'active';

  return (
    <button
      onClick={onOpen}
      style={{
        position: 'relative', display: 'block', width: 'calc(100% - 2 * var(--space-4))',
        margin: '10px var(--space-4) 0', padding: '14px 40px 14px 18px',
        borderRadius: 16, background: 'var(--bg-primary)',
        border: '1px solid var(--border-light)',
        borderLeft: `4px solid ${divColor}`,
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-sans)',
        WebkitTapHighlightColor: 'transparent', minHeight: 104,
        boxShadow: 'var(--tech-shadow-card)',
      }}
    >
      {/* Top row: emoji + job# + division + phase + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          {job.job_number}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{divLabel}</span>
        {phase && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: divPill.bg, color: divPill.color,
            textTransform: 'capitalize',
          }}>
            {phase}
          </span>
        )}
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
          textTransform: 'capitalize',
        }}>
          {status}
        </span>
      </div>

      {/* Progress bar — only if tasks exist */}
      {total > 0 ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Tasks</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: allDone ? '#059669' : 'var(--text-primary)' }}>
              {completed}/{total}
            </span>
          </div>
          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: allDone ? '#059669' : divColor,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No tasks yet</div>
      )}

      {/* Next appt */}
      {nextAppt && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          Next: <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {relativeDate(nextAppt.date)}{nextAppt.time_start ? ` · ${formatTime(nextAppt.time_start)}` : ''}
          </span>
        </div>
      )}

      <span style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        color: 'var(--text-tertiary)', display: 'flex',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}

// ───────────────────────────────────────────────────────────────
// PhotosGroup — one section per job. Mini header only when multi-job.
// Thumbnails sorted newest-first (caller responsibility).
// Reusable shell for TechJobDetail (single group, no header).
// ───────────────────────────────────────────────────────────────
function PhotosGroup({ job, photos, notes, isSingleJob, db, onOpenAlbum }) {
  if (photos.length === 0 && notes.length === 0) return null;
  const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
  const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
  const maxPreview = 3;
  const visible = photos.slice(0, maxPreview);
  const remaining = Math.max(0, photos.length - maxPreview);

  return (
    <div style={{ marginTop: 14 }}>
      {!isSingleJob && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          paddingBottom: 6, marginBottom: 8,
          borderBottom: `2px solid ${divColor}`,
        }}>
          <span style={{ fontSize: 14 }}>{emoji}</span>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {job.job_number}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
            · {job.division}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
            {notes.length > 0 && ` · ${notes.length} note${notes.length !== 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {visible.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onOpenAlbum(job.id, i)}
              style={{
                padding: 0, border: '1px solid var(--border-light)', borderRadius: 10,
                aspectRatio: '1', background: 'var(--bg-tertiary)', overflow: 'hidden',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              <img
                src={fileUrl(db, p.file_path)}
                alt={p.name || 'Photo'}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            </button>
          ))}
          {remaining > 0 ? (
            <button
              onClick={() => onOpenAlbum(job.id, maxPreview)}
              style={{
                padding: 0, border: '1px solid var(--border-light)', borderRadius: 10,
                aspectRatio: '1', background: 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 2,
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>+{remaining}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)' }}>more</span>
            </button>
          ) : (
            // Pad with empty cells if fewer than 4 photos so grid stays consistent
            Array.from({ length: Math.max(0, 4 - visible.length) }).map((_, i) => (
              <div key={`pad-${i}`} style={{ aspectRatio: '1' }} />
            ))
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.slice(0, 3).map(n => (
            <div key={n.id} style={{
              padding: '8px 12px', borderRadius: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-light)',
              fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4,
            }}>
              {n.description || n.name || 'Note'}
            </div>
          ))}
          {notes.length > 3 && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              +{notes.length - 3} more note{notes.length - 3 !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Lightbox — full-screen pager over one job's photos, newest-first.
// ───────────────────────────────────────────────────────────────
function Lightbox({ photos, index, onClose, onIndex, db }) {
  if (!photos || photos.length === 0 || index == null) return null;
  const current = photos[index];
  if (!current) return null;
  const canPrev = index > 0;
  const canNext = index < photos.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); onClose(); }}
        aria-label="Close album"
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
          fontSize: 22, lineHeight: 1, cursor: 'pointer',
          minWidth: 44, minHeight: 44, borderRadius: 'var(--radius-full)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>

      <div style={{
        position: 'absolute', top: 16, left: 16,
        color: '#fff', fontSize: 13, fontWeight: 600,
        background: 'rgba(0,0,0,0.35)', padding: '6px 12px', borderRadius: 'var(--radius-full)',
      }}>
        {index + 1} / {photos.length}
      </div>

      <img
        src={fileUrl(db, current.file_path)}
        alt={current.name || 'Photo'}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain',
          touchAction: 'pinch-zoom',
        }}
      />

      {canPrev && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index - 1); }}
          aria-label="Previous photo"
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {canNext && (
        <button
          onClick={e => { e.stopPropagation(); onIndex(index + 1); }}
          aria-label="Next photo"
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
            minWidth: 48, minHeight: 48, borderRadius: 'var(--radius-full)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {current.description && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20, right: 20,
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '10px 14px', borderRadius: 'var(--radius-md)',
          fontSize: 13, lineHeight: 1.4, textAlign: 'center',
        }}>
          {current.description}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────
export default function TechClaimDetail() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [detail, setDetail] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [taskSummaries, setTaskSummaries] = useState({});
  const [docs, setDocs] = useState([]);
  const [lightbox, setLightbox] = useState(null); // { jobId, index }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Add Photo / Add Note state
  const [jobPicker, setJobPicker] = useState(null); // { action: 'photo'|'note' }
  const [uploading, setUploading] = useState(false);
  const [noteJobId, setNoteJobId] = useState(null); // when set, inline note composer is open
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const fileRef = useRef(null);
  const pendingPhotoJobIdRef = useRef(null);

  // Dark gradient hero → switch status bar to light icons
  useEffect(() => {
    statusBarLight();
    return () => statusBarDark();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [data, appts] = await Promise.all([
        db.rpc('get_claim_detail', { p_claim_id: claimId }),
        db.rpc('get_claim_appointments', { p_claim_id: claimId }).catch(() => []),
      ]);
      if (!data?.claim) {
        setLoadError('Claim not found');
        return;
      }
      setDetail(data);
      setAppointments(appts || []);

      // Task summaries per job — parallel, soft-fail per-job
      const jobIds = (data.jobs || []).map(j => j.id);
      if (jobIds.length > 0) {
        const idList = jobIds.map(id => `"${id}"`).join(',');
        const [summaryEntries, docList] = await Promise.all([
          Promise.all(jobIds.map(id =>
            db.rpc('get_job_task_summary', { p_job_id: id })
              .then(s => [id, s])
              .catch(() => [id, null])
          )),
          db.select('job_documents', `job_id=in.(${idList})&order=created_at.desc`).catch(() => []),
        ]);
        setTaskSummaries(Object.fromEntries(summaryEntries));
        setDocs(docList || []);
      }
    } catch (e) {
      setLoadError(e.message || 'Failed to load claim');
      toast('Failed to load claim', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId]);

  useEffect(() => { load(); }, [load]);

  // ── Photo upload flow ──
  const uploadPhotoForJob = useCallback(async (file, jobId) => {
    if (!file || !jobId) return;
    if (file.size > 10 * 1024 * 1024) { toast('Photo is too large (max 10 MB)', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed', 'error'); return; }
    setUploading(true);
    try {
      const ts = Date.now();
      const path = `${jobId}/${ts}-${file.name}`;
      const res = await fetch(`${db.baseUrl}/storage/v1/object/job-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${db.apiKey}`, 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error('Upload failed');
      await db.rpc('insert_job_document', {
        p_job_id: jobId,
        p_name: file.name,
        p_file_path: `job-files/${path}`,
        p_mime_type: file.type,
        p_category: 'photo',
        p_uploaded_by: employee?.id || null,
        p_appointment_id: null,
      });
      impact('light');
      toast('Photo uploaded');
      load();
    } catch (err) {
      toast('Photo upload failed: ' + err.message, 'error');
    } finally {
      setUploading(false);
    }
  }, [db, employee?.id, load]);

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const jobId = pendingPhotoJobIdRef.current;
    pendingPhotoJobIdRef.current = null;
    if (file && jobId) uploadPhotoForJob(file, jobId);
  };

  const captureForJob = async (jobId) => {
    if (uploading) return;
    if (isNativeCamera()) {
      try {
        const file = await takeNativePhoto();
        if (file) await uploadPhotoForJob(file, jobId);
      } catch (err) {
        if (!isUserCancelled(err)) toast('Camera error: ' + err.message, 'error');
      }
    } else {
      pendingPhotoJobIdRef.current = jobId;
      fileRef.current?.click();
    }
  };

  const startAddPhoto = () => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast('No jobs on this claim', 'error'); return; }
    if (jobs.length === 1) captureForJob(jobs[0].id);
    else setJobPicker({ action: 'photo' });
  };

  const startAddNote = () => {
    const jobs = detail?.jobs || [];
    if (jobs.length === 0) { toast('No jobs on this claim', 'error'); return; }
    setNoteText('');
    if (jobs.length === 1) setNoteJobId(jobs[0].id);
    else setJobPicker({ action: 'note' });
  };

  const onJobPicked = (jobId) => {
    const action = jobPicker?.action;
    setJobPicker(null);
    if (action === 'photo') captureForJob(jobId);
    else if (action === 'note') { setNoteText(''); setNoteJobId(jobId); }
  };

  const saveNote = async () => {
    if (!noteJobId || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await db.rpc('insert_job_document', {
        p_job_id: noteJobId,
        p_name: 'Field note',
        p_file_path: '',
        p_mime_type: 'text/plain',
        p_category: 'note',
        p_uploaded_by: employee?.id || null,
        p_description: noteText.trim(),
        p_appointment_id: null,
      });
      toast('Note saved');
      setNoteText('');
      setNoteJobId(null);
      load();
    } catch (err) {
      toast('Failed to save note: ' + err.message, 'error');
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  if (!detail?.claim) {
    return (
      <div className="tech-page">
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            {loadError || 'Claim not found'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 20 }}>
            This claim may have been removed or is unavailable.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" onClick={() => navigate('/tech/claims')}>Back to Claims</button>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const { claim, jobs = [], contact, adjuster } = detail;
  const division = jobs[0]?.division || 'water';
  const insuredName = contact?.name || jobs[0]?.insured_name || 'Unknown';
  const phone = contact?.phone || jobs[0]?.client_phone || null;
  const address = [claim.loss_address, claim.loss_city, claim.loss_state].filter(Boolean).join(', ');
  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';
  const nowNext = pickNowNext(appointments, employee?.id);

  // Group docs by job, split into photos (cat=photo) + notes (cat=note)
  const docsByJob = {};
  for (const d of docs) {
    if (!docsByJob[d.job_id]) docsByJob[d.job_id] = { photos: [], notes: [] };
    if (d.category === 'photo') docsByJob[d.job_id].photos.push(d);
    else if (d.category === 'note') docsByJob[d.job_id].notes.push(d);
  }
  const totalPhotos = docs.filter(d => d.category === 'photo').length;
  const totalNotes = docs.filter(d => d.category === 'note').length;
  const hasAnyPhotoOrNote = totalPhotos + totalNotes > 0;

  const lightboxPhotos = lightbox ? (docsByJob[lightbox.jobId]?.photos || []) : [];

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <Hero
        division={division}
        claimNumber={claim.claim_number}
        insuredName={insuredName}
        address={address}
        status={claim.status}
        jobCount={jobs.length}
        lossDate={claim.date_of_loss}
        lossType={claim.loss_type}
        insuranceClaimNumber={claim.insurance_claim_number}
        onBack={() => navigate('/tech/claims')}
        showMenu={isAdmin}
        onMenu={() => { /* Phase 5: admin kebab menu */ }}
      />
      <ActionBar phone={phone} address={address} />

      {nowNext && (
        <NowNextTile
          appt={nowNext.appt}
          ctxType={nowNext.ctxType}
          onOpen={() => navigate(`/tech/appointment/${nowNext.appt.id}`)}
        />
      )}

      {jobs.length > 0 && (
        <>
          <div style={{
            padding: '20px var(--space-4) 0',
            fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {jobs.length === 1 ? 'Job' : `Jobs (${jobs.length})`}
          </div>
          {jobs.map(job => (
            <JobTile
              key={job.id}
              job={job}
              taskSummary={taskSummaries[job.id]}
              nextAppt={nextApptForJob(job.id, appointments)}
              onOpen={() => navigate(`/tech/jobs/${job.id}`)}
            />
          ))}
        </>
      )}

      {/* Photos & Notes — grouped by job */}
      <div style={{ padding: '22px var(--space-4) 0' }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
        }}>
          Photos & Notes{hasAnyPhotoOrNote ? ` (${totalPhotos + totalNotes})` : ''}
        </div>
        {hasAnyPhotoOrNote ? (
          jobs.map(job => {
            const g = docsByJob[job.id];
            if (!g || (g.photos.length === 0 && g.notes.length === 0)) return null;
            return (
              <PhotosGroup
                key={job.id}
                job={job}
                photos={g.photos}
                notes={g.notes}
                isSingleJob={jobs.length === 1}
                db={db}
                onOpenAlbum={(jobId, index) => setLightbox({ jobId, index })}
              />
            );
          })
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '6px 0 4px' }}>
            No photos or notes yet.
          </div>
        )}

        {/* Inline note composer — appears when a job is picked for a note */}
        {noteJobId && (
          <div style={{
            marginTop: 12, padding: 12,
            border: '1px solid var(--border-color)', borderRadius: 12,
            background: 'var(--bg-primary)',
          }}>
            {jobs.length > 1 && (
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>
                Note for <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {jobs.find(j => j.id === noteJobId)?.job_number}
                </strong>
              </div>
            )}
            <textarea
              className="input textarea"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="What do you want to note?"
              rows={3}
              autoFocus
              style={{ width: '100%', fontSize: 15, fontFamily: 'var(--font-sans)', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setNoteJobId(null); setNoteText(''); }}
                style={{
                  padding: '10px 18px', minHeight: 44, borderRadius: 10,
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)', cursor: 'pointer',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={saveNote}
                disabled={!noteText.trim() || savingNote}
                style={{
                  padding: '10px 18px', minHeight: 44, borderRadius: 10,
                  background: noteText.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: noteText.trim() ? '#fff' : 'var(--text-tertiary)',
                  border: 'none',
                  cursor: noteText.trim() && !savingNote ? 'pointer' : 'not-allowed',
                  fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  opacity: savingNote ? 0.7 : 1,
                }}
              >
                {savingNote ? 'Saving…' : 'Save note'}
              </button>
            </div>
          </div>
        )}

        {/* Action row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            onClick={startAddPhoto}
            disabled={uploading || jobs.length === 0}
            style={{
              flex: 1, minHeight: 48, borderRadius: 12,
              background: 'var(--accent)', color: '#fff', border: 'none',
              cursor: uploading ? 'wait' : 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent', opacity: uploading ? 0.7 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
            {uploading ? 'Uploading…' : 'Add Photo'}
          </button>
          <button
            onClick={startAddNote}
            disabled={jobs.length === 0 || !!noteJobId}
            style={{
              flex: 1, minHeight: 48, borderRadius: 12,
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', cursor: 'pointer',
              fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent',
              opacity: (jobs.length === 0 || noteJobId) ? 0.5 : 1,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Add Note
          </button>
        </div>
      </div>

      {/* Hidden file input for web photo picker */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {/* Job picker sheet (multi-job claims) */}
      {jobPicker && (
        <div
          onClick={() => setJobPicker(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', width: '100%',
              borderTopLeftRadius: 20, borderTopRightRadius: 20,
              padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
              maxHeight: '70vh', overflowY: 'auto',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.12)',
            }}
          >
            <div style={{
              width: 36, height: 4, background: 'var(--border-color)',
              borderRadius: 2, margin: '0 auto 12px',
            }} />
            <div style={{
              fontSize: 15, fontWeight: 700, color: 'var(--text-primary)',
              marginBottom: 10, textAlign: 'center',
            }}>
              {jobPicker.action === 'photo' ? 'Add photo to which job?' : 'Add note to which job?'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map(job => {
                const divColor = DIV_BORDER_COLORS[job.division] || '#6b7280';
                const emoji = DIV_EMOJI[job.division] || DIV_EMOJI.general;
                return (
                  <button
                    key={job.id}
                    onClick={() => onJobPicked(job.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '14px 14px', minHeight: 60,
                      borderRadius: 12, textAlign: 'left',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-light)',
                      borderLeft: `4px solid ${divColor}`,
                      cursor: 'pointer', fontFamily: 'var(--font-sans)',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        {job.job_number}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                        {job.division} · {(job.phase || '').replace(/_/g, ' ')}
                      </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setJobPicker(null)}
              style={{
                marginTop: 14, width: '100%', minHeight: 44, borderRadius: 10,
                background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Phase 5: Claim details collapsed + adjuster contact */}

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
          db={db}
        />
      )}

      {/* Silence unused-adjuster warning — wired up in Phase 5 */}
      {adjuster ? null : null}
    </div>
  );
}
