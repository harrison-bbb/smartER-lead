# SmartER Lead — Cold Email Outreach Platform

A full-featured cold email outreach platform inspired by Instantly.ai. Run it yourself, own your data, pay nothing per contact. Built with Node.js, Next.js, PostgreSQL, and Redis.


---

## What It Does

- **Multi-step email sequences** — enroll leads into automated follow-up chains with configurable delays between steps
- **Email account management** — connect via SMTP or Gmail OAuth, with per-account daily send limits
- **Email warmup** — built-in warmup pool system that gradually ramps sending volume and auto-rescues spam
- **Inbox (reply management)** — unified inbox across all campaigns with one-click intent tagging (Interested, Meeting Booked, Not Interested, Not Now, Out of Office)
- **AI reply drafts** — Claude AI reads the original email + prospect's reply and drafts a response for you
- **Deliverability tracking** — open and click tracking via pixel and redirect (requires public domain)
- **Lead management** — import via CSV, organize into lists, global blocklist for emails/domains
- **Analytics** — per-campaign stats (sent, opened, clicked, replied, bounced rates)
- **Email health scoring** — warmup health score (0–100) with recommended daily send limit based on ramp progress and reply rate

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm` |
| Docker Desktop | Latest | [docker.com](https://www.docker.com/products/docker-desktop) — runs Postgres + Redis |

---

## Setup (Local Dev — 5 minutes)

### 1. Clone the repo

```bash
git clone https://github.com/harrison-bbb/smartER-lead.git
cd smartER-lead
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# Required — generate with: openssl rand -hex 32
JWT_SECRET=your_64_char_hex_string
JWT_REFRESH_SECRET=your_different_64_char_hex_string

# Required — exactly 64 hex chars (32 bytes): openssl rand -hex 32
ENCRYPTION_KEY=your_64_char_hex_string

# Optional — needed for Gmail OAuth connect button
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional — needed for AI reply drafts in inbox
ANTHROPIC_API_KEY=
```

**Database and Redis** are pre-configured to use the Docker containers — no changes needed for local dev.

> **Generate secrets quickly:**
> ```bash
> openssl rand -hex 32   # run this 3 times — once for each key
> ```

### 4. Start Docker (database + Redis)

Make sure Docker Desktop is running, then:

```bash
docker compose up -d db redis
```

### 5. Run database migrations

This creates all the tables:

```bash
pnpm db:push
```

### 6. Start everything

```bash
bash start.sh
```

This script:
- Kills any processes already on ports 3000/3001
- Starts the API server (port 3001)
- Starts the background worker (campaign sends, reply detection, warmup)
- Starts the Next.js frontend (port 3000)
- Prints a status check when ready

Open **http://localhost:3000** and create your account.

---

## Email Account Setup

You have two ways to connect an email account:

### Option A — SMTP (any provider)

Works with Gmail, Outlook, Zoho, Namecheap, SendGrid, Mailgun, etc.

1. Go to **Accounts** → **Add Account**
2. Fill in your SMTP credentials:
   - **Host**: e.g. `smtp.gmail.com`
   - **Port**: `587` (TLS) or `465` (SSL)
   - **Username**: your email address
   - **Password**: your app password (see below for Gmail)
3. Fill in IMAP settings for reply detection:
   - **Host**: e.g. `imap.gmail.com`
   - **Port**: `993`
4. Set your daily send limit (start low — see Deliverability section)
5. Click **Test Connection** — green means you're good

**Gmail app password**: Gmail → Account → Security → 2-Step Verification → App passwords → create one. Use this instead of your real password.

### Option B — Gmail OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable the **Gmail API**
3. Create OAuth 2.0 credentials → Web application
4. Add `http://localhost:3001/auth/google/callback` as an authorized redirect URI
5. Copy Client ID and Client Secret into `.env`
6. Go to **Accounts** → **Connect Gmail**

---

## Testing Deliverability (Recommended Before Sending)

Before you send any campaigns, test that your emails won't hit spam. The goal is **10/10 on mail-tester.com**.

### Step 1 — Set up email authentication records (DNS)

Your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.) needs these DNS records:

**SPF** — authorizes your mail server to send for your domain:
```
Type: TXT
Name: @
Value: v=spf1 include:_spf.google.com ~all
       (replace with your provider's SPF value)
```

