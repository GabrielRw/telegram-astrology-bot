# Astrology Messaging Starter Kit

Build your astrology bot in 5 minutes.

A production-ready open-source astrology bot starter built with Node.js, Telegraf, Meta WhatsApp Cloud API, and FreeAstroApi. The project is intentionally small, readable, and easy to fork, while still showing real-world API usage:

- guided birth-data intake
- natal chart image generation
- shared messaging core with Telegram and WhatsApp adapters
- conversational astrologer mode grounded in cached natal data
- Gemini + FreeAstro MCP integration for follow-up chart questions
- locale-aware UX in English, French, German, and Spanish

## Why This Repo Exists

This project is meant to be a developer acquisition tool for FreeAstroApi.

It shows how to:

- structure a messaging bot cleanly
- isolate API logic in a service layer
- handle multi-step user input
- call multiple astrology endpoints in a realistic flow
- keep the codebase simple enough to fork in minutes

## Features

- `/start` guided onboarding and re-entry
- `/profile` to inspect, update, reset, or view the saved chart
- `/language` to switch the bot UI and answer language
- `/billing` and `/subscribe` for plan status and Stripe checkout
- shared conversation and natal-intake core across channels
- direct plain-language onboarding that can start natal intake from a normal chat message
- natal chart PNG available on demand
- top 3 city matches returned as inline buttons for confirmation
- explicit numeric fallback for city confirmation if buttons do not render
- plain-language astrologer chat after setup
- cached chart tools plus FreeAstro MCP-backed follow-up answers
- Supabase-backed persistence for saved profiles, onboarding state, and pending questions
- durable webhook event queue with idempotent Telegram and WhatsApp event handling
- structured JSON logs plus Telegram error alerts
- WhatsApp Meta Cloud API webhook support with conversation-first UX
- locale detection from platform language, then birth-country fallback
- support for unknown birth time
- clean env-based setup with no hardcoded secrets
- 3 free chart questions per day, then Stripe-hosted upgrade flow to unlimited questions for $4/month
- Stripe webhook sync for subscription status plus Customer Portal management links

### Guided setup

The first profile setup now asks only for:

1. birth date
2. birth city
3. whether birth time is known
4. birth time, if available

After setup, users can ask conversational chart questions like:

- `What is my rising sign?`
- `What does my Sun in Taurus in the 9th house mean?`
- `Which major aspect is strongest in my chart?`
- `Summarize my chart in 3 paragraphs`

If birth time is unknown:

- the API still computes a natal chart
- houses and angles are unavailable
- Rising sign is omitted

## Project Structure

```text
telegram-astrology-bot/
├── src/
│   ├── bot.js
│   ├── commands/
│   │   ├── chat.js
│   │   ├── language.js
│   │   ├── natal.js
│   │   ├── profile.js
│   │   └── start.js
│   ├── i18n/
│   │   └── catalog.js
│   ├── services/
│   │   ├── conversation.js
│   │   ├── freeastro.js
│   │   ├── freeastroMcp.js
│   │   ├── gemini.js
│   │   └── locale.js
│   ├── state/
│   │   └── chatState.js
│   └── utils/
│       └── format.js
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

## Stack

- Node.js 24+
- Telegraf
- native `fetch`
- dotenv

No database is required for local development. Supabase is optional for durable state in production.

## Quick Start

### 1. Clone

```bash
git clone https://github.com/GabrielRw/telegram-astrology-bot.git
cd telegram-astrology-bot
```

### 2. Install

```bash
npm install
```

### 3. Create `.env`

```bash
cp .env.example .env
```

Add:

```env
BOT_TOKEN=your_telegram_bot_token
FREEASTRO_API_KEY=your_freeastro_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemma-4-31b-it
FREEASTRO_MCP_URL=https://api.freeastroapi.com/mcp
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
TELEGRAM_ALERT_CHAT_ID=
```

### 4. Run

```bash
npm run dev
```

### 5. Open Telegram

Open your bot chat and send:

```text
/start
```

Then try:

```text
/profile
/language
```

Then ask a plain text question:

```text
What is my rising sign?
```

## Deploy On Render

This repo now supports Telegram and WhatsApp webhooks in one Node service.

Deployment mode:

- local development: polling mode
- Render production: webhook mode

### Recommended Render setup

Create a new **Web Service** on Render:

- connect the GitHub repo
- build command: `npm install`
- start command: `npm start`
- health check path: `/healthz`

Or use the included [render.yaml](/Users/gabriel/Documents/telegram-bot/render.yaml) with Render Blueprints.

### Render environment variables

Add these in Render:

```env
BOT_TOKEN=your_telegram_bot_token
FREEASTRO_API_KEY=your_freeastro_api_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemma-4-31b-it
FREEASTRO_MCP_URL=https://api.freeastroapi.com/mcp
TELEGRAM_ALERT_CHAT_ID=
WEBHOOK_BASE_URL=https://your-service-name.onrender.com
WEBHOOK_PATH=/telegram/webhook
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_MONTHLY_PRICE_ID=price_xxx
STRIPE_WEBHOOK_PATH=/stripe/webhook
WHATSAPP_ACCESS_TOKEN=your_meta_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_whatsapp_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_whatsapp_verify_token
WHATSAPP_WEBHOOK_PATH=/whatsapp/webhook
```

Before first production deploy, run the SQL in [schema.sql](/Users/gabriel/Documents/telegram-bot/supabase/schema.sql) against your Supabase project.

Create a recurring Stripe price for `$4/month`, copy its price id into `STRIPE_MONTHLY_PRICE_ID`, and point your Stripe webhook endpoint at `https://your-service-name.onrender.com/stripe/webhook`.

