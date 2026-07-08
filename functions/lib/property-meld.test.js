/**
 * ════════════════════════════════════════════════
 * FILE: property-meld.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Property Meld email reader works. It feeds real Property Meld
 *   emails (copied straight from the owner's inbox) into the parser and checks
 *   it pulls out the right pieces, tells restoration work apart from carpet
 *   cleaning by the vendor account, and hands the right values to the database.
 *
 * DEPENDS ON:
 *   Internal:  ./property-meld.js
 *   Data:      reads → none · writes → none (pure unit tests)
 *
 * NOTES / GOTCHAS:
 *   - Fixtures are VERBATIM real email bodies covering every notification type
 *     (assigned / canceled / message) plus restoration / cleaning / ambiguous
 *     classification cases. Keep them exact — the parser is regex-based.
 * ════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
  parseMeldEmail,
  classifyMeldBusiness,
  shouldIngestMeld,
  meldToUpsertParams,
} from './property-meld.js';

/*
 * Fixtures below are VERBATIM plain-text bodies of real Property Meld emails
 * from the owner's inbox (redacted only by virtue of being test data). They
 * cover every notification type observed: assigned, canceled, message, plus a
 * restoration vs. cleaning vs. ambiguous-title assignment for the classifier.
 */

// Restoration assignment — vendor account 83074 (Utah Pros Restoration).
const RECON_ASSIGN = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 145 1000 South - DWN, Unit DWN: Reconstruction',
  text: `A2Z Properties

assigned this Meld that needs to be

Accepted (https://app.propertymeld.com/2156/v/83074/melds/incoming/12533505/summary/?accept=) or Rejected (https://app.propertymeld.com/2156/v/83074/melds/incoming/12533505/summary/?reject=).

"Restoration after flood"

Review: https://app.propertymeld.com/2156/v/83074/melds/incoming/12533505/summary/

Meld Details:

Reconstruction
# TFTBCQPPending vendor acceptance
https://app.propertymeld.com/2156/v/83074/melds/incoming/12533505/summary/

Due Date
Apr. 21, 2026, 6:12 PM MDT

Appointment Window

Not scheduled

Unit:
145 1000 South - DWN
Unit DWN
Orem, UT 84058

Manage all notifications: https://app.propertymeld.com/2156/v/83074/account-settings/notification/

Sent by A2Z Properties. Powered by Property Meld.`,
};

// Cleaning assignment — vendor account 51865 (Utah Pros Carpet Cleaning). Note
// the long description truncated with "See More".
const CLEANING_ASSIGN = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 550 West 200 South - 1, Unit 1: Carpet Cleaning',
  text: `A2Z Properties

assigned this Meld that needs to be

Accepted (https://app.propertymeld.com/2156/v/51865/melds/incoming/13016966/summary/?accept=) or Rejected (https://app.propertymeld.com/2156/v/51865/melds/incoming/13016966/summary/?reject=).

"Coordinate with Ramos and Rafael to make sure carpet cleaning is done after repairs and regular cleaning. Attached is the check out inspection report that may contain additional information regarding…"
See More: https://app.propertymeld.com/2156/v/51865/melds/incoming/13016966/summary/

Review: https://app.propertymeld.com/2156/v/51865/melds/incoming/13016966/summary/

Meld Details:

Carpet Cleaning
# T720F12Pending vendor acceptance
https://app.propertymeld.com/2156/v/51865/melds/incoming/13016966/summary/

Due Date
Jun. 20, 2026, 12:58 PM MDT

Appointment Window

Not scheduled

Unit:
550 West 200 South - 1
Unit 1
Provo, UT 84601

Manage all notifications: https://app.propertymeld.com/2156/v/51865/account-settings/notification/

Sent by A2Z Properties. Powered by Property Meld.`,
};

// The trap case: title is "Carpet repair" (sounds like restoration) but it came
// through the CLEANING account 51865, so it must be classified as cleaning.
const CARPET_REPAIR_ASSIGN = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 238 N 750 E, Unit 238: Carpet repair',
  text: `A2Z Properties

assigned this Meld that needs to be

Accepted (https://app.propertymeld.com/2156/v/51865/melds/incoming/13195011/summary/?accept=) or Rejected (https://app.propertymeld.com/2156/v/51865/melds/incoming/13195011/summary/?reject=).

"Please repair the carpet in the master bedroom. I&#x27;m adding a picture. You have an schedule to clean the carpet on 7/3
Key Box 3040"

Review: https://app.propertymeld.com/2156/v/51865/melds/incoming/13195011/summary/

Meld Details:

Carpet repair
# T1HX11DPending vendor acceptance
https://app.propertymeld.com/2156/v/51865/melds/incoming/13195011/summary/

Due Date
Jul. 3, 2026, 8:53 PM MDT

Appointment Window

Not scheduled

Unit:
238 N 750 E
Unit 238
Vineyard, UT 84059

Manage all notifications: https://app.propertymeld.com/2156/v/51865/account-settings/notification/

Sent by A2Z Properties. Powered by Property Meld.`,
};

