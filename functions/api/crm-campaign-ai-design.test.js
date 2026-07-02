/**
 * ════════════════════════════════════════════════
 * FILE: crm-campaign-ai-design.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tests the one piece of "Design with AI" logic that doesn't need a live
 *   Anthropic API or Supabase session to check: whether a draft email is
 *   empty (so the AI should design from scratch) or has real content (so it
 *   should redesign what's already there).
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./crm-campaign-ai-design.js (isEmptyDraft, SCHEMA)
 *
 * NOTES / GOTCHAS:
 *   - Written before the worker file existed (test-first) — expect this to
 *     fail until crm-campaign-ai-design.js is created.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { isEmptyDraft, SCHEMA } from './crm-campaign-ai-design.js';

describe('isEmptyDraft', () => {
  it('treats undefined/null/empty string as empty', () => {
    expect(isEmptyDraft(undefined)).toBe(true);
    expect(isEmptyDraft(null)).toBe(true);
    expect(isEmptyDraft('')).toBe(true);
  });

  it('treats whitespace-only content as empty', () => {
    expect(isEmptyDraft('   \n\t  ')).toBe(true);
  });

  it('treats tags with no text content as empty', () => {
    expect(isEmptyDraft('<p></p>')).toBe(true);
    expect(isEmptyDraft('<p>   </p><div></div>')).toBe(true);
  });

  it('treats a draft with real text as non-empty', () => {
    expect(isEmptyDraft('<p>Hi {{first_name}}, thanks for choosing us.</p>')).toBe(false);
    expect(isEmptyDraft('Hi there')).toBe(false);
  });
});

describe('SCHEMA (structured-output contract)', () => {
  it('requires body_html and forbids extra properties', () => {
    expect(SCHEMA.required).toEqual(['body_html']);
    expect(SCHEMA.additionalProperties).toBe(false);
    expect(SCHEMA.properties.body_html.type).toBe('string');
  });
});
