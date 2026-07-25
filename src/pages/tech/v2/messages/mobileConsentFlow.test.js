/**
 * Fail-closed SMS consent and mobile affordance contracts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));

import { isServiceSmsBlocked } from './useServiceSmsConsent';

const threadSource = readFileSync(fileURLToPath(new URL('./ThreadView.jsx', import.meta.url)), 'utf8');
const composerSource = readFileSync(fileURLToPath(new URL('./Composer.jsx', import.meta.url)), 'utf8');
const pageSource = readFileSync(fileURLToPath(new URL('../TechMessagesV2.jsx', import.meta.url)), 'utf8');
const css = readFileSync(fileURLToPath(new URL('../../../../index.css', import.meta.url)), 'utf8');

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

describe('Tech Messages v2 service consent', () => {
  it('fails closed for direct SMS while loading, unavailable, missing, or DND', () => {
    expect(isServiceSmsBlocked({ status: { loading: true } })).toBe(true);
    expect(isServiceSmsBlocked({ status: { error: 'offline' } })).toBe(true);
    expect(isServiceSmsBlocked({ status: { allowed: false } })).toBe(true);
    expect(isServiceSmsBlocked({ status: { allowed: true }, dnd: true })).toBe(true);
    expect(isServiceSmsBlocked({ status: { allowed: true } })).toBe(false);
  });

  it('keeps group handling at the server per-recipient gate', () => {
    expect(isServiceSmsBlocked({
      status: { loading: true, allowed: false },
      isMulti: true,
      dnd: true,
    })).toBe(false);
  });

  it('records permission without automatically sending or retrying', () => {
    expect(threadSource).toContain('recordConsent(record)');
    expect(threadSource).toContain('setConsentPromptOpen(false)');
    expect(threadSource).not.toMatch(/onRecorded=[\s\S]{0,180}\b(send|retry)\s*\(/);
  });

  it('permits internal notes while SMS is blocked', () => {
    expect(composerSource).toContain('const blockedOutbound = !isNote &&');
    expect(composerSource).toContain('smsBlocked');
  });
});

describe('Tech Messages v2 new-conversation navigation and touch targets', () => {
  it('uses URL state and replaces the picker with the started thread', () => {
    expect(pageSource).toContain("searchParams.get('new') === '1'");
    expect(pageSource).toContain("next.set('new', '1')");
    expect(pageSource).toContain("next.delete('new')");
    expect(pageSource).toContain('setSearchParams(next, { replace: true })');
  });

  it('keeps primary picker and consent controls at the 48px field-tech floor', () => {
    expect(declarationsFor('.tv2-msgs-new-btn')).toContain('width: 48px');
    expect(declarationsFor('.tv2-msgs-new-btn')).toContain('height: 48px');
    expect(declarationsFor('.tv2-msgs-new__contact')).toContain('min-height: 68px');
    expect(css).toContain('.tv2-msgs-consent-banner button');
    expect(css).toContain('min-height: 48px');
  });
});
