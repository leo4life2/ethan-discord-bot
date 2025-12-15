# Discord Role Hardening

These steps remove the ability for the bot to trigger `@everyone`/`@here` notices at the Discord permission layer and ensure the bot role only has what it needs.

1. **Create a dedicated bot role**
   - Server Settings → *Roles* → *Create Role* (e.g. `Ethan Bot`).
   - Drag the role **above** any member roles the bot must moderate so its webhooks embed correctly.
   - Assign the role to the bot under *Server Settings → Members*.

2. **Deny the mention permission**
   - Open the bot role, scroll to *Text Channel Permissions*.
   - Under *Mentions*, disable **“Mention @everyone, @here, and All Roles”**.
   - Confirm the toggle is gray (explicit deny). This prevents pings even if the bot crafts mention tokens.

3. **Strip unused high-risk permissions**
   - Keep only:
     - View Channels
     - Send Messages
     - Embed Links
     - Attach Files
     - Add Reactions (optional, for UX)
     - Use Application Commands
     - Read Message History
   - Remove anything privileged (`Administrator`, `Manage Server`, `Manage Channels`, `Manage Roles`, `Mention Everyone`, `Manage Webhooks`, `Create Public Threads`, etc.) unless there is a documented need.

4. **Lock down channel-overrides**
   - For each channel the bot can speak in, ensure overrides inherit the role settings above.
   - Explicitly deny `@everyone` mentions on any per-channel override to avoid accidental escalation.

5. **Verify**
   - From a test account with manage rights, attempt to make the bot mention `@everyone` via `/nick @everyone`.
   - The message should send without pinging (the client shows plain text). If Discord flags a permission error, the deny is in effect.

With these steps plus the `allowed_mentions: none` enforcement in code, the bot is fully least-privileged regarding global mentions.

