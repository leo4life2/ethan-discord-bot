import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { listVersions } from '../promptStore.js';

export const data = new SlashCommandBuilder()
  .setName('show-edit-history')
  .setDescription('Show recent prompt versions with ids and commit messages');

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  const versions = await listVersions();
  if (versions.length === 0) {
    return interaction.reply({ content: 'No versions yet.', flags: MessageFlags.Ephemeral });
  }
  const top = versions.slice(0, 10);
  const lines = top.map(v => `v${v.id} • ${v.updatedAt} • ${v.updatedBy} — ${v.commitMessage || ''}`.trim());
  const content = lines.join('\n');
  return interaction.reply({ content: content, flags: MessageFlags.Ephemeral });
}


