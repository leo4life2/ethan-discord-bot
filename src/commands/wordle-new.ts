import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { triggerManualWordleForChannel, isWordleChannel } from '../wordle.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';
import { hasEditorPermission } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('wordle-new')
  .setDescription('Start a fresh Wordle puzzle in the Wordle channel');

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

  if (!isWordleChannel(interaction.channelId)) {
    return interaction.reply({
      content: 'Use this in the Wordle channel.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const challenge = await triggerManualWordleForChannel(interaction.channel, interaction.user.tag);
  if (!challenge) {
    return interaction.editReply({
      content: 'Could not start a Wordle puzzle in this channel.',
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }

  return interaction.editReply({
    content: 'Started a fresh Wordle puzzle.',
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}
