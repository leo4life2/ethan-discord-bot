// Configuration for prompt editing and storage

const PROD_EDITOR_ROLE_ID = "1274516674586087515";
const STAGING_EDITOR_ROLE_ID = "1450283341919293480";

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const TEXT_VERBOSITIES = ['low', 'medium', 'high'] as const;
const SEARCH_CONTEXT_SIZES = ['low', 'medium', 'high'] as const;
const TOOL_CHOICES = ['auto', 'required', 'none'] as const;

function parseEnum<T extends readonly string[]>(raw: string | undefined, allowed: T, fallback: T[number]): T[number] {
  if (!raw) return fallback;
  return allowed.includes(raw) ? raw as T[number] : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

// Comma-separated allowlist in env, or leave empty
export const EDITOR_USER_IDS: string[] = (process.env.EDITOR_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Path to JSON prompt store (relative to project root)
export const STORE_PATH: string = process.env.PROMPT_STORE_PATH || "./prompt.json";
export const KNOWLEDGE_PATH: string = process.env.KNOWLEDGE_PATH || "./knowledge.json";
export const STATE_PATH: string = process.env.STATE_PATH || "./bot-state.json";
export const WORDLE_STATE_PATH: string = process.env.WORDLE_STATE_PATH || "./wordle-state.json";

export const ETHAN_REPLY_MODEL = process.env.ETHAN_REPLY_MODEL || 'gpt-5.1';
export const ETHAN_REPLY_REASONING_EFFORT = parseEnum(
  process.env.ETHAN_REPLY_REASONING_EFFORT,
  REASONING_EFFORTS,
  'low',
);
export const ETHAN_REPLY_VERBOSITY = parseEnum(
  process.env.ETHAN_REPLY_VERBOSITY,
  TEXT_VERBOSITIES,
  'medium',
);
export const ETHAN_REPLY_MAX_TURNS = parsePositiveInteger(process.env.ETHAN_REPLY_MAX_TURNS, 4);

export const ETHAN_RESEARCH_MODEL = process.env.ETHAN_RESEARCH_MODEL || 'gpt-5.5';
export const ETHAN_RESEARCH_REASONING_EFFORT = parseEnum(
  process.env.ETHAN_RESEARCH_REASONING_EFFORT,
  REASONING_EFFORTS,
  'high',
);
export const ETHAN_RESEARCH_VERBOSITY = parseEnum(
  process.env.ETHAN_RESEARCH_VERBOSITY,
  TEXT_VERBOSITIES,
  'low',
);
export const ETHAN_RESEARCH_SEARCH_CONTEXT_SIZE = parseEnum(
  process.env.ETHAN_RESEARCH_SEARCH_CONTEXT_SIZE,
  SEARCH_CONTEXT_SIZES,
  'medium',
);
export const ETHAN_RESEARCH_TOOL_CHOICE = parseEnum(
  process.env.ETHAN_RESEARCH_TOOL_CHOICE,
  TOOL_CHOICES,
  'auto',
);
export const ETHAN_RESEARCH_MAX_TURNS = parsePositiveInteger(process.env.ETHAN_RESEARCH_MAX_TURNS, 6);
export const ETHAN_RESEARCH_MAX_OUTPUT_TOKENS = parsePositiveInteger(process.env.ETHAN_RESEARCH_MAX_OUTPUT_TOKENS, 5400);
export const ETHAN_RESEARCH_MAX_SOURCES = parsePositiveInteger(process.env.ETHAN_RESEARCH_MAX_SOURCES, 8);
export const ETHAN_RESEARCH_EXTERNAL_WEB_ACCESS = parseBoolean(process.env.ETHAN_RESEARCH_EXTERNAL_WEB_ACCESS, true);
export const ETHAN_RESEARCH_PARALLEL_TOOL_CALLS = parseBoolean(process.env.ETHAN_RESEARCH_PARALLEL_TOOL_CALLS, false);
export const ETHAN_RESEARCH_ALLOWED_DOMAINS = Object.freeze(parseCsv(process.env.ETHAN_RESEARCH_ALLOWED_DOMAINS));

const PROD_ETHAN_CHANNEL_IDS = [
  "1266202723448000650", // production ask ethan 1
  "1453363563950248038", // production ask ethan 2
];

const STAGING_ETHAN_CHANNEL_IDS = [
  "1450278513021292594", // staging talk-to-ethan
];

const PROD_WORDLE_CHANNEL_IDS = [
  "1453363597152358533", // production Wordle with Ethan
];

const STAGING_WORDLE_CHANNEL_IDS: string[] = [];

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
export const WORDLE_CHANNEL_IDS = Object.freeze(resolveIds(PROD_WORDLE_CHANNEL_IDS, STAGING_WORDLE_CHANNEL_IDS, ACTIVE_BOT_MODE));
export const TARGET_GUILD_IDS = Object.freeze(resolveIds(PROD_GUILD_IDS, STAGING_GUILD_IDS, ACTIVE_BOT_MODE));

export function isGuildAllowed(guildId?: string | null): boolean {
  if (!guildId) {
    return true; // allow DMs by default
  }
  return TARGET_GUILD_IDS.includes(guildId);
}