### Important

- this bot must have a public HTTPS URL in webhook mode
- `WEBHOOK_BASE_URL` should match your Render public URL exactly
- the webhook path defaults to `/telegram/webhook`
- rotate the old exposed secrets before deploying to production

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `BOT_TOKEN` | Yes | Telegram bot token from BotFather |
| `FREEASTRO_API_KEY` | Yes | FreeAstroApi secret key |
| `GEMINI_API_KEY` | Chat mode | Gemini API key for conversational astrologer mode |
| `GEMINI_MODEL` | Optional | Gemini model id, defaults to `gemma-4-31b-it` |
| `FREEASTRO_MCP_URL` | Optional | FreeAstro MCP endpoint, defaults to `https://api.freeastroapi.com/mcp` |
| `SUPABASE_URL` | Production | Supabase project URL used for durable state and event storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Supabase service role key used for persistence and webhook queueing |
| `TELEGRAM_ALERT_CHAT_ID` | Optional | Telegram chat id that receives owner alerts when FreeAstro API credits are exhausted or operational failures happen |
| `WEBHOOK_BASE_URL` | Render only | Public HTTPS base URL for webhook mode, for example `https://your-service-name.onrender.com` |
| `WEBHOOK_PATH` | Optional | Webhook route path, defaults to `/telegram/webhook` |
| `STRIPE_SECRET_KEY` | Billing | Stripe secret key used to create Checkout and Customer Portal sessions |
| `STRIPE_WEBHOOK_SECRET` | Billing | Stripe webhook signing secret for subscription sync |
| `STRIPE_MONTHLY_PRICE_ID` | Billing | Stripe recurring monthly price id for the unlimited plan |
| `STRIPE_WEBHOOK_PATH` | Optional | Stripe webhook route path, defaults to `/stripe/webhook` |
| `APP_BASE_URL` | Optional | Optional override for hosted billing success and return pages; falls back to `WEBHOOK_BASE_URL` |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp only | Meta Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp only | Meta Cloud API phone number id |
| `WHATSAPP_VERIFY_TOKEN` | WhatsApp only | Verify token used for Meta webhook challenge |
| `WHATSAPP_WEBHOOK_PATH` | Optional | Webhook route path, defaults to `/whatsapp/webhook` |

## Commands

### `/start`

Starts onboarding for new users and shows localized re-entry prompts for returning users.

### `/profile`

Shows the saved birth details and offers:

- update
- reset
- show chart

### `/language`

Lets the user switch between:

- English
- Français
- Deutsch
- Español

### `/billing`

Shows the current quota or unlimited plan status. If the user already subscribed, it also returns a Stripe Customer Portal link.

### `/subscribe`

Creates a Stripe Checkout link for the `$4/month` unlimited plan.

