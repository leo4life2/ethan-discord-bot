import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Client, Message } from 'discord.js';
import { WORDLE_CHANNEL_IDS, WORDLE_STATE_PATH } from './config.js';
import { logger } from './logger.js';
import { SAFE_ALLOWED_MENTIONS } from './utils/allowedMentions.js';
import { sanitizeDiscordMentions } from './utils/sanitize.js';

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const CHALLENGE_HOUR = 8;
const SCHEDULER_INTERVAL_MS = 60_000;

const WORDLE_ANSWERS = [
  'about', 'above', 'abuse', 'actor', 'acute', 'admit', 'adopt', 'adult', 'after', 'again',
  'agent', 'agree', 'ahead', 'alarm', 'album', 'alert', 'alike', 'alive', 'allow', 'alone',
  'along', 'alter', 'among', 'anger', 'angle', 'angry', 'apart', 'apple', 'apply', 'arena',
  'argue', 'arise', 'array', 'aside', 'asset', 'audio', 'avoid', 'award', 'aware', 'badly',
  'baker', 'basic', 'basis', 'beach', 'began', 'begin', 'being', 'below', 'bench', 'birth',
  'black', 'blame', 'blank', 'blind', 'block', 'blood', 'board', 'boost', 'booth', 'bound',
  'brain', 'brand', 'bread', 'break', 'breed', 'brief', 'bring', 'broad', 'broke', 'brown',
  'build', 'built', 'buyer', 'cable', 'cabin', 'carry', 'catch', 'cause', 'chain', 'chair',
  'chart', 'chase', 'cheap', 'check', 'chest', 'chief', 'child', 'choir', 'chose', 'civil',
  'claim', 'class', 'clean', 'clear', 'click', 'clock', 'close', 'coach', 'coast', 'could',
  'count', 'court', 'cover', 'craft', 'crash', 'cream', 'crime', 'cross', 'crowd', 'crown',
  'curve', 'cycle', 'daily', 'dance', 'dated', 'dealt', 'death', 'debut', 'delay', 'depth',
  'doing', 'doubt', 'dozen', 'draft', 'drama', 'drawn', 'dream', 'dress', 'drill', 'drink',
  'drive', 'drove', 'dying', 'eager', 'early', 'earth', 'eight', 'elite', 'empty', 'enemy',
  'enjoy', 'enter', 'entry', 'equal', 'error', 'event', 'every', 'exact', 'exist', 'extra',
  'faith', 'false', 'fault', 'fiber', 'field', 'fifth', 'fifty', 'fight', 'final', 'first',
  'fixed', 'flash', 'fleet', 'floor', 'fluid', 'focus', 'force', 'forth', 'forty', 'forum',
  'found', 'frame', 'frank', 'fraud', 'fresh', 'front', 'fruit', 'fully', 'funny', 'giant',
  'given', 'glass', 'globe', 'going', 'grace', 'grade', 'grand', 'grant', 'grass', 'great',
  'green', 'gross', 'group', 'grown', 'guard', 'guess', 'guest', 'guide', 'happy', 'hardy',
  'heart', 'heavy', 'hence', 'honey', 'horse', 'hotel', 'house', 'human', 'ideal', 'image',
  'index', 'inner', 'input', 'issue', 'ivory', 'jelly', 'joint', 'jolly', 'judge', 'known',
  'label', 'large', 'laser', 'later', 'laugh', 'layer', 'learn', 'lease', 'least', 'leave',
  'legal', 'level', 'light', 'limit', 'links', 'lives', 'local', 'loose', 'lower', 'lucky',
  'lunch', 'lying', 'magic', 'major', 'maker', 'march', 'match', 'maybe', 'mayor', 'meant',
  'media', 'metal', 'might', 'minor', 'minus', 'mixed', 'model', 'money', 'month', 'moral',
  'motor', 'mount', 'mouse', 'mouth', 'movie', 'music', 'needs', 'never', 'newly', 'night',
  'noise', 'north', 'novel', 'nurse', 'occur', 'ocean', 'offer', 'often', 'order', 'other',
  'ought', 'paint', 'panel', 'paper', 'party', 'peace', 'phase', 'phone', 'photo', 'piece',
  'pilot', 'pitch', 'place', 'plain', 'plane', 'plant', 'plate', 'point', 'pound', 'power',
  'press', 'price', 'pride', 'prime', 'print', 'prior', 'prize', 'proof', 'proud', 'prove',
  'queen', 'quick', 'quiet', 'quite', 'radio', 'raise', 'range', 'rapid', 'ratio', 'reach',
  'ready', 'refer', 'right', 'rival', 'river', 'rocky', 'rogue', 'roman', 'rough', 'round',
  'route', 'royal', 'rural', 'scale', 'scene', 'scope', 'score', 'sense', 'serve', 'seven',
  'shall', 'shape', 'share', 'sharp', 'sheet', 'shelf', 'shell', 'shift', 'shirt', 'shock',
  'shoot', 'short', 'shown', 'sight', 'since', 'sixth', 'sixty', 'skill', 'sleep', 'slide',
  'small', 'smart', 'smile', 'smelt', 'smoke', 'solid', 'solve', 'sorry', 'sound', 'south',
  'space', 'spare', 'speak', 'speed', 'spend', 'spent', 'split', 'spoke', 'sport', 'staff',
  'stage', 'stake', 'stand', 'start', 'state', 'steam', 'steel', 'stick', 'still', 'stock',
  'stone', 'stood', 'store', 'storm', 'story', 'strip', 'stuck', 'study', 'stuff', 'style',
  'sugar', 'suite', 'super', 'sweet', 'table', 'taken', 'taste', 'teach', 'teeth', 'terse',
  'thank', 'theft', 'their', 'theme', 'there', 'these', 'thick', 'thing', 'think', 'thorn',
  'third', 'those', 'three', 'threw', 'throw', 'tight', 'times', 'tired', 'title', 'today',
  'topic', 'total', 'touch', 'tough', 'tower', 'track', 'trade', 'train', 'treat', 'trend',
  'trial', 'tried', 'tries', 'truck', 'truly', 'trust', 'truth', 'twice', 'under', 'undue',
  'union', 'unity', 'until', 'upper', 'upset', 'urban', 'usage', 'usual', 'valid', 'value',
  'video', 'virus', 'visit', 'vital', 'voice', 'waste', 'watch', 'water', 'wheel', 'where',
  'which', 'while', 'white', 'whole', 'whose', 'woman', 'women', 'world', 'worry', 'worse',
  'worst', 'worth', 'would', 'wound', 'write', 'wrong', 'wrote', 'yield', 'young', 'youth',
] as const;

