import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { loadPrompt, getVersionById } from '../promptStore.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';

export const data = new SlashCommandBuilder()
  .setName('prompt-view')
  .setDescription('Show the current system prompt or a specific version')
  .addIntegerOption((o) => o.setName('id').setDescription('Prompt version id to view'));

export async function execute(interaction: any) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }
  const id = interaction.options.getInteger('id');
  const p = id ? await getVersionById(id) : await loadPrompt();
  if (!p) {
    const msg = id ? `Version v${id} not found.` : 'No prompt set yet.';
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
  }
  const text = p.text ?? '';
  const meta = `v${p.id}`;
  const commit = p.commitMessage ? ` — ${p.commitMessage}` : '';
  const header2 = `${meta} • ${p.updatedAt ?? 'n/a'} • ${p.updatedBy ?? 'n/a'}${commit}`;
  if (text.length <= 1800) {
    return interaction.reply({
      content: `${header2}\n\n\u200B\n\u200B\n\`\`\`\n${text}\n\`\`\``,
      flags: MessageFlags.Ephemeral,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
  }
  const file = new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `system-prompt-v${p.id}.txt` });
  return interaction.reply({ content: header2, files: [file], flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
}


