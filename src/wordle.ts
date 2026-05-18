import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Client, Message } from 'discord.js';
import { WORDLE_CHANNEL_IDS, WORDLE_STATE_PATH } from './config.js';
import { logger } from './logger.js';
import { openai } from './openaiClient.js';
import { loadPrompt } from './promptStore.js';
import { SAFE_ALLOWED_MENTIONS } from './utils/allowedMentions.js';
import { withRetry } from './utils/retry.js';
import { sanitizeDiscordMentions } from './utils/sanitize.js';

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const CHALLENGE_HOUR = 8;
const SCHEDULER_INTERVAL_MS = 60_000;
const DEFAULT_WORDLE_CHANNEL_ID = WORDLE_CHANNEL_IDS[0] ?? '';
const MIN_WORDLE_LENGTH = 5;
const MAX_WORDLE_LENGTH = 8;
const WORDLE_WORD_PATTERN = /^[a-z]{5,8}$/;

type WordleTrigger = 'scheduled' | 'manual';

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
  'beacon', 'biome', 'border', 'branch', 'bridge', 'bucket', 'candle', 'canyon', 'castle',
  'cavern', 'copper', 'crouch', 'crystal', 'desert', 'dragon', 'forest', 'furnace', 'glider',
  'helmet', 'island', 'jungle', 'ladder', 'lantern', 'market', 'mining', 'module', 'nether',
  'portal', 'potion', 'quartz', 'rocket', 'shield', 'signal', 'silver', 'temple', 'ticket',
  'tunnel', 'village', 'warden', 'window', 'wizard', 'ancient', 'battery', 'campfire',
  'command', 'compass', 'creeper', 'diamond', 'emerald', 'factory', 'gateway', 'harvest',
  'library', 'machine', 'monster', 'outpost', 'pickaxe', 'pioneer', 'railway', 'reactor',
  'scanner', 'shulker', 'storage', 'texture', 'upgrade', 'venture', 'voltage', 'weather',
  'workshop', 'zeppelin', 'artifact', 'backpack', 'baseline',
  'crafting', 'daylight', 'delivery', 'engineer', 'fortress',
  'guardian', 'operator', 'overland', 'pipeline', 'platform', 'redstone',
  'resource', 'skeleton', 'snapshot', 'treasure', 'villager',
] as const;

interface WordleWinner {
  id: string;
  username: string;
}

interface WordleChallenge {
  localDate: string;
  word: string;
  createdAt: string;
  trigger?: WordleTrigger;
  announcement?: string;
  solvedAt?: string;
  solvedBy?: WordleWinner;
}

interface WordleUsedWord {
  word: string;
  localDate?: string;
  usedAt?: string;
  trigger?: WordleTrigger;
}

interface StartWordleOptions {
  trigger: WordleTrigger;
  force?: boolean;
  requestedBy?: string;
}

interface WordleState {
  channels: Record<string, WordleChallenge>;
  usedWords: Record<string, WordleUsedWord[]>;
}

interface PacificNow {
  dateKey: string;
  hour: number;
  minute: number;
}

const defaultState = (): WordleState => ({ channels: {}, usedWords: {} });

const WORDLE_CHALLENGE_TEXT_FORMAT: any = {
  type: 'json_schema',
  name: 'wordle_challenge_format',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      word: {
        type: 'string',
        minLength: MIN_WORDLE_LENGTH,
        maxLength: MAX_WORDLE_LENGTH,
        pattern: '^[a-z]+$',
        description: 'The secret answer: 5 to 8 lowercase English letters, no spaces.',
      },
      announcement: {
        type: 'string',
        description: 'A short Discord announcement with a tiny non-spoiler hint and Wordle instructions. Do not reveal the answer.',
      },
    },
    required: ['word', 'announcement'],
  },
};

