import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  MessageFlags,
  Message,
  Routes,
  Collection,
} from "discord.js";
import { handle, generateSpeech } from "./logic.js";
import { REST } from "@discordjs/rest";
import fs from 'node:fs/promises';
import { startPresenceRotation } from './presence.js';
import * as PromptView from './commands/prompt-view.js';
import * as PromptEdit from './commands/prompt-edit.js';
import * as PromptHistory from './commands/prompt-history.js';
import * as PromptRollback from './commands/prompt-rollback.js';
import * as LearnCommand from './commands/learn.js';
import { renderLearnMessage } from './commands/learn.js';
import { getLearnSession, setLearnItemStatus, isSessionComplete, removeLearnSession } from './learnSessions.js';
import { appendKnowledge } from './knowledgeStore.js';
import * as ViewKnowledge from './commands/view-knowledge.js';
import * as EditKnowledge from './commands/edit-knowledge.js';
import * as KnowledgeHistory from './commands/knowledge-history.js';
import * as KnowledgeRollback from './commands/knowledge-rollback.js';
import * as PauseCommand from './commands/pause.js';
import * as StartCommand from './commands/start.js';
import { logger } from './logger.js';
import { SAFE_ALLOWED_MENTIONS, RAW_SAFE_ALLOWED_MENTIONS } from './utils/allowedMentions.js';
import { isBotPaused } from './stateStore.js';
import { ETHAN_CHANNEL_IDS, TARGET_GUILD_IDS, isGuildAllowed } from './config.js';
import { sanitizeDiscordMentions } from './utils/sanitize.js';

const TOKEN = process.env.DISCORD_TOKEN!;
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needs the MESSAGE CONTENT privileged intent enabled
  ],
});

const RESPONSE_SILENCE_MS = 3000;
type PendingReply = {
  message: Message;
  timeout: NodeJS.Timeout;
  token: number;
  typingInterval?: NodeJS.Timeout | null;
};
const pendingReplies = new Map<string, PendingReply>();
let pendingTokenCounter = 0;

const rest = new REST({ version: '10' })
  .setToken(TOKEN);

// Define interfaces for better type safety with Discord API responses
interface AttachmentSlot {
  id: string;
  upload_filename: string;
  upload_url: string;
}

interface ChannelAttachmentsResponse {
  attachments: AttachmentSlot[];
}

async function sendVoiceMessage(channelId: string, filePath: string, seconds: number, audioFileName: string, attachmentTitle: string) {
  const buf = await fs.readFile(filePath); // buf is a Node.js Buffer
  const { attachments: [slot] } = await rest.post(
    `/channels/${channelId}/attachments`,
    { body: { files: [{ id: '0', filename: audioFileName, file_size: buf.length }] } }
  ) as ChannelAttachmentsResponse;

  await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'audio/ogg' },
    // Cast to any to satisfy BodyInit; node's undici accepts Buffer
    body: buf as any,
  });

  const waveform = Buffer.alloc(256, 128).toString('base64'); // Generate default flat waveform

  await rest.post(
    `/channels/${channelId}/messages`, // Use raw path
    { body: {
        flags: 1 << 13,                  // 8192
        attachments: [{
          id: '0',
          filename: audioFileName,
          uploaded_filename: slot.upload_filename,
          duration_secs: seconds,
          waveform: waveform, // Use internally generated flat waveform
          title: `Voice message: ${attachmentTitle}`,   // Keep the title field
        }],
        allowed_mentions: RAW_SAFE_ALLOWED_MENTIONS,
      } }
  );
}

function startTypingLoop(channel: any): NodeJS.Timeout | null {
  if (!channel || typeof channel.sendTyping !== 'function') return null;
  // Typing indicator lasts ~10 seconds; refresh a bit sooner.
  const intervalMs = 8000;
  // Fire immediately so users see it during the debounce window.
  channel.sendTyping().catch(() => {});
  return setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, intervalMs);
}

function stopTypingLoop(interval: NodeJS.Timeout | null | undefined) {
  if (!interval) return;
  clearInterval(interval);
}

