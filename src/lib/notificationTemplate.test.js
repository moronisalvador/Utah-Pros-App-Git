/**
 * ════════════════════════════════════════════════
 * FILE: notificationTemplate.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the notification variable picker inserts at the selected cursor,
 *   replaces selected text, and refuses unknown or over-limit variables.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./notificationTemplate.js
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { insertNotificationTemplateVariable } from './notificationTemplate.js';

describe('insertNotificationTemplateVariable', () => {
  it('inserts an approved variable at the cursor', () => {
    expect(insertNotificationTemplateVariable({
      template: 'Payment  received',
      variableKey: 'invoice_number',
      allowedVariableKeys: ['amount', 'invoice_number'],
      selectionStart: 8,
      selectionEnd: 8,
      maxLength: 80,
    })).toEqual({
      ok: true,
      value: 'Payment {{invoice_number}} received',
      caret: 26,
    });
  });

  it('replaces the active selection', () => {
    expect(insertNotificationTemplateVariable({
      template: 'Hello customer',
      variableKey: 'customer_name',
      allowedVariableKeys: ['customer_name'],
      selectionStart: 6,
      selectionEnd: 14,
      maxLength: 80,
    })).toMatchObject({
      ok: true,
      value: 'Hello {{customer_name}}',
    });
  });

  it('rejects variables outside the current event allowlist', () => {
    expect(insertNotificationTemplateVariable({
      template: 'Payment received',
      variableKey: 'customer_name',
      allowedVariableKeys: ['amount', 'invoice_number'],
      maxLength: 80,
    })).toEqual({
      ok: false,
      error: 'Variable is not allowed for this event',
    });
  });

  it('rejects an insertion that would exceed the surface limit', () => {
    expect(insertNotificationTemplateVariable({
      template: '1234567890',
      variableKey: 'amount',
      allowedVariableKeys: ['amount'],
      maxLength: 12,
    })).toEqual({
      ok: false,
      error: 'Presentation copy is too long',
    });
  });
});
