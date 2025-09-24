import fs from 'node:fs/promises';
import path from 'node:path';
import { KNOWLEDGE_PATH } from './config.js';

export interface KnowledgeEntry {
  text: string;
  added_at: string;
}

export interface KnowledgeVersion {
  id: number;
  entries: KnowledgeEntry[];
  updatedAt: string;
  updatedBy: string;
  commitMessage: string;
}

interface KnowledgeStoreData {
  latestId: number;
  versions: KnowledgeVersion[];
}

const MAX_VERSIONS = 11;

async function readRaw(): Promise<any | null> {
  try {
    const abs = path.resolve(KNOWLEDGE_PATH);
    const json = await fs.readFile(abs, 'utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function normalizeEntry(entry: any): KnowledgeEntry | null {
  const text = String(entry?.text ?? '').trim();
  if (!text) return null;
  const addedAt = entry?.added_at ? String(entry.added_at) : new Date().toISOString();
  return {
    text,
    added_at: addedAt,
  };
}

function normalizeEntries(entries: any[]): KnowledgeEntry[] {
  const seen = new Set<string>();
  const out: KnowledgeEntry[] = [];
  entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is KnowledgeEntry => !!entry)
    .forEach((entry) => {
      if (seen.has(entry.text)) return;
      seen.add(entry.text);
      out.push(entry);
    });
  // newest first by added_at
  out.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
  return out;
}

async function migrateIfNeeded(raw: any | null): Promise<KnowledgeStoreData> {
  if (!raw) {
    return { latestId: 0, versions: [] };
  }

  if (Array.isArray(raw.versions) && Number.isFinite(raw.latestId)) {
    const versions: KnowledgeVersion[] = raw.versions.map((v: any) => ({
      id: Number(v.id),
      entries: normalizeEntries(Array.isArray(v.entries) ? v.entries : []),
      updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : new Date().toISOString(),
      updatedBy: typeof v.updatedBy === 'string' ? v.updatedBy : 'unknown',
      commitMessage: typeof v.commitMessage === 'string' ? v.commitMessage : '',
    }));
    versions.sort((a, b) => a.id - b.id);
    const latestId = versions.at(-1)?.id ?? Number(raw.latestId) ?? 0;
    return { latestId, versions };
  }

  if (Array.isArray(raw)) {
    const entries = normalizeEntries(raw);
    const initial: KnowledgeVersion = {
      id: entries.length > 0 ? 1 : 0,
      entries,
      updatedAt: new Date().toISOString(),
      updatedBy: 'migration',
      commitMessage: entries.length > 0 ? 'legacy import' : 'empty import',
    };
    return {
      latestId: initial.id,
      versions: initial.id === 0 ? [] : [initial],
    };
  }

  return { latestId: 0, versions: [] };
}

async function writeStore(data: KnowledgeStoreData): Promise<void> {
  const abs = path.resolve(KNOWLEDGE_PATH);
  await fs.writeFile(abs, JSON.stringify(data, null, 2), 'utf8');
}

export async function loadKnowledgeStore(): Promise<KnowledgeStoreData> {
  const raw = await readRaw();
  return migrateIfNeeded(raw);
}

export async function loadKnowledge(): Promise<KnowledgeEntry[]> {
  const store = await loadKnowledgeStore();
  return store.versions.at(-1)?.entries ?? [];
}

export async function listKnowledgeVersions(): Promise<KnowledgeVersion[]> {
  const store = await loadKnowledgeStore();
  return [...store.versions].sort((a, b) => b.id - a.id);
}

export async function getKnowledgeVersionById(id: number): Promise<KnowledgeVersion | null> {
  const store = await loadKnowledgeStore();
  return store.versions.find((version) => version.id === id) ?? null;
}

export async function saveKnowledge(
  entries: KnowledgeEntry[],
  who: string,
  commitMessage: string,
): Promise<KnowledgeVersion> {
  const store = await loadKnowledgeStore();
  const nextId = (store.latestId ?? 0) + 1;
  const normalized = normalizeEntries(entries);
  const version: KnowledgeVersion = {
    id: nextId,
    entries: normalized,
    updatedAt: new Date().toISOString(),
    updatedBy: who,
    commitMessage,
  };
  const versions = [...store.versions, version];
  const trimmed = versions.length > MAX_VERSIONS ? versions.slice(versions.length - MAX_VERSIONS) : versions;
  const nextStore: KnowledgeStoreData = {
    latestId: version.id,
    versions: trimmed,
  };
  await writeStore(nextStore);
  return version;
}

export async function appendKnowledge(
  entries: KnowledgeEntry[],
  who: string,
  commitMessage: string,
): Promise<KnowledgeVersion | null> {
  const normalized = normalizeEntries(entries);
  if (normalized.length === 0) return null;

  const current = await loadKnowledge();
  const existingTexts = new Set(current.map((entry) => entry.text));
  const toAdd = normalized.filter((entry) => !existingTexts.has(entry.text));
  if (toAdd.length === 0) return null;

  const merged = normalizeEntries([...toAdd, ...current]);
  return saveKnowledge(merged, who, commitMessage);
}

export async function rollbackKnowledge(
  targetId: number,
  who: string,
  commitMessage?: string,
): Promise<KnowledgeVersion | null> {
  const store = await loadKnowledgeStore();
  const target = store.versions.find((version) => version.id === targetId);
  if (!target) return null;
  const message = commitMessage && commitMessage.trim().length > 0
    ? commitMessage.trim()
    : `rollback to v${target.id}${target.commitMessage ? `: ${target.commitMessage}` : ''}`;
  return saveKnowledge([...target.entries], who, message);
}

