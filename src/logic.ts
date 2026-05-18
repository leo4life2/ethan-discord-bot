import { ChannelType, type Message } from "discord.js";
import path from 'node:path';
import fs from 'node:fs/promises';
import { Agent, run, tool, webSearchTool } from '@openai/agents';
import type { AgentInputItem, RunStreamEvent, Tool } from '@openai/agents';
import { z } from 'zod';
import { loadPrompt } from './promptStore.js';
import { loadKnowledge } from './knowledgeStore.js';
import { openai } from './openaiClient.js';
import { logger } from './logger.js';
import { SAFE_ALLOWED_MENTIONS } from './utils/allowedMentions.js';
import { sanitizeDiscordMentions } from './utils/sanitize.js';
import { withRetry } from './utils/retry.js';
import {
  ETHAN_REPLY_MAX_TURNS,
  ETHAN_REPLY_MODEL,
  ETHAN_REPLY_REASONING_EFFORT,
  ETHAN_REPLY_VERBOSITY,
  ETHAN_RESEARCH_ALLOWED_DOMAINS,
  ETHAN_RESEARCH_EXTERNAL_WEB_ACCESS,
  ETHAN_RESEARCH_MAX_OUTPUT_TOKENS,
  ETHAN_RESEARCH_MAX_SOURCES,
  ETHAN_RESEARCH_MAX_TURNS,
  ETHAN_RESEARCH_MODEL,
  ETHAN_RESEARCH_PARALLEL_TOOL_CALLS,
  ETHAN_RESEARCH_REASONING_EFFORT,
  ETHAN_RESEARCH_SEARCH_CONTEXT_SIZE,
  ETHAN_RESEARCH_TOOL_CHOICE,
  ETHAN_RESEARCH_VERBOSITY,
  ETHAN_SUPPORT_FORUM_CHANNEL_ID,
  ETHAN_SUPPORT_TICKET_TOOL_ENABLED,
} from './config.js';

let lastTtsTimestamp = 0;
const MAX_REACTIONS_PER_MESSAGE = 5;
const MAX_REACTION_USERS_PER_EMOJI = 6;
const MIN_RESEARCH_PROGRESS_DOTS = 3;
const MAX_RESEARCH_PROGRESS_DOTS = 160;
const SUPPORT_TICKET_TITLE_MAX_LENGTH = 90;
const SUPPORT_TICKET_BODY_MAX_LENGTH = 1900;
const SUPPORT_TICKET_CONTEXT_MAX_MESSAGES = 6;
const SUPPORT_TICKET_AUTO_ARCHIVE_DURATION_MINUTES = 10080;
const SUPPORT_TICKET_CACHE_MAX_ENTRIES = 200;

const EthanResponseSchema = z.object({
  should_send_text_message: z.boolean().describe('Whether Ethan should send a text message to the channel.'),
  should_react: z.boolean().describe('Whether Ethan should react to the latest message.'),
  generate_speech: z.boolean().describe('Whether Ethan should generate and send a voice message.'),
  say_in_discord: z.string().describe('Text content for message and/or speech. Do not include the `[Ethan]:` prefix.'),
  reaction_emoji: z.string().describe('Unicode emoji to react with on the latest message. If not reacting, return an empty string.'),
});

const ResearchSourceSchema = z.object({
  title: z.string().describe('Short source title.'),
  url: z.string().describe('Source URL.'),
  relevant_claim: z.string().describe('One concise claim this source supports.'),
});