**DKIM** — cryptographic signature that proves emails aren't tampered:
- Gmail: Google Workspace Admin → Apps → Gmail → Authenticate email
- SMTP providers (Zoho, Namecheap Mail, etc.) — check their docs for DKIM setup

**DMARC** — tells receivers what to do with failed auth:
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:you@yourdomain.com
```

### Step 2 — Test with mail-tester.com

1. Go to [mail-tester.com](https://mail-tester.com) — it gives you a unique test email address
2. Send a test email to that address (directly from your mail client, not through this platform yet)
3. Click **Check your score**
4. Fix any issues it flags before you start sending campaigns

**Common issues and fixes:**

| Issue | Fix |
|---|---|
| SPF not found | Add SPF TXT record to your domain DNS |
| DKIM not configured | Enable DKIM in your mail provider |
| Reverse DNS mismatch | Contact your hosting provider |
| Blacklisted IP | Use a dedicated sending IP or switch providers |
| HTML-only email | The platform automatically generates a plain text version |

### Step 3 — Warm up before blasting

Never start with your full daily limit. Use the built-in warmup feature (see below).

---

## Email Warmup

Sending from a cold domain/IP immediately results in spam flags. The warmup system gradually builds your sender reputation.

### How it works

1. Go to **Warmup** → **Create Pool**
2. Add your email accounts to the pool
3. The system automatically sends warmup emails between accounts in the pool, replies to them, and rescues them from spam
4. Volume ramps up each day: starts at 2/day → increases toward your max target
5. Each account gets a **health score** (0–100) based on ramp progress, reply rate, and spam rescue rate

### Health score breakdown

- **0–39** (Red): Account is cold — do not send campaigns yet
- **40–69** (Yellow): Warming up — send very conservatively (< 20/day)
- **70–100** (Green): Warmed up — you can send at the recommended limit

### Recommended daily limit

On the **Accounts** page, each warmed account shows a recommended daily send limit. Click **Sync** to apply it automatically. The formula scales from 10/day (cold) to 200/day (fully warmed).

### Warmup best practices

- Run warmup for at least **2–4 weeks** before starting real campaigns
- Never exceed the recommended limit even after warmup
- If you add a new sending domain, start it in the pool first
- Keep warmup running even while sending campaigns — it maintains reputation

---

## Campaigns

### Creating a campaign

1. **Campaigns** → **New Campaign**
2. Set the campaign name and select your email account
3. Select or create a **Lead List**
4. Build your **email sequence**:
   - Step 1: subject + body (supports `{{firstName}}`, `{{company}}`, `{{lastName}}` merge tags)
   - Step 2+: follow-ups with delay in days (e.g., delay 3 days for a follow-up)
5. Configure **sending schedule** (hours, days of week, timezone, daily limit)
6. Click **Start** to launch

### Merge tags

In your email subject and body, use double-curly-brace tags:

```
{{firstName}}    — lead's first name
{{lastName}}     — lead's last name
{{company}}      — lead's company
{{title}}        — lead's job title
{{email}}        — lead's email address
```

Any custom fields on your leads are also available as `{{fieldName}}`.

### Auto-stop on reply

When a lead replies, they are automatically removed from the sequence. No more follow-ups get sent to someone who already responded.

### Campaign analytics

Click a campaign to see:
- Sent / Opened / Clicked / Replied counts and rates
- Per-step analytics
- Individual lead statuses

---

## Inbox

All replies from all campaigns appear in the unified Inbox.

### Intent tagging

When you open a reply, tag it with one click:

| Tag | Color | Meaning |
|---|---|---|
| Interested | Green | Prospect wants to learn more |
| Meeting Booked | Blue | Call is scheduled |
| Not Interested | Red | Pass — remove from future outreach |
| Not Now | Orange | Good prospect, wrong timing |
| Out of Office | Grey | Auto-reply — follow up later |

Tags appear as colored dots in the reply list and can be filtered via the pills at the top of the left panel.

### AI reply drafts

If you have an `ANTHROPIC_API_KEY` configured, open any reply and click **Draft with AI**. Claude reads:
- The original email you sent them
- Their reply

And writes a concise 2–4 sentence follow-up for you to edit and send. You stay in control — the draft is just a starting point.

### Sending replies

Type your reply in the compose box and click **Send Reply**. The reply threads correctly using `In-Reply-To` headers.

---

## Leads

### Importing leads

1. **Leads** → **Import CSV**
2. CSV must have an `email` column. Supported columns:
   ```
   email, firstName, lastName, company, title, phone, website
   ```
3. Extra columns become custom fields accessible as `{{columnName}}` in templates

### Lists

Organize leads into lists and assign a list to a campaign. One list can be used across multiple campaigns.

### Blocklist

**Settings** → **Blocklist** — add individual emails or entire domains. Blocklisted leads are skipped automatically during campaign sends, even if they're in a list.

---

## Architecture

```
┌──────────────────┐     ┌──────────────────────────────┐
│  Next.js (3000)  │────▶│  Express API (3001)          │
│  React frontend  │     │  - Auth (JWT)                │
└──────────────────┘     │  - Campaigns, Leads, Inbox   │
                         │  - Email accounts             │
                         └──────────┬───────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             PostgreSQL           Redis          Worker
             (Drizzle ORM)     (BullMQ)       (background)
                                                   │
                                     ┌─────────────┼──────────────┐
                                     ▼             ▼              ▼
                               Campaign        Reply           Warmup
                               Sender          Detector        Engine
