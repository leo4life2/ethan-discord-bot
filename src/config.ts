// Configuration for prompt editing and storage

export const EDITOR_ROLE_ID: string = "1274516674586087515"

// Comma-separated allowlist in env, or leave empty
export const EDITOR_USER_IDS: string[] = (process.env.EDITOR_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Path to JSON prompt store (relative to project root)
export const STORE_PATH: string = process.env.PROMPT_STORE_PATH || "./prompt.json";
export const KNOWLEDGE_PATH: string = process.env.KNOWLEDGE_PATH || "./knowledge.json";
export const STATE_PATH: string = process.env.STATE_PATH || "./bot-state.json";

const DEFAULT_ETHAN_CHANNEL_IDS = [
  "1266202723448000650", // production talk-to-ethan
  "1450278513021292594", // staging talk-to-ethan
];
const DEFAULT_GUILD_IDS = [
  "1261542082124972193", // production guild
  "1450277712844423198", // staging guild
];

function parseIdList(value: string | undefined, fallback: string[]): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return [...fallback];
  }
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return ids.length > 0 ? ids : [...fallback];
}

export const ETHAN_CHANNEL_IDS = Object.freeze(parseIdList(process.env.ETHAN_CHANNEL_IDS, DEFAULT_ETHAN_CHANNEL_IDS));
const rawGuildIds = process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID;
export const TARGET_GUILD_IDS = Object.freeze(parseIdList(rawGuildIds, DEFAULT_GUILD_IDS));

