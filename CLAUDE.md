# SmartER Lead — Setup Guide for Claude Code

This file tells you (Claude Code) how to set up this project for the user. Follow these steps in order. Run commands automatically where you can — don't ask the user to run things you can run yourself.

---

## What This Project Is

A self-hosted cold email outreach platform (like Instantly.ai). It sends email sequences, tracks replies, warms up email accounts, and has an AI-powered inbox. It requires Node.js, pnpm, and Docker Desktop.

---

## Step 1 — Check Prerequisites

Run these checks and tell the user what's missing before proceeding:

```bash
node --version          # Need 20+
pnpm --version          # Need 9+ (install with: npm install -g pnpm)
docker --version        # Need Docker Desktop running
docker ps               # If this errors, Docker Desktop isn't running — tell the user to open it
```

If Docker isn't running, tell the user: "Please open Docker Desktop and wait for it to fully start, then let me know."

---

## Step 2 — Install Dependencies

```bash
pnpm install
```

---

## Step 3 — Create and Configure .env

```bash
cp .env.example .env
```

Then generate the three required secrets and write them directly into `.env`:

```bash
# Generate JWT_SECRET
JWT_SECRET=$(openssl rand -hex 32)

# Generate JWT_REFRESH_SECRET  
JWT_REFRESH_SECRET=$(openssl rand -hex 32)

# Generate ENCRYPTION_KEY
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Use the Edit tool to replace the placeholder values in `.env` with the generated secrets. The `.env` file has these lines that need real values:

```
JWT_SECRET=change_me_generate_with_openssl_rand_hex_32
JWT_REFRESH_SECRET=change_me_generate_with_openssl_rand_hex_32_different
ENCRYPTION_KEY=change_me_generate_with_openssl_rand_hex_32_exactly_64_chars_here
```

After editing, ask the user:
- "Do you have an Anthropic API key? If yes, paste it and I'll add it to your .env for AI reply drafts." (ANTHROPIC_API_KEY)
- "Do you want Gmail OAuth (Connect Gmail button)? If yes, I'll walk you through getting a Google Cloud client ID." (optional — skip if they say no)

Leave `TRACKING_DOMAIN=` empty — this is correct for local dev.

---

## Step 4 — Start Everything

```bash
bash start.sh
```

This script automatically:
- Starts Postgres and Redis via Docker
- Waits for the database to be healthy
- Runs database migrations (creates all tables)
- Starts the API on port 3001
- Starts the background worker
- Starts the Next.js frontend on port 3000

**First run takes 30–60 seconds** because Docker pulls images and Next.js compiles. Subsequent starts are fast.

Watch for the output lines:
- `✅ API running at http://localhost:3001` — good
- `✅ Frontend running at http://localhost:3000` — good
- `❌ API failed to start` — check `/tmp/outreach-api.log`
- `❌ Frontend failed to start` — check `/tmp/outreach-web.log`

---

## Step 5 — Verify It Works

```bash
curl -s http://localhost:3001/health
```

Should return `{"status":"ok"}`. Then tell the user to open **http://localhost:3000** in their browser and create an account.

---

## Common Failures and Fixes

**"Failed to fetch" errors in the UI**
Docker isn't running or containers crashed.
```bash
docker compose up -d db redis
# Then restart start.sh
```

**API fails with Postgres connection error**
Database isn't ready yet or DATABASE_URL is wrong.
```bash
docker compose ps   # check db container is "healthy"
cat /tmp/outreach-api.log   # read the error
```

**Port already in use**
```bash
lsof -ti:3001,3000 | xargs kill -9
```
Then re-run `bash start.sh`.

**pnpm: command not found**
```bash
npm install -g pnpm
```

**`openssl` not found (Windows)**
On Windows, generate secrets at https://generate-secret.vercel.app/64 — paste three different values into `.env`.

---

## Project Structure (for context)

```
apps/
  api/          Express.js REST API + BullMQ workers
    src/
      routes/   API endpoints (campaigns, leads, inbox, accounts, warmup...)
      queues/   Background jobs (campaign-send, reply-detect, warmup)
      db/       Drizzle ORM schema + migrations
      lib/      Email sending, IMAP, crypto, JWT
  web/          Next.js 14 frontend
    app/        Pages (campaigns, leads, inbox, warmup, accounts...)
    components/ Shared UI components
packages/
  shared/       Shared TypeScript types
docker-compose.yml   Postgres + Redis (+ production api/worker/web)
start.sh             Local dev startup script
```

---

## After Setup — First Things to Do

Tell the user these next steps:

1. **Connect an email account** — Go to Accounts → Add Account. Use SMTP credentials. For Gmail, they need an "App Password" (Gmail Settings → Security → 2-Step Verification → App Passwords).

2. **Test deliverability** — Before sending any campaigns, go to mail-tester.com, get a test address, send an email to it from their mail client, check the score. Aim for 10/10. Fix SPF/DKIM/DMARC if needed.

3. **Start warmup** — Go to Warmup → Create Pool → add their account. Run warmup for 2–4 weeks before sending real campaigns.

4. **Import leads** — Go to Leads → Import CSV. Column headers: `email, firstName, lastName, company, title`.

5. **Create a campaign** — Campaigns → New Campaign → add sequence steps → select lead list → Start.