interface WordleWinner {
  id: string;
  username: string;
}

interface WordleChallenge {
  localDate: string;
  word: string;
  createdAt: string;
  solvedAt?: string;
  solvedBy?: WordleWinner;
}

interface WordleState {
  channels: Record<string, WordleChallenge>;
}

interface PacificNow {
  dateKey: string;
  hour: number;
  minute: number;
}

const defaultState = (): WordleState => ({ channels: {} });

function getPacificNow(date = new Date()): PacificNow {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = value('year');
  const month = value('month');
  const day = value('day');
  return {
    dateKey: `${year}-${month}-${day}`,
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  };
}

function isAtOrAfterDailyStart(now: PacificNow): boolean {
  return now.hour > CHALLENGE_HOUR || (now.hour === CHALLENGE_HOUR && now.minute >= 0);
}

function normalizeWinner(raw: any): WordleWinner | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const username = typeof raw.username === 'string' ? raw.username : '';
  if (!id || !username) return undefined;
  return { id, username };
}

function normalizeChallenge(raw: any): WordleChallenge | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const localDate = typeof raw.localDate === 'string' ? raw.localDate : '';
  const word = typeof raw.word === 'string' ? raw.word.toLowerCase() : '';
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^[a-z]{5}$/.test(word) || !createdAt) {
    return undefined;
  }
  const challenge: WordleChallenge = { localDate, word, createdAt };
  if (typeof raw.solvedAt === 'string') {
    challenge.solvedAt = raw.solvedAt;
  }
  const winner = normalizeWinner(raw.solvedBy);
  if (winner) {
    challenge.solvedBy = winner;
  }
  return challenge;
}

