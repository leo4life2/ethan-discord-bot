import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { listKnowledgeVersions } from '../knowledgeStore.js';

const MAX_LINES = 10;

export const data = new SlashCommandBuilder()
  .setName('show-knowledge-history')
  .setDescription('List recent knowledge base versions');

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }

  const versions = await listKnowledgeVersions();
  if (versions.length === 0) {
    return interaction.reply({ content: 'No knowledge versions found.', flags: MessageFlags.Ephemeral });
  }

  const lines = versions.slice(0, MAX_LINES).map((version) => {
    const commit = version.commitMessage ? ` — ${version.commitMessage}` : '';
    return `v${version.id} • ${version.updatedAt} • ${version.updatedBy}${commit}`;
  });

  return interaction.reply({
    content: lines.join('\n'),
    flags: MessageFlags.Ephemeral,
  });
}


