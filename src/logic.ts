import type { Message } from "discord.js";
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadPrompt } from './promptStore.js';
import { loadKnowledge } from './knowledgeStore.js';
import { openai } from './openaiClient.js';
import { logger } from './logger.js';
import { SAFE_ALLOWED_MENTIONS } from './utils/allowedMentions.js';
import { sanitizeDiscordMentions } from './utils/sanitize.js';
import { withRetry } from './utils/retry.js';

let lastTtsTimestamp = 0;
const MAX_REACTIONS_PER_MESSAGE = 5;
const MAX_REACTION_USERS_PER_EMOJI = 6;

const ETHAN_RESPONSE_TEXT_FORMAT: any = {
  type: 'json_schema',
  name: 'ethan_reply_format',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      should_send_text_message: {
        type: 'boolean',
        description: 'Whether Ethan should send a text message to the channel.',
      },
      should_react: {
        type: 'boolean',
        description: 'Whether Ethan should react to the latest message.',
      },
      generate_speech: {
        type: 'boolean',
        description: 'Whether Ethan should generate and send a voice message.',
      },
      say_in_discord: {
        type: 'string',
        description: 'Text content for message and/or speech. If not sending text or speech, return an empty string. DO NOT include the `[Ethan]:` prefix.',
      },
      reaction_emoji: {
        type: 'string',
        description: 'Unicode emoji to react with on the latest message. If not reacting, return an empty string.',
      },
    },
    required: ['should_send_text_message', 'should_react', 'generate_speech', 'say_in_discord', 'reaction_emoji'],
  },
};