### Conversational chart chat

Any plain-text message that is not a command can start the AI flow.

Behavior:

- if no natal profile exists yet, the bot stores the user question, starts setup, and asks for the missing birth data conversationally
- once the natal chart is complete, the bot automatically returns to the original question and answers it from the chart
- if a natal profile already exists, the message is handled as a chart question immediately

Examples:

```text
What is my rising sign?
What does my Venus placement say about relationships?
Which major aspect is the strongest in my chart?
Summarize my chart in 3 paragraphs.
```

Strict gating:

- before a natal profile exists, the bot does not improvise personal readings
- it collects the missing birth data first, then answers the original question

## Architecture

### `src/bot.js`

Application entrypoint:

- loads env vars
- validates required config
- creates the Telegraf bot
- registers commands
- adds global error handling

### `src/commands/*`

Thin channel handlers:

- `start.js`, `language.js`, `natal.js`, `profile.js`, and `chat.js` bind Telegram events to the shared controller
- WhatsApp webhook handling uses the same shared controller through a Meta adapter

### Shared runtime

- one service can expose both `/telegram/webhook` and `/whatsapp/webhook`
- Telegram can still run in polling mode locally when webhook mode is not enabled

### `src/services/freeastro.js`

Single source of truth for FreeAstroApi access:

- base URL
- headers
- JSON parsing
- binary chart image requests
- API error normalization

### `src/services/gemini.js`

Gemini orchestration:

- official Google GenAI SDK
- function declarations for cached chart tools
- function-calling loop
- user-safe Gemini error normalization

### `src/services/freeastroMcp.js`

FreeAstro MCP adapter:

- MCP `streamable-http` transport
- tool discovery
- tool name sanitization for Gemini function calling
- tool execution wrapper

### `src/services/conversation.js`

Conversation orchestration:

- strict natal gating
- cached chart tool execution
- MCP fallback when more chart data is needed
- history and tool-result updates
- locale-aware Gemini response-language control

### `src/services/locale.js` and `src/i18n/catalog.js`

Localization:

- locale resolution from manual choice, platform language, and birth country
- translated UI copy for Telegram and WhatsApp
- localized suggestion prompts and button labels

### `src/state/chatState.js`

In-memory per-chat state:

- natal profile
- raw natal payload
- chat history
- active flow
- recent tool results

When Supabase is configured, this state is also persisted and rehydrated on restart.

### `src/services/persistence.js`

Conversation persistence:

- hydrates chat state and onboarding state from Supabase
- debounces writes from the in-memory store
- persists pending question, saved profile, and active intake session

### `src/services/eventQueue.js`

Durable webhook processing:

- idempotent event insert by provider event key
- background worker for Telegram and WhatsApp webhook events
- retry with backoff for transient failures
- dead-letter style terminal status after repeated failures

### `src/services/logger.js`

Operational logging:

- structured JSON logs
- shared error-reporting helper
- optional Telegram owner alerts for operational failures

### `src/utils/format.js`

Presentation helpers:

- natal summary formatting
- natal aspect ranking
- interpretation extraction
- Telegram-safe message chunking

## FreeAstro Endpoints Used

### Geo search

- `GET /api/v1/geo/search`

Used for:

- resolving the natal birth city to coordinates and timezone

### Natal calculation

- `POST /api/v1/natal/calculate`

Used for:

- natal placements
- houses and angles
- aspects
- interpretation blocks

### Natal chart image

- `POST /api/v1/natal/chart/`

Used for:

- PNG natal chart returned on demand from `/profile`

### FreeAstro MCP

- `https://api.freeastroapi.com/mcp`

Used for:

- conversational chart questions that need specific tool-backed data beyond the cached natal profile

## How Conversational Mode Works

Conversational mode is chart-grounded, not free-form.

Rules:

- no natal profile: the bot starts natal intake, collects the missing data, and resumes the original question after the chart is created
- natal profile available: the bot answers follow-up questions using cached chart data first
- if cached data is insufficient, the bot may call FreeAstro MCP tools
- the bot should not invent missing chart facts

Conversation memory is still kept in process for fast access:
- each chat gets a short rolling history
- natal profile data is reused across follow-up messages
- when Supabase is configured, profile, pending question, and onboarding state survive restarts

