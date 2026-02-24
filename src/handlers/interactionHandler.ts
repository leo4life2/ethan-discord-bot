import { Client, Events, MessageFlags } from 'discord.js';
import * as PromptView from '../commands/prompt-view.js';
import * as PromptEdit from '../commands/prompt-edit.js';
import * as PromptHistory from '../commands/prompt-history.js';
import * as PromptRollback from '../commands/prompt-rollback.js';
import * as LearnCommand from '../commands/learn.js';
import { renderLearnMessage } from '../commands/learn.js';
import { getLearnSession, setLearnItemStatus, isSessionComplete, removeLearnSession } from '../learnSessions.js';
import { appendKnowledge } from '../knowledgeStore.js';
import * as ViewKnowledge from '../commands/view-knowledge.js';
import * as EditKnowledge from '../commands/edit-knowledge.js';
import * as KnowledgeHistory from '../commands/knowledge-history.js';
import * as KnowledgeRollback from '../commands/knowledge-rollback.js';
import * as PauseCommand from '../commands/pause.js';
import * as StartCommand from '../commands/start.js';
import { SAFE_ALLOWED_MENTIONS } from '../utils/allowedMentions.js';
import { isGuildAllowed } from '../config.js';
import { logger } from '../logger.js';

const commands = new Map<string, { execute: (interaction: any) => Promise<any> }>([
  ['prompt-view', { execute: PromptView.execute }],
  ['prompt-edit', { execute: PromptEdit.execute }],
  ['show-edit-history', { execute: PromptHistory.execute }],
  ['prompt-rollback', { execute: PromptRollback.execute }],
  ['learn', { execute: LearnCommand.execute }],
  ['view-knowledge-base', { execute: ViewKnowledge.execute }],
  ['edit-knowledge-base', { execute: EditKnowledge.execute }],
  ['show-knowledge-history', { execute: KnowledgeHistory.execute }],
  ['knowledge-rollback', { execute: KnowledgeRollback.execute }],
  ['pause', { execute: PauseCommand.execute }],
  ['start', { execute: StartCommand.execute }],
]);

export function registerInteractionHandler(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction: any) => {
    try {
      if (!isGuildAllowed(interaction.guildId ?? null)) {
        return;
      }

      if (interaction.isChatInputCommand()) {
        const handler = commands.get(interaction.commandName);
        if (!handler) {
          return interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
        }
        await handler.execute(interaction);
        return;
      }

      if (interaction.isButton()) {
        const customId = interaction.customId;
        if (!customId.startsWith('learn:')) return;
        const parts = customId.split(':');
        if (parts.length !== 4) return;
        const [, sessionId, indexStr, action] = parts;
        const index = Number(indexStr);
        if (!Number.isInteger(index)) return;

        const session = getLearnSession(sessionId);
        if (!session) {
          await interaction.reply({ content: 'Session not found.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
          return;
        }

        if (interaction.user.id !== session.initiatorId) {
          await interaction.reply({ content: 'Only the initiator can approve/reject.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
          return;
        }

        const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : null;
        if (!status) {
          return;
        }

        const updatedItem = setLearnItemStatus(sessionId, index, status);
        if (!updatedItem) {
          await interaction.deferUpdate().catch(() => {});
          return;
        }

        const updatedSession = getLearnSession(sessionId);

        if (isSessionComplete(sessionId)) {
          const finalSession = getLearnSession(sessionId);
          if (finalSession) {
            const approved = finalSession.items.filter((item) => item.status === 'approved');
            if (approved.length > 0) {
              await appendKnowledge(
                approved.map((item) => ({
                  text: item.text,
                  added_at: new Date().toISOString(),
                })),
                interaction.user.tag,
                `learn session ${sessionId} (${approved.length} new)`
              );
            }
            await interaction.update(renderLearnMessage(finalSession));
          }
          removeLearnSession(sessionId);
        } else if (updatedSession) {
          await interaction.update(renderLearnMessage(updatedSession));
        }

        return;
      }
    } catch (err) {
      logger.error('Error handling interaction', { error: err });
      if (interaction.isRepliable()) {
        try {
          await interaction.reply({ content: 'Command failed.', flags: MessageFlags.Ephemeral, allowedMentions: SAFE_ALLOWED_MENTIONS });
        } catch {
          try {
            await interaction.editReply({ content: 'Command failed.', allowedMentions: SAFE_ALLOWED_MENTIONS });
          } catch {
            // ignore
          }
        }
      }
    }
  });
}
