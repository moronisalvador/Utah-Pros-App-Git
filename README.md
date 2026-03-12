# UPR Platform

Unified internal tool for Utah Pros Restoration — messaging, job management, scheduling, CRM, and operations.

## Stack
- **Frontend**: React 19 + Vite 8
- **Hosting**: Cloudflare Pages + Workers (functions/)
- **Database**: Supabase (REST, no SDK except for Realtime)
- **Messaging**: Twilio SMS/MMS/RCS

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create env files
cp .env.example .env.local        # Frontend vars (anon key)
cp .dev.vars.example .dev.vars    # Worker vars (service role key, Twilio)

# 3. Fill in your Supabase anon key in .env.local
# VITE_SUPABASE_URL=https://glsmljpabrwonfiltiqm.supabase.co
# VITE_SUPABASE_ANON_KEY=<your-anon-key>

# 4. Start development
npm run dev                        # Vite dev server (port 5173)
npx wrangler pages dev dist        # Cloudflare Pages + Workers (port 8788)
```

For full development with Workers, run both Vite and Wrangler simultaneously. The Vite proxy config forwards `/api/*` requests to the Wrangler dev server.

## Project Structure

```
src/
  App.jsx                   # Router — all 10 routes
  main.jsx                  # Entry point
  index.css                 # Design system
  lib/
    supabase.js             # REST client (anon key, frontend)
    realtime.js             # Supabase JS client (Realtime subscriptions only)
    api.js                  # Helper for /api/* worker calls
  contexts/
    AuthContext.jsx          # Supabase Auth + employee bridge
  components/
    Layout.jsx              # Sidebar + content wrapper
    Sidebar.jsx             # Role-based nav from nav_permissions
    ProtectedRoute.jsx      # Auth guard
    Icons.jsx               # Inline SVG nav icons
  pages/
    Login.jsx               # Auth + dev mode employee selector
    Dashboard.jsx           # Stats + recent jobs
    Conversations.jsx       # 3-panel messaging UI + Realtime
    Jobs.jsx                # Pipeline kanban + list view
    Leads.jsx               # Lead contacts table
    Customers.jsx           # All contacts table
    Schedule.jsx            # Job schedule (shell)
    TimeTracking.jsx        # Time entries (shell)
    Marketing.jsx           # Campaigns (shell)
    Admin.jsx               # Team + automation rules
    Settings.jsx            # Profile + message templates
functions/
  api/
    send-message.js         # Outbound SMS/MMS + internal notes
    twilio-webhook.js       # Inbound message handler + automation
    twilio-status.js        # Delivery receipt callbacks
  lib/
    supabase.js             # REST client (service role key, Workers)
    twilio.js               # Twilio REST + signature validation
    cors.js                 # CORS for Pages Functions
```

## Environment Variables

### Frontend (.env.local)
| Variable | Description |
|---|---|
| VITE_SUPABASE_URL | Supabase project URL |
| VITE_SUPABASE_ANON_KEY | Supabase anon/public key |

### Workers (.dev.vars / Cloudflare Dashboard)
| Variable | Description |
|---|---|
| SUPABASE_URL | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key |
| TWILIO_ACCOUNT_SID | Twilio Account SID |
| TWILIO_AUTH_TOKEN | Twilio Auth Token |
| TWILIO_PHONE_NUMBER | Twilio phone number |
| TWILIO_MESSAGING_SERVICE_SID | Twilio Messaging Service SID |
| PAGES_URL | Production URL (auto in prod) |

## Auth Flow
1. User signs in via Supabase Auth (email/password)
2. AuthContext matches auth user → employee row by email
3. Nav permissions loaded by employee role
4. Dev mode: bypass auth, select employee directly

Note: `auth_user_id` is currently NULL on all 7 employees. Once Supabase Auth users are created, link them in the employees table.

## Deploy
Push to the GitHub branch connected to Cloudflare Pages. Cloudflare auto-builds:
- **Framework preset**: React (Vite)
- **Build command**: `npm run build`
- **Output directory**: `dist`
- **Workers**: Auto-detected from `functions/` directory
