import fs from 'node:fs/promises';
import type { REST } from '@discordjs/rest';
import {
  ChannelType,
  Client,
  Collection,
  Events,
  Message,
} from 'discord.js';
import { handle, generateSpeech } from '../logic.js';
import { logger } from '../logger.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';
import { isBotPaused } from '../stateStore.js';
import { ETHAN_CHANNEL_IDS, isGuildAllowed } from '../config.js';
import { sanitizeDiscordMentions } from '../utils/sanitize.js';
import { sendVoiceMessage } from './voiceMessage.js';

const RESPONSE_SILENCE_MS = 2500;
const CUE_WORDS = ['spoon', 'ethan'] as const;
const TYPING_START_DELAY_MS = 350;
const TYPING_REFRESH_INTERVAL_MS = 8000;

type PendingReply = {
  message: Message;
  timeout: NodeJS.Timeout;
  token: number;
  typingRefresher?: { stop: () => void } | null;
};

function messageHasCueWord(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  return CUE_WORDS.some((w) => lower.includes(w));
}

function startTypingRefresher(channel: any): { stop: () => void } | null {
  if (!channel || typeof channel.sendTyping !== 'function') return null;

  // Keep the typing indicator alive while we wait + generate a reply.
  let interval: NodeJS.Timeout | null = null;
  const startTimeout = setTimeout(() => {
    channel.sendTyping().catch(() => {});
    interval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, TYPING_REFRESH_INTERVAL_MS);
  }, TYPING_START_DELAY_MS);

  return {
    stop: () => {
      clearTimeout(startTimeout);
      if (interval) clearInterval(interval);
    },
  };
}

function stopTypingRefresher(refresher: { stop: () => void } | null | undefined): void {
  if (!refresher) return;
  try {
    refresher.stop();
  } catch {
    // ignore
  }
}

export function registerMessageHandler(client: Client, rest: REST): void {
  const pendingReplies = new Map<string, PendingReply>();
  let pendingTokenCounter = 0;

  const createSilenceTimeout = (channelId: string, token: number): NodeJS.Timeout => {
    return setTimeout(() => {
      flushPendingReply(channelId, token).catch((error) => {
        logger.error('Failed to process pending reply', { channelId, error });
      });
    }, RESPONSE_SILENCE_MS);
  };

  const scheduleDeferredReply = (message: Message): void => {
    const channelId = message.channel.id;
    const token = ++pendingTokenCounter;
    const existing = pendingReplies.get(channelId);
    if (existing) {
      clearTimeout(existing.timeout);
    }
    const timeout = createSilenceTimeout(channelId, token);
    const typingRefresher = existing?.typingRefresher ?? startTypingRefresher(message.channel as any);
    pendingReplies.set(channelId, { message, timeout, token, typingRefresher });
  };

  const bumpPendingSilence = (channelId: string): void => {
    const entry = pendingReplies.get(channelId);
    if (!entry) return;
    clearTimeout(entry.timeout);
    entry.timeout = createSilenceTimeout(channelId, entry.token);
  };

  const respondToMessage = async (latestMessage: Message): Promise<void> => {
    if (!client.user) return;
    const channel = latestMessage.channel;
    if (!channel.isTextBased()) {
      return;
    }
    const textChannel = channel as any;
    try {
      const historyCollection = await textChannel.messages.fetch({ limit: 20 }) as Collection<string, Message>;
      const history = Array.from(historyCollection.values()).reverse();
      const response = await handle(latestMessage.content, latestMessage, history, client.user.id);

      if (response?.generateSpeech) {
        const finalReply = sanitizeDiscordMentions(response.text.replace(/<@!?\d+>/g, '').trim());
        try {
          const speech = await generateSpeech(finalReply);
          if (speech) {
            const audioFileNameWithExt = `voice_message_${Date.now()}.ogg`;
            await sendVoiceMessage(rest, textChannel.id, speech.filePath, speech.duration, audioFileNameWithExt, finalReply);
            await fs.unlink(speech.filePath).catch((error) => {
              logger.error('Failed to delete temp speech file', { error, filePath: speech.filePath });
            });
          } else if (response.shouldSendTextMessage && !response.textAlreadySent) {
            await textChannel.send({ content: finalReply, allowedMentions: SAFE_ALLOWED_MENTIONS });
          }
        } catch (err) {
          logger.error('Error generating or sending speech', { error: err });
          if (response.shouldSendTextMessage && !response.textAlreadySent) {
            await textChannel.send({ content: finalReply, allowedMentions: SAFE_ALLOWED_MENTIONS });
          }
        }
      }
    } catch (err) {
      logger.error('Error fetching history or handling message', { error: err });
      await textChannel.send({ content: 'Beep boop... Error processing that.', allowedMentions: SAFE_ALLOWED_MENTIONS }).catch((error: any) => {
        logger.error('Failed to send error message to channel', { error });
      });
    }
  };

  const flushPendingReply = async (channelId: string, token: number): Promise<void> => {
    const entry = pendingReplies.get(channelId);
    if (!entry || entry.token !== token) {
      return;
    }
    pendingReplies.delete(channelId);
    const typingRefresher = entry.typingRefresher ?? null;
    if (await isBotPaused()) {
      stopTypingRefresher(typingRefresher);
      return;
    }
    try {
      await respondToMessage(entry.message);
    } finally {
      stopTypingRefresher(typingRefresher);
    }
  };

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot || !client.user) return;

    const isTextChannel =
      msg.channel.type === ChannelType.GuildText ||
      msg.channel.type === ChannelType.DM ||
      msg.channel.isThread();
    if (!isTextChannel) {
      return;
    }

    // Any activity in the channel resets the silence timer if a reply is pending.
    bumpPendingSilence(msg.channel.id);

    if (!isGuildAllowed(msg.guildId ?? null)) {
      return;
    }

    const isMentioned = msg.mentions.users.has(client.user.id);
    const parentChannelId = msg.channel.isThread() ? msg.channel.parentId : null;
    const isInEthanChannel =
      ETHAN_CHANNEL_IDS.includes(msg.channel.id) ||
      (parentChannelId ? ETHAN_CHANNEL_IDS.includes(parentChannelId) : false);
    const hasCueWord = messageHasCueWord(msg.content);

    if (!isMentioned && !isInEthanChannel && !hasCueWord) {
      return;
    }

    if (await isBotPaused()) {
      return;
    }

    scheduleDeferredReply(msg);
  });
}
