/**
 * Render + unit smoke-tests for the UX-Quality F-S2 shared UI primitives.
 * Uses renderToStaticMarkup (vitest runs in plain node — no jsdom), matching the
 * existing settingsPrimitives.render.test.jsx approach: prove each primitive mounts
 * and emits its contract (roles, labels, tones), plus unit-test the pure classifier.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Modal, IconButton, StatusPill, EmptyState, ErrorState, PageHeader, SearchInput,
} from '@/components/ui';
import { toneForStatus } from '@/components/ui/statusTone';

describe('F-S2 UI primitives render', () => {
  it('Modal renders role=dialog, aria-modal, its title and children when open', () => {
    const out = renderToStaticMarkup(
      <Modal open title="Edit job" onClose={() => {}}>
        <p>body-content</p>
      </Modal>,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toContain('Edit job');
    expect(out).toContain('body-content');
    expect(out).toContain('ui-modal-overlay');
  });

  it('Modal renders nothing when closed', () => {
    expect(renderToStaticMarkup(<Modal open={false} title="x">y</Modal>)).toBe('');
  });

  it('IconButton emits its accessible label as aria-label and title', () => {
    const out = renderToStaticMarkup(<IconButton label="Close">✕</IconButton>);
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain('title="Close"');
    expect(out).toContain('ui-icon-btn');
  });

  it('StatusPill maps a status word to the right tone and shows humanized text', () => {
    expect(renderToStaticMarkup(<StatusPill status="paid" />)).toContain('data-tone="success"');
    expect(renderToStaticMarkup(<StatusPill status="overdue" />)).toContain('data-tone="danger"');
    expect(renderToStaticMarkup(<StatusPill status="pending_review" />)).toContain('data-tone="warning"');
    const info = renderToStaticMarkup(<StatusPill status="in_progress" />);
    expect(info).toContain('data-tone="info"');
    expect(info).toContain('In Progress'); // humanized
    // explicit tone override wins
    expect(renderToStaticMarkup(<StatusPill status="paid" tone="neutral" label="X" />)).toContain('data-tone="neutral"');
  });

  it('EmptyState shows icon, title, sub and action', () => {
    const out = renderToStaticMarkup(
      <EmptyState icon="📋" title="No jobs yet" sub="Create one to start" action={<button>New</button>} />,
    );
    expect(out).toContain('No jobs yet');
    expect(out).toContain('Create one to start');
    expect(out).toContain('ui-empty-state');
    expect(out).toContain('>New<');
  });

  it('ErrorState shows the message, role=alert and a retry button', () => {
    const out = renderToStaticMarkup(<ErrorState message="Network down" onRetry={() => {}} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain('Network down');
    expect(out).toContain('Try again');
  });

  it('PageHeader renders title, subtitle and actions', () => {
    const out = renderToStaticMarkup(
      <PageHeader title="Jobs" subtitle="12 of 340" actions={<button>Add</button>} />,
    );
    expect(out).toContain('Jobs');
    expect(out).toContain('12 of 340');
    expect(out).toContain('>Add<');
  });

  it('SearchInput is a named, controlled input with the search icon', () => {
    const out = renderToStaticMarkup(<SearchInput value="" onChange={() => {}} placeholder="Find jobs" />);
    expect(out).toContain('aria-label="Find jobs"');
    expect(out).toContain('ui-search-input');
  });
});

describe('toneForStatus classifier', () => {
  it('classifies the common status vocab', () => {
    expect(toneForStatus('Paid')).toBe('success');
    expect(toneForStatus('completed')).toBe('success');
    expect(toneForStatus('overdue')).toBe('danger');
    expect(toneForStatus('failed')).toBe('danger');
    expect(toneForStatus('pending')).toBe('warning');
    expect(toneForStatus('scheduled')).toBe('info');
    expect(toneForStatus('closed')).toBe('neutral');
  });
  it('falls back to neutral for unknown/empty', () => {
    expect(toneForStatus('')).toBe('neutral');
    expect(toneForStatus(null)).toBe('neutral');
    expect(toneForStatus('wat')).toBe('neutral');
  });
  it('uses substring detection for compound statuses', () => {
    expect(toneForStatus('estimate_approved')).toBe('success');
    expect(toneForStatus('payment_declined')).toBe('danger');
  });
});