## Error Handling

The service layer converts API failures into user-safe messages.

Handled cases include:

- missing API key
- invalid API key
- rate limits
- unknown city
- invalid JSON from upstream
- upstream 5xx failures
- invalid Gemini API key
- invalid Gemini model id
- FreeAstro MCP connectivity/auth failures
- duplicate webhook delivery
- transient webhook handler failures via queued retry

The bot also tolerates chart-image failure separately:

- if natal chart PNG generation fails
- the natal text response still proceeds

## Local Testing

### Syntax checks

```bash
node --check src/bot.js
node --check src/commands/chat.js
node --check src/commands/language.js
node --check src/commands/natal.js
node --check src/commands/profile.js
node --check src/commands/start.js
node --check src/services/conversation.js
node --check src/services/freeastro.js
node --check src/services/freeastroMcp.js
node --check src/services/gemini.js
node --check src/state/chatState.js
node --check src/utils/format.js
```

### Manual Telegram test

1. Start the bot locally with `npm run dev`
2. Open your bot in Telegram
3. Send `/start`
4. Complete the guided intake
5. When asked for a city, tap one of the city buttons or reply `1`, `2`, or `3`
6. Ask a plain text chart question
7. Send `/language` and switch locale
8. Send `/profile`
9. Use `Show chart`

To test persistence and queueing:

1. Configure Supabase and run [schema.sql](/Users/gabriel/Documents/telegram-bot/supabase/schema.sql)
2. Complete setup in Telegram or WhatsApp
3. Restart the bot process
4. Confirm `/profile` still shows the saved birth details
5. Send a new message and confirm the conversation continues without re-onboarding

You can also test the direct onboarding path:

1. Start a fresh chat with no natal profile
2. Send a plain-language question like `What does my Venus placement say about relationships?`
3. Let the bot collect date, city, and optional time
4. Confirm the city from the inline buttons
5. Verify that the bot answers the original question after building the chart

### Expected guided behavior

You should receive:

- city confirmation buttons before natal calculation
- a direct answer to the original question after setup
- a short follow-up prompt suggesting what to ask next
- chart access through `/profile`

## Troubleshooting

### The bot does not answer in Telegram

Check:

- the bot process is still running
- the token in `.env` is correct
- you are messaging the correct bot username

### The city is not found

Try:

- adding the country
- using a larger nearby city
- simplifying punctuation

If multiple places match, the bot returns the top 3 results as buttons and waits for the user to confirm the correct city before calculating the chart.

Examples:

- `Paris France`
- `Mexico City`
- `New York`

### Birth time unknown

That is supported.

The bot will continue, but:

- Rising sign is unavailable
- houses and angles are unavailable
- confidence may be lower

### A button says details expired

Run `/profile` or `/start` again.

### Conversational mode says Gemini is unavailable

Check:

- `GEMINI_API_KEY` is set
- the key is valid for the Gemini API
- `GEMINI_MODEL` is a valid model id for your account

If the key was pasted in chat or logs, rotate it before production use.

### Conversational mode answers only after setup

This is intentional.

The bot is configured in strict chart-based mode:

- no chart, no personal astrology answer
- complete setup first, then ask follow-up questions

## Publishing Notes

This repo intentionally avoids:

- databases
- auth systems
- unnecessary dependencies
- frontend UI
- framework overengineering

That makes it suitable as:

- a starter kit
- a demo repo
- a base for premium astrology products

## Security

- never commit `.env`
- rotate any token or API key that has been pasted into chat or logs
- use `.env.example` for placeholders only

## Resources

- [FreeAstroApi Documentation](https://www.freeastroapi.com/docs)
- [Western Natal Docs](https://www.freeastroapi.com/docs/western/natal)
- [Geo Search Docs](https://www.freeastroapi.com/docs/geo/search)
- [Chart SVG / PNG Docs](https://www.freeastroapi.com/docs/western/chart-svg)
- [FreeAstro MCP endpoint](https://api.freeastroapi.com/mcp)
- [Gemini function calling docs](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemma on Gemini API docs](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)

Get your API key: [FreeAstroApi Pricing](https://www.freeastroapi.com/pricing)

## License

MIT
