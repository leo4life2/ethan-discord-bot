import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { EDITOR_ROLE_ID, EDITOR_USER_IDS } from '../config.js';
import { savePrompt } from '../promptStore.js';

function canEdit(interaction: any): boolean {
  if (!interaction.inGuild()) return false;
  if (Array.isArray(EDITOR_USER_IDS) && EDITOR_USER_IDS.includes(interaction.user.id)) return true;
  return interaction.member?.roles?.cache?.has?.(EDITOR_ROLE_ID) === true;
}

export const data = new SlashCommandBuilder()
  .setName('prompt-edit')
  .setDescription('Replace the system prompt')
  .addAttachmentOption((o) => o.setName('file').setDescription('Upload a .txt file with the new prompt').setRequired(true))
  .addStringOption((o) => o.setName('message').setDescription('Commit message for this change').setRequired(true));

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!canEdit(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }
  const message = interaction.options.getString('message', true);
  const attachment = interaction.options.getAttachment('file', true);
  if (attachment.size > 512 * 1024) {
    return interaction.reply({ content: 'File too large (>512KB).', flags: MessageFlags.Ephemeral });
  }
  if (attachment.contentType && !String(attachment.contentType).startsWith('text/')) {
    return interaction.reply({ content: 'Please upload a text file.', flags: MessageFlags.Ephemeral });
  }
  let text: string;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    text = await res.text();
  } catch (e) {
    return interaction.reply({ content: 'Could not read the file from Discord CDN.', flags: MessageFlags.Ephemeral });
  }
  const saved = await savePrompt(text, interaction.user.tag, message);
  return interaction.reply({ content: `✅ Updated to v${saved.id} — ${saved.commitMessage}`, flags: MessageFlags.Ephemeral });
}


