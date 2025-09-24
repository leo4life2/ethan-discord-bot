import { randomUUID } from 'node:crypto';

export type LearnItemStatus = 'pending' | 'approved' | 'rejected';

export interface LearnItem {
  text: string;
  status: LearnItemStatus;
}

export interface LearnSession {
  id: string;
  initiatorId: string;
  createdAt: number;
  items: LearnItem[];
}

const sessions = new Map<string, LearnSession>();

export function createLearnSession(initiatorId: string, texts: string[]): LearnSession {
  const session: LearnSession = {
    id: randomUUID(),
    initiatorId,
    createdAt: Date.now(),
    items: texts.map((text) => ({ text, status: 'pending' })),
  };
  sessions.set(session.id, session);
  return session;
}

export function getLearnSession(id: string): LearnSession | undefined {
  return sessions.get(id);
}

export function setLearnItemStatus(sessionId: string, index: number, status: LearnItemStatus): LearnItem | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const item = session.items[index];
  if (!item) return null;
  if (item.status !== 'pending') return item;
  item.status = status;
  return item;
}

export function getLearnItem(sessionId: string, index: number): LearnItem | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return session.items[index] ?? null;
}

export function isSessionComplete(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return true;
  return session.items.every((item) => item.status !== 'pending');
}

export function removeLearnSession(sessionId: string): void {
  sessions.delete(sessionId);
}


