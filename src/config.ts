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

