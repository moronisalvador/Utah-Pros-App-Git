import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { DIV_GRADIENTS, DIV_PILL_COLORS, CLAIM_STATUS_COLORS } from './techConstants';
import { DIV_EMOJI } from '@/lib/claimUtils';
import { toast } from '@/lib/toast';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';

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
// Page
// ───────────────────────────────────────────────────────────────
export default function TechClaimDetail() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Dark gradient hero → switch status bar to light icons
  useEffect(() => {
    statusBarLight();
    return () => statusBarDark();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await db.rpc('get_claim_detail', { p_claim_id: claimId });
      if (!data?.claim) {
        setLoadError('Claim not found');
        return;
      }
      setDetail(data);
    } catch (e) {
      setLoadError(e.message || 'Failed to load claim');
      toast('Failed to load claim', 'error');
    } finally {
      setLoading(false);
    }
  }, [db, claimId]);

  useEffect(() => { load(); }, [load]);

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

      {/* Phase 2: NowNext module */}
      {/* Phase 3: Jobs tiles */}
      {/* Phase 4: Photos & Notes grouped by job */}
      {/* Phase 5: Claim details collapsed + adjuster contact */}

      {/* Silence unused-adjuster warning for Phase 1 — wired up in Phase 5 */}
      {adjuster ? null : null}
    </div>
  );
}
