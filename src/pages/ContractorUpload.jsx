/**
 * ════════════════════════════════════════════════
 * FILE: ContractorUpload.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets a contractor safely send only the documents named in their Utah Pros Restoration request.
 *   It does not show any other contractor data or give the browser direct access to file storage.
 *   Most of the people who open this page work from a phone and many do not read English, so it
 *   offers English, Spanish and Portuguese and asks for as little reading as possible.
 *
 * WHERE IT LIVES:
 *   Route:        /contractor-upload (capability arrives in a URL fragment)
 *   Rendered by:  public route wiring in src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query, react-i18next
 *   Internal:  UI primitives, contractor-compliance API, LanguageContext, i18n engine
 *   Data:      reads  → public Contractor Compliance Worker projection
 *              writes → public Contractor Compliance upload Worker
 *
 * NOTES / GOTCHAS:
 *   - The raw token stays in the URL/form only and is never retained in browser storage.
 *   - THIS ROUTE IS OUTSIDE Layout AND TechLayout, which are the only two `upr:toast`
 *     listeners — so ok()/err() are NO-OPS here. Every message a contractor must actually see
 *     is rendered in-page in the `role="status"` region. Do not "simplify" that back to a toast.
 *   - It DOES sit inside LanguageProvider (App.jsx wraps the router), so the switcher uses
 *     useLanguage(): that orders the locale fetch before the engine switch and sets
 *     <html lang>, which a screen reader needs to pronounce Spanish and Portuguese correctly.
 *   - The file input deliberately has NO `capture` attribute. With `accept` alone iOS offers
 *     Photo Library / Take Photo / Browse; adding `capture` would force the camera and lock out
 *     anyone who already has the certificate saved as a PDF.
 *   - Coverage dates are OPTIONAL here (migration 20260819010000). A contractor who cannot find
 *     them sends the certificate anyway and a reviewer supplies them on accept; the RPC refuses
 *     to accept a non-W-9 document that still has none. One date without the other is refused,
 *     because that is a half-filled form rather than a deliberate omission.
 *   - The file is STAGED and sent on an explicit button. The previous flow uploaded on
 *     file-select and cleared the input on failure, which put the contractor in a
 *     pick-file → error → pick-file-again loop.
 * ════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, StatusPill } from '@/components/ui';
import { err, ok } from '@/lib/toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { getPublicRequest, uploadPublicDocument } from '@/components/contractor-compliance/api';
import './ContractorCompliance.css';

// Endonyms — a language name is shown in its own language, never translated.
const LANG_CHOICES = [['en', 'English'], ['es', 'Español'], ['pt', 'Português']];

const WC = 'workers_comp';
const WAIVER = 'workers_comp_waiver';

export default function ContractorUpload() {
  const { t } = useTranslation('contractor');
  const { lang, setLang } = useLanguage();
  const [token] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return fragment.get('token') || '';
  });
  const [dates, setDates] = useState({});
  const [staged, setStaged] = useState({});
  // Workers comp and the Utah exemption waiver are alternatives, not both: a
  // contractor either carries the insurance or is exempt. The request asks for
  // both so either satisfies it, but showing both as needed reads as two
  // mandatory items nobody can satisfy at once. Null until they choose.
  const [wcChoice, setWcChoice] = useState(null);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  // The token is part of the key: react-query persists for 24h, so without it a
  // second request opened on the same phone would render the FIRST request's
  // document list and expiry date.
  const request = useQuery({ queryKey: ['contractor-upload', token], queryFn: () => getPublicRequest(token), enabled: !!token, retry: false, refetchOnWindowFocus: false });

  const upload = useMutation({
    mutationFn: ({ file, documentType }) => uploadPublicDocument({
      token, documentType, file,
      effectiveDate: dates[documentType]?.effectiveDate,
      expirationDate: dates[documentType]?.expirationDate,
      taxYear: dates[documentType]?.taxYear,
    }),
    onSuccess: (_result, variables) => {
      ok(t('received'));
      setStaged((current) => ({ ...current, [variables.documentType]: null }));
      request.refetch();
    },
    // The server's message is raw English from a Worker; this audience may read
    // neither it nor English at all, so the translated line is what they see.
    onError: () => err(t('uploadFailed')),
  });

  const data = request.data || {};
  const types = useMemo(() => (Array.isArray(data.requested_types) ? data.requested_types : []), [data.requested_types]);

  const langBar = (
    <div className="contractor-lang-bar" role="group" aria-label={t('language')}>
      {LANG_CHOICES.map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={`contractor-lang-btn${lang === code ? ' is-selected' : ''}`}
          aria-pressed={lang === code}
          onClick={() => setLang(code)}
        >{label}</button>
      ))}
    </div>
  );

  // Only a FIRST load with no data is a dead link. react-query v5 keeps `data`
  // through a failed refetch, so gating on `error` alone blanked the whole page
  // when the post-upload refetch or a reconnect hiccuped.
  if (!token || (request.isError && !request.data)) {
    return <main className="contractor-upload-page">{langBar}<ErrorState message={t('linkUnavailable')} onRetry={token ? request.refetch : undefined} retryLabel={t('retry')} /></main>;
  }
  if (request.isPending) {
    return <main className="contractor-upload-page"><div className="loading-page"><div className="spinner" /><span>{t('title')}</span></div></main>;
  }

  const wcEither = types.includes(WC) && types.includes(WAIVER);
  const visibleTypes = wcEither ? types.filter((type) => (type === WC || type === WAIVER ? type === wcChoice : true)) : types;
  // The workers-comp pair is ONE thing to send, so it counts once. Without this
  // the page asks for 3 documents and is satisfied by 2.
  const remaining = wcEither ? types.length - 1 : types.length;

  function renderDoc(type) {
    const value = dates[type] || {};
    const isW9 = type === 'w9';
    const file = staged[type] || null;
    // Per-card: a shared isPending made every card say "Sending…" at once.
    const busy = upload.isPending && upload.variables?.documentType === type;
    const anyDate = Boolean(value.effectiveDate || value.expirationDate);
    const bothDates = Boolean(value.effectiveDate && value.expirationDate);
    const datesOutOfOrder = bothDates && value.effectiveDate > value.expirationDate;
    // Coverage dates are OPTIONAL: a contractor who cannot find them on their
    // certificate should still be able to send it, and a reviewer fills them in
    // on accept. Half-filled is still refused — that is a mistake, not a choice.
    const datesReady = isW9 ? !!value.taxYear : (!anyDate || (bothDates && !datesOutOfOrder));
    const canSend = Boolean(file) && datesReady && !upload.isPending;
    const setField = (field, next) => setDates((current) => ({ ...current, [type]: { ...value, [field]: next } }));
    const hintId = `contractor-hint-${type}`;
    const hint = !file ? t('needFile')
      : datesOutOfOrder ? t('datesOutOfOrder')
      : !datesReady ? (isW9 ? t('needTaxYear') : t('needDates'))
      : null;

    return (
      <div key={type} className="contractor-public-upload">
        <span className="contractor-doc-name">{t(`doc_${type}`)}</span>
        <StatusPill status="requested" label={t('requestedPill')} tone="info" />

        <label className="contractor-file-label">
          <span className="contractor-field-label">{file ? t('fileChosen') : t('chooseFile')}</span>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            disabled={upload.isPending}
            onChange={(event) => {
              const chosen = event.target.files?.[0] || null;
              setStaged((current) => ({ ...current, [type]: chosen }));
            }}
          />
        </label>
        <small>{t('fileTypes')}</small>

        {isW9 ? (
          <>
            <span className="contractor-field-label">{t('taxYear')}</span>
            <input className="input" type="number" min="2000" max="2100" inputMode="numeric" aria-label={t('taxYear')} value={value.taxYear || ''} onChange={(event) => setField('taxYear', event.target.value)} />
          </>
        ) : (
          <>
            <span className="contractor-field-label">{t('coverageStart')}</span>
            <small className="contractor-dates-optional">{t('datesOptional')}</small>
            <input className="input" type="date" aria-label={t('coverageStart')} value={value.effectiveDate || ''} onChange={(event) => setField('effectiveDate', event.target.value)} />
            <span className="contractor-field-label">{t('coverageEnd')}</span>
            <input className="input" type="date" aria-label={t('coverageEnd')} min={value.effectiveDate || undefined} value={value.expirationDate || ''} onChange={(event) => setField('expirationDate', event.target.value)} />
          </>
        )}

        {/* aria-disabled rather than disabled: a `disabled` button drops out of the
            tab order, so a keyboard or screen-reader user cannot reach it to find
            out WHY it will not send. It stays focusable and describes itself. */}
        <button
          type="button"
          className="btn btn-primary contractor-send-btn"
          aria-disabled={!canSend}
          aria-describedby={hint ? hintId : undefined}
          onClick={() => { if (canSend) upload.mutate({ file, documentType: type }); }}
        >
          {busy ? t('sending') : t('send')}
        </button>
        {hint ? <small className="contractor-send-hint" id={hintId}>{hint}</small> : null}
      </div>
    );
  }

  return (
    <main className="contractor-upload-page">
      <section className="card contractor-upload-card">
        {langBar}
        <p className="contractor-upload-brand">Utah Pros Restoration</p>
        <h1>{t('title')}</h1>
        <p>{t('intro')}</p>
        {data.expires_at ? <p className="contractor-muted">{t('expires', { date: new Date(data.expires_at).toLocaleDateString(lang) })}</p> : null}
        {remaining ? <p className="contractor-progress">{t('remaining', { count: remaining })}</p> : null}

        {/* The ONLY place a contractor learns whether the send worked — toasts do
            not exist on this route. Always mounted so the region is announced. */}
        <p className="contractor-inline-notice" role="status" aria-live="polite">
          {upload.isSuccess ? t('received') : upload.isError ? t('uploadFailed') : ''}
        </p>

        {types.length ? (
          <div className="contractor-public-types">
            {wcEither ? (
              <div className="contractor-public-upload contractor-wc-choice">
                <span className="contractor-doc-name">{t('wcTitle')}</span>
                <StatusPill status="requested" label={wcChoice ? t('requestedPill') : t('wcChooseOne')} tone="info" />
                <p className="contractor-wc-help">{t('wcHelp')}</p>
                <button type="button" className={`contractor-wc-option${wcChoice === WC ? ' is-selected' : ''}`} aria-pressed={wcChoice === WC} onClick={() => setWcChoice(WC)}>{t('wcHasInsurance')}</button>
                <button type="button" className={`contractor-wc-option${wcChoice === WAIVER ? ' is-selected' : ''}`} aria-pressed={wcChoice === WAIVER} onClick={() => setWcChoice(WAIVER)}>{t('wcExempt')}</button>
              </div>
            ) : null}
            {visibleTypes.map(renderDoc)}
          </div>
        ) : (
          <EmptyState icon="✓" title={t('allDone')} sub="" />
        )}

        <p className="contractor-upload-privacy">{t('privacy')}</p>
      </section>
    </main>
  );
}
