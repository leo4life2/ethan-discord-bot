import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { rollbackKnowledge } from '../knowledgeStore.js';

export const data = new SlashCommandBuilder()
  .setName('knowledge-rollback')
  .setDescription('Create a new knowledge version by rolling back to an older one')
  .addIntegerOption((option) =>
    option
      .setName('id')
      .setDescription('Knowledge version id to roll back to')
      .setRequired(true)
      .setMinValue(1),
  )
  .addStringOption((option) =>
    option
      .setName('message')
      .setDescription('Optional commit message for the rollback'),
  );

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }

  const id = interaction.options.getInteger('id', true);
  const message = interaction.options.getString('message') ?? undefined;

  const version = await rollbackKnowledge(id, interaction.user.tag, message);
  if (!version) {
    return interaction.reply({ content: `Version v${id} not found.`, flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({ content: `✅ Rolled back to v${id}. New head is v${version.id}.`, flags: MessageFlags.Ephemeral });
}