const WORDLE_SOLVED_TEXT_FORMAT: any = {
  type: 'json_schema',
  name: 'wordle_solved_format',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message: {
        type: 'string',
        description: 'One short Discord line celebrating the solver. Do not reveal the answer.',
      },
    },
    required: ['message'],
  },
};

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !WORDLE_WORD_PATTERN.test(word) || !createdAt) {
    return undefined;
  }
  const challenge: WordleChallenge = { localDate, word, createdAt };
  if (raw.trigger === 'scheduled' || raw.trigger === 'manual') {
    challenge.trigger = raw.trigger;
  }
  if (typeof raw.announcement === 'string' && raw.announcement.trim()) {
    challenge.announcement = raw.announcement.trim();
  }
  if (typeof raw.solvedAt === 'string') {
    challenge.solvedAt = raw.solvedAt;
  }
  const winner = normalizeWinner(raw.solvedBy);
  if (winner) {
    challenge.solvedBy = winner;
  }
  return challenge;
}

function normalizeUsedWord(raw: any): WordleUsedWord | undefined {
  if (typeof raw === 'string') {
    const word = raw.trim().toLowerCase();
    return WORDLE_WORD_PATTERN.test(word) ? { word } : undefined;
  }

  if (!raw || typeof raw !== 'object') return undefined;
  const word = typeof raw.word === 'string' ? raw.word.trim().toLowerCase() : '';
  if (!WORDLE_WORD_PATTERN.test(word)) return undefined;

  const usedWord: WordleUsedWord = { word };
  if (typeof raw.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.localDate)) {
    usedWord.localDate = raw.localDate;
  }
  if (typeof raw.usedAt === 'string' && raw.usedAt.trim()) {
    usedWord.usedAt = raw.usedAt;
  }
  if (raw.trigger === 'scheduled' || raw.trigger === 'manual') {
    usedWord.trigger = raw.trigger;
  }
  return usedWord;
}

function normalizeUsedWordHistory(raw: any): WordleUsedWord[] {
  const entries = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const history: WordleUsedWord[] = [];

  for (const entryRaw of entries) {
    const entry = normalizeUsedWord(entryRaw);
    if (!entry || seen.has(entry.word)) continue;
    seen.add(entry.word);
    history.push(entry);
  }

  return history;
}

function addUsedWord(state: WordleState, channelId: string, challenge: WordleChallenge): void {
  const history = state.usedWords[channelId] ?? [];
  if (history.some((entry) => entry.word === challenge.word)) {
    state.usedWords[channelId] = history;
    return;
  }

  state.usedWords[channelId] = [
    ...history,
    {
      word: challenge.word,
      localDate: challenge.localDate,
      usedAt: challenge.createdAt,
      trigger: challenge.trigger,
    },
  ];
}

function usedWordsForChannel(state: WordleState, channelId: string): string[] {
  return (state.usedWords[channelId] ?? []).map((entry) => entry.word);
}