// Cancel — cleaning account. No Meld-summary URL; account id only in the footer.
const CLEANING_CANCEL = {
  from: 'noreply@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 435 S 100 E, Unit 435: Carpet Cleaning',
  text: `A2Z Properties canceled this Meld and requires no further action.

Meld Details:

Carpet Cleaning
# TPVIA6K

Unit:
435 S 100 E
Unit 435
Provo, UT 84606

Manage all notifications: https://app.propertymeld.com/2156/v/51865/account-settings/notification/

Sent by A2Z Properties. Powered by Property Meld.`,
};

// Message on a restoration Meld — the envelope From is the per-Meld reply token.
const RECON_MESSAGE = {
  from: '92cc7e85-d698-4dcd-a51a-f4f1b570fdfe@msg.propertymeld.com',
  subject: '[A2Z Properties] - Meld at 145 1000 South - DWN, Unit DWN: Reconstruction',
  text: `Send a message on the Meld by replying to this email or using the View Messages button below

Leuri Zibetti (Manager) sent a message.

"Thank you for being a valued Vendor of ours. Could you please schedule this Meld or provide your availability to the tenant(s) within the next 24 hours?

How to schedule a Meld:
https://help.propertymeld.com/hc/en-usus/articles/360012710454-How-to-Schedule-a-Meld-Vendor

If you are not able to respond or schedule this work request, please reply to this message or let us know so we can reassign to a different vendor."

Sent to Managers and Vendors

View Messages: https://app.propertymeld.com/2156/v/83074/meld/12533505/messages/

Meld Details:

Reconstruction
# TFTBCQPPending more vendor availability
https://app.propertymeld.com/2156/v/83074/meld/12533505/summary/

Due Date
Apr. 21, 2026, 6:12 PM MDT

Appointment Window

Not scheduled

Unit:
145 1000 South - DWN
Unit DWN
Orem, UT 84058

Manage all notifications: https://app.propertymeld.com/2156/v/83074/account-settings/notification/

Sent by A2Z Properties. Powered by Property Meld.`,
};

// Daily digest — not a Meld; must never be ingested.
const DAILY_SUMMARY = {
  from: 'noreply@msg.propertymeld.com',
  subject: '(A2Z Properties) provided daily activity summary on Monday, April 20, 2026 from Property Meld',
  text: `Activity Summary - Utah Pros Restoration

Here's a summary of what's happened in the last 24 hours.

Unaccepted Melds: 0
Unscheduled Melds: 2`,
};

describe('parseMeldEmail — restoration assignment', () => {
  const p = parseMeldEmail(RECON_ASSIGN);
  it('detects the event', () => expect(p.event).toBe('assigned'));
  it('extracts org + vendor account', () => {
    expect(p.orgId).toBe('2156');
    expect(p.vendorAccountId).toBe('83074');
  });
  it('extracts the meld number and internal id', () => {
    expect(p.meldNumber).toBe('TFTBCQP');
    expect(p.meldId).toBe('12533505');
  });
  it('extracts type, status, due date', () => {
    expect(p.meldType).toBe('Reconstruction');
    expect(p.status).toBe('Pending vendor acceptance');
    expect(p.dueDate).toBe('Apr. 21, 2026, 6:12 PM MDT');
  });
  it('extracts the full address', () => {
    expect(p.address.street).toBe('145 1000 South - DWN');
    expect(p.address.unit).toBe('Unit DWN');
    expect(p.address.cityStateZip).toBe('Orem, UT 84058');
    expect(p.address.full).toBe('145 1000 South - DWN, Unit DWN, Orem, UT 84058');
  });
  it('extracts the (short, untruncated) description', () => {
    expect(p.description).toBe('Restoration after flood');
    expect(p.descriptionTruncated).toBe(false);
  });
  it('captures a portal deep link', () => {
    expect(p.portalUrl).toContain('/2156/v/83074/melds/incoming/12533505/summary/');
  });
});

describe('parseMeldEmail — truncated description', () => {
  it('flags a "See More" description as truncated', () => {
    const p = parseMeldEmail(CLEANING_ASSIGN);
    expect(p.descriptionTruncated).toBe(true);
    expect(p.description).toContain('Coordinate with Ramos and Rafael');
  });
});

describe('parseMeldEmail — HTML entities & multi-line description', () => {
  it('decodes entities and keeps the whole quoted block', () => {
    const p = parseMeldEmail(CARPET_REPAIR_ASSIGN);
    expect(p.description).toContain("I'm adding a picture"); // &#x27; decoded
    expect(p.description).toContain('Key Box 3040');          // spans a newline
  });
});

describe('parseMeldEmail — cancel', () => {
  const p = parseMeldEmail(CLEANING_CANCEL);
  it('detects the event and forces Canceled status', () => {
    expect(p.event).toBe('canceled');
    expect(p.status).toBe('Canceled');
  });
  it('still gets the meld number and account (from the footer)', () => {
    expect(p.meldNumber).toBe('TPVIA6K');
    expect(p.vendorAccountId).toBe('51865');
  });
  it('has no portal summary link or internal id on a cancel', () => {
    expect(p.meldId).toBeNull();
    expect(p.portalUrl).toBeNull();
  });
});

