# ENCIRCLE_API_REFERENCE.md
## Encircle Public API — UPR Integration Reference
**API Version:** 1.7.0 (OAS3)
**Base URL:** `https://api.encircleapp.com`
**OpenAPI Spec:** `https://api.encircleapp.com/openapi_v3.json`
**Last Updated:** April 9, 2026

---

## Authentication

Every request requires a Bearer token in the Authorization header.

```
Authorization: Bearer <ENCIRCLE_API_KEY>
Content-Type: application/json
X-Encircle-Attribution: UtahProsRestorationApp
```

**Optional idempotency header** — use on retries to prevent duplicate processing:
```
X-Encircle-Request: <unique-string-per-request>
```

Our token is stored as `ENCIRCLE_API_KEY` in the Cloudflare Pages dashboard (used by `functions/api/sync-encircle.js` and `functions/api/encircle-import.js`). Also in the Netlify demo-sheet project env vars. Token ends in `...47c2`.

---

## Pagination (all list endpoints)

All list endpoints return cursor-based pagination:
```json
{
  "list": [ ...items ],
  "cursor": {
    "order": "newest",
    "limit": 50,
    "after": "jwt-token-string-or-null"
  }
}
```

**Common query params for all list endpoints:**
- `order` — `newest` (default) or `oldest`
- `limit` — 1-100, default 50
- `after` — JWT cursor string from previous response for next page. `null` = last page.

---

## 1. Property Claims (Jobs)

This is the core entity. In Encircle, a "Property Claim" = a job/loss file.

### List / Search Claims
```
GET /v1/property_claims
```
**Query params:**
- `policyholder_name` — search by insured name
- `contractor_identifier` — search by our CLM number
- `assignment_identifier` — search by assignment #
- `insurer_identifier` — search by carrier identifier
- `limit`, `order`, `after` — pagination

**Response:** `{ list: [ PropertyClaim, ... ], cursor: {...} }`