function normalizeState(raw: any): WordleState {
  if (!raw || typeof raw !== 'object') return defaultState();
  const state = defaultState();
  const channels = raw.channels && typeof raw.channels === 'object' ? raw.channels : {};
  for (const [channelId, challengeRaw] of Object.entries(channels)) {
    const challenge = normalizeChallenge(challengeRaw);
    if (challenge) {
      state.channels[channelId] = challenge;
    }
  }
  return state;
}

async function readState(): Promise<WordleState> {
  try {
    const abs = path.resolve(WORDLE_STATE_PATH);
    const json = await fs.readFile(abs, 'utf8');
    return normalizeState(JSON.parse(json));
  } catch {
    return defaultState();
  }
}

async function writeState(state: WordleState): Promise<void> {
  const abs = path.resolve(WORDLE_STATE_PATH);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, JSON.stringify(state, null, 2), 'utf8');
}

function pickWord(previousWord?: string): string {
  let word = WORDLE_ANSWERS[crypto.randomInt(WORDLE_ANSWERS.length)];
  while (word === previousWord) {
    word = WORDLE_ANSWERS[crypto.randomInt(WORDLE_ANSWERS.length)];
  }
  return word;
}

function createChallenge(localDate: string, previousWord?: string): WordleChallenge {
  return {
    localDate,
    word: pickWord(previousWord),
    createdAt: new Date().toISOString(),
  };
}

function challengeIntro(localDate: string): string {
  return [
    `Wordle with Ethan - ${localDate}`,
    'Guess today\'s five-letter word.',
    '',
    'Reply with one five-letter guess. 🟩 correct spot, 🟨 wrong spot, ⬜ absent.',
  ].join('\n');
}

function parseGuess(content: string): string | null {
  const stripped = content
    .replace(/<@!?\d+>/g, '')
    .replace(/^guess\s*[:,-]?\s*/i, '')
    .trim()
    .toLowerCase();
  return /^[a-z]{5}$/.test(stripped) ? stripped : null;
}

