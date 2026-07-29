/**
 * ════════════════════════════════════════════════
 * FILE: ProviderEventOps.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows the owner which message-provider events still need attention. One
 *   button queues an exact failed event for the existing recovery worker; the
 *   other acknowledges an old failure so it stops creating daily alerts.
 *
 * WHERE IT LIVES:
 *   Route:        /dev-tools?tab=messaging&sub=events
 *   Rendered by:  src/pages/DevTools.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, @tanstack/react-query
 *   Internal:  @/components/TabLoading, @/components/ui,
 *              @/hooks/useTwoClickConfirm, @/lib/realtime, @/lib/toast
 *   Data:      reads  → message_provider_events through /api/provider-event-ops
 *              writes → message_provider_events through /api/provider-event-ops
 *
 * NOTES / GOTCHAS:
 *   - This component never receives message content or raw provider payloads.
 *   - Mark resolved uses the app-wide two-click confirmation pattern.
 *   - Window-focus refetch is disabled so minimize/resume does not move the page.
 * ════════════════════════════════════════════════
 */

import { useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import TabLoading from '@/components/TabLoading';
import { EmptyState, ErrorState, StatusPill } from '@/components/ui';
import { useTwoClickConfirm } from '@/hooks/useTwoClickConfirm';
import { getAuthHeader } from '@/lib/realtime';
import { err, ok } from '@/lib/toast';

const QUERY_KEY = ['owner', 'provider-event-ops'];

function formatTimestamp(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function readPage(offset = 0) {
  const auth = await getAuthHeader();
  const response = await fetch(`/api/provider-event-ops?offset=${offset}`, {
    headers: auth,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Provider events failed to load (${response.status})`);
  }
  return body;
}

async function runAction({ action, eventId }) {
  const auth = await getAuthHeader();
  const response = await fetch('/api/provider-event-ops', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, event_id: eventId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Provider event action failed (${response.status})`);
  }
  return body;
}

export function ProviderEventList({
  events,
  busyId,
  isResolveArmed,
  onRetry,
  onResolve,
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon="✓"
        title="No unresolved provider events"
        sub="There are no failed or overdue message events waiting for attention."
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      {events.map((event) => {
        const busy = busyId === event.id;
        const canAct = event.processing_state === 'failed';
        const armed = isResolveArmed(event.id);
        return (
          <article
            key={event.id}
            style={{
              display: 'grid',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-primary)',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 700,
                  overflowWrap: 'anywhere',
                }}>
                  {event.error_code || 'Unknown provider error'}
                </div>
                <div style={{
                  marginTop: 'var(--space-1)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                }}>
                  {event.sender_address || 'Unknown sender'}
                  {' '}
                  {event.direction === 'outbound' ? '→' : '←'}
                  {' '}
                  {event.recipient_address || 'Unknown recipient'}
                </div>
              </div>
              <StatusPill
                status={event.processing_state}
                tone={event.processing_state === 'failed' ? 'danger' : 'warning'}
                dot
              />
            </div>

            <div style={{
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-xs)',
            }}>
              <span>{event.direction || 'unknown'} {event.message_type || 'message'}</span>
              <span>{event.processing_attempts ?? 0} attempt{event.processing_attempts === 1 ? '' : 's'}</span>
              <span>{formatTimestamp(event.received_at)}</span>
            </div>

            {canAct ? (
              <div style={{
                display: 'flex',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
              }}>
                <button
                  type="button"
                  className="btn btn-secondary provider-event-action"
                  disabled={busy}
                  onClick={() => onRetry(event)}
                >
                  {busy ? 'Working…' : 'Retry'}
                </button>
                <button
                  type="button"
                  className={`btn provider-event-action ${armed ? 'btn-danger' : 'btn-secondary'}`}
                  disabled={busy}
                  onBlur={() => onResolve(event, { blur: true })}
                  onClick={() => onResolve(event)}
                >
                  {armed ? 'Confirm resolved' : 'Mark resolved'}
                </button>
              </div>
            ) : (
              <div style={{
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-xs)',
              }}>
                Waiting for the scheduled recovery worker.
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function ProviderEventOps() {
  const queryClient = useQueryClient();
  const { isArmed, arm, cancel } = useTwoClickConfirm();

  const query = useInfiniteQuery({
    queryKey: QUERY_KEY,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => readPage(pageParam),
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const events = useMemo(
    () => (query.data?.pages || []).flatMap((page) => page.events || []),
    [query.data],
  );

  const mutation = useMutation({
    mutationFn: runAction,
    onSuccess: async (result) => {
      cancel();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      if (!result.changed) {
        ok('That event was already handled.');
      } else if (result.action === 'retry') {
        ok('Event queued for recovery. No customer message was resent.');
      } else {
        ok('Event marked resolved.');
      }
    },
    onError: (error) => {
      err(error instanceof Error ? error.message : 'Provider event action failed.');
    },
  });

  const onRetry = (event) => {
    mutation.mutate({ action: 'retry', eventId: event.id });
  };

  const onResolve = (event, options = {}) => {
    if (options.blur) {
      cancel();
      return;
    }
    if (!isArmed(event.id)) {
      arm(event.id);
      return;
    }
    mutation.mutate({ action: 'resolve', eventId: event.id });
  };

  if (query.isPending) {
    return <TabLoading label="Loading provider events…" />;
  }

  return (
    <div>
      {query.error && (
        <ErrorState
          message="The provider-event queue could not be loaded."
          onRetry={() => query.refetch()}
        />
      )}
      {(!query.error || events.length > 0) && (
        <ProviderEventList
          events={events}
          busyId={mutation.isPending ? mutation.variables?.eventId : null}
          isResolveArmed={isArmed}
          onRetry={onRetry}
          onResolve={onResolve}
        />
      )}
      {query.hasNextPage && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginTop: 'var(--space-4)',
        }}>
          <button
            type="button"
            className="btn btn-secondary provider-event-action"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
