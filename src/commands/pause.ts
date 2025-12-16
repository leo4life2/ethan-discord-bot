import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { isBotPaused, setBotPaused } from '../stateStore.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';
import { refreshPresence } from '../presence.js';

export const data = new SlashCommandBuilder()
  .setName('pause')
  .setDescription('Pause Ethan so he stops responding to messages');

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content: 'Use this in a server.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }
  if (!hasEditorPermission(interaction)) {
    return interaction.reply({
      content: 'No permission.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }
  if (await isBotPaused()) {
    return interaction.reply({
      content: 'Already paused.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }
  await setBotPaused(true, interaction.user.tag);
  await refreshPresence(interaction.client);
  return interaction.reply({
    content: '⏸️ Ethan is now paused.',
    flags: MessageFlags.Ephemeral,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}


