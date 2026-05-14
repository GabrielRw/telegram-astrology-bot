# Monthly Transit Timeline

Print-first monthly transit calendar using the FreeAstro monthly timeline endpoint and Paged.js.

## Run

```bash
npm start
```

Open `http://127.0.0.1:4173`.

## Config

- Edit [`config/chart.json`](/Users/gabriel/Documents/telegram-bot/Horoscope%20Calendar/config/chart.json) to change the month, natal profile, filters, or theme.
- Keep the API key in `config.local.json` or set `FREE_ASTRO_API_KEY` in the shell before starting the server.

## Notes

- The browser uses a local proxy endpoint so the API key does not need to be embedded in the client.
- Paged.js is loaded from `unpkg` with `auto: false`, then triggered after the SVG chart finishes rendering.
- The current version renders one row per transit and one A3 portrait page per month.