function normalizeState(raw: any): WordleState {
  if (!raw || typeof raw !== 'object') return defaultState();
  const state = defaultState();
  const usedWords = raw.usedWords && typeof raw.usedWords === 'object' ? raw.usedWords : {};
  for (const [channelId, historyRaw] of Object.entries(usedWords)) {
    const history = normalizeUsedWordHistory(historyRaw);
    if (history.length > 0) {
      state.usedWords[channelId] = history;
    }
  }

  const channels = raw.channels && typeof raw.channels === 'object' ? raw.channels : {};
  for (const [channelId, challengeRaw] of Object.entries(channels)) {
    const challenge = normalizeChallenge(challengeRaw);
    if (challenge) {
      state.channels[channelId] = challenge;
      addUsedWord(state, channelId, challenge);
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

function currentCaliforniaDateTime(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date());
}

async function getWordleSystemPrompt(userName: string): Promise<string> {
  const stored = await loadPrompt();
  const base = stored?.text ?? [
    'You are Ethan, a playful AI robot who lives in a Discord server.',
    'Keep messages casual, sharp, and alive.',
  ].join('\n');
  const currentDate = `current California datetime: ${currentCaliforniaDateTime()}`;
  return base
    .replace('{currentDate}', currentDate)
    .replace('{userName}', userName);
}

function extractStructuredObject(response: any): any | null {
  const outputs: any[] = Array.isArray(response?.output) ? response.output : [];
  for (const outputItem of outputs) {
    const parts: any[] = Array.isArray(outputItem?.content) ? outputItem.content : [];
    for (const part of parts) {
      if (part?.parsed && typeof part.parsed === 'object') {
        return part.parsed;
      }
      if (part?.type === 'output_text' && typeof part?.text === 'string') {
        try {
          return JSON.parse(part.text);
        } catch {
          // keep looking
        }
      }
    }
  }

  if (typeof response?.output_text === 'string') {
    try {
      return JSON.parse(response.output_text);
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeGeneratedWord(raw: unknown, usedWords: ReadonlySet<string>): string | null {
  const word = String(raw ?? '').trim().toLowerCase();
  if (!WORDLE_WORD_PATTERN.test(word)) {
    return null;
  }
  if (usedWords.has(word)) {
    return null;
  }
  return word;
}

function wordLengthLabel(length: number): string {
  return `${length}-letter`;
}

function wordLengthRangeLabel(): string {
  return `${MIN_WORDLE_LENGTH}-${MAX_WORDLE_LENGTH} letter`;
}

function fallbackAnnouncement(localDate: string, wordLength = MIN_WORDLE_LENGTH): string {
  return [
    `Wordle with Ethan - ${localDate}`,
    `A fresh ${wordLengthLabel(wordLength)} puzzle just spawned somewhere between redstone dust and robot static.`,
    '',
    `Reply with one ${wordLengthLabel(wordLength)} guess. 🟩 correct spot, 🟨 wrong spot, ⬜ absent.`,
  ].join('\n');
}

function normalizeAnnouncement(raw: unknown, localDate: string, word: string): string {
  let announcement = sanitizeDiscordMentions(String(raw ?? '')).trim();
  const lower = announcement.toLowerCase();
  if (
    announcement.length < 20 ||
    announcement.length > 1200 ||
    lower.includes(word.toLowerCase()) ||
    /@everyone|@here/i.test(announcement)
  ) {
    announcement = fallbackAnnouncement(localDate, word.length);
  }

  const mentionsExpectedLength = new RegExp(`${word.length}\\s*-?\\s*letter`, 'i').test(announcement);
  if (!mentionsExpectedLength || !/🟩|green/i.test(announcement)) {
    announcement = `${announcement.trim()}\n\nReply with one ${wordLengthLabel(word.length)} guess. 🟩 correct spot, 🟨 wrong spot, ⬜ absent.`;
  }

  return announcement;
}

async function generateChallengeWithLlm(
  localDate: string,
  usedWords: readonly string[],
  trigger: WordleTrigger,
): Promise<{ word: string; announcement: string } | null> {
  try {
    const systemPrompt = await getWordleSystemPrompt('Wordle players');
    const usedWordSet = new Set(usedWords);
    const usedWordsText = usedWords.length > 0 ? usedWords.join(', ') : 'none';
    const response = await withRetry(
      () =>
        openai.responses.create({
          model: 'gpt-5.1',
          input: [
            {
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text: `${systemPrompt}

[Wordle mode]
Generate a private Wordle puzzle for a Discord channel.
- Return only the structured JSON fields.
- Pick one common English answer between ${MIN_WORDLE_LENGTH} and ${MAX_WORDLE_LENGTH} lowercase letters a-z.
- Use Ethan's personality when choosing the secret word itself, not just when writing the announcement.
- Prefer vivid, playable words with robot, Minecraft, adventure, building, puzzle, or internet energy when they are natural English words.
- Do not use a proper noun, profanity, plural ending in s, or an obscure word.
- The announcement should sound like Ethan and can have Minecraft/robot flavor.
- Include one tiny hint, but do not reveal the answer, its first letter, last letter, exact letters, rhyme, or spelling pattern.
- The announcement must tell people the exact answer length and explain 🟩 🟨 ⬜.
- Never include @everyone, @here, or role/user mentions.
- Already used words to avoid forever in this channel: ${usedWordsText}.`,
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `Create the ${trigger} Wordle for ${localDate}. Keep the announcement under 700 characters.`,
                },
              ],
            },
          ],
          reasoning: {
            effort: 'low',
            summary: 'auto',
          },
          text: {
            format: WORDLE_CHALLENGE_TEXT_FORMAT,
            verbosity: 'medium',
          },
          metadata: { purpose: 'wordle-challenge' },
        }),
      { operation: 'openai.responses.create (wordle-challenge)' },
    );

    const parsed = extractStructuredObject(response);
    const word = normalizeGeneratedWord(parsed?.word, usedWordSet);
    if (!word) {
      return null;
    }

    return {
      word,
      announcement: normalizeAnnouncement(parsed?.announcement, localDate, word),
    };
  } catch (error) {
    logger.error('Failed to generate Wordle challenge with LLM', { error });
    return null;
  }
}

function pickWord(usedWords: ReadonlySet<string>, previousWord?: string): string {
  const answerPool = WORDLE_ANSWERS.filter((word) => WORDLE_WORD_PATTERN.test(word));
  const unusedWords = answerPool.filter((word) => !usedWords.has(word));
  if (unusedWords.length > 0) {
    return unusedWords[crypto.randomInt(unusedWords.length)];
  }

  logger.warn('Wordle answer pool exhausted; allowing answer reuse', {
    usedWordCount: usedWords.size,
  });
  const fallbackWords = answerPool.filter((word) => word !== previousWord);
  const pool = fallbackWords.length > 0 ? fallbackWords : answerPool;
  return pool[crypto.randomInt(pool.length)];
}

async function createChallenge(
  localDate: string,
  usedWords: readonly string[],
  previousWord: string | undefined,
  trigger: WordleTrigger,
): Promise<WordleChallenge> {
  const usedWordSet = new Set(usedWords);
  if (previousWord) {
    usedWordSet.add(previousWord);
  }

  const wordsToAvoid = [...usedWordSet];
  const generated = await generateChallengeWithLlm(localDate, wordsToAvoid, trigger);
  const word = generated?.word ?? pickWord(usedWordSet, previousWord);
  return {
    localDate,
    word,
    createdAt: new Date().toISOString(),
    trigger,
    announcement: generated?.announcement ?? fallbackAnnouncement(localDate, word.length),
  };
}

function challengeIntro(challenge: WordleChallenge): string {
  return challenge.announcement ?? fallbackAnnouncement(challenge.localDate, challenge.word.length);
}

function parseGuess(content: string): string | null {
  const stripped = content
    .replace(/<@!?\d+>/g, '')
    .replace(/^guess\s*[:,-]?\s*/i, '')
    .trim()
    .toLowerCase();
  return WORDLE_WORD_PATTERN.test(stripped) ? stripped : null;
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
  return `Already solved by ${winner}. Ethan is back in normal chat mode until the next puzzle.`;
}

function fallbackSolvedMessage(winnerName: string): string {
  return `${winnerName} got it. Ethan is emotionally placing a tiny diamond block on the scoreboard.`;
}

function normalizeSolvedMessage(raw: unknown, winnerName: string): string {
  const message = sanitizeDiscordMentions(String(raw ?? '')).trim();
  if (
    message.length < 8 ||
    message.length > 500 ||
    /@everyone|@here/i.test(message)
  ) {
    return fallbackSolvedMessage(winnerName);
  }
  return message;
}

async function generateSolvedMessage(winnerName: string, score: string): Promise<string> {
  try {
    const systemPrompt = await getWordleSystemPrompt(winnerName);
    const response = await withRetry(
      () =>
        openai.responses.create({
          model: 'gpt-5.1',
          input: [
            {
              role: 'developer',
              content: [
                {
                  type: 'input_text',
                  text: `${systemPrompt}

[Wordle solved mode]
Write one short Discord line celebrating someone solving Ethan's Wordle.
- Use Ethan's existing personality.
- Minecraft/robot flavor is welcome.
- Do not reveal the secret word.
- Do not mention or invent the answer.
- Do not include @everyone, @here, user mentions, or role mentions.
- Keep it under 220 characters.`,
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `${winnerName} solved the puzzle with score boxes ${score}. Write the celebration line.`,
                },
              ],
            },
          ],
          reasoning: {
            effort: 'low',
            summary: 'auto',
          },
          text: {
            format: WORDLE_SOLVED_TEXT_FORMAT,
            verbosity: 'medium',
          },
          metadata: { purpose: 'wordle-solved' },
        }),
      { operation: 'openai.responses.create (wordle-solved)' },
    );

    const parsed = extractStructuredObject(response);
    return normalizeSolvedMessage(parsed?.message, winnerName);
  } catch (error) {
    logger.error('Failed to generate Wordle solved message with LLM', { error });
    return fallbackSolvedMessage(winnerName);
  }
}

async function startWordleChallenge(
  channelId: string,
  announceChannel: any,
  options: StartWordleOptions,
): Promise<WordleChallenge | null> {
  const now = getPacificNow();
  const state = await readState();
  const existing = state.channels[channelId];
  if (!options.force && existing?.localDate === now.dateKey) {
    return existing;
  }

  if (!options.force && !isAtOrAfterDailyStart(now)) {
    return null;
  }

  const usedWords = usedWordsForChannel(state, channelId);
  const challenge = await createChallenge(now.dateKey, usedWords, existing?.word, options.trigger);
  state.channels[channelId] = challenge;
  addUsedWord(state, channelId, challenge);
  await writeState(state);

  if (announceChannel && typeof announceChannel.send === 'function') {
    await announceChannel.send({
      content: challengeIntro(challenge),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }

  logger.info('Created Wordle challenge', {
    channelId,
    localDate: challenge.localDate,
    trigger: options.trigger,
    requestedBy: options.requestedBy,
    usedWordCount: state.usedWords[channelId]?.length ?? 0,
  });

  return challenge;
}

async function ensureTodaysChallenge(channelId: string, announceChannel?: any): Promise<WordleChallenge | null> {
  return startWordleChallenge(channelId, announceChannel, { trigger: 'scheduled' });
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

export async function triggerManualWordleForChannel(channel: any, requestedBy?: string): Promise<WordleChallenge | null> {
  if (!channel || typeof channel.id !== 'string' || typeof channel.send !== 'function') {
    return null;
  }
  if (!isWordleChannel(channel.id)) {
    return null;
  }
  return startWordleChallenge(channel.id, channel, {
    trigger: 'manual',
    force: true,
    requestedBy,
  });
}

export async function triggerManualWordleForChannelId(
  client: Client,
  channelId = DEFAULT_WORDLE_CHANNEL_ID,
  requestedBy?: string,
): Promise<WordleChallenge | null> {
  if (!channelId || !WORDLE_CHANNEL_IDS.includes(channelId)) {
    return null;
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || typeof (channel as any).send !== 'function') {
    return null;
  }
  return triggerManualWordleForChannel(channel as any, requestedBy);
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
      content: `Send one ${wordLengthRangeLabel()} guess, like \`crane\` or \`pickaxe\`.`,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  if (guess.length !== challenge.word.length) {
    await message.reply({
      content: `Today's puzzle is ${wordLengthLabel(challenge.word.length)}. Send one ${wordLengthLabel(challenge.word.length)} guess.`,
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
    const winnerName = displayNameFor(message);
    const solvedMessage = await generateSolvedMessage(winnerName, score);
    await message.reply({
      content: `${score}\n${solvedMessage}`,
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
