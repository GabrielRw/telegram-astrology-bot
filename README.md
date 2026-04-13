# Astrology Telegram Starter Kit

Build your astrology bot in 5 minutes.

A production-ready open-source Telegram bot starter built with Node.js, Telegraf, and FreeAstroApi. The project is intentionally small, readable, and easy to fork, while still showing real-world API usage:

- sign-based daily horoscope
- guided natal chart intake
- natal chart image generation
- interpretation-on-demand with Telegram buttons
- conversational astrologer mode grounded in cached natal data
- Gemini + FreeAstro MCP integration for follow-up chart questions

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
- direct plain-language onboarding that can start natal intake from a normal chat message
- natal chart PNG generated from FreeAstroApi
- top 3 city matches returned as inline buttons for confirmation
- natal placements returned as separate messages with interpretation buttons
- top 5 major natal aspects returned with interpretation buttons
- plain-language astrologer chat after `/natal`
- cached chart tools plus FreeAstro MCP-backed follow-up answers
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
6. shows up to 3 city matches as buttons so the user confirms the right location

Then it returns:

- natal chart PNG
- natal snapshot summary
- one message per planet placement with a `Get interpretation` button
- top 5 major aspects with a `Get interpretation` button

After `/natal`, users can ask conversational chart questions like:

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
│   │   ├── daily.js
│   │   ├── natal.js
│   │   └── start.js
│   ├── services/
│   │   ├── conversation.js
│   │   ├── freeastro.js
│   │   ├── freeastroMcp.js
│   │   └── gemini.js
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
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemma-4-31b-it
FREEASTRO_MCP_URL=https://api.freeastroapi.com/mcp
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

Then ask a plain text question:

```text
What is my rising sign?
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
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemma-4-31b-it
FREEASTRO_MCP_URL=https://api.freeastroapi.com/mcp
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
| `GEMINI_API_KEY` | Chat mode | Gemini API key for conversational astrologer mode |
| `GEMINI_MODEL` | Optional | Gemini model id, defaults to `gemma-4-31b-it` |
| `FREEASTRO_MCP_URL` | Optional | FreeAstro MCP endpoint, defaults to `https://api.freeastroapi.com/mcp` |
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

### Conversational chart chat

Any plain-text message that is not a command can start the AI flow.

Behavior:

- if no natal profile exists yet, the bot stores the user question, starts natal intake, and asks for the missing birth data conversationally
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

Thin Telegram handlers:

- `start.js` handles onboarding
- `daily.js` handles sign forecast requests
- `natal.js` handles the guided natal flow, chart image, and interpretation buttons
- `chat.js` handles plain-text astrologer conversations after a natal profile exists

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

### `src/state/chatState.js`

In-memory per-chat state:

- natal profile
- raw natal payload
- chat history
- active flow
- recent tool results

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

### FreeAstro MCP

- `https://api.freeastroapi.com/mcp`

Used for:

- conversational chart questions that need specific tool-backed data beyond the cached natal profile

## How Natal Interpretations Work

The bot does not dump the entire natal interpretation response by default.

Instead it turns the result into:

- planet placement messages with buttons
- top 5 major aspect messages with buttons

When a user taps `Get interpretation`, the bot returns the relevant interpretation block extracted from the FreeAstro response.

This keeps the main chat readable while still exposing rich API content.

## How Conversational Mode Works

Conversational mode is chart-grounded, not free-form.

Rules:

- no natal profile: the bot starts natal intake, collects the missing data, and resumes the original question after the chart is created
- natal profile available: the bot answers follow-up questions using cached chart data first
- if cached data is insufficient, the bot may call FreeAstro MCP tools
- the bot should not invent missing chart facts

The current memory model is in-memory only:

- each Telegram chat gets a short rolling history
- natal profile data is reused across follow-up messages
- history is lost on process restart

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

The bot also tolerates chart-image failure separately:

- if natal chart PNG generation fails
- the natal text response still proceeds

## Local Testing

### Syntax checks

```bash
node --check src/bot.js
node --check src/commands/chat.js
node --check src/commands/daily.js
node --check src/commands/natal.js
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
4. Send `/daily leo`
5. Send `/natal`
6. Complete the guided intake
7. When asked for a city, tap one of the city buttons
8. Tap a few `Get interpretation` buttons
9. Ask a plain text chart question

You can also test the direct onboarding path:

1. Start a fresh chat with no natal profile
2. Send a plain-language question like `What does my Venus placement say about relationships?`
3. Let the bot collect name, date, time, and city
4. Confirm the city from the inline buttons
5. Verify that the bot answers the original question after building the chart

### Expected natal behavior

You should receive:

- a chart image
- a natal summary
- planet placement messages
- 5 aspect messages
- city confirmation buttons before natal calculation
- working interpretation responses from the buttons
- grounded answers to plain-language chart questions after `/natal`

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

Run `/natal` again.

Interpretation button data is kept in memory for the running bot process and is not persisted.

### Conversational mode says Gemini is unavailable

Check:

- `GEMINI_API_KEY` is set
- the key is valid for the Gemini API
- `GEMINI_MODEL` is a valid model id for your account

If the key was pasted in chat or logs, rotate it before production use.

### Conversational mode answers only after `/natal`

This is intentional.

The bot is configured in strict chart-based mode:

- no chart, no personal astrology answer
- complete `/natal` first, then ask follow-up questions

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
- [FreeAstro MCP endpoint](https://api.freeastroapi.com/mcp)
- [Gemini function calling docs](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemma on Gemini API docs](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)

Get your API key: [FreeAstroApi Pricing](https://www.freeastroapi.com/pricing)

## License

MIT
