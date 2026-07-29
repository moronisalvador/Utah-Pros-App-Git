/**
 * ════════════════════════════════════════════════
 * FILE: NotificationPresentation.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets active internal admins safely edit approved bell/PWA notification
 *   copy and allowlisted destinations, preview synthetic examples, inspect
 *   audit history, and reset an override to its code-owned default.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/notification-presentation
 *   Rendered by:  src/App.jsx (SettingsLayout + AdminRoute)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/{TabLoading,settings/SettingsPageHeader,ui},
 *              @/hooks/useTwoClickConfirm,
 *              @/lib/{notificationTemplate,realtime,toast},
 *              ./NotificationPresentation.css
 *   Data:      reads/writes → /api/notification-presentation only
 *
 * NOTES / GOTCHAS:
 *   - The browser never queries the service-only tables/RPC directly.
 *   - Preview uses synthetic registry samples and cannot send a notification.
 *   - Native copy may use the same event-approved variables as PWA, but its
 *     destination remains restricted to the field-app route catalog.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TabLoading from '@/components/TabLoading';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import { EmptyState, ErrorState, StatusPill } from '@/components/ui';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { insertNotificationTemplateVariable } from '@/lib/notificationTemplate';
import { getAuthHeader } from '@/lib/realtime';
import { err, ok } from '@/lib/toast';
import './NotificationPresentation.css';

const SURFACE_LABELS = {
  bell: 'In-app bell',
  pwa_push: 'PWA push',
  native_push: 'Native iPhone',
};

function apiUrl(action, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  return `/api/notification-presentation?${query}`;
}

async function requestPresentation(path, options = {}) {
  const auth = await getAuthHeader();
  const response = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...auth,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

// eslint-disable-next-line react-refresh/only-export-components
export async function loadNotificationPresentationCatalog() {
  return requestPresentation(apiUrl('catalog'));
}

// eslint-disable-next-line react-refresh/only-export-components
export async function loadNotificationPresentationHistory(typeKey, surface) {
  return requestPresentation(apiUrl('history', { type_key: typeKey, surface }));
}

function configForSurface(surface) {
  const override = surface?.override;
  if (override?.enabled) {
    return {
      title_template: override.title_template,
      body_template: override.body_template,
      route_id: override.route_id,
      contract_version: override.contract_version,
    };
  }
  return { ...surface.default_config };
}

function sameConfig(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NotificationPreview({ surface, preview }) {
  if (!preview) {
    return (
      <div className="notif-pres-preview notif-pres-preview--empty">
        Choose Preview to validate this copy with synthetic data.
      </div>
    );
  }
  return (
    <div className={`notif-pres-preview notif-pres-preview--${surface}`}>
      <div className="notif-pres-preview-app">Utah Pros</div>
      <div className="notif-pres-preview-title">{preview.title}</div>
      <div className="notif-pres-preview-body">{preview.body}</div>
      <div className="notif-pres-preview-route">
        <span>Opens</span>
        <code>{preview.url}</code>
      </div>
    </div>
  );
}

export default function NotificationPresentation() {
  const [events, setEvents] = useState([]);
  const [selectedTypeKey, setSelectedTypeKey] = useState('');
  const [surfaceKey, setSurfaceKey] = useState('bell');
  const [draft, setDraft] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [conflict, setConflict] = useState('');
  const [pendingSelection, setPendingSelection] = useState(null);
  const [variablePickerField, setVariablePickerField] = useState('');
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const variablePickerRefs = useRef({});
  const variablePickerTriggerRefs = useRef({});
  const eventsRef = useRef([]);
  const historyRequestRef = useRef(0);
  const historyIdentityRef = useRef('');
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const selectedEvent = useMemo(
    () => events.find((event) => event.type_key === selectedTypeKey) || events[0] || null,
    [events, selectedTypeKey],
  );
  const selectedSurface = selectedEvent?.surfaces?.[surfaceKey] || null;
  const dirty = !!draft && !!baseline && !sameConfig(draft, baseline);
  const activeOverride = selectedSurface?.override?.enabled === true;
  const revision = Number(selectedSurface?.override?.revision || 0);
  const interactionLocked = saving || previewing;
  const historyTypeKey = selectedEvent?.type_key || '';
  const hasSelectedSurface = !!selectedSurface;

  const load = useCallback(async ({ initial = false } = {}) => {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const data = await loadNotificationPresentationCatalog();
      const nextEvents = data.events || [];
      eventsRef.current = nextEvents;
      setEvents(nextEvents);
      setSelectedTypeKey((current) => (
        nextEvents.some((event) => event.type_key === current)
          ? current
          : nextEvents[0]?.type_key || ''
      ));
      setLoadError('');
      setRefreshError('');
      return nextEvents;
    } catch (error) {
      console.error('Notification presentation catalog failed:', error);
      if (!eventsRef.current.length) {
        setLoadError('Notification presentation settings could not be loaded.');
      } else {
        setRefreshError('Could not refresh notification presentation settings.');
      }
      return null;
    } finally {
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load({ initial: true });
  }, [load]);

  useEffect(() => {
    if (!selectedSurface) return;
    const config = configForSurface(selectedSurface);
    setDraft(config);
    setBaseline(config);
    setPreview(null);
    setConflict('');
    setVariablePickerField('');
    cancel();
  }, [selectedTypeKey, surfaceKey, selectedSurface, cancel]);

  const loadHistory = useCallback(async () => {
    if (!historyTypeKey || !hasSelectedSurface) return;
    const identity = `${historyTypeKey}:${surfaceKey}`;
    const requestId = historyRequestRef.current + 1;
    historyRequestRef.current = requestId;
    if (historyIdentityRef.current !== identity) {
      historyIdentityRef.current = identity;
      setHistory([]);
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data = await loadNotificationPresentationHistory(historyTypeKey, surfaceKey);
      if (historyRequestRef.current !== requestId) return;
      setHistory(data.history || []);
    } catch (error) {
      if (historyRequestRef.current !== requestId) return;
      console.error('Notification presentation history failed:', error);
      setHistoryError('Audit history could not be loaded.');
    } finally {
      if (historyRequestRef.current === requestId) setHistoryLoading(false);
    }
  }, [hasSelectedSurface, historyTypeKey, surfaceKey]);

  useEffect(() => {
    loadHistory();
    return () => {
      historyRequestRef.current += 1;
    };
  }, [loadHistory]);

  useEffect(() => {
    if (!variablePickerField) return undefined;
    const closeOnPointerDown = (event) => {
      if (!variablePickerRefs.current[variablePickerField]?.contains(event.target)) {
        setVariablePickerField('');
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        const activeField = variablePickerField;
        setVariablePickerField('');
        variablePickerTriggerRefs.current[activeField]?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [variablePickerField]);

  useEffect(() => {
    if (interactionLocked) setVariablePickerField('');
  }, [interactionLocked]);

  const requestSelection = (selection) => {
    if (interactionLocked) return;
    if (dirty) {
      setPendingSelection(selection);
      return;
    }
    if (selection.typeKey) setSelectedTypeKey(selection.typeKey);
    if (selection.surface) setSurfaceKey(selection.surface);
  };

  const discardAndContinue = () => {
    const selection = pendingSelection;
    setPendingSelection(null);
    if (selection?.refresh) {
      load();
      return;
    }
    if (selection?.typeKey) setSelectedTypeKey(selection.typeKey);
    if (selection?.surface) setSurfaceKey(selection.surface);
  };

  const refreshCatalog = () => {
    if (interactionLocked) return;
    if (dirty) {
      setPendingSelection({ refresh: true });
      return;
    }
    load();
  };

  const applyMutationResult = (result) => {
    if (!result || !selectedEvent) return;
    setEvents((current) => {
      const next = current.map((event) => (
        event.type_key !== selectedEvent.type_key
          ? event
          : {
            ...event,
            surfaces: {
              ...event.surfaces,
              [surfaceKey]: {
                ...event.surfaces[surfaceKey],
                override: {
                  type_key: selectedEvent.type_key,
                  surface: surfaceKey,
                  revision: result.revision,
                  ...result.config,
                },
              },
            },
          }
      ));
      eventsRef.current = next;
      return next;
    });
  };

  const runPreview = async () => {
    if (!selectedEvent || !selectedSurface || !draft) return false;
    setPreviewing(true);
    try {
      const data = await requestPresentation('/api/notification-presentation', {
        method: 'POST',
        body: JSON.stringify({
          action: 'preview',
          type_key: selectedEvent.type_key,
          surface: surfaceKey,
          config: draft,
        }),
      });
      setPreview(data.presentation);
      setConflict('');
      return true;
    } catch (error) {
      setPreview(null);
      err(error.message);
      return false;
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!dirty || saving || !selectedEvent || !draft) return;
    setSaving(true);
    try {
      if (!await runPreview()) return;
      const data = await requestPresentation('/api/notification-presentation', {
        method: 'POST',
        body: JSON.stringify({
          action: 'save',
          type_key: selectedEvent.type_key,
          surface: surfaceKey,
          config: draft,
          expected_revision: revision,
          request_id: crypto.randomUUID(),
        }),
      });
      applyMutationResult(data.result);
      await loadHistory();
      ok('Notification presentation saved');
    } catch (error) {
      if (error.status === 409) setConflict(error.message);
      else err(error.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!activeOverride || saving || !selectedEvent) return;
    const confirmKey = `${selectedEvent.type_key}:${surfaceKey}`;
    if (!isArmed(confirmKey)) {
      arm(confirmKey);
      return;
    }
    setSaving(true);
    try {
      const data = await requestPresentation('/api/notification-presentation', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reset',
          type_key: selectedEvent.type_key,
          surface: surfaceKey,
          expected_revision: revision,
          request_id: crypto.randomUUID(),
        }),
      });
      applyMutationResult(data.result);
      await loadHistory();
      ok('Restored the code default');
      cancel();
    } catch (error) {
      if (error.status === 409) setConflict(error.message);
      else err(error.message);
    } finally {
      setSaving(false);
    }
  };

  const insertVariable = (field, key) => {
    if (interactionLocked || !selectedSurface.copy_editable || !draft) return;
    const allowedKeys = new Set(selectedSurface.variables.map((variable) => variable.key));
    if (!allowedKeys.has(key)) return;

    const templateKey = field === 'title' ? 'title_template' : 'body_template';
    const element = field === 'title' ? titleRef.current : bodyRef.current;
    const currentTemplate = draft[templateKey] || '';
    const start = element?.selectionStart ?? currentTemplate.length;
    const end = element?.selectionEnd ?? start;
    const limit = field === 'title' ? selectedSurface.limits.title : selectedSurface.limits.body;
    const insertion = insertNotificationTemplateVariable({
      template: currentTemplate,
      variableKey: key,
      allowedVariableKeys: [...allowedKeys],
      selectionStart: start,
      selectionEnd: end,
      maxLength: limit,
    });
    if (!insertion.ok) {
      err(`The ${field === 'title' ? 'title' : 'message'} is too long to add that variable.`);
      return;
    }

    setDraft((current) => ({
      ...current,
      [templateKey]: insertion.value,
    }));
    setVariablePickerField('');
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  const variablePicker = (field) => {
    if (!selectedSurface.copy_editable || selectedSurface.variables.length === 0) return null;
    const open = variablePickerField === field;
    const label = field === 'title' ? 'title' : 'message';
    const menuId = `notif-pres-${field}-variable-menu`;
    return (
      <div
        ref={(node) => {
          variablePickerRefs.current[field] = node;
        }}
        className="notif-pres-variable-picker"
      >
        <button
          ref={(node) => {
            variablePickerTriggerRefs.current[field] = node;
          }}
          type="button"
          className="btn btn-secondary btn-sm notif-pres-variable-trigger"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={interactionLocked}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVariablePickerField(open ? '' : field)}
        >
          <span aria-hidden="true">＋</span>
          Add variable
        </button>
        {open && (
          <div
            id={menuId}
            className="notif-pres-variable-menu"
            role="region"
            aria-label={`Variables available for the ${label}`}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="notif-pres-variable-menu-head">
              All values this event provides
              <span>Choose a value to insert at your cursor.</span>
            </div>
            <div className="notif-pres-variable-options">
              {selectedSurface.variables.map((variable) => (
                <button
                  key={variable.key}
                  type="button"
                  className="notif-pres-variable"
                  disabled={interactionLocked}
                  onClick={() => insertVariable(field, variable.key)}
                >
                  <span>{variable.label}</span>
                  <code>{`{{${variable.key}}}`}</code>
                  <small>Example: {variable.sample}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <TabLoading />;
  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        onRetry={refreshing ? undefined : () => load()}
        retryLabel={refreshing ? 'Trying again…' : 'Try again'}
      />
    );
  }
  if (!events.length) {
    return (
      <EmptyState
        icon="🔔"
        title="Notification presentation is unavailable"
        sub="The server catalog did not return any configurable notification events."
      />
    );
  }

  return (
    <div className="settings-subpage notif-pres-page">
      <SettingsPageHeader
        title="Notification presentation"
        subtitle="Control approved notification copy and tap destinations without changing recipients or delivery channels."
        actions={(
          <button className="btn btn-secondary" type="button" disabled={refreshing || interactionLocked} onClick={refreshCatalog}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      />

      {refreshError && (
        <div className="notif-pres-inline-alert" role="alert">
          Couldn&apos;t refresh. Your last loaded configuration is still shown.
        </div>
      )}
      {pendingSelection && (
        <div className="notif-pres-unsaved" role="alert">
          <div>
            <strong>Unsaved changes</strong>
            <span>
              {pendingSelection.refresh
                ? 'Discard this draft before refreshing?'
                : 'Discard this draft before switching?'}
            </span>
          </div>
          <div className="notif-pres-unsaved-actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setPendingSelection(null)}>
              Keep editing
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={discardAndContinue}>
              Discard &amp; continue
            </button>
          </div>
        </div>
      )}

      <div className="notif-pres-workspace">
        <aside className="notif-pres-events" aria-label="Notification events">
          <div className="notif-pres-panel-label">Events</div>
          {events.map((event) => (
            <button
              key={event.type_key}
              type="button"
              className={`notif-pres-event${selectedEvent?.type_key === event.type_key ? ' active' : ''}`}
              disabled={interactionLocked}
              onClick={() => requestSelection({ typeKey: event.type_key })}
            >
              <span className="notif-pres-event-title">{event.label}</span>
              <span className="notif-pres-event-meta">{event.category || 'General'}</span>
            </button>
          ))}
        </aside>

        <main className="notif-pres-editor">
          <div className="notif-pres-editor-head">
            <div>
              <div className="notif-pres-eyebrow">{selectedEvent.type_key}</div>
              <h2>{selectedEvent.label}</h2>
              <p>{selectedEvent.description}</p>
            </div>
            <StatusPill
              tone={activeOverride ? 'success' : 'neutral'}
              label={activeOverride ? `Custom · rev ${revision}` : 'Code default'}
              dot
            />
          </div>

          <div className="notif-pres-surfaces" role="tablist" aria-label="Notification surface">
            {Object.keys(selectedEvent.surfaces).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={surfaceKey === key}
                className={`notif-pres-surface${surfaceKey === key ? ' active' : ''}`}
                disabled={interactionLocked}
                onClick={() => requestSelection({ surface: key })}
              >
                {SURFACE_LABELS[key]}
              </button>
            ))}
          </div>

          {surfaceKey === 'native_push' && (
            <div className="notif-pres-privacy-note">
              <strong>Same approved details as PWA</strong>
              Native iPhone notifications can use this event&apos;s approved variables. Tap destinations
              remain limited to field-app routes, and each iPhone controls whether previews appear while locked.
            </div>
          )}

          {conflict && (
            <div className="notif-pres-conflict" role="alert">
              <div>
                <strong>Newer revision available</strong>
                <span>{conflict}. Your draft is still here.</span>
              </div>
              <button className="btn btn-secondary btn-sm" type="button" disabled={refreshing || interactionLocked} onClick={refreshCatalog}>
                Reload saved version
              </button>
            </div>
          )}

          <div className="notif-pres-form">
            <div className="notif-pres-field">
              <div className="notif-pres-field-head">
                <label htmlFor="notif-pres-title">Title</label>
                {variablePicker('title')}
              </div>
              <input
                id="notif-pres-title"
                ref={titleRef}
                className="input"
                value={draft?.title_template || ''}
                maxLength={selectedSurface.limits.title}
                disabled={!selectedSurface.copy_editable || interactionLocked}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  title_template: event.target.value,
                }))}
              />
              <small>{draft?.title_template?.length || 0}/{selectedSurface.limits.title}</small>
            </div>

            <div className="notif-pres-field">
              <div className="notif-pres-field-head">
                <label htmlFor="notif-pres-message">Message</label>
                {variablePicker('body')}
              </div>
              <textarea
                id="notif-pres-message"
                ref={bodyRef}
                className="input textarea notif-pres-textarea"
                value={draft?.body_template || ''}
                maxLength={selectedSurface.limits.body}
                disabled={!selectedSurface.copy_editable || interactionLocked}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  body_template: event.target.value,
                }))}
              />
              <small>{draft?.body_template?.length || 0}/{selectedSurface.limits.body}</small>
            </div>

            <label className="notif-pres-field">
              <span>Tap destination</span>
              <select
                className="input"
                value={draft?.route_id || ''}
                disabled={interactionLocked}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  route_id: event.target.value,
                }))}
              >
                {selectedSurface.routes.map((route) => (
                  <option key={route.id} value={route.id}>{route.label}</option>
                ))}
              </select>
              <small>Destinations are allowlisted route identifiers; paths and URLs cannot be entered.</small>
            </label>
          </div>

          <div className="notif-pres-actions">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={previewing || saving}
              onClick={runPreview}
            >
              {previewing ? 'Validating…' : 'Preview'}
            </button>
            <div className="notif-pres-actions-spacer" />
            {activeOverride && (
              <button
                className={`btn btn-secondary${isArmed(`${selectedEvent.type_key}:${surfaceKey}`) ? ' notif-pres-reset-armed' : ''}`}
                type="button"
                disabled={interactionLocked}
                onBlur={cancel}
                onClick={reset}
              >
                {isArmed(`${selectedEvent.type_key}:${surfaceKey}`) ? 'Confirm restore default' : 'Restore default'}
              </button>
            )}
            <button className="btn btn-primary" type="button" disabled={!dirty || interactionLocked} onClick={save}>
              {saving ? 'Saving…' : 'Save presentation'}
            </button>
          </div>
        </main>

        <aside className="notif-pres-side">
          <section className="notif-pres-side-card">
            <div className="notif-pres-panel-label">Synthetic preview</div>
            <NotificationPreview surface={surfaceKey} preview={preview} />
            <p className="notif-pres-side-note">
              Preview never loads a customer, payment, message, job, or provider record.
            </p>
          </section>

          <section className="notif-pres-side-card">
            <div className="notif-pres-panel-label">Audit history</div>
            {historyLoading && history.length === 0 ? (
              <TabLoading label="Loading history…" />
            ) : historyError && history.length === 0 ? (
              <ErrorState
                className="notif-pres-history-error"
                icon={null}
                message={historyError}
                onRetry={loadHistory}
                retryLabel="Try history again"
              />
            ) : (
              <>
                {historyLoading && (
                  <div className="notif-pres-history-status" role="status">
                    Refreshing history…
                  </div>
                )}
                {historyError && (
                  <div className="notif-pres-history-status notif-pres-history-status--error" role="alert">
                    <span>{historyError}</span>
                    <button className="btn btn-secondary btn-sm" type="button" onClick={loadHistory}>
                      Try again
                    </button>
                  </div>
                )}
                {history.length === 0 ? (
                  <div className="notif-pres-history-empty">No saved changes for this surface.</div>
                ) : (
                  <ol className="notif-pres-history">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <div>
                          <strong>{entry.action === 'reset' ? 'Restored default' : 'Saved custom copy'}</strong>
                          <span>Revision {entry.revision}</span>
                        </div>
                        <small>{entry.actor_name} · {formatDate(entry.created_at)}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