const ResearchBriefSchema = z.object({
  answer: z.string().describe('Concise research answer for Ethan to use.'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Confidence in the researched answer.'),
  sources: z.array(ResearchSourceSchema).max(8).describe('Sources used for the answer.'),
  caveats: z.string().describe('Any uncertainty, source weakness, or missing information. Empty string if none.'),
});

const SupportTicketInputSchema = z.object({
  title: z.string().min(1).max(SUPPORT_TICKET_TITLE_MAX_LENGTH).describe('Short developer-readable title for the support forum post.'),
  severity: z.enum(['low', 'medium', 'high', 'urgent']).describe('How severe the MinePal issue appears from the conversation.'),
  user_impact: z.string().max(600).describe('What the user is blocked by or experiencing. Empty string if unknown.'),
  summary: z.string().min(1).max(1200).describe('Concise factual summary of the MinePal problem developers should know about.'),
  evidence: z.array(z.string().min(1).max(400)).max(8).describe('Specific observations from the conversation. Do not include speculation.'),
  requested_action: z.string().max(600).describe('What developers should investigate or do next. Empty string if unclear.'),
});

type EthanResponse = z.infer<typeof EthanResponseSchema>;
type ResearchBrief = z.infer<typeof ResearchBriefSchema>;
type SupportTicketInput = z.infer<typeof SupportTicketInputSchema>;
type ProgressSource = 'reply' | 'research';

const supportTicketsBySourceMessageId = new Map<string, {
  threadId: string;
  url: string;
  title: string;
}>();

function rememberSupportTicket(sourceMessageId: string, ticket: {
  threadId: string;
  url: string;
  title: string;
}): void {
  if (supportTicketsBySourceMessageId.size >= SUPPORT_TICKET_CACHE_MAX_ENTRIES) {
    const oldestKey = supportTicketsBySourceMessageId.keys().next().value;
    if (oldestKey) supportTicketsBySourceMessageId.delete(oldestKey);
  }
  supportTicketsBySourceMessageId.set(sourceMessageId, ticket);
}

const SYSTEM_PROMPT_APPENDIX = [
  '[System Prompt Appendix]',
  'Be proactive and engage frequently in chat.',
  'Lean toward responding rather than staying silent.',
  'Use lightweight reactions often when they fit the vibe.',
  'You can choose any combination of actions: text message, reaction, and voice.',
  'At least one action must be true: should_send_text_message, should_react, or generate_speech.',
  'Always include all schema fields.',
  'If should_send_text_message is true or generate_speech is true, provide say_in_discord; otherwise set say_in_discord to an empty string.',
  'If should_react is true, provide reaction_emoji; otherwise set reaction_emoji to an empty string.',
  'You have a research_web tool backed by a stronger research specialist.',
  'Use research_web before replying when the question depends on current outside facts, credible sources, technical details you are unsure about, or a difficult support/research question.',
  'Do not call research_web for casual chat, obvious conversation, or MinePal facts already present in this prompt.',
  'When you use research_web, fold the result into Ethan voice and include concise source URLs when they matter.',
  'You also have a create_support_ticket tool that creates a real post in the MinePal support forum for developers.',
  'Use create_support_ticket only when the current conversation clearly describes a MinePal bug, outage, account/payment issue, moderation/support issue, or other problem a developer should know about.',
  'Do not create support tickets for casual chat, ordinary questions, jokes, vague dissatisfaction, feature brainstorming, or issues that need one clarifying question first.',
  'If you create a support ticket, keep replying normally afterward and mention the ticket only briefly if it helps the user.',
].join('\n');

function generateKnowledgeSection(entries: { text: string; added_at: string }[]): string {
  if (!entries.length) return '';
  const lastUpdated = entries[0]?.added_at ?? new Date().toISOString();
  const lines = entries.map((entry) => {
    const dateLabel = entry.added_at ? ` (${entry.added_at})` : '';
    return `- ${entry.text}${dateLabel}`;
  });
  return `[Server Knowledge — last updated ${lastUpdated}]

${lines.join('\n')}`;
}

/**
 * Generate a system prompt with dynamic values.
 */
async function getSystemPrompt(userName: string): Promise<string> {
  const californiaNow = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date());
  const currentDate = `current California datetime: ${californiaNow}`;
  const stored = await loadPrompt();
  const base = stored ? (stored.text ?? '') : '';
  const knowledge = await loadKnowledge();
  const knowledgeSection = knowledge.length > 0
    ? generateKnowledgeSection(knowledge)
    : '';
  const promptWithKnowledge = knowledgeSection
    ? `${knowledgeSection}

${base}`
    : base;
  return `${promptWithKnowledge}

${SYSTEM_PROMPT_APPENDIX}`
    .replace('{currentDate}', currentDate)
    .replace('{userName}', userName);
}

/**
 * Split a long string into Discord-safe message chunks (<= 2000 chars),
 * preferring to break on paragraph or line boundaries.
 */