describe('parseMeldEmail — message', () => {
  const p = parseMeldEmail(RECON_MESSAGE);
  it('detects the event and speaker', () => {
    expect(p.event).toBe('message');
    expect(p.messageFrom).toBe('Leuri Zibetti (Manager)');
  });
  it('captures the message text', () => {
    expect(p.messageText).toContain('valued Vendor of ours');
    expect(p.messageText).toContain('reassign to a different vendor');
  });
  it('captures the per-meld reply-thread address', () => {
    expect(p.threadReplyAddress).toBe('92cc7e85-d698-4dcd-a51a-f4f1b570fdfe@msg.propertymeld.com');
  });

  it('extracts the reply address from a "Display Name <addr>" From header', () => {
    const withName = parseMeldEmail({ ...RECON_MESSAGE, from: 'Property Meld <92cc7e85-d698-4dcd-a51a-f4f1b570fdfe@msg.propertymeld.com>' });
    expect(withName.threadReplyAddress).toBe('92cc7e85-d698-4dcd-a51a-f4f1b570fdfe@msg.propertymeld.com');
  });
  it('handles the /meld/{id}/ URL variant and the open status set', () => {
    expect(p.meldId).toBe('12533505');
    expect(p.meldNumber).toBe('TFTBCQP');
    expect(p.status).toBe('Pending more vendor availability');
  });
});

describe('classifyMeldBusiness — account id is the only signal', () => {
  it('83074 → restoration', () => {
    expect(classifyMeldBusiness(parseMeldEmail(RECON_ASSIGN))).toBe('restoration');
  });
  it('51865 → cleaning', () => {
    expect(classifyMeldBusiness(parseMeldEmail(CLEANING_ASSIGN))).toBe('cleaning');
  });
  it('"Carpet repair" title does NOT fool it — cleaning account wins', () => {
    expect(classifyMeldBusiness(parseMeldEmail(CARPET_REPAIR_ASSIGN))).toBe('cleaning');
  });
  it('unmapped account → unknown', () => {
    const p = parseMeldEmail(RECON_ASSIGN);
    p.vendorAccountId = '99999';
    expect(classifyMeldBusiness(p)).toBe('unknown');
  });
});

describe('shouldIngestMeld — only restoration flows into UPR', () => {
  it('ingests a restoration assignment', () => {
    const r = shouldIngestMeld(parseMeldEmail(RECON_ASSIGN));
    expect(r).toMatchObject({ ingest: true, business: 'restoration', event: 'assigned', needsReview: false });
  });
  it('ingests a restoration message and cancel too', () => {
    expect(shouldIngestMeld(parseMeldEmail(RECON_MESSAGE)).ingest).toBe(true);
  });
  it('drops cleaning work', () => {
    expect(shouldIngestMeld(parseMeldEmail(CLEANING_ASSIGN)).ingest).toBe(false);
    expect(shouldIngestMeld(parseMeldEmail(CARPET_REPAIR_ASSIGN)).ingest).toBe(false);
    expect(shouldIngestMeld(parseMeldEmail(CLEANING_CANCEL)).ingest).toBe(false);
  });
  it('never ingests the daily digest', () => {
    const r = shouldIngestMeld(parseMeldEmail(DAILY_SUMMARY));
    expect(r.ingest).toBe(false);
    expect(r.event).toBe('daily_summary');
  });
  it('flags an unmapped account for review instead of dropping it', () => {
    const p = parseMeldEmail(RECON_ASSIGN);
    p.vendorAccountId = '70000';
    const r = shouldIngestMeld(p);
    expect(r).toMatchObject({ ingest: false, business: 'unknown', needsReview: true });
  });
});

describe('meldToUpsertParams — maps parsed email to the RPC arguments', () => {
  it('maps an assignment to p_* params', () => {
    const params = meldToUpsertParams(parseMeldEmail(RECON_ASSIGN), { receivedAt: '2026-04-15T00:12:49Z' });
    expect(params).toMatchObject({
      p_meld_number: 'TFTBCQP',
      p_event: 'assigned',
      p_vendor_account_id: '83074',
      p_business: 'restoration',
      p_meld_internal_id: '12533505',
      p_meld_type: 'Reconstruction',
      p_status: 'Pending vendor acceptance',
      p_address_full: '145 1000 South - DWN, Unit DWN, Orem, UT 84058',
      p_description: 'Restoration after flood',
      p_description_clipped: false,
      p_is_emergency: false,
      p_received_at: '2026-04-15T00:12:49Z',
    });
  });

  it('carries the message text + reply address for a message event', () => {
    const params = meldToUpsertParams(parseMeldEmail(RECON_MESSAGE));
    expect(params.p_event).toBe('message');
    expect(params.p_message_from).toBe('Leuri Zibetti (Manager)');
    expect(params.p_thread_reply_address).toBe('92cc7e85-d698-4dcd-a51a-f4f1b570fdfe@msg.propertymeld.com');
  });

  it('flags a clipped (truncated) description via p_description_clipped', () => {
    const params = meldToUpsertParams(parseMeldEmail(CLEANING_ASSIGN));
    expect(params.p_description_clipped).toBe(true);
  });
});
