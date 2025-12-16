// Configuration for prompt editing and storage

const PROD_EDITOR_ROLE_ID = "1274516674586087515";
const STAGING_EDITOR_ROLE_ID = "1450283341919293480";

// Comma-separated allowlist in env, or leave empty
export const EDITOR_USER_IDS: string[] = (process.env.EDITOR_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Path to JSON prompt store (relative to project root)
export const STORE_PATH: string = process.env.PROMPT_STORE_PATH || "./prompt.json";
export const KNOWLEDGE_PATH: string = process.env.KNOWLEDGE_PATH || "./knowledge.json";
export const STATE_PATH: string = process.env.STATE_PATH || "./bot-state.json";

const PROD_ETHAN_CHANNEL_IDS = [
  "1266202723448000650", // production talk-to-ethan
];

const STAGING_ETHAN_CHANNEL_IDS = [
  "1450278513021292594", // staging talk-to-ethan
];

const PROD_GUILD_IDS = [
  "1261542082124972193", // production guild
];

const STAGING_GUILD_IDS = [
  "1450277712844423198", // staging guild
];

type BotMode = 'all' | 'prod' | 'staging';

function normalizeMode(raw: string | undefined | null): BotMode {
  switch ((raw ?? 'all').toLowerCase()) {
    case 'prod':
    case 'production':
      return 'prod';
    case 'staging':
      return 'staging';
    default:
      return 'all';
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function resolveIds(prod: string[], staging: string[], mode: BotMode): string[] {
  if (mode === 'prod') return unique(prod);
  if (mode === 'staging') return unique(staging);
  return unique([...prod, ...staging]);
}

export const ACTIVE_BOT_MODE: BotMode = normalizeMode(process.env.BOT_MODE);
export const EDITOR_ROLE_ID: string =
  ACTIVE_BOT_MODE === 'staging' ? STAGING_EDITOR_ROLE_ID : PROD_EDITOR_ROLE_ID;
export const ETHAN_CHANNEL_IDS = Object.freeze(resolveIds(PROD_ETHAN_CHANNEL_IDS, STAGING_ETHAN_CHANNEL_IDS, ACTIVE_BOT_MODE));
export const TARGET_GUILD_IDS = Object.freeze(resolveIds(PROD_GUILD_IDS, STAGING_GUILD_IDS, ACTIVE_BOT_MODE));

export function isGuildAllowed(guildId?: string | null): boolean {
  if (!guildId) {
    return true; // allow DMs by default
  }
  return TARGET_GUILD_IDS.includes(guildId);
}

