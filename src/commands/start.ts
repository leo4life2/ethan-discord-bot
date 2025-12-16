import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { hasEditorPermission } from '../utils/permissions.js';
import { isBotPaused, setBotPaused } from '../stateStore.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';
import { refreshPresence } from '../presence.js';

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Resume Ethan so he can reply again');

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
  if (!(await isBotPaused())) {
    return interaction.reply({
      content: 'Already running.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }
  await setBotPaused(false, interaction.user.tag);
  await refreshPresence(interaction.client);
  return interaction.reply({
    content: '▶️ Ethan is back online and will respond normally.',
    flags: MessageFlags.Ephemeral,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}