### Get Single Claim
```
GET /v1/property_claims/{property_claim_id}
```
**Path param:** `property_claim_id` — integer (Encircle's internal ID)

**Response:** Full `PropertyClaim` object.

### Create Claim
```
POST /v1/property_claims
```
**Request body fields:**
- `policyholder_name` — string (required)
- `full_address` — string
- `policyholder_email_address` — string
- `policyholder_phone_number` — string
- `insurance_company_name` — string
- `policy_number` — string
- `contractor_identifier` — string (our CLM number)
- `assignment_identifier` — string
- `insurer_identifier` — string
- `adjuster_name` — string
- `date_of_loss` — date string (YYYY-MM-DD, must be in the past)
- `type_of_loss` — string
- `cat_code` — string
- `broker_or_agent_name` — string
- `project_manager_name` — string
- `loss_details` — string
- `locale` — BCP47 language tag (e.g., "en")
- `brand_id` — UUID (organization brand)

### Update Claim
```
PATCH /v1/property_claims/{property_claim_id}
```
**All PATCH-able fields (all optional, nullable):**
```
type_of_loss              string
locale                    BCP47 string
adjuster_name             string
assignment_identifier     string     (empty → null)
cat_code                  string
contents_estimate         integer    (cents — 550 = $5.50)
contractor_identifier     string     (empty → null) ← OUR CLM NUMBER GOES HERE
date_claim_created        date       (YYYY-MM-DD)
date_of_loss              date       (YYYY-MM-DD, must be in past)
default_depreciation      number     (0-1, e.g. 0.05 = 5%)
emergency_estimate        integer    (cents)
full_address              string
insurer_identifier        string     (empty → null)
loss_details              string
max_depreciation          number     (0-1)
policyholder_email_address string
policyholder_name         string
policyholder_phone_number string
project_manager_name      string
repair_estimate           integer    (cents)
sales_tax                 number     (0+)
broker_or_agent_name      string
insurance_company_name    string
policy_number             string
```
**Response:** `200` — PropertyClaim updated successfully.

### PropertyClaim Response Object
Key fields returned (confirmed from working code + OpenAPI):
```json
{
  "id": 4498929,                          // integer — Encircle internal ID
  "policyholder_name": "Virginia Roundy",
  "policyholder_email_address": "v@example.com",
  "policyholder_phone_number": "(801) 223-4813",
  "full_address": "211 W 255 S, Orem, UT 84058",
  "insurance_company_name": "Progressive Insurance",
  "policy_number": "PO-123456",
  "contractor_identifier": "CLM-2604-001", // our CLM number after write-back
  "assignment_identifier": null,
  "insurer_identifier": "Virginia Rondy",  // carrier_identifier in our DB
  "adjuster_name": null,
  "date_of_loss": "2025-09-04",
  "date_claim_created": "2025-09-04",
  "type_of_loss": "Water",
  "cat_code": "3",
  "broker_or_agent_name": null,
  "project_manager_name": "Ben Palmieri/Moroni Salvador",
  "loss_details": "A supply failure in the clothes washer...",
  "contents_estimate": null,               // cents
  "emergency_estimate": null,              // cents
  "repair_estimate": null,                 // cents
  "default_depreciation": null,            // 0-1
  "max_depreciation": null,                // 0-1
  "sales_tax": null,
  "created_at": "2025-09-04T15:30:00Z",
  "summary": "..."                         // may also appear as loss_details
}
```

---

## 2. Structures & Rooms

Structures are the buildings within a claim. Rooms are spaces within structures.

### List Structures
```
GET /v1/property_claims/{property_claim_id}/structures?limit=100
```
**Response:** `{ list: [ Structure, ... ] }`

Each structure has: `id` (integer), `name` (string), `property_claim_id`.

### Create Structure
```
POST /v1/property_claims/{property_claim_id}/structures
```
**Body:** `{ "name": "Main House" }`

### List Rooms
```
GET /v1/property_claims/{property_claim_id}/structures/{structure_id}/rooms?limit=100
```
**Response:** `{ list: [ Room, ... ] }`

Each room has: `id` (integer), `name` (string), `structure_id`.

### Get Room by ID (v2 — includes Hydro dimensions)
```
GET /v2/property_claims/{property_claim_id}/rooms/{room_id}
```
Returns room with Hydro room dimensions (length, width, height).

### Create Room
```
POST /v1/property_claims/{property_claim_id}/structures/{structure_id}/rooms
```
**Body:** `{ "name": "Master Bedroom" }`

---

## 3. Media (Photos/Videos)

### List Media for Claim
```
GET /v1/property_claims/{property_claim_id}/media
```
**Query params:**
- `source` — filter by media source type
- `limit`, `order`, `after` — pagination

**Response:** `{ list: [ Media, ... ], cursor: {...} }`

### Media Response Object
```json
{
  "id": 12345,
  "url": "https://...",                    // direct URL to the image/video
  "thumbnail_url": "https://...",          // smaller version
  "source": "photo",                       // photo, video, sketch, etc.
  "room_id": 567,                          // nullable
  "structure_id": 89,                      // nullable
  "creator": { "email": "tech@company.com" },
  "primary_server_created": "2025-09-04T16:00:00Z",
  "secondary_server_created": "...",
  "primary_client_created": "...",         // when the photo was actually taken
  "secondary_client_created": "..."
}
```

### Upload Media
Two-step process:

**Step 1: Create upload ticket**
```
POST /v1/property_claims/{property_claim_id}/uploads
```
**Body:** `{ "file_name": "photo.jpg", "mime_type": "image/jpeg" }`
**Response:** Returns an upload URL + media ID.

**Step 2: Upload file to the returned URL**
PUT the actual file bytes to the `upload_url` from step 1.

**Step 3: Attach to room (optional)**
```
POST /v1/property_claims/{property_claim_id}/media
```
Associates the uploaded media with a specific room/structure.

---

## 4. Notes

### General Notes (Claim-level)

**List Notes**
```
GET /v2/property_claims/{property_claim_id}/notes
```
**Response:** `{ list: [ Note, ... ], cursor: {...} }`

**Create Note**
```
POST /v2/property_claims/{property_claim_id}/notes
```
**Body:**
```json
{
  "title": "Demo Sheet",        // required in some schemas, optional in others
  "text": "Note content here"   // required
}
```
**Response:** `{ id: 123, ... }`

**Get Note by ID**
```
GET /v2/property_claims/{property_claim_id}/notes/{note_id}
```

**Update Note**
```
PATCH /v2/property_claims/{property_claim_id}/notes/{note_id}
```

### Room Notes

**List Room Notes**
```
GET /v2/property_claims/{property_claim_id}/rooms/{room_id}/notes
```

**Create Room Note**
```
POST /v2/property_claims/{property_claim_id}/rooms/{room_id}/notes
```

**Get / Update Room Note**
```
GET  /v2/property_claims/{property_claim_id}/rooms/{room_id}/notes/{note_id}
PATCH /v2/property_claims/{property_claim_id}/rooms/{room_id}/notes/{note_id}
```

---

## 5. User Assignments

Assign/unassign Encircle users to claims. The user must have an Encircle account.

**Assign User**
```
POST /v1/property_claims/{property_claim_id}/assignments
Body: { "email_address": "tech@utah-pros.com" }
```
Returns: `200` (assigned) or `202` (already assigned)

**List Assigned Users**
```
GET /v1/property_claims/{property_claim_id}/assignments
```

**Unassign User**
```
DELETE /v1/property_claims/{property_claim_id}/assignments
Body: { "email_address": "tech@utah-pros.com" }
```

---

## 6. Web App Redirect (Deep Links)

Open a claim directly in Encircle's web app.

### Get Redirect URL
```
GET /v1/property_claims/{property_claim_id}/webapp_redirect
```
Returns HTTP `302` redirect to the Encircle web app URL for that claim.

### Generate SSO Link (External User)
```
POST /v1/property_claims/{property_claim_id}/webapp_uri
```
Returns a single-sign-on link authenticated as an external user. Useful for giving adjusters or homeowners a direct link.

---

## 7. Hydro / Dry Logs (FUTURE — 6-9 months out)

**NOT building now**, but documenting for future reference.

Hydro is Encircle's drying/moisture tracking system. Data is organized as:
`Claim → Structure → Room → Readings`

### Atmosphere Readings (Affected)
```
GET /v2/property_claims/{property_claim_id}/affected_atmosphere_readings
GET /v2/property_claims/{property_claim_id}/affected_atmosphere_readings/{id}
```
Query by `room_id` to filter.

### Atmosphere Readings (Unaffected / Control)
```
GET /v2/property_claims/{property_claim_id}/unaffected_atmosphere_readings
GET /v2/property_claims/{property_claim_id}/unaffected_atmosphere_readings/{id}
```

### Material Readings (Moisture content)
```
GET /v2/property_claims/{property_claim_id}/material_readings
GET /v2/property_claims/{property_claim_id}/material_readings/{id}
```
Query by `room_id` to filter.

### Equipment Readings (Dehu output, etc.)
```
GET /v2/property_claims/{property_claim_id}/equipment_readings
GET /v2/property_claims/{property_claim_id}/equipment_readings/{id}
```

### Room with Hydro Dimensions
```
GET /v2/property_claims/{property_claim_id}/rooms/{room_id}
```
Returns room with length, width, height for drying calculations.

---

## 8. Equipment

### List Organization Equipment (v2)
```
GET /v2/equipment
```
Query params: `organization_id`, `is_retired`, `equipment_type`, `currently_placed_in_claim_id`

Equipment types: `air_mover`, `dehumidifier`, `air_scrubber`, `dryer`, `heater`, `other`

### Get / Create / Update Equipment
```
GET   /v2/equipment/{organization_equipment_id}
POST  /v2/equipment
PATCH /v2/equipment/{organization_equipment_id}
```

### Equipment Specs (what's supported by Encircle)
```
GET /v2/equipment_specs
GET /v2/equipment_specs/{equipment_spec_id}
```
Returns: manufacturer, model, xact_charge_code, voltage, amperage, CFM, HEPA filter count, AHAM pints/day.

### Legacy Equipment Endpoints (v1 — still works)
```
GET/POST/PATCH /v1/air_movers
GET/POST/PATCH /v1/air_scrubbers
GET/POST/PATCH /v1/dehumidifiers
GET /v1/{type}/supported — list equipment models Encircle supports
```

---

## 9. Webhooks

Subscribe to real-time events from Encircle.

### Create Webhook
```
POST /v1/webhooks
```
**Body:**
```json
{
  "delivery_url": "https://your-domain.com/api/encircle-webhook",
  "events": ["add_property_claim", "update_property_claim"],
  "authentication": {
    "type": "shared_secret",
    "secret": "your-shared-secret"
  }
}
```

### List / Delete Webhooks
```
GET    /v1/webhooks
DELETE /v1/webhooks/{webhook_id}
```

### Available Webhook Events
```
Property Claims:
  add_property_claim, delete_property_claim, update_property_claim

Media:
  add_property_claim_media, delete_property_claim_media
  add_property_inspection_media, delete_property_inspection_media

Notes:
  add_property_claim_note, delete_property_claim_note
  add_property_claim_room_note, delete_property_claim_room_note

Equipment:
  add_air_mover, update_air_mover
  add_air_scrubber, update_air_scrubber
  add_dehumidifier, update_dehumidifier

Property Inspections:
  add_property_inspection, delete_property_inspection, update_property_inspection
```

### Webhook Authentication
Encircle signs webhook deliveries. Verify with the JWK Set:
```
GET /v1/json_web_key_set/{key_set_id}
```
Returns ES256 public keys for signature verification.

---

## 10. Organization

### List Organizations
```
GET /v1/organizations
```

### List Organization Brands
```
GET /v1/organizations/{organization_id}/brands
```

### Get User by Email
```
GET /v1/users/{email_address}
```

---

## UPR Field Mapping (Encircle → Supabase)

| Encircle Field | UPR contacts | UPR claims | UPR jobs |
|---|---|---|---|
| `id` (int) | — | — | `encircle_claim_id` |
| `policyholder_name` | `name` | — | `insured_name` |
| `policyholder_phone_number` | `phone` | — | `client_phone` |
| `policyholder_email_address` | `email` | — | `client_email` |
| `full_address` (parsed) | — | `loss_address` | `address` |
| `insurance_company_name` | — | `insurance_carrier` | `insurance_company` |
| `policy_number` | — | `policy_number` | `policy_number` |
| `adjuster_name` | — | — | `adjuster_name` |
| `date_of_loss` | — | `date_of_loss` | `date_of_loss` |
| `type_of_loss` | — | `loss_type` | `type_of_loss` |
| `cat_code` | — | — | `cat_code` |
| `broker_or_agent_name` | — | — | `broker_agent` |
| `project_manager_name` | — | — | `project_manager` |
| `loss_details` / `summary` | — | — | `encircle_summary` |
| `insurer_identifier` | — | — | `carrier_identifier` |
| `assignment_identifier` | — | — | `assignment_identifier` |
| `contractor_identifier` | — | — | ← **write-back** our CLM-YYMM-XXX |

---

## Existing UPR Code Using This API

| File | What it does |
|---|---|
| `functions/api/sync-encircle.js` | Bulk sync: pulls 15 recent claims → upserts jobs + creates contacts |
| `functions/api/encircle-import.js` | Selective import: search → preview → import with division selection → write-back CLM |
| Demo Sheet (`demo-sheet.netlify.app`) | Search claims, fetch rooms, post notes |

---

## Rate Limits & Notes

- Default pagination limit: 50. Max: 100.
- Monetary values are in **cents** (integer). 550 = $5.50.
- Depreciation values are 0-1 decimals. 0.05 = 5%.
- `date_of_loss` must be in the past — API rejects future dates.
- Empty strings for nullable string fields get coerced to `null`.
- The `X-Encircle-Request` header enables idempotent retries.
