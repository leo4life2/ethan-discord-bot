import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { EDITOR_ROLE_ID, EDITOR_USER_IDS } from '../config.js';
import { rollbackToVersion, getVersionById } from '../promptStore.js';

function canEdit(interaction: any): boolean {
  if (!interaction.inGuild()) return false;
  if (Array.isArray(EDITOR_USER_IDS) && EDITOR_USER_IDS.includes(interaction.user.id)) return true;
  return interaction.member?.roles?.cache?.has?.(EDITOR_ROLE_ID) === true;
}

export const data = new SlashCommandBuilder()
  .setName('prompt-rollback')
  .setDescription('Create a new latest version by rolling back to an older one')
  .addIntegerOption((o) => o.setName('id').setDescription('Version id to roll back to').setRequired(true));

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
  }
  if (!canEdit(interaction)) {
    return interaction.reply({ content: 'No permission.', flags: MessageFlags.Ephemeral });
  }
  const id = interaction.options.getInteger('id', true);
  const exists = await getVersionById(id);
  if (!exists) {
    return interaction.reply({ content: `Version v${id} not found.`, flags: MessageFlags.Ephemeral });
  }
  const saved = await rollbackToVersion(id, interaction.user.tag);
  if (!saved) {
    return interaction.reply({ content: 'Rollback failed.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ content: `✅ Rolled back to v${id}. New head is v${saved.id} — ${saved.commitMessage}`, flags: MessageFlags.Ephemeral });
}


