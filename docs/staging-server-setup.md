# Staging Server Checklist

Use this when mirroring the production “Ethan” environment in a staging Discord.

## 1. Add the bot to staging

1. Generate the normal OAuth invite link from the [Discord developer portal](https://discord.com/developers/applications) (`Bot` + `applications.commands` scopes, same permissions as production).
2. Invite the existing bot application to the staging guild (`1450277712844423198`). Once authorized, the single running bot session will appear online in both guilds automatically.

## 2. Mirror roles & permissions

- Create the `Ethan` bot role and drag it above any roles it should visually sit over.
- Reuse the same permissions as production (no administrator, no @everyone mention). This keeps behaviour identical without touching code.
- If you need slash-command access in staging without adding new role IDs to code, add your Discord user IDs to `EDITOR_USER_IDS` in `.env` (comma‑separated). That allowlist works in every guild.

## 3. Mirror channels

1. Create the bot’s listening text channel (e.g. `talk-to-ethan`) in staging. Current staging channel ID: **1450278513021292594**.
2. This ID (plus the prod one) is already hard-coded in `src/config.ts`, so no `.env` changes are required for the default dual-guild deployment.
3. Only touch `ETHAN_CHANNEL_IDS` via env if you need to override the defaults for a special case.

## 4. Register slash commands in both guilds

- `src/config.ts` already lists both the production and staging guild IDs, so commands register in both without extra env wiring.
- If you ever need to limit or expand the list temporarily, you can still override with `DISCORD_GUILD_IDS`, but day-to-day use should rely on the checked-in constants.

If you need a staging-only process, run `./pull-and-deploy.sh --staging` which:

- Uses tmux session `ethan-discord-bot-staging`
- Limits `ETHAN_CHANNEL_IDS` to `1450278513021292594`
- Limits `DISCORD_GUILD_IDS` to `1450277712844423198`

## 5. Knowledge/prompt storage

- The JSON stores (`prompt.json`, `knowledge.json`, `bot-state.json`) live on disk. If you need independent staging data, point the bot at alternate paths via `PROMPT_STORE_PATH`, `KNOWLEDGE_PATH`, and `STATE_PATH`.

## 6. Sanity checks

- Run `/pause` and `/start` in staging to ensure slash commands are registered.
- Post a message in the staging channel without mentioning the bot—it should answer automatically.
- Trigger any feature that sends attachments (voice replies, learn sessions) to verify `allowed_mentions` stays scoped and uploads succeed.
