import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { listKnowledgeVersions, getKnowledgeVersionById, loadKnowledgeStore } from '../knowledgeStore.js';

export const data = new SlashCommandBuilder()
  .setName('view-knowledge-base')
  .setDescription('Download the current knowledge base or a specific version')
  .addIntegerOption((option) =>
    option
      .setName('id')
      .setDescription('Knowledge version id to download')
      .setMinValue(1),
  );

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const id = interaction.options.getInteger('id');
  const store = await loadKnowledgeStore();
  const version = id ? await getKnowledgeVersionById(id) : store.versions.at(-1) ?? null;

  if (!version) {
    return interaction.editReply('No knowledge base found for that id.');
  }

  const body = JSON.stringify(version.entries, null, 2);
  const attachment = new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: `knowledge-v${version.id}.json` });

  return interaction.editReply({
    content: `Knowledge base version v${version.id} • ${version.updatedAt} • ${version.updatedBy} — ${version.commitMessage || 'no message'}`,
    files: [attachment],
  });
}


