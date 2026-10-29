# userbot

A Discord self-bot that automatically bumps your server across multiple bump
bots (DISBOARD and others). Each bump bot runs its own independent loop with its
own channel and cooldown, waits for the bot's reply, and reschedules based on
the actual response (success vs. cooldown). Outcomes are posted to a webhook.

> **Warning:** Self-bots violate Discord's Terms of Service and can get your
> account banned. Use at your own risk.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN` — your user account token (required)
   - `WEBHOOK_URL` — Discord webhook for notifications (optional)
   - `BUMP_CHANNEL` — default channel ID for DISBOARD (optional)
3. `npm start`

Requires Node.js >= 20.18. For long-running use, run it
under a supervisor such as pm2 or systemd with auto-restart.

## Commands

Type these as yourself in any channel (only your own messages are read):

- `!bumpstatus` — list each bot: name, channel, enabled, approx next bump time.
- `!setchannel <key> [#channel|id]` — set a bot's channel (defaults to current).
- `!setbumpchannel [#channel|id]` — backward-compatible alias for the DISBOARD channel.
- `!setwebhook <url>` — set the shared notification webhook.
- `!enable <key>` / `!disable <key>` — toggle a bot and (re)start/stop its loop live.
- `!bumpnow <key>` — trigger an immediate bump attempt for that bot.

Invalid keys reply with the list of valid keys.

## Adding / enabling another bump bot

Bots are config-driven via the `BUMP_BOTS` array in `selfbot.js`. To add or
enable one:

1. Edit the entry in `BUMP_BOTS` (or add a new one) with the bot's real
   application ID (`botId`), slash `command`, `cooldownMs`, and the lowercase
   `successPattern` / `cooldownPattern` substrings from its reply embed.
2. Verify the `botId` in-server (entries shipped with an empty ID or
   `defaultEnabled: false` are marked `// TODO: verify botId before enabling`).
3. Set its channel: `!setchannel <key> #channel`.
4. Enable it: `!enable <key>`.

DISBOARD (`disboard`) is enabled by default. Other listed bots
(`discadia`, `disforge`, `discordscom`, `dsme`) are present but disabled
pending verification of their bot IDs and reply wording.