```

**Key components:**

- **API** (`apps/api`) — Express.js REST API, JWT auth, Drizzle ORM for PostgreSQL
- **Worker** (`apps/api/src/worker.ts`) — BullMQ workers for campaign sending, IMAP reply detection, email warmup
- **Frontend** (`apps/web`) — Next.js 14 app router, Tailwind CSS, SWR for data fetching
- **Queues** — BullMQ on Redis: `campaign-send`, `reply-detect`, `warmup`
- **Shared** (`packages/shared`) — shared TypeScript types

---

## Production Deployment

> The Docker Compose file includes production service definitions for api, worker, and web. Here's the recommended flow:

### 1. Build all images

```bash
docker compose build
```

### 2. Configure production `.env`

Set `TRACKING_DOMAIN` to your public HTTPS domain. This enables open/click tracking:

```env
TRACKING_DOMAIN=https://yourdomain.com
```

### 3. Run migrations

```bash
docker compose run --rm api node -e "import('./dist/db/index.js').then(({db})=>console.log('ok'))"
# or just run: pnpm db:migrate inside the container
```

### 4. Start all services

```bash
docker compose up -d
```

Services:
- **db** — PostgreSQL 16
- **redis** — Redis 7
- **api** — Express API on port 3001
- **worker** — BullMQ background worker
- **web** — Next.js on port 3000

Put a reverse proxy (Nginx, Caddy, Cloudflare Tunnel) in front to handle HTTPS.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_HOST` | Yes | Redis host (default: localhost) |
| `REDIS_PORT` | Yes | Redis port (default: 6379) |
| `JWT_SECRET` | Yes | 32-byte hex secret for access tokens |
| `JWT_REFRESH_SECRET` | Yes | 32-byte hex secret for refresh tokens |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for encrypting SMTP passwords |
| `TRACKING_DOMAIN` | No | Public HTTPS domain for open/click tracking |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID (Gmail connect) |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | No | OAuth callback URL |
| `ANTHROPIC_API_KEY` | No | Claude API key for AI reply drafts |
| `PORT` | No | API port (default: 3001) |
| `WEB_URL` | No | Frontend URL for CORS |
| `NEXT_PUBLIC_API_URL` | No | API URL the browser uses |

---

## Troubleshooting

**API fails to start**
```bash
cat /tmp/outreach-api.log
```
Most common causes: Docker not running, wrong DATABASE_URL, port 3001 already in use.

**"Failed to fetch" errors in the UI**
Docker Desktop isn't running or the containers aren't up. Fix:
```bash
open -a Docker   # wait 10 seconds
docker compose up -d db redis
bash start.sh
```

**Emails going to spam**
- Check mail-tester.com score (aim for 10/10)
- Verify SPF, DKIM, DMARC are set up on your domain
- Run warmup for 2–4 weeks before sending campaigns
- Lower your daily send limit

**IMAP reply detection not working**
- Verify IMAP credentials (host, port, username, password) on the account
- Ensure IMAP is enabled in your mail provider settings
- Gmail: enable IMAP in Gmail settings, use an app password

**Warmup emails not sending**
- Make sure the background worker is running (check `/tmp/outreach-worker.log`)
- Accounts in the pool must have status `active`
- Check that Redis is running: `docker compose ps redis`

**Database schema out of date after pulling updates**
```bash
pnpm db:push
```

---

## Contributing

PRs welcome. Please open an issue first for large changes.

---

## License

MIT
