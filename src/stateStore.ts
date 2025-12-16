import fs from 'node:fs/promises';
import path from 'node:path';
import { STATE_PATH } from './config.js';

export interface BotState {
  paused: boolean;
  updatedAt: string;
  updatedBy: string;
}

const defaultState = (): BotState => ({
  paused: false,
  updatedAt: new Date().toISOString(),
  updatedBy: 'system',
});

let cachedState: BotState | null = null;

async function readRawState(): Promise<any | null> {
  try {
    const abs = path.resolve(STATE_PATH);
    const json = await fs.readFile(abs, 'utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeState(raw: any | null): BotState {
  if (!raw || typeof raw !== 'object') {
    return defaultState();
  }
  return {
    paused: Boolean(raw.paused),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : 'unknown',
  };
}

async function writeState(state: BotState): Promise<void> {
  const abs = path.resolve(STATE_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(state, null, 2), 'utf8');
}

export async function getBotState(forceReload = false): Promise<BotState> {
  if (!forceReload && cachedState) {
    return cachedState;
  }
  const raw = await readRawState();
  cachedState = normalizeState(raw);
  return cachedState;
}

export async function isBotPaused(): Promise<boolean> {
  const state = await getBotState();
  return state.paused;
}

export async function setBotPaused(paused: boolean, updatedBy = 'system'): Promise<BotState> {
  const nextState: BotState = {
    paused,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await writeState(nextState);
  cachedState = nextState;
  return nextState;
}