function createSilenceTimeout(channelId: string, token: number): NodeJS.Timeout {
  return setTimeout(() => {
    flushPendingReply(channelId, token).catch((error) => {
      logger.error('Failed to process pending reply', { channelId, error });
    });
  }, RESPONSE_SILENCE_MS);
}

function scheduleDeferredReply(message: Message) {
  const channelId = message.channel.id;
  const token = ++pendingTokenCounter;
  const existing = pendingReplies.get(channelId);
  if (existing) {
    clearTimeout(existing.timeout);
  }
  const timeout = createSilenceTimeout(channelId, token);
  const typingInterval = existing?.typingInterval ?? startTypingLoop(message.channel as any);
  pendingReplies.set(channelId, { message, timeout, token, typingInterval });
}

function bumpPendingSilence(channelId: string) {
  const entry = pendingReplies.get(channelId);
  if (!entry) return;
  clearTimeout(entry.timeout);
  entry.timeout = createSilenceTimeout(channelId, entry.token);
}

async function flushPendingReply(channelId: string, token: number) {
  const entry = pendingReplies.get(channelId);
  if (!entry || entry.token !== token) {
    return;
  }
  pendingReplies.delete(channelId);
  const typingInterval = entry.typingInterval ?? null;
  if (await isBotPaused()) {
    stopTypingLoop(typingInterval);
    return;
  }
  try {
    await respondToMessage(entry.message);
  } finally {
    stopTypingLoop(typingInterval);
  }
}

async function respondToMessage(latestMessage: Message) {
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
    
    if (response) {
          const finalReply = sanitizeDiscordMentions(response.text.replace(/<@!?\d+>/g, '').trim());
      
      if (response.generateSpeech) {
        try {
          const speech = await generateSpeech(finalReply);
          if (speech) {
            const audioFileNameWithExt = `voice_message_${Date.now()}.ogg`;
            await sendVoiceMessage(textChannel.id, speech.filePath, speech.duration, audioFileNameWithExt, finalReply);
            await fs.unlink(speech.filePath).catch((error) => {
              logger.error('Failed to delete temp speech file', { error, filePath: speech.filePath });
            });
          } else {
            await textChannel.send({ content: finalReply, allowedMentions: SAFE_ALLOWED_MENTIONS });
          }
        } catch (err) {
          logger.error("Error generating or sending speech", { error: err });
          await textChannel.send({ content: finalReply, allowedMentions: SAFE_ALLOWED_MENTIONS });
        }
      } else {
        await textChannel.send({ content: finalReply, allowedMentions: SAFE_ALLOWED_MENTIONS });
      }
    }
  } catch (err) {
    logger.error("Error fetching history or handling message", { error: err });
    await textChannel.send({ content: "Beep boop... Error processing that.", allowedMentions: SAFE_ALLOWED_MENTIONS }).catch((error: any) => {
      logger.error("Failed to send error message to channel", { error });
    });
  }
}

async function registerSlashCommands(readyClient: any) {
  try {
    // Ensure application data is loaded
    if (!readyClient.application) {
      await readyClient.fetchApplication?.();
    } else {
      await readyClient.application.fetch?.();
    }
    const CLIENT_ID = readyClient.application?.id;
    if (!CLIENT_ID) {
      logger.warn('Unable to resolve application id; skipping command registration');
      return;
    }
    const commandBodies = [
      (PromptView as any).data.toJSON(),
      (PromptEdit as any).data.toJSON(),
      (PromptHistory as any).data.toJSON(),
      (PromptRollback as any).data.toJSON(),
      (LearnCommand as any).data.toJSON(),
      (ViewKnowledge as any).data.toJSON(),
      (EditKnowledge as any).data.toJSON(),
      (KnowledgeHistory as any).data.toJSON(),
      (KnowledgeRollback as any).data.toJSON(),
      (PauseCommand as any).data.toJSON(),
      (StartCommand as any).data.toJSON(),
    ];
    for (const guildId of TARGET_GUILD_IDS) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commandBodies });
        logger.info(`Registered guild commands in ${guildId}`);
      } catch (guildError) {
        logger.error('Failed to register slash commands in guild', { guildId, error: guildError });
      }
    }
  } catch (e) {
    logger.error('Failed to register slash commands', { error: e });
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  if (readyClient.user) { // Ensure client.user is available
    startPresenceRotation(readyClient); // Start new presence rotation
  }
  await registerSlashCommands(readyClient);
});

