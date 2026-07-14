// Unit tests for the pure helpers behind the upr_code_context tool.
// Written test-first (per the UPR build loop) for the bits most likely to break
// silently: tokenization (camel/snake/kebab splitting), synonym expansion (the
// domain-vocabulary layer), scoring (literal hits must outrank synonym hits),
// and the end-to-end search over a small injected index (shape + token budget).

import { describe, it, expect } from 'vitest';
import {
  tokenize, expandTokens, scoreEntry, searchCodeContext, SYNONYM_CLUSTERS,
} from './codeContext.js';
import { INDEX } from './codeIndex.js';

describe('tokenize (identifier / phrase → keyword tokens)', () => {
  it('splits camelCase', () => {
    expect(tokenize('InvoiceEditor')).toEqual(['invoice', 'editor']);
  });

  it('splits snake_case and kebab-case and paths', () => {
    // The runtime tokenizer keeps 'api'/'js' (those are build-index-only stopwords);
    // its job is to split a user's query, not to prune index noise.
    expect(tokenize('qbo-payments-sync')).toEqual(['qbo', 'payments', 'sync']);
    expect(tokenize('convert_estimate_to_invoice')).toEqual(
      ['convert', 'estimate', 'invoice'], // "to" is a stopword
    );
  });

  it('drops stopwords and 1-char tokens', () => {
    expect(tokenize('the a invoice')).toEqual(['invoice']);
  });

  it('returns [] for empty / nullish input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe('expandTokens (business-vocabulary synonym expansion)', () => {
  it('keeps the user tokens as primary and adds cluster synonyms to expanded', () => {
    const { primary, expanded } = expandTokens(['invoice']);
    expect(primary.has('invoice')).toBe(true);
    // invoice cluster includes qbo/billing/receivable
    expect(expanded.has('qbo')).toBe(true);
    expect(expanded.has('billing')).toBe(true);
    // a synonym is not a primary term
    expect(primary.has('qbo')).toBe(false);
  });

  it('does not invent synonyms for an unknown token', () => {
    const { expanded } = expandTokens(['zzznotaword']);
    expect([...expanded]).toEqual(['zzznotaword']);
  });

  it('every synonym cluster is bidirectional (each member expands to the rest)', () => {
    for (const cluster of SYNONYM_CLUSTERS) {
      for (const word of cluster) {
        const { expanded } = expandTokens([word]);
        for (const other of cluster) expect(expanded.has(other)).toBe(true);
      }
    }
  });
});

describe('scoreEntry (literal hits outrank synonym hits)', () => {
  it('weights a primary (user-typed) token above a synonym-only token', () => {
    const { primary, expanded } = expandTokens(['invoice']);
    const literal = scoreEntry(['invoice'], primary, expanded);   // primary hit
    const synonym = scoreEntry(['qbo'], primary, expanded);       // synonym hit
    expect(literal).toBeGreaterThan(synonym);
  });

  it('scores zero when nothing overlaps', () => {
    const { primary, expanded } = expandTokens(['invoice']);
    expect(scoreEntry(['schedule', 'calendar'], primary, expanded)).toBe(0);
  });

  it('tolerates empty / missing entry tokens', () => {
    const { primary, expanded } = expandTokens(['invoice']);
    expect(scoreEntry([], primary, expanded)).toBe(0);
    expect(scoreEntry(undefined, primary, expanded)).toBe(0);
  });
});

describe('searchCodeContext (end-to-end over an injected fixture index)', () => {
  const fixture = {
    pages: [
      { path: 'src/pages/InvoiceEditor.jsx', tokens: ['invoice', 'editor'] },
      { path: 'src/pages/Schedule.jsx', tokens: ['schedule'] },
    ],
    components: [{ path: 'src/components/ClaimBilling.jsx', tokens: ['claim', 'billing'] }],
    workers: [
      { path: 'functions/api/qbo-invoice.js', tokens: ['qbo', 'invoice'] },
      { path: 'functions/api/twilio-webhook.js', tokens: ['twilio', 'webhook'] },
    ],
    rpcs: [{ name: 'create_invoice_for_job', tokens: ['create', 'invoice', 'job'] }],
    tables: [{ name: 'invoices', tokens: ['invoices', 'invoice'] }],
    topics: [{ title: 'Financial', tokens: ['financial', 'invoice'] }],
    tests: [{ path: 'functions/api/qbo-invoice.test.js', tokens: ['qbo', 'invoice', 'test'] }],
    rules: [{ path: '.claude/rules/database-standard.md', summary: 'DB law', tokens: ['database', 'standard'] }],
    gold: [{ path: 'src/pages/Schedule.jsx', reason: 'resume gold', source: 'page-lifecycle.md', tokens: ['schedule'] }],
  };

  it('finds the invoice-relevant entries and excludes the irrelevant ones', () => {
    const r = searchCodeContext('invoice', {}, fixture);
    expect(r.pages).toContain('src/pages/InvoiceEditor.jsx');
    expect(r.pages).not.toContain('src/pages/Schedule.jsx');
    expect(r.workers).toContain('functions/api/qbo-invoice.js');       // synonym qbo→invoice
    expect(r.workers).not.toContain('functions/api/twilio-webhook.js');
    expect(r.rpcs).toContain('create_invoice_for_job');
    expect(r.tables).toContain('invoices');
    expect(r.tests).toContain('functions/api/qbo-invoice.test.js');
  });

  it('returns the documented compact shape and reports applied synonyms', () => {
    const r = searchCodeContext('invoice', {}, fixture);
    expect(r).toHaveProperty('feature', 'invoice');
    expect(r).toHaveProperty('query_terms');
    expect(r).toHaveProperty('synonyms_applied');
    expect(r).toHaveProperty('pages');
    expect(r).toHaveProperty('rules');
    expect(r).toHaveProperty('gold_standards');
    expect(r).toHaveProperty('related_docs');
    expect(r.synonyms_applied).toContain('qbo'); // invoice→qbo expansion surfaced
  });

  it('respects max_results as a per-category cap', () => {
    const r = searchCodeContext('invoice', { maxResults: 1 }, fixture);
    expect(r.workers.length).toBeLessThanOrEqual(1);
  });

  it('throws on an empty feature', () => {
    expect(() => searchCodeContext('', {}, fixture)).toThrow(/feature is required/i);
    expect(() => searchCodeContext('   ', {}, fixture)).toThrow();
  });
});

describe('searchCodeContext (against the real generated index)', () => {
  it('maps the canonical example to real invoice/qbo code and stays token-frugal', () => {
    const r = searchCodeContext('invoice payment reconciliation', {}, INDEX);
    expect(r.pages).toContain('src/pages/InvoiceEditor.jsx');
    expect(r.workers.some((w) => /qbo-(invoice|payment)/.test(w))).toBe(true);
    expect(r.rpcs.length).toBeGreaterThan(0);
    // Budget guard: the whole payload must stay well under ~2k tokens (~8k chars).
    expect(JSON.stringify(r).length).toBeLessThan(6000);
  });

  it('the generated index is non-empty across every category', () => {
    for (const key of ['pages', 'components', 'workers', 'rpcs', 'tables', 'topics', 'tests', 'rules']) {
      expect(Array.isArray(INDEX[key])).toBe(true);
      expect(INDEX[key].length).toBeGreaterThan(0);
    }
  });
});