const SYSTEM_PROMPT_APPENDIX = [
  '[System Prompt Appendix]',
  'Decide whether the latest message is actually directed at Ethan.',
  'You can choose any combination of actions: text message, reaction, and voice.',
  'At least one action must be true: should_send_text_message, should_react, or generate_speech.',
  'Always include all schema fields.',
  'If should_send_text_message is true or generate_speech is true, provide say_in_discord; otherwise set say_in_discord to an empty string.',
  'If should_react is true, provide reaction_emoji; otherwise set reaction_emoji to an empty string.',
  'Prefer simple unicode emoji reactions like 👀, 😂, 😭, 🤝, 🔥, 🙏.',
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

// Using Responses API; message parts will be constructed inline as needed

/** Interface for the structured output from OpenAI */
interface EthanResponse {
  should_send_text_message?: boolean;
  should_react?: boolean;
  generate_speech?: boolean;
  say_in_discord?: string;
  reaction_emoji?: string;
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

  // Build Responses API input array
  const inputItems: Array<{
    role: string;
    content: Array<any>;
  }> = [];

  // Developer/system instructions as developer role
  inputItems.push({
    role: "developer",
    content: [
      {
        type: "input_text",
        text: systemPrompt,
      },
    ],
  });

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

        const role = msg.author.id === botId ? 'assistant' : 'user';
        const partType = role === 'assistant' ? 'output_text' : 'input_text';

        const contentParts: any[] = [
          {
            type: partType,
            text: `[${msg.author.username}]: ${effectiveContent}`,
          },
        ];

        // Include image attachments from historical user messages
        if (role === 'user' && msg.attachments.size > 0) {
          const imageAttachments = Array.from(msg.attachments.values()).filter(
            (attachment) => attachment.contentType?.startsWith('image/')
          );
          imageAttachments.forEach((attachment) => {
            contentParts.push({
              type: 'input_image',
              image_url: attachment.url,
            });
          });
        }

        return {
          role,
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
        image_url: attachment.url,
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

    const safeEdit = async (text: string) => {
      if (hasCompleted) return;
      if (text === currentProgressText) return; // Skip if no visible change
      const now = Date.now();
      if (now < nextAllowedEditAt) return;
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

    // DEBUG: Log full input to LLM
    logger.debug('LLM input', { input: inputItems });

    const stream = await withRetry(
      () =>
        Promise.resolve(
          openai.responses.stream({
            model: 'gpt-5.1',
            input: inputItems as any,
            text: {
              format: ETHAN_RESPONSE_TEXT_FORMAT,
              verbosity: 'medium',
            },
            reasoning: {
              effort: 'low',
              summary: 'auto',
            },
            tools: [
              {
                type: 'web_search',
                user_location: { type: 'approximate', country: 'US' },
                search_context_size: 'low',
              } as any,
            ],
            store: true,
          }),
        ),
      { operation: 'openai.responses.stream (discord reply)' },
    );

    return await new Promise((resolve) => {
      stream.on('event', async (event: any) => {
        try {
          const type = event?.type;
          // Ignore any late events after completion
          if (hasCompleted) return;
          if (type === 'response.web_search_call.in_progress') {
            await ensureProgressMessage('searching the web...');
            await safeEdit('searching the web...');
            return;
          }
          if (type === 'response.reasoning_summary_text.delta') {
            await ensureProgressMessage('thinking...');
            await safeEdit('thinking...');
            return;
          }
          if (type === 'response.completed') {
            const finalResponse = event?.response ?? event;
            hasCompleted = true;

            // DEBUG: Log full output from LLM
            logger.debug('LLM output', { output: finalResponse });
            let rawText: string | undefined = typeof finalResponse?.output_text === 'string' ? finalResponse.output_text : undefined;
            let structured: EthanResponse | null = null;
            const urlCitations: Array<{ title: string; url: string; start: number; end: number }> = [];

            // Inspect outputs for JSON parsed content or text
            const outputs: any[] = Array.isArray(finalResponse?.output) ? finalResponse.output : [];
            for (const outputItem of outputs) {
              const parts: any[] = Array.isArray(outputItem?.content) ? outputItem.content : [];
              for (const part of parts) {
                const partType = part?.type;
                if (partType === 'output_text' && typeof part?.text === 'string') {
                  // Collect URL citations from annotations and replace in-place
                  const anns: any[] = Array.isArray(part?.annotations) ? part.annotations : [];
                  const urlAnns = anns.filter((a) => a?.type === 'url_citation' && typeof a?.url === 'string');
                  urlAnns.forEach((ann) => {
                    urlCitations.push({
                      title: ann.title,
                      url: ann.url,
                      start: ann.start_index,
                      end: ann.end_index,
                    });
                  });

                  let replaced = part.text as string;
                  // Do not inline replace by indices (could shift positions across parts). Instead, save to urlCitations and handle cite tokens after.

                  rawText = (rawText || '') + replaced;
                } else if ((partType === 'json' || partType === 'tool_result' || partType === 'output_json_schema') && part?.parsed) {
                  try {
                    structured = part.parsed as EthanResponse;
                  } catch {
                    // ignore
                  }
                } else if (partType === 'refusal' && typeof part?.refusal === 'string') {
                  rawText = (rawText || '') + part.refusal;
                }
              }
            }

            if (!structured && rawText && typeof rawText === 'string') {
              try {
                structured = JSON.parse(rawText);
              } catch {
                // not JSON, proceed with raw text
              }
            }

            if (!structured && (!rawText || typeof rawText !== 'string' || rawText.trim() === '')) {
              logger.warn('OpenAI response content was empty.');
              const fallback = "My brain's a bit fuzzy, what was that?";
              if (!sentAnyProgress) {
                await textChannel.send({
                  content: fallback,
                  allowedMentions: SAFE_ALLOWED_MENTIONS,
                });
              } else if (progressMessage) {
                await safeEdit(fallback);
              }
              resolve(undefined);
              return;
            }

            let shouldSendText = Boolean(structured?.should_send_text_message);
            let shouldReact = Boolean(structured?.should_react);
            const wantsSpeech = Boolean(structured?.generate_speech);

            // Enforce at least one action if the model returns none.
            if (!shouldSendText && !shouldReact && !wantsSpeech) {
              shouldReact = true;
            }

            if (shouldReact) {
              const reactionEmoji = typeof structured?.reaction_emoji === 'string' && structured.reaction_emoji.trim()
                ? structured.reaction_emoji.trim()
                : '👀';
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
              finalText = (structured?.say_in_discord ?? rawText ?? '')
                // Strip a leading "[Ethan]:" prefix if the model includes it anyway.
                // Also tolerate minor spacing like "[ Ethan ] :" and remove all whitespace after the colon.
                .replace(/^\s*(?:\[\s*Ethan\s*\]\s*:|Ethan\s*:)\s*/i, '')
                .replace(/^\s*Voice message:\s*/i, '')
                .trim();
              finalText = sanitizeDiscordMentions(finalText);
              if (!finalText) {
                finalText = "My brain's a bit fuzzy, what was that?";
              }

              // Replace any cite tokens like "citeturn0forecast0" with URL(s)
              // Match ligature-like private-use tokens we observed: "cite..."
              const citeTokenRegex = /cite[^]+/g;
              if (citeTokenRegex.test(finalText)) {
                const uniqueUrls = Array.from(new Set(urlCitations.map(c => c.url)));
                const replacement = uniqueUrls.length > 0
                  ? (uniqueUrls.length === 1 ? ` (${uniqueUrls[0]})` : ` (${uniqueUrls.join(', ')})`)
                  : '';
                finalText = finalText.replace(citeTokenRegex, replacement);
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
              resolve({
                text: finalText,
                generateSpeech: true,
                shouldSendTextMessage: shouldSendText,
                textAlreadySent,
              });
              return;
            }

            resolve(undefined);
            return;
          }
          if (type === 'response.error') {
            logger.error('OpenAI API stream error event', { event });
            if (!sentAnyProgress) {
              await textChannel.send({
                content: 'Oops, my brain short circuited. Say again?',
                allowedMentions: SAFE_ALLOWED_MENTIONS,
              });
            } else if (progressMessage) {
              try {
                await progressMessage.edit({
                  content: 'Oops, my brain short circuited. Say again?',
                  allowedMentions: SAFE_ALLOWED_MENTIONS,
                });
              } catch (e) {
                logger.error('Failed to set error content on progress message', { error: e });
              }
            }
            resolve(undefined);
            return;
          }
        } catch (e) {
          logger.error('Error in stream event handler', { error: e });
          resolve(undefined);
        }
      });
    });
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
