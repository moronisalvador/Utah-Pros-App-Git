/**
 * ════════════════════════════════════════════════
 * FILE: meldsSeed.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A short, hand-checked list of REAL restoration Melds pulled from the
 *   owner's Property Meld emails, so the /melds page has something real to show
 *   before the live email feed is wired up. Every row here is restoration work
 *   from the Utah Pros Restoration vendor account (Property Meld account 83074)
 *   — carpet-cleaning Melds (a different business) are deliberately excluded.
 *
 * WHERE IT LIVES:
 *   Route:        used by /melds (src/pages/Melds.jsx)
 *   Rendered by:  Melds.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  shape matches parseMeldEmail() output in
 *              functions/lib/property-meld.js
 *   Data:      reads → none · writes → none (static preview data)
 *
 * NOTES / GOTCHAS:
 *   - THIS IS TEMPORARY PREVIEW DATA. Once the inbound-meld worker + melds
 *     table land, Melds.jsx switches to db.rpc('get_melds', …) and this file
 *     is deleted. It exists only so the page is viewable today.
 *   - Fields mirror what the email actually carries. Photos and full inspection
 *     reports are NOT in the email (portal-only) — hence portalUrl, which a
 *     tech taps to see them in Property Meld.
 */

export const MELDS_SEED = [
  {
    meldNumber: 'TFTBCQP',
    meldType: 'Reconstruction',
    status: 'Pending vendor acceptance',
    isEmergency: false,
    address: { street: '145 1000 South - DWN', unit: 'Unit DWN', cityStateZip: 'Orem, UT 84058' },
    description: 'Restoration after flood',
    descriptionTruncated: false,
    dueDate: 'Apr. 21, 2026, 6:12 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-04-15T00:12:49Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/12533505/summary/',
  },
  {
    meldNumber: 'TH1BCY1',
    meldType: 'Mold check',
    status: 'Pending completion',
    isEmergency: false,
    address: { street: '145 1000 South - DWN', unit: 'Unit DWN', cityStateZip: 'Orem, UT 84058' },
    description: 'Please check all windows for mold growth. Spanish speaking.',
    descriptionTruncated: false,
    dueDate: 'Mar. 25, 2026, 4:59 PM MDT',
    appointmentWindow: 'Thursday, March 19, 2026 4:00 PM MDT',
    receivedAt: '2026-03-18T23:00:50Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/11900000/summary/',
  },
  {
    meldNumber: 'TWFL001',
    meldType: 'Water Fountain Pipe Leak-Mitigation Work',
    status: 'Pending completion',
    isEmergency: false,
    address: { street: '1639 W 3040 N', unit: 'Unit 1', cityStateZip: 'Pleasant Grove, UT 84062' },
    description: 'Owner has filed an insurance claim. Proceed with mitigation.',
    descriptionTruncated: false,
    dueDate: 'Jun. 25, 2026, 12:00 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-06-24T14:45:57Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/13100000/summary/',
  },
  {
    meldNumber: 'TMIT223',
    meldType: 'Mitigation and Repairs',
    status: 'Pending completion',
    isEmergency: false,
    address: { street: '223 East Hill Avenue #2', unit: 'Unit 2', cityStateZip: 'Provo, UT 84601' },
    description: 'Tenant reported water damage — mitigation then repairs.',
    descriptionTruncated: false,
    dueDate: 'Jul. 8, 2026, 5:00 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-07-01T00:03:38Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/13180000/summary/',
  },
  {
    meldNumber: 'T7J1D18',
    meldType: 'Wall Abatement & Repairs',
    status: 'Pending vendor acceptance',
    isEmergency: false,
    address: { street: '550 West 200 South - 2', unit: 'Unit 2', cityStateZip: 'Provo, UT 84601' },
    description: 'Pre-1978 property — RRP requirements apply. Abate and repair wall.',
    descriptionTruncated: false,
    dueDate: 'May. 20, 2026, 6:16 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-05-16T00:16:18Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/12700000/summary/',
  },
  {
    meldNumber: 'TFLOOD24',
    meldType: 'Active Flooding Or Leaking',
    status: 'Pending completion',
    isEmergency: true,
    address: { street: '24 N Southgate Loop - 1', unit: 'Unit 1', cityStateZip: 'Saratoga Springs, UT 84045' },
    description: 'Resident said: Active flooding or leaking. Leak from unit above.',
    descriptionTruncated: true,
    dueDate: 'Apr. 15, 2026, 6:13 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-04-15T00:13:13Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/12530000/summary/',
  },
  {
    meldNumber: 'TMOLD550',
    meldType: 'Possible Mold In The Far Bedroom',
    status: 'Pending completion',
    isEmergency: false,
    address: { street: '550 West 200 South - 2', unit: 'Unit 2', cityStateZip: 'Provo, UT 84601' },
    description: 'Tenant reports possible mold in the far bedroom.',
    descriptionTruncated: false,
    dueDate: 'May. 8, 2026, 5:00 PM MDT',
    appointmentWindow: 'Not scheduled',
    receivedAt: '2026-05-04T23:43:37Z',
    portalUrl: 'https://app.propertymeld.com/2156/v/83074/melds/incoming/12600000/summary/',
  },
];
