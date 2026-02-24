import type { REST } from '@discordjs/rest';
import { Routes } from 'discord.js';
import * as PromptView from '../commands/prompt-view.js';
import * as PromptEdit from '../commands/prompt-edit.js';
import * as PromptHistory from '../commands/prompt-history.js';
import * as PromptRollback from '../commands/prompt-rollback.js';
import * as LearnCommand from '../commands/learn.js';
import * as ViewKnowledge from '../commands/view-knowledge.js';
import * as EditKnowledge from '../commands/edit-knowledge.js';
import * as KnowledgeHistory from '../commands/knowledge-history.js';
import * as KnowledgeRollback from '../commands/knowledge-rollback.js';
import * as PauseCommand from '../commands/pause.js';
import * as StartCommand from '../commands/start.js';
import { TARGET_GUILD_IDS } from '../config.js';
import { logger } from '../logger.js';

export async function registerSlashCommands(readyClient: any, rest: REST): Promise<void> {
  try {
    if (!readyClient.application) {
      await readyClient.fetchApplication?.();
    } else {
      await readyClient.application.fetch?.();
    }
    const CLIENT_ID = readyClient.application?.id;
    if (!CLIENT_ID) {
      logger.warn('Unable to resolve application id; skipping command registration');
      return;
    }
    const commandBodies = [
      (PromptView as any).data.toJSON(),
      (PromptEdit as any).data.toJSON(),
      (PromptHistory as any).data.toJSON(),
      (PromptRollback as any).data.toJSON(),
      (LearnCommand as any).data.toJSON(),
      (ViewKnowledge as any).data.toJSON(),
      (EditKnowledge as any).data.toJSON(),
      (KnowledgeHistory as any).data.toJSON(),
      (KnowledgeRollback as any).data.toJSON(),
      (PauseCommand as any).data.toJSON(),
      (StartCommand as any).data.toJSON(),
    ];
    for (const guildId of TARGET_GUILD_IDS) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commandBodies });
        logger.info(`Registered guild commands in ${guildId}`);
      } catch (guildError) {
        logger.error('Failed to register slash commands in guild', { guildId, error: guildError });
      }
    }
  } catch (e) {
    logger.error('Failed to register slash commands', { error: e });
  }
}