export function scoreWordleGuess(guess: string, answer: string): string {
  const guessLetters = guess.toLowerCase().split('');
  const answerLetters = answer.toLowerCase().split('');
  const result = Array<string>(guessLetters.length).fill('⬜');
  const unmatchedAnswerCounts = new Map<string, number>();

  for (let i = 0; i < guessLetters.length; i += 1) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = '🟩';
    } else {
      const letter = answerLetters[i];
      unmatchedAnswerCounts.set(letter, (unmatchedAnswerCounts.get(letter) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guessLetters.length; i += 1) {
    if (result[i] === '🟩') continue;
    const letter = guessLetters[i];
    const remaining = unmatchedAnswerCounts.get(letter) ?? 0;
    if (remaining > 0) {
      result[i] = '🟨';
      unmatchedAnswerCounts.set(letter, remaining - 1);
    }
  }

  return result.join('');
}

function displayNameFor(message: Message): string {
  const displayName = message.member?.displayName || message.author.globalName || message.author.username;
  return sanitizeDiscordMentions(displayName).trim() || 'Someone';
}

function solvedText(challenge: WordleChallenge): string {
  const winner = challenge.solvedBy?.username ? sanitizeDiscordMentions(challenge.solvedBy.username) : 'someone';
  return `Already solved by ${winner}. The answer was ${challenge.word.toUpperCase()}.`;
}

async function ensureTodaysChallenge(channelId: string, announceChannel?: any): Promise<WordleChallenge | null> {
  const now = getPacificNow();
  const state = await readState();
  const existing = state.channels[channelId];
  if (existing?.localDate === now.dateKey) {
    return existing;
  }

  if (!isAtOrAfterDailyStart(now)) {
    return null;
  }

  const challenge = createChallenge(now.dateKey, existing?.word);
  state.channels[channelId] = challenge;
  await writeState(state);

  if (announceChannel && typeof announceChannel.send === 'function') {
    await announceChannel.send({
      content: challengeIntro(challenge.localDate),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }

  logger.info('Created Wordle challenge', {
    channelId,
    localDate: challenge.localDate,
  });

  return challenge;
}

export function isWordleChannel(channelId: string, parentChannelId?: string | null): boolean {
  return WORDLE_CHANNEL_IDS.includes(channelId) ||
    (parentChannelId ? WORDLE_CHANNEL_IDS.includes(parentChannelId) : false);
}

function wordleChannelIdFor(message: Message): string {
  const parentChannelId = message.channel.isThread() ? message.channel.parentId : null;
  if (parentChannelId && WORDLE_CHANNEL_IDS.includes(parentChannelId)) {
    return parentChannelId;
  }
  return message.channel.id;
}

export async function shouldHandleWordleMessage(message: Message): Promise<boolean> {
  const wordleChannelId = wordleChannelIdFor(message);
  const now = getPacificNow();
  const state = await readState();
  const challenge = state.channels[wordleChannelId];
  return !(challenge?.localDate === now.dateKey && challenge.solvedAt);
}

export async function handleWordleMessage(message: Message): Promise<void> {
  const channel = message.channel as any;
  if (!channel || typeof channel.send !== 'function') {
    return;
  }

  const wordleChannelId = wordleChannelIdFor(message);
  const challenge = await ensureTodaysChallenge(wordleChannelId, channel);
  if (!challenge) {
    await message.reply({
      content: 'Today\'s puzzle starts at 8:00 AM Pacific.',
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  const guess = parseGuess(message.content);
  if (!guess) {
    await message.reply({
      content: 'Send one five-letter guess, like `crane`.',
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  const score = scoreWordleGuess(guess, challenge.word);
  if (guess === challenge.word) {
    const state = await readState();
    const latest = state.channels[wordleChannelId];
    if (latest?.localDate === challenge.localDate && latest.solvedAt) {
      await message.reply({
        content: solvedText(latest),
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
      return;
    }
    if (latest?.localDate === challenge.localDate && !latest.solvedAt) {
      latest.solvedAt = new Date().toISOString();
      latest.solvedBy = {
        id: message.author.id,
        username: displayNameFor(message),
      };
      await writeState(state);
    }
    await message.reply({
      content: `${score}\n${displayNameFor(message)} got it.`,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  await message.reply({
    content: score,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}

async function postTodaysWordleIfDue(client: Client): Promise<void> {
  const now = getPacificNow();
  if (!isAtOrAfterDailyStart(now)) {
    return;
  }

  for (const channelId of WORDLE_CHANNEL_IDS) {
    try {
      const state = await readState();
      if (state.channels[channelId]?.localDate === now.dateKey) {
        continue;
      }
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased() || typeof (channel as any).send !== 'function') {
        logger.warn('Wordle channel is not text sendable', { channelId });
        continue;
      }
      await ensureTodaysChallenge(channelId, channel);
    } catch (error) {
      logger.error('Failed to post Wordle challenge', { channelId, error });
    }
  }
}

export function startWordleScheduler(client: Client): void {
  if (WORDLE_CHANNEL_IDS.length === 0) {
    return;
  }

  postTodaysWordleIfDue(client).catch((error) => {
    logger.error('Failed to run initial Wordle scheduler check', { error });
  });

  const timer = setInterval(() => {
    postTodaysWordleIfDue(client).catch((error) => {
      logger.error('Failed to run Wordle scheduler check', { error });
    });
  }, SCHEDULER_INTERVAL_MS);
  timer.unref?.();
}
