# WhatsApp command bot

A small WhatsApp bot with a browser-based pairing dashboard. Enter your own WhatsApp number on the page to request a pairing code; after linking, send commands that start with a hyphen (`-`) in a WhatsApp chat.

> **Important:** pairing codes are a WhatsApp Web linking feature, not part of Meta's official WhatsApp Cloud API. This project uses the community-maintained, unofficial Baileys library (pinned to a v7 release candidate), so WhatsApp protocol or library changes can break it. It is not affiliated with WhatsApp, and unofficial automation may be unsupported or put an account at risk. Use only with your own account and do not use it for bulk messaging or spam. If you need a supported business integration, use the official Cloud API instead; that uses webhook verification rather than a phone pairing code.

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
cp .env.example .env   # optional; defaults work without this file
npm start
```

Open `http://localhost:3000`. To use another port or auth directory, set `PORT` or `AUTH_DIR` in `.env`. By default, linked-device credentials are stored outside the repository in `~/.local/state/whatsapp-command-bot/auth` (or under `$XDG_STATE_HOME` when set). The server listens on `0.0.0.0` so it can be opened through a development preview or hosted environment. For pairing from a remote preview, the server host must allow outbound WhatsApp Web connections, the phone needs internet access, and the dashboard URL should be kept private. Some hosted previews block WhatsApp connections; if pairing cannot complete there, run the bot locally.

## Docker and Railway

The repository includes a Dockerfile and Railway configuration. The container listens on Railway's provided `PORT`, exposes `/healthz` for health checks, stores its WhatsApp session under `/data/auth`, and runs the bot as an unprivileged user.

### Docker

Create a strong dashboard password, then build and run with a persistent Docker volume:

```sh
export DASHBOARD_PASSWORD="$(openssl rand -hex 24)"
docker build -t whatsapp-command-bot .
docker run --rm -p 3000:3000 \
  -e DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
  -v whatsapp-bot-data:/data \
  whatsapp-command-bot
```

Open `http://localhost:3000`. The browser will ask for HTTP Basic Auth credentials: username `bot`, and the password in `DASHBOARD_PASSWORD`.

### Railway

1. Deploy this repository as a Railway service. `railway.json` selects the Dockerfile builder and configures `/healthz` as the health check.
2. Add a **Volume** to the service and mount it at `/data`. This is important: without a persistent volume, a redeploy or restart can lose the linked WhatsApp session.
3. In the service's **Variables**, set `DASHBOARD_PASSWORD` to a unique, strong value of at least 16 characters. Production startup fails if this is missing or too short. Optionally set `AUTH_DIR=/data/auth`; it is already the container default.
4. Generate a public domain for the service. Visit it and authenticate with username `bot` and the password you set. Railway provides `PORT` automatically.
5. Keep this to **one running replica** because a WhatsApp linked-device session should not be opened by multiple bot processes at once.

The dashboard and pairing/status APIs are protected by HTTP Basic Auth when `DASHBOARD_PASSWORD` is set. `/healthz` remains unauthenticated so Railway can check the service. Keep the dashboard password and the Railway URL private.

## Pair your phone

1. Enter your own WhatsApp number in international format, including the country code (for example `+91 98765 43210`).
2. Select **Generate pairing code**.
3. In WhatsApp, open **Linked devices** → **Link a device** → **Link with phone number instead**.
4. Enter the code displayed in the dashboard. Never share the code.

Linked-device credentials are saved in `AUTH_DIR` and are needed to reconnect after a restart. The local default is outside the repository at `~/.local/state/whatsapp-command-bot/auth`; Docker and Railway use `/data/auth`. Treat this data as a password: do not share or commit it. **Disconnect and clear saved session** logs out and deletes the local session.

## Commands

| Command | What it does |
| --- | --- |
| `-ping` | Check that the bot is online |
| `-menu` or `-help` | Show the command menu |
| `-about` | Show a short description |
| `-time` | Show the current time in India Standard Time |
| `-echo <text>` | Echo the supplied text |

Messages that do not start with `-` are ignored. Add commands in `src/bot.js`.

## Tests

```sh
npm test
```
