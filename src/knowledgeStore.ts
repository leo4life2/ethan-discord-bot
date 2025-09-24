import fs from 'node:fs/promises';
import path from 'node:path';
import { KNOWLEDGE_PATH } from './config.js';

export interface KnowledgeEntry {
  text: string;
  added_at: string;
}

export async function loadKnowledge(): Promise<KnowledgeEntry[]> {
  try {
    const abs = path.resolve(KNOWLEDGE_PATH);
    const json = await fs.readFile(abs, 'utf8');
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        text: String(item.text ?? '').trim(),
        added_at: String(item.added_at ?? ''),
      }))
      .filter((entry) => entry.text.length > 0)
      .sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
  } catch {
    return [];
  }
}

export async function appendKnowledge(entries: KnowledgeEntry[]): Promise<void> {
  const normalized = entries
    .map((entry) => ({
      text: String(entry.text ?? '').trim(),
      added_at: String(entry.added_at ?? new Date().toISOString()),
    }))
    .filter((entry) => entry.text.length > 0);
  if (normalized.length === 0) return;

  const existing = await loadKnowledge();
  const existingText = new Set(existing.map((e) => e.text));
  const toAdd = normalized.filter((entry) => !existingText.has(entry.text));
  if (toAdd.length === 0) return;

  const merged = [...toAdd, ...existing].sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''));
  const abs = path.resolve(KNOWLEDGE_PATH);
  await fs.writeFile(abs, JSON.stringify(merged, null, 2), 'utf8');
}

