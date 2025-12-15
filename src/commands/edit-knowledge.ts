import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { saveKnowledge, KnowledgeEntry } from '../knowledgeStore.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';

export const data = new SlashCommandBuilder()
  .setName('edit-knowledge-base')
  .setDescription('Replace the knowledge base with an uploaded JSON file')
  .addAttachmentOption((option) =>
    option
      .setName('file')
      .setDescription('Upload a JSON file with the new knowledge base')
      .setRequired(true),
  )
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('Commit message for this change')
      .setRequired(true),
  );

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }

  const commitMessage = interaction.options.getString('message', true);
  const attachment = interaction.options.getAttachment('file', true);

  if (attachment.size > 512 * 1024) {
    return interaction.reply({ content: 'File too large (>512KB).', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }
  if (attachment.contentType && !attachment.contentType.includes('json')) {
    return interaction.reply({ content: 'Please upload a JSON file.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON must be an array');
    }
    const entries: KnowledgeEntry[] = parsed.map((entry: any) => ({
      text: String(entry?.text ?? '').trim(),
      added_at: entry?.added_at ? String(entry.added_at) : new Date().toISOString(),
    }));
    const version = await saveKnowledge(entries, interaction.user.tag, commitMessage);
    return interaction.editReply({ content: `✅ Knowledge base updated to v${version.id}.`, allowedMentions: SAFE_ALLOWED_MENTIONS });
  } catch (error) {
    console.error('Failed to replace knowledge base:', error);
    return interaction.editReply({ content: 'Failed to process the uploaded JSON.', allowedMentions: SAFE_ALLOWED_MENTIONS });
  }
}


