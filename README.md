# Astrology Telegram Starter Kit

Build your astrology bot in 5 minutes.

A production-ready open-source Telegram bot starter built with Node.js, Telegraf, and FreeAstroApi. The project is intentionally small, readable, and easy to fork, while still showing real-world API usage:

- sign-based daily horoscope
- guided natal chart intake
- natal chart image generation
- interpretation-on-demand with Telegram buttons

## Why This Repo Exists

This project is meant to be a developer acquisition tool for FreeAstroApi.

It shows how to:

- structure a Telegram bot cleanly
- isolate API logic in a service layer
- handle multi-step user input
- call multiple astrology endpoints in a realistic flow
- keep the codebase simple enough to fork in minutes

## Features

- `/start` welcome message with quick command guidance
- `/daily <sign>` for a sign-based daily forecast
- `/natal` guided questionnaire for date, time, and city
- natal chart PNG generated from FreeAstroApi
- natal placements returned as separate messages with interpretation buttons
- top 5 major natal aspects returned with interpretation buttons
- support for unknown birth time
- clean env-based setup with no hardcoded secrets

## What The Bot Returns

### `/daily <sign>`

Uses FreeAstro's sign-wide daily endpoint and returns:

- theme
- category scores
- moon sign and moon phase
- lucky indicators
- short forecast text

Important:

- this is a generic sign forecast
- it is not a personalized natal/transit reading

### `/natal`

Runs a guided flow:

1. asks for name
2. asks for birth date
3. asks whether birth time is known
4. asks for birth time if available
5. asks for birth city

Then it returns:

- natal chart PNG
- natal snapshot summary
- one message per planet placement with a `Get interpretation` button
- top 5 major aspects with a `Get interpretation` button

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
│   │   ├── daily.js
│   │   ├── natal.js
│   │   └── start.js
│   ├── services/
│   │   └── freeastro.js
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

No database is required for the starter kit.

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
/daily leo
/natal
```

## Deploy On Render

This repo now supports **Telegram webhooks** for Render Web Services.

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
WEBHOOK_BASE_URL=https://your-service-name.onrender.com
WEBHOOK_PATH=/telegram/webhook
```

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
| `WEBHOOK_BASE_URL` | Render only | Public HTTPS base URL for webhook mode, for example `https://your-service-name.onrender.com` |
| `WEBHOOK_PATH` | Optional | Webhook route path, defaults to `/telegram/webhook` |

## Commands

### `/start`

Shows:

- project intro
- available commands
- quick usage hints

### `/daily <sign>`

Examples:

```text
/daily leo
/daily libra
/daily scorpio
```

Input rules:

- sign must be one of the 12 western zodiac signs
- capitalization does not matter

### `/natal`

This is a guided flow, not a one-line command.

The bot will ask for:

- name
- birth date
- birth time yes/no
- birth time if known
- city

Supported examples:

- `1990-05-15`
- `14:30`
- `Paris`
- `New York`

## Architecture

### `src/bot.js`

Application entrypoint:

- loads env vars
- validates required config
- creates the Telegraf bot
- registers commands
- adds global error handling

### `src/commands/*`

Thin Telegram handlers:

- `start.js` handles onboarding
- `daily.js` handles sign forecast requests
- `natal.js` handles the guided natal flow, chart image, and interpretation buttons

### `src/services/freeastro.js`

Single source of truth for FreeAstroApi access:

- base URL
- headers
- JSON parsing
- binary chart image requests
- API error normalization

### `src/utils/format.js`

Presentation helpers:

- sign normalization
- text formatting
- natal aspect ranking
- interpretation extraction
- Telegram-safe message chunking

## FreeAstro Endpoints Used

### Daily sign forecast

- `GET /api/v2/horoscope/daily/sign`

Used for:

- `/daily <sign>`

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

- PNG natal chart sent in Telegram before text results

## How Natal Interpretations Work

The bot does not dump the entire natal interpretation response by default.

Instead it turns the result into:

- planet placement messages with buttons
- top 5 major aspect messages with buttons

When a user taps `Get interpretation`, the bot returns the relevant interpretation block extracted from the FreeAstro response.

This keeps the main chat readable while still exposing rich API content.

## Error Handling

The service layer converts API failures into user-safe messages.

Handled cases include:

- missing API key
- invalid API key
- rate limits
- unknown city
- invalid JSON from upstream
- upstream 5xx failures

The bot also tolerates chart-image failure separately:

- if natal chart PNG generation fails
- the natal text response still proceeds

## Local Testing

### Syntax checks

```bash
node --check src/bot.js
node --check src/commands/daily.js
node --check src/commands/natal.js
node --check src/commands/start.js
node --check src/services/freeastro.js
node --check src/utils/format.js
```

### Manual Telegram test

1. Start the bot locally with `npm run dev`
2. Open your bot in Telegram
3. Send `/start`
4. Send `/daily leo`
5. Send `/natal`
6. Complete the guided intake
7. Tap a few `Get interpretation` buttons

### Expected natal behavior

You should receive:

- a chart image
- a natal summary
- planet placement messages
- 5 aspect messages
- working interpretation responses from the buttons

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

Run `/natal` again.

Interpretation button data is kept in memory for the running bot process and is not persisted.

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
- [Daily Sign Docs](https://www.freeastroapi.com/docs/western/daily-sign)
- [Geo Search Docs](https://www.freeastroapi.com/docs/geo/search)
- [Chart SVG / PNG Docs](https://www.freeastroapi.com/docs/western/chart-svg)

Get your API key: [FreeAstroApi Pricing](https://www.freeastroapi.com/pricing)

## License

MIT
