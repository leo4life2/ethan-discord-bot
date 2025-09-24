import fs from 'node:fs/promises';
import path from 'node:path';
import { STORE_PATH } from './config.js';

export interface PromptVersion {
  id: number;
  text: string;
  updatedAt: string;
  updatedBy: string;
  commitMessage: string;
}

export interface PromptStoreData {
  latestId: number;
  versions: PromptVersion[]; // ascending by id
}

async function readRaw(): Promise<any | null> {
  try {
    const abs = path.resolve(STORE_PATH);
    const json = await fs.readFile(abs, 'utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function writeRaw(data: PromptStoreData): Promise<void> {
  const abs = path.resolve(STORE_PATH);
  await fs.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
}

async function migrateIfNeeded(raw: any | null): Promise<PromptStoreData> {
  if (!raw) {
    // Empty store
    return { latestId: 0, versions: [] };
  }
  if (Array.isArray(raw.versions) && Number.isFinite(raw.latestId)) {
    // Already in new format
    const versions = (raw.versions as any[]).map((v) => ({
      id: Number(v.id),
      text: String(v.text ?? ''),
      updatedAt: String(v.updatedAt ?? new Date().toISOString()),
      updatedBy: String(v.updatedBy ?? 'unknown'),
      commitMessage: String(v.commitMessage ?? ''),
    } as PromptVersion));
    versions.sort((a, b) => a.id - b.id);
    return { latestId: Number(raw.latestId) || (versions.at(-1)?.id ?? 0), versions };
  }
  // Legacy format support
  const text: string = typeof raw.text === 'string' ? raw.text : '';
  const version: number = Number.isFinite(raw.version) ? raw.version : 1;
  const updatedAt: string = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();
  const updatedBy: string = typeof raw.updatedBy === 'string' ? raw.updatedBy : 'unknown';
  const initial: PromptVersion = {
    id: version,
    text,
    updatedAt,
    updatedBy,
    commitMessage: typeof raw.commitMessage === 'string' && raw.commitMessage.length > 0 ? raw.commitMessage : 'initial import',
  };
  return { latestId: initial.id, versions: [initial] };
}

export async function loadStore(): Promise<PromptStoreData> {
  const raw = await readRaw();
  return migrateIfNeeded(raw);
}

export async function loadPrompt(): Promise<PromptVersion | null> {
  const store = await loadStore();
  return store.versions.at(-1) ?? null;
}

export async function listVersions(): Promise<PromptVersion[]> {
  const store = await loadStore();
  // Return latest first
  return [...store.versions].reverse();
}

export async function getVersionById(id: number): Promise<PromptVersion | null> {
  const store = await loadStore();
  return store.versions.find((v) => v.id === id) ?? null;
}

export async function savePrompt(text: string, who: string, commitMessage: string): Promise<PromptVersion> {
  const store = await loadStore();
  const nextId = (store.latestId ?? 0) + 1;
  const version: PromptVersion = {
    id: nextId,
    text,
    updatedAt: new Date().toISOString(),
    updatedBy: who,
    commitMessage,
  };
  const versions = [...store.versions, version];
  // Keep at most 21 (latest + 20 previous)
  const maxKeep = 21;
  const trimmed = versions.length > maxKeep ? versions.slice(versions.length - maxKeep) : versions;
  const nextStore: PromptStoreData = { latestId: version.id, versions: trimmed };
  await writeRaw(nextStore);
  return version;
}

export async function rollbackToVersion(targetId: number, who: string): Promise<PromptVersion | null> {
  const target = await getVersionById(targetId);
  if (!target) return null;
  const msg = `rollback to v${target.id}: ${target.commitMessage || ''}`.trim();
  return savePrompt(target.text, who, msg);
}


