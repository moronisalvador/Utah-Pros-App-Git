# Utah Pros Restoration — Demo Sheet v15
## Deploy Guide

---

## What's in this zip

```
├── index.html                          ← App entry point
├── package.json                        ← Dependencies (React + Vite)
├── vite.config.js                      ← Build config
├── netlify.toml                        ← Netlify build + function config
├── .env.example                        ← Environment variable template
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx                        ← React root
│   └── demo-sheet-v21.jsx               ← Main app component
└── netlify/
    └── functions/
        ├── send-email.js               ← Sends demo sheet by email
        ├── encircle-search.js          ← Searches Encircle jobs
        └── encircle-rooms.js           ← Fetches rooms from Encircle job
```

---

## Step 1 — Connect to Netlify

### Option A: Drag & Drop (fastest)
1. Go to [app.netlify.com](https://app.netlify.com)
2. Drag this entire unzipped folder onto the Netlify dashboard
3. Netlify will auto-detect the build settings from `netlify.toml`

### Option B: GitHub (recommended for ongoing updates)
1. Push this folder to a GitHub repo
2. In Netlify → **Add new site → Import from Git**
3. Select your repo — build settings auto-fill from `netlify.toml`

---

## Step 2 — Set Environment Variables

In Netlify: **Site Settings → Environment Variables → Add variable**

Add each of the following:

| Variable | Value | Used by |
|---|---|---|
| `ENCIRCLE_API_KEY` | *(set in Netlify dashboard)* | encircle-search.js, encircle-rooms.js |
| `SMTP_HOST` | Your SMTP server (e.g. `smtp.gmail.com`) | send-email.js |
| `SMTP_PORT` | `587` | send-email.js |
| `SMTP_USER` | Your email address | send-email.js |
| `SMTP_PASS` | Your email password or app password | send-email.js |
| `SMTP_FROM` | Sender name/email | send-email.js |
| `EMAIL_TO` | Where to send completed sheets | send-email.js |

### Fast import via CLI (optional)
```bash
# Install Netlify CLI if needed
npm install -g netlify-cli

# Link to your site
netlify link

# Import env vars from the example file (edit values first)
cp .env.example .env
# → Edit .env with your real values
netlify env:import .env
```

---

## Step 3 — Trigger a Deploy

- If you used drag & drop: it deployed automatically
- If you used GitHub: push any commit to trigger a build
- Or in Netlify dashboard: **Deploys → Trigger deploy → Deploy site**

---

## Step 4 — Restrict your Google Maps API Key

The Google Maps key is embedded in `src/demo-sheet-v21.jsx`. To prevent abuse:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. APIs & Services → Credentials → click your key
3. Under **Application restrictions** → select **HTTP referrers**
4. Add your Netlify domain: `https://your-site-name.netlify.app/*`
5. Save

---

## Functions Reference

### `/.netlify/functions/encircle-search`
Searches Encircle property claims.
- **Query params:** `policyholder_name`, `contractor_identifier`, or `assignment_identifier`
- **Returns:** `{ list: [...claims] }`

### `/.netlify/functions/encircle-rooms`
Fetches all structures + rooms for a linked Encircle job.
- **Query params:** `claim_id` (integer)
- **Returns:** `{ rooms: [{ id, name, structureId, structureName }], structures: [...] }`

### `/.netlify/functions/send-email`
Sends the completed demo sheet as an HTML email.
- **Body:** `{ subject: string, message: string (HTML) }`
- **Returns:** `{ ok: true }`

---

## Local Development

```bash
# Install dependencies
npm install

# Install Netlify CLI
npm install -g netlify-cli

# Run with functions locally (requires .env file)
cp .env.example .env
# → Fill in your values in .env
netlify dev
```

The app will be available at `http://localhost:8888` with all functions running locally.

---

*Utah Pros Restoration — Demo Sheet v15*
