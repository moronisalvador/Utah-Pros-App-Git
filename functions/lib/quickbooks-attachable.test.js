import { describe, expect, it } from 'vitest';
import { buildAttachableMetadata } from './quickbooks.js';

describe('buildAttachableMetadata', () => {
  it('links to an Invoice and includes-on-send by default', () => {
    const m = buildAttachableMetadata({ entityType: 'invoice', qboEntityId: 123, fileName: 'scope.pdf', contentType: 'application/pdf' });
    expect(m.FileName).toBe('scope.pdf');
    expect(m.ContentType).toBe('application/pdf');
    expect(m.AttachableRef).toHaveLength(1);
    expect(m.AttachableRef[0].EntityRef).toEqual({ type: 'Invoice', value: '123' });
    expect(m.AttachableRef[0].IncludeOnSend).toBe(true);
  });

  it('maps entityType "estimate" → EntityRef type "Estimate"', () => {
    const m = buildAttachableMetadata({ entityType: 'estimate', qboEntityId: '99', fileName: 'photo.jpg' });
    expect(m.AttachableRef[0].EntityRef.type).toBe('Estimate');
    expect(m.AttachableRef[0].EntityRef.value).toBe('99');
  });

  it('honors includeOnSend:false (in QuickBooks only, not on the email)', () => {
    const m = buildAttachableMetadata({ entityType: 'invoice', qboEntityId: 1, fileName: 'x.pdf', includeOnSend: false });
    expect(m.AttachableRef[0].IncludeOnSend).toBe(false);
  });

  it('omits ContentType when not provided', () => {
    const m = buildAttachableMetadata({ entityType: 'invoice', qboEntityId: 1, fileName: 'x.pdf' });
    expect('ContentType' in m).toBe(false);
  });
});