function splitIntoDiscordMessages(text: string, maxLength = 2000): string[] {
  if (!text) return [""];
  if (text.length <= maxLength) return [text];

  const hardLimit = Math.max(1, Math.min(maxLength, 2000));
  const softLimit = Math.max(1, hardLimit - 50); // leave a little headroom

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > hardLimit) {
    // Try to split on double newline, then single newline, then space
    let splitIdx = -1;
    const candidate = remaining.slice(0, softLimit);

    splitIdx = candidate.lastIndexOf("\n\n");
    if (splitIdx === -1) splitIdx = candidate.lastIndexOf("\n");
    if (splitIdx === -1) splitIdx = candidate.lastIndexOf(" ");
    if (splitIdx === -1 || splitIdx < softLimit * 0.5) {
      // Fallback: hard cut
      splitIdx = hardLimit;
    }

    const part = remaining.slice(0, splitIdx).trimEnd();
    chunks.push(part);
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function formatReactionEmoji(reaction: any): string {
  const emoji = reaction?.emoji;
  if (emoji && typeof emoji.toString === 'function') {
    return emoji.toString();
  }
  if (emoji?.name) {
    return String(emoji.name);
  }
  return 'unknown_emoji';
}

async function buildReactionSummary(message: Message): Promise<string> {
  const reactions = Array.from(message.reactions.cache.values());
  if (reactions.length === 0) return '';

  const selectedReactions = reactions.slice(0, MAX_REACTIONS_PER_MESSAGE);
  const summaryParts: string[] = [];

  for (const reaction of selectedReactions) {
    const emoji = formatReactionEmoji(reaction);
    let users: string[] = [];
    try {
      const fetchedUsers = await reaction.users.fetch({ limit: MAX_REACTION_USERS_PER_EMOJI });
      users = Array.from(fetchedUsers.values()).map((user) => user.username);
    } catch (error) {
      logger.warn('Failed to fetch reaction users for context', {
        error,
        messageId: message.id,
        emoji,
      });
      users = Array.from(reaction.users.cache.values()).map((user) => user.username);
    }

    users = Array.from(new Set(users)).slice(0, MAX_REACTION_USERS_PER_EMOJI);
    const usersText = users.length > 0 ? users.join(', ') : 'unknown users';
    const count = typeof reaction.count === 'number' ? reaction.count : users.length;
    const moreUsers = count > users.length ? ` (+${count - users.length} more)` : '';
    summaryParts.push(`${emoji} x${count} by ${usersText}${moreUsers}`);
  }

  const extraReactionTypes = reactions.length - selectedReactions.length;
  const extraSuffix = extraReactionTypes > 0
    ? `; +${extraReactionTypes} more reaction types`
    : '';

  return `[Reactions: ${summaryParts.join(' | ')}${extraSuffix}]`;
}

function formatResearchBrief(brief: ResearchBrief | undefined): string {
  if (!brief) {
    return 'research_result: unavailable';
  }

  const sources = brief.sources
    .slice(0, ETHAN_RESEARCH_MAX_SOURCES)
    .map((source, index) => `${index + 1}. ${source.title}: ${source.relevant_claim} (${source.url})`);

  return [
    `research_answer: ${brief.answer}`,
    `confidence: ${brief.confidence}`,
    sources.length > 0 ? `sources:\n${sources.join('\n')}` : 'sources: none',
    brief.caveats ? `caveats: ${brief.caveats}` : 'caveats: none',
  ].join('\n');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function sanitizeSupportTicketText(text: string): string {
  return sanitizeDiscordMentions(text)
    .replace(/<@!?\d+>/g, 'user')
    .replace(/<@&\d+>/g, 'role')
    .replace(/<#\d+>/g, 'channel');
}

function sanitizeSupportTicketTitle(title: string): string {
  const sanitized = sanitizeSupportTicketText(title)
    .replace(/\s+/g, ' ')
    .trim();

  return truncateText(sanitized || 'MinePal support issue', SUPPORT_TICKET_TITLE_MAX_LENGTH);
}

function supportTicketMessageUrl(message: Message): string {
  try {
    return message.url;
  } catch {
    return '';
  }
}

function formatSupportContextLine(message: Message): string {
  let content = message.content?.trim() || '';
  if (!content && message.attachments.size > 0) {
    content = `[${message.attachments.size} attachment${message.attachments.size === 1 ? '' : 's'}]`;
  }
  if (!content && message.embeds.length > 0) {
    const embed = message.embeds[0];
    content = embed.description?.trim() || embed.title?.trim() || '[embed]';
  }

  const safeContent = truncateText(sanitizeSupportTicketText(content || '[no text]'), 260);
  return `- ${message.author.username}: ${safeContent}`;
}

function buildSupportTicketBody(input: SupportTicketInput, messageMeta: Message, history: Message[]): string {
  const sourceUrl = supportTicketMessageUrl(messageMeta);
  const channelLabel = messageMeta.guildId
    ? `<#${messageMeta.channelId}>`
    : `DM with ${messageMeta.author.username}`;

  const contextMessages = history
    .filter((message) => message.channelId === messageMeta.channelId)
    .slice(-SUPPORT_TICKET_CONTEXT_MAX_MESSAGES);

  if (!contextMessages.some((message) => message.id === messageMeta.id)) {
    contextMessages.push(messageMeta);
  }

  const evidenceLines = input.evidence.length > 0
    ? input.evidence.map((item) => `- ${truncateText(sanitizeSupportTicketText(item), 350)}`)
    : ['- No specific evidence provided.'];

  const contextLines = contextMessages.length > 0
    ? contextMessages.map(formatSupportContextLine)
    : ['- No recent context available.'];

  const lines = [
    '**Created by Ethan**',
    `**Severity:** ${input.severity}`,
    `**Reported by:** ${messageMeta.author.username} (${messageMeta.author.id})`,
    `**Source:** ${sourceUrl || 'unavailable'}`,
    `**Channel:** ${channelLabel}`,
    '',
    '**User impact**',
    truncateText(sanitizeSupportTicketText(input.user_impact.trim() || 'Unknown.'), 550),
    '',
    '**Summary**',
    truncateText(sanitizeSupportTicketText(input.summary.trim()), 900),
    '',
    '**Evidence**',
    ...evidenceLines,
    '',
    '**Requested action**',
    truncateText(sanitizeSupportTicketText(input.requested_action.trim() || 'Investigate the issue above.'), 550),
    '',
    '**Recent context**',
    ...contextLines,
  ];

  return truncateText(lines.join('\n'), SUPPORT_TICKET_BODY_MAX_LENGTH);
}

function createSupportTicketTool(messageMeta: Message, history: Message[]) {
  return tool({
    name: 'create_support_ticket',
    description: [
      'Create a real post in the MinePal support forum for developers to investigate.',
      'Use only when the current Discord conversation clearly reports a MinePal bug, outage, account/payment problem, moderation/support problem, or another concrete issue developers should know about.',
      'Do not use for casual conversation, ordinary how-to questions, vague frustration, feature brainstorming, or cases where you still need one clarifying question.',
      'Keep the ticket factual. Do not include hidden reasoning, unsupported guesses, private chain of thought, or raw Discord mentions.',
    ].join(' '),
    parameters: SupportTicketInputSchema,
    strict: true,
    timeoutMs: 12000,
    timeoutBehavior: 'error_as_result',
    errorFunction: (_context, error) => {
      logger.error('Support ticket tool failed', {
        error,
        messageId: messageMeta.id,
        channelId: messageMeta.channelId,
      });
      return 'support_ticket_created: false\nerror: Ethan could not create the support ticket because the Discord tool failed.';
    },
    execute: async (input) => {
      const existing = supportTicketsBySourceMessageId.get(messageMeta.id);
      if (existing) {
        return [
          'support_ticket_created: false',
          'duplicate_for_source_message: true',
          `thread_id: ${existing.threadId}`,
          `url: ${existing.url}`,
          `title: ${existing.title}`,
        ].join('\n');
      }

      const supportChannel = await messageMeta.client.channels.fetch(ETHAN_SUPPORT_FORUM_CHANNEL_ID);
      if (!supportChannel || supportChannel.type !== ChannelType.GuildForum) {
        logger.error('Support forum channel is unavailable or not a forum channel', {
          supportForumChannelId: ETHAN_SUPPORT_FORUM_CHANNEL_ID,
          actualType: supportChannel?.type,
          messageId: messageMeta.id,
        });
        return [
          'support_ticket_created: false',
          `error: support forum channel ${ETHAN_SUPPORT_FORUM_CHANNEL_ID} is unavailable or is not a forum channel`,
        ].join('\n');
      }

      const title = sanitizeSupportTicketTitle(input.title);
      const content = buildSupportTicketBody(input, messageMeta, history);
      const thread = await (supportChannel as any).threads.create({
        name: title,
        autoArchiveDuration: SUPPORT_TICKET_AUTO_ARCHIVE_DURATION_MINUTES,
        message: {
          content,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        },
        reason: `Ethan support ticket from message ${messageMeta.id}`,
      });
      const starterMessage = await thread.fetchStarterMessage().catch(() => null);
      const url = starterMessage?.url ?? `https://discord.com/channels/${thread.guildId}/${thread.id}`;

      rememberSupportTicket(messageMeta.id, {
        threadId: thread.id,
        url,
        title,
      });

      logger.info('Created support ticket', {
        threadId: thread.id,
        url,
        title,
        severity: input.severity,
        supportForumChannelId: ETHAN_SUPPORT_FORUM_CHANNEL_ID,
        sourceMessageId: messageMeta.id,
        sourceChannelId: messageMeta.channelId,
      });

      return [
        'support_ticket_created: true',
        `thread_id: ${thread.id}`,
        `url: ${url}`,
        `title: ${title}`,
      ].join('\n');
    },
  });
}

function getRawModelEventData(event: RunStreamEvent): any | null {
  if (event.type !== 'raw_model_stream_event') return null;
  const data = event.data as any;
  return data?.event ?? data;
}

function isResearchActivityEvent(event: RunStreamEvent): boolean {
  if (event.type === 'agent_updated_stream_event') {
    return event.agent.name === 'Research brain';
  }

  if (event.type === 'run_item_stream_event') {
    const item = event.item as any;
    return item?.agent?.name === 'Research brain' ||
      item?.toolName === 'research_web' ||
      item?.rawItem?.name === 'research_web' ||
      event.name === 'tool_search_called';
  }

  const rawType = getRawModelEventData(event)?.type;
  return typeof rawType === 'string' && rawType.includes('web_search_call');
}

function createEthanAgent(
  systemPrompt: string,
  onResearchStream: (event: RunStreamEvent, source: ProgressSource) => void | Promise<void>,
  messageMeta: Message,
  history: Message[],
) {
  const webSearchOptions = {
    userLocation: { type: 'approximate', country: 'US' },
    searchContextSize: ETHAN_RESEARCH_SEARCH_CONTEXT_SIZE,
    externalWebAccess: ETHAN_RESEARCH_EXTERNAL_WEB_ACCESS,
    ...(ETHAN_RESEARCH_ALLOWED_DOMAINS.length > 0
      ? { filters: { allowedDomains: [...ETHAN_RESEARCH_ALLOWED_DOMAINS] } }
      : {}),
  } as const;

  const researchAgent = new Agent({
    name: 'Research brain',
    instructions: [
      'You are Ethan\'s private research specialist.',
      'Research only the narrow question passed to you.',
      'Use web search for current facts, external claims, technical uncertainty, or source-backed answers.',
      'Prefer primary or authoritative sources. Avoid unsupported forum claims unless the user specifically needs community evidence.',
      'Return concise findings for Ethan to rewrite in his Discord voice.',
      'Do not mention hidden chain of thought. Do not invent sources. If sources are weak or missing, say so in caveats.',
    ].join('\n'),
    model: ETHAN_RESEARCH_MODEL,
    modelSettings: {
      reasoning: {
        effort: ETHAN_RESEARCH_REASONING_EFFORT,
        summary: 'auto',
      },
      text: {
        verbosity: ETHAN_RESEARCH_VERBOSITY,
      },
      toolChoice: ETHAN_RESEARCH_TOOL_CHOICE,
      parallelToolCalls: ETHAN_RESEARCH_PARALLEL_TOOL_CALLS,
      maxTokens: ETHAN_RESEARCH_MAX_OUTPUT_TOKENS,
      store: true,
    },
    tools: [
      webSearchTool(webSearchOptions),
    ],
    outputType: ResearchBriefSchema,
  });

  const tools: Tool[] = [
    researchAgent.asTool({
      toolName: 'research_web',
      toolDescription: [
        'Research a current, source-backed, technical, or uncertain question before Ethan replies.',
        'Input should include the exact question, relevant Discord context, and what kind of source or freshness matters.',
      ].join(' '),
      runOptions: {
        maxTurns: ETHAN_RESEARCH_MAX_TURNS,
      },
      onStream: async ({ event }) => {
        await onResearchStream(event, 'research');
      },
      customOutputExtractor: (result) => formatResearchBrief(result.finalOutput as ResearchBrief | undefined),
    }),
  ];

  if (ETHAN_SUPPORT_TICKET_TOOL_ENABLED) {
    tools.push(createSupportTicketTool(messageMeta, history));
  }

  return new Agent({
    name: 'Ethan reply brain',
    instructions: systemPrompt,
    model: ETHAN_REPLY_MODEL,
    modelSettings: {
      reasoning: {
        effort: ETHAN_REPLY_REASONING_EFFORT,
        summary: 'auto',
      },
      text: {
        verbosity: ETHAN_REPLY_VERBOSITY,
      },
      toolChoice: 'auto',
      parallelToolCalls: false,
      store: true,
    },
    tools,
    outputType: EthanResponseSchema,
  });
}

export interface HandleSpeechDirective {
  text: string;
  generateSpeech: true;
  shouldSendTextMessage: boolean;
  textAlreadySent: boolean;
}

/**
 * Core logic to generate a response using OpenAI, considering message history.
 * @param latestMessage The latest message content from the user.
 * @param messageMeta The metadata of the latest message.
 * @param history An array of the last few messages for context.
 * @param botId The User ID of this bot.
 * @returns An object containing the response text and whether to generate speech.
 */
export async function handle(
  latestMessage: string,
  messageMeta: Message,
  history: Message[],
  botId: string
): Promise<HandleSpeechDirective | undefined> {
  const systemPrompt = await getSystemPrompt(messageMeta.author.username);
  // Narrow channel to one that supports send(); avoid version-specific typings
  const channel = messageMeta.channel as any;
  if (!channel || typeof channel.send !== 'function') {
    return undefined;
  }
  const textChannel: any = channel;

  const inputItems: AgentInputItem[] = [];

  // Map historical messages (oldest first), excluding the latest message to avoid duplication
  const filteredHistory = history.filter((msg) => msg.id !== messageMeta.id);
  inputItems.push(
    ...(await Promise.all(
      filteredHistory.map(async (msg) => {
        let effectiveContent = msg.content?.trim() || '';

        if (!effectiveContent && msg.attachments.size > 0) {
          const attachmentWithTitle = Array.from(msg.attachments.values()).find(
            (att) => (att as any).title && typeof (att as any).title === 'string' && (att as any).title.trim() !== ''
          );
          if (attachmentWithTitle) {
            effectiveContent = ((attachmentWithTitle as any).title as string).trim();
          }
        }

        if (!effectiveContent && msg.embeds && msg.embeds.length > 0) {
          const embed = msg.embeds[0];
          effectiveContent = embed.description?.trim() || embed.title?.trim() || '';
        }

        if (!effectiveContent && msg.reference && msg.reference.messageId && msg.reference.channelId) {
          try {
            const channel = await msg.client.channels.fetch(msg.reference.channelId);
            if (channel && channel.isTextBased()) {
              const referencedMessage = await channel.messages.fetch(msg.reference.messageId);
              if (referencedMessage) {
                const refMsgContent = referencedMessage.content?.trim();
                if (refMsgContent) {
                  effectiveContent = `[Replying to ${referencedMessage.author.username}: ${refMsgContent}]`;
                } else {
                  effectiveContent = `[Replying to ${referencedMessage.author.username}: (message has no text)]`;
                }
              } else {
                effectiveContent = "[Original message not found in channel]";
              }
            } else {
              effectiveContent = "[Original message's channel not found or not text-based]";
            }
          } catch (fetchError) {
            logger.error('Failed to fetch referenced message for reply context', {
              messageId: msg.reference.messageId,
              channelId: msg.reference.channelId,
              error: fetchError,
            });
            effectiveContent = "[Error loading reply context]";
          }
        }
        const reactionSummary = await buildReactionSummary(msg);
        if (reactionSummary) {
          effectiveContent = effectiveContent
            ? `${effectiveContent}\n${reactionSummary}`
            : reactionSummary;
        }

        const isAssistant = msg.author.id === botId;
        const textPart = {
          type: isAssistant ? 'output_text' : 'input_text',
          text: `[${msg.author.username}]: ${effectiveContent}`,
        } as const;

        // Include image attachments from historical user messages
        const contentParts: any[] = [textPart];
        if (!isAssistant && msg.attachments.size > 0) {
          const imageAttachments = Array.from(msg.attachments.values()).filter(
            (attachment) => attachment.contentType?.startsWith('image/')
          );
          imageAttachments.forEach((attachment) => {
            contentParts.push({
              type: 'input_image',
              image: attachment.url,
            });
          });
        }

        if (isAssistant) {
          return {
            role: 'assistant' as const,
            status: 'completed' as const,
            content: contentParts,
          };
        }

        return {
          role: 'user' as const,
          content: contentParts,
        };
      })
    ))
  );

  // Add the latest message with any images attached
  const latestReactionSummary = await buildReactionSummary(messageMeta);
  const latestText = latestReactionSummary
    ? `[${messageMeta.author.username}]: ${latestMessage || '<no message>'}\n${latestReactionSummary}`
    : `[${messageMeta.author.username}]: ${latestMessage || '<no message>'}`;
  const latestContentParts: Array<any> = [
    { type: 'input_text', text: latestText },
  ];

  if (messageMeta.attachments.size > 0) {
    const imageAttachments = Array.from(messageMeta.attachments.values()).filter(
      (attachment) => attachment.contentType?.startsWith('image/')
    );

    imageAttachments.forEach((attachment) => {
      latestContentParts.push({
        type: 'input_image',
        image: attachment.url,
      });
    });
  }

  inputItems.push({ role: 'user', content: latestContentParts });

  try {
    // Streaming: progressively update a message in Discord based on events
    let progressMessage: any | null = null;
    let progressMessagePromise: Promise<any> | null = null;
    let attemptedProgressSend = false;
    let sentAnyProgress = false;
    let hasCompleted = false;
    let nextAllowedEditAt = 0;
    const editCooldownMs = 1200;
    let currentProgressText = '';
    let researchProgressDots = MIN_RESEARCH_PROGRESS_DOTS - 1;

    const ensureProgressMessage = async (initialText: string) => {
      if (hasCompleted) return;
      if (progressMessage) return;
      if (progressMessagePromise) {
        try { await progressMessagePromise; } catch { /* ignore */ }
        return;
      }

      attemptedProgressSend = true; // set BEFORE awaiting to avoid concurrent sends
      progressMessagePromise = (async () => {
        try {
          const sent = await textChannel.send({
            content: initialText,
            allowedMentions: SAFE_ALLOWED_MENTIONS,
          });
          progressMessage = sent;
          currentProgressText = initialText;
          sentAnyProgress = true;
        } catch (e) {
          logger.error('Failed to send progress message', { error: e });
        } finally {
          progressMessagePromise = null;
        }
      })();
      try { await progressMessagePromise; } catch { /* ignore */ }
    };

    const safeEdit = async (text: string, options: { force?: boolean } = {}) => {
      if (hasCompleted) return;
      if (text === currentProgressText) return; // Skip if no visible change
      const now = Date.now();
      if (!options.force && now < nextAllowedEditAt) return;
      nextAllowedEditAt = now + editCooldownMs;
      if (!progressMessage) {
        if (progressMessagePromise) {
          try { await progressMessagePromise; } catch { /* ignore */ }
        }
        if (!progressMessage) return;
      }
      try {
        await progressMessage.edit({
          content: text,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
        currentProgressText = text;
      } catch (e) {
        logger.error('Failed to edit progress message', { error: e });
      }
    };

    const updateProgressText = async (text: string, options: { force?: boolean } = {}) => {
      await ensureProgressMessage(text);
      await safeEdit(text, options);
    };

    const updateResearchProgress = async (options: { force?: boolean } = {}) => {
      researchProgressDots = Math.min(researchProgressDots + 1, MAX_RESEARCH_PROGRESS_DOTS);
      await updateProgressText(`researching:${'.'.repeat(researchProgressDots)}`, options);
    };

    const handleProgressEvent = async (event: RunStreamEvent, source: ProgressSource = 'reply') => {
      if (hasCompleted) return;

      const isResearch = source === 'research' || isResearchActivityEvent(event);

      if (isResearch && event.type === 'agent_updated_stream_event') {
        await updateResearchProgress();
        return;
      }

      if (event.type === 'raw_model_stream_event') {
        const rawEvent = getRawModelEventData(event);
        const type = rawEvent?.type;

        if (type === 'response.error') {
          logger.error('OpenAI agent stream error event', { event: rawEvent ?? event.data });
        }

        if (isResearch) {
          await updateResearchProgress(type === 'response.reasoning_summary_text.done'
            || type === 'response.web_search_call.completed'
            ? { force: true }
            : {});
          return;
        }

        if (type === 'response.reasoning_summary_text.delta') {
          await updateProgressText('thinking...');
          return;
        }

        return;
      }

      if (isResearch && event.type === 'run_item_stream_event') {
        await updateResearchProgress({
          force: event.name === 'tool_search_output_created',
        });
      }
    };

    const ethanAgent = createEthanAgent(systemPrompt, handleProgressEvent, messageMeta, history);

    logger.debug('LLM input', {
      input: inputItems,
      replyModel: ETHAN_REPLY_MODEL,
      researchModel: ETHAN_RESEARCH_MODEL,
    });

    const stream = await run(ethanAgent, inputItems, {
      stream: true,
      maxTurns: ETHAN_REPLY_MAX_TURNS,
    });

    for await (const event of stream) {
      try {
        await handleProgressEvent(event);
      } catch (e) {
        logger.error('Error in agent stream event handler', { error: e });
      }
    }
    await stream.completed;
    if (stream.error) {
      throw stream.error;
    }

    hasCompleted = true;
    const structured = stream.finalOutput as EthanResponse | undefined;
    logger.debug('LLM output', {
      output: structured,
      lastResponseId: stream.lastResponseId,
    });

    if (!structured) {
      logger.warn('OpenAI agent response content was empty.');
      const fallback = "My brain's a bit fuzzy, what was that?";
      if (!sentAnyProgress) {
        await textChannel.send({
          content: fallback,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
      } else if (progressMessage) {
        await progressMessage.edit({
          content: fallback,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
      }
      return undefined;
    }

    let shouldSendText = Boolean(structured.should_send_text_message);
    let shouldReact = Boolean(structured.should_react);
    const wantsSpeech = Boolean(structured.generate_speech);

    // Enforce at least one action if the model returns none.
    if (!shouldSendText && !shouldReact && !wantsSpeech) {
      shouldReact = true;
    }

    if (shouldReact) {
      const reactionEmoji = structured.reaction_emoji.trim() || '👀';
      try {
        await messageMeta.react(reactionEmoji);
      } catch (e) {
        logger.error('Failed to add reaction to latest message', {
          error: e,
          reactionEmoji,
          messageId: messageMeta.id,
          channelId: messageMeta.channelId,
        });
      }
    }

    const needsTextPayload = shouldSendText || wantsSpeech;
    let finalText = '';
    if (needsTextPayload) {
      finalText = structured.say_in_discord
        // Strip a leading "[Ethan]:" prefix if the model includes it anyway.
        // Also tolerate minor spacing like "[ Ethan ] :" and remove all whitespace after the colon.
        .replace(/^\s*(?:\[\s*Ethan\s*\]\s*:|Ethan\s*:)\s*/i, '')
        .replace(/^\s*Voice message:\s*/i, '')
        .trim();
      finalText = sanitizeDiscordMentions(finalText);
      if (!finalText) {
        finalText = "My brain's a bit fuzzy, what was that?";
      }
    }

    let textAlreadySent = false;
    if (shouldSendText) {
      if (progressMessage) {
        try {
          const chunks = splitIntoDiscordMessages(finalText || '');
          if (chunks.length > 0) {
            await progressMessage.edit({
              content: chunks[0],
              allowedMentions: SAFE_ALLOWED_MENTIONS,
            });
            for (let i = 1; i < chunks.length; i++) {
              await textChannel.send({
                content: chunks[i],
                allowedMentions: SAFE_ALLOWED_MENTIONS,
              });
            }
          }
          textAlreadySent = true;
        } catch (e) {
          logger.error('Failed to set final message content', { error: e });
          try {
            const chunks = splitIntoDiscordMessages(finalText || '');
            for (const chunk of chunks) {
              await textChannel.send({
                content: chunk,
                allowedMentions: SAFE_ALLOWED_MENTIONS,
              });
            }
            textAlreadySent = true;
          } catch (sendFallbackError) {
            logger.error('Failed to send text fallback after edit failure', { error: sendFallbackError });
          }
        }
      } else {
        const chunks = splitIntoDiscordMessages(finalText || '');
        for (const chunk of chunks) {
          await textChannel.send({
            content: chunk,
            allowedMentions: SAFE_ALLOWED_MENTIONS,
          });
        }
        textAlreadySent = true;
      }
    } else if (progressMessage && !wantsSpeech) {
      try {
        await progressMessage.delete();
      } catch (e) {
        logger.error('Failed to delete progress message after non-text response', { error: e });
      }
    }

    if (wantsSpeech) {
      if (progressMessage && !textAlreadySent) {
        try {
          await progressMessage.delete();
        } catch (e) {
          logger.error('Failed to delete progress message before voice response', { error: e });
        }
      }
      return {
        text: finalText,
        generateSpeech: true,
        shouldSendTextMessage: shouldSendText,
        textAlreadySent,
      };
    }

    return undefined;
  } catch (error) {
    logger.error('OpenAI API error', { error });
    await textChannel.send({
      content: 'Oops, my brain short circuited. Say again?',
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    }).catch((sendError: any) => {
      logger.error('Failed to send API error message', { error: sendError });
    });
    return undefined;
  }
}

/**
 * Generate speech from text using OpenAI's TTS API
 * @param text The text to convert to speech
 * @returns The path to the generated audio file and its duration, or undefined if rate limited
 */
export async function generateSpeech(text: string): Promise<{ filePath: string; duration: number } | undefined> {
  const now = Date.now();
  if (now - lastTtsTimestamp < 10000) {
    return undefined;
  }
  
  try {
    lastTtsTimestamp = now;
    const speech = await withRetry(
      () =>
        openai.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: "ballad",
          input: text,
          instructions: "Speak casually, using Gen-Z internet slang with slurred, relaxed pronunciation.",
          response_format: "opus"
        }),
      { operation: 'openai.audio.speech.create (tts)' },
    );
    
    const fileName = `voice_${now}.ogg`;
    const filePath = path.resolve(process.cwd(), 'temp_audio', fileName);
    const buffer = Buffer.from(await speech.arrayBuffer());

    // Ensure the directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, buffer);
    
    const estimatedDuration = Math.max(1, Math.min(60, Math.ceil(text.length / 100)));
    
    return { filePath, duration: estimatedDuration };
  } catch (error) {
    logger.error("OpenAI TTS API error", { error });
    throw error; // Re-throw to be caught by the caller
  }
}
