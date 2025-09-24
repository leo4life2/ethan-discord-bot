import {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { extractLearnedFacts } from '../openaiHelpers.js';
import { loadKnowledge } from '../knowledgeStore.js';
import { createLearnSession, setLearnSessionMessage, type LearnSession } from '../learnSessions.js';

const MAX_FETCH = 50;
const MIN_FETCH = 30;

export const data = new SlashCommandBuilder()
  .setName('learn')
  .setDescription('Capture new knowledge from the recent conversation');

function buildButtons(sessionId: string, index: number, status: string) {
  const approve = new ButtonBuilder()
    .setCustomId(`learn:${sessionId}:${index}:approve`)
    .setLabel('✅')
    .setStyle(ButtonStyle.Success)
    .setDisabled(status !== 'pending');
  const reject = new ButtonBuilder()
    .setCustomId(`learn:${sessionId}:${index}:reject`)
    .setLabel('❌')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(status !== 'pending');
  return new ActionRowBuilder<ButtonBuilder>().addComponents(approve, reject);
}

function formatTranscript(messages: any[]): string {
  return messages
    .map((msg) => {
      const author = msg.author?.tag ?? msg.author?.username ?? 'Unknown';
      return `[${author}] ${msg.content ?? ''}`;
    })
    .join('\n');
}

async function fetchContext(interaction: ChatInputCommandInteraction) {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) return [];
  const fetched = await channel.messages.fetch({ limit: MAX_FETCH });
  const messages = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  if (messages.length > MIN_FETCH) {
    return messages.slice(messages.length - MIN_FETCH);
  }
  return messages;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ ephemeral: true });
  const messages = await fetchContext(interaction);
  if (messages.length === 0) {
    return interaction.editReply('No messages found to learn from.');
  }

  const transcript = formatTranscript(messages);
  const knowledge = await loadKnowledge();
  const candidates = await extractLearnedFacts(transcript, knowledge);

  if (candidates.length === 0) {
    return interaction.editReply('No new facts detected.');
  }

  const session = createLearnSession(interaction.user.id, candidates);
  const render = renderLearnMessage(session);

  const message = await interaction.editReply(render as any);
  if (message) {
    setLearnSessionMessage(session.id, message.id, message.channelId, message.guildId ?? undefined);
  }
}

function formatStatus(status: string): string {
  switch (status) {
    case 'approved':
      return '✅ approved';
    case 'rejected':
      return '❌ rejected';
    default:
      return '⏳ pending';
  }
}

export function renderLearnMessage(session: LearnSession) {
  const header = 'Approve any new knowledge points below.';
  const list = session.items
    .map((item, idx) => `${idx + 1}. ${item.text} — ${formatStatus(item.status)}`)
    .join('\n');

  const rows = session.items.map((item, index) => buildButtons(session.id, index, item.status));

  if (list.length > 1800) {
    const attachment = new AttachmentBuilder(Buffer.from(list, 'utf8'), { name: 'learn-candidates.txt' });
    return {
      content: header,
      files: [attachment],
      components: rows,
    };
  }

  return {
    content: `${header}\n\n${list}`,
    components: rows,
  };
}