// Register interaction handler for slash commands
const commands = new Map<string, { execute: (interaction: any) => Promise<any> }>([
  ['prompt-view', { execute: PromptView.execute }],
  ['prompt-edit', { execute: PromptEdit.execute }],
  ['show-edit-history', { execute: PromptHistory.execute }],
  ['prompt-rollback', { execute: PromptRollback.execute }],
  ['learn', { execute: LearnCommand.execute }],
  ['view-knowledge-base', { execute: ViewKnowledge.execute }],
  ['edit-knowledge-base', { execute: EditKnowledge.execute }],
  ['show-knowledge-history', { execute: KnowledgeHistory.execute }],
  ['knowledge-rollback', { execute: KnowledgeRollback.execute }],
  ['pause', { execute: PauseCommand.execute }],
  ['start', { execute: StartCommand.execute }],
]);

client.on(Events.InteractionCreate, async (interaction: any) => {
  try {
    if (!isGuildAllowed(interaction.guildId ?? null)) {
      return;
    }

    if (interaction.isChatInputCommand()) {
      const handler = commands.get(interaction.commandName);
      if (!handler) {
        return interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
      }
      await handler.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (!customId.startsWith('learn:')) return;
      const parts = customId.split(':');
      if (parts.length !== 4) return;
      const [, sessionId, indexStr, action] = parts;
      const index = Number(indexStr);
      if (!Number.isInteger(index)) return;

      const session = getLearnSession(sessionId);
      if (!session) {
        await interaction.reply({ content: 'Session not found.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
        return;
      }

      if (interaction.user.id !== session.initiatorId) {
        await interaction.reply({ content: 'Only the initiator can approve/reject.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
        return;
      }

      const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
      if (!status) {
        return;
      }

      const updatedItem = setLearnItemStatus(sessionId, index, status);
      if (!updatedItem) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }

      const updatedSession = getLearnSession(sessionId);

      if (isSessionComplete(sessionId)) {
        const finalSession = getLearnSession(sessionId);
        if (finalSession) {
          const approved = finalSession.items.filter((item) => item.status === 'approved');
          if (approved.length > 0) {
            await appendKnowledge(
              approved.map((item) => ({
                text: item.text,
                added_at: new Date().toISOString(),
              })),
              interaction.user.tag,
              `learn session ${sessionId} (${approved.length} new)`
            );
          }
          await interaction.update(renderLearnMessage(finalSession));
        }
        removeLearnSession(sessionId);
      } else if (updatedSession) {
        await interaction.update(renderLearnMessage(updatedSession));
      }

      return;
    }
  } catch (err) {
    logger.error('Error handling interaction', { error: err });
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: 'Command failed.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
      } catch {
        try {
          await interaction.editReply({ content: 'Command failed.', allowedMentions: SAFE_ALLOWED_MENTIONS });
        } catch {/* ignore */}
      }
    }
  }
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || !client.user) return;

  const isTextChannel =
    msg.channel.type === ChannelType.GuildText ||
    msg.channel.type === ChannelType.DM;
  if (!isTextChannel) {
    return;
  }

  // Any activity in the channel resets the silence timer if a reply is pending
  bumpPendingSilence(msg.channel.id);
        
  if (!isGuildAllowed(msg.guildId ?? null)) {
    return;
  }

  const isMentioned = msg.mentions.users.has(client.user.id);
  const isInEthanChannel = ETHAN_CHANNEL_IDS.includes(msg.channel.id);

  if (!isMentioned && !isInEthanChannel) {
    return;
  }

  if (await isBotPaused()) {
    return;
  }

  scheduleDeferredReply(msg);
});

// Removed old presence logic and login
client.login(TOKEN); // Login is now the last step
