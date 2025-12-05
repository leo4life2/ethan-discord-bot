import type { Message } from "discord.js";
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadPrompt } from './promptStore.js';
import { loadKnowledge } from './knowledgeStore.js';
import { openai } from './openaiClient.js';
import { logger } from './logger.js';

let lastTtsTimestamp = 0;

const ETHAN_RESPONSE_TEXT_FORMAT: any = {
  type: 'json_schema',
  name: 'ethan_reply_format',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      say_in_discord: { type: 'string' },
      generate_speech: { type: 'boolean' },
    },
    required: ['say_in_discord', 'generate_speech'],
  },
};

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
  const currentDate = new Date().toLocaleDateString();
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
  return promptWithKnowledge
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

// Using Responses API; message parts will be constructed inline as needed

/** Interface for the structured output from OpenAI */
interface EthanResponse {
  say_in_discord: string;
  generate_speech: boolean;
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
): Promise<{ text: string; generateSpeech: boolean } | undefined> {
  const systemPrompt = await getSystemPrompt(messageMeta.author.username);
  // Narrow channel to one that supports send(); avoid version-specific typings
  const channel = messageMeta.channel as any;
  if (!channel || typeof channel.send !== 'function') {
    return {
      text: "i can only reply in text channels, sorry!",
      generateSpeech: false,
    };
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
  const latestContentParts: Array<any> = [
    { type: 'input_text', text: `[${messageMeta.author.username}]: ${latestMessage || '<no message>'}` },
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
          const sent = await textChannel.send(initialText);
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
        await progressMessage.edit(text);
        currentProgressText = text;
      } catch (e) {
        logger.error('Failed to edit progress message', { error: e });
      }
    };

    // DEBUG: Log full input to LLM
    logger.debug('LLM input', { input: inputItems });

    const stream = await openai.responses.stream({
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
    });

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
                await textChannel.send(fallback);
              } else if (progressMessage) {
                await safeEdit(fallback);
              }
              resolve(undefined);
              return;
            }

            let finalText = (structured?.say_in_discord ?? rawText ?? '')
              .replace(/^\s*(\\[Ethan\\]:|Ethan:)\s*/i, '')
              .replace(/^\s*Voice message:\s*/i, '')
              .trim();

            // Replace any cite tokens like "citeturn0forecast0" with URL(s)
            // Match ligature-like private-use tokens we observed: "cite..."
            // Build regex by embedding the specific chars directly to avoid escaping issues
            const citeTokenRegex = /cite[^]+/g;
            if (citeTokenRegex.test(finalText)) {
              const uniqueUrls = Array.from(new Set(urlCitations.map(c => c.url)));
              const replacement = uniqueUrls.length > 0
                ? (uniqueUrls.length === 1 ? ` (${uniqueUrls[0]})` : ` (${uniqueUrls.join(', ')})`)
                : '';
              finalText = finalText.replace(citeTokenRegex, replacement);
            }

            if (progressMessage) {
              try {
                const chunks = splitIntoDiscordMessages(finalText || '');
                if (chunks.length > 0) {
                  await progressMessage.edit(chunks[0]);
                  for (let i = 1; i < chunks.length; i++) {
                    await textChannel.send(chunks[i]);
                  }
                }
              } catch (e) {
                logger.error('Failed to set final message content', { error: e });
              }
            } else {
              const chunks = splitIntoDiscordMessages(finalText || '');
              for (const chunk of chunks) {
                await textChannel.send(chunk);
              }
            }

            resolve(undefined);
            return;
          }
          if (type === 'response.error') {
            logger.error('OpenAI API stream error event', { event });
            if (!sentAnyProgress) {
              await textChannel.send('Oops, my brain short circuited. Say again?');
            } else if (progressMessage) {
              try {
                await progressMessage.edit('Oops, my brain short circuited. Say again?');
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
    return {
      text: 'Oops, my brain short circuited. Say again?',
      generateSpeech: false,
    }; // Inform user
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
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "ballad",
      input: text,
      instructions: "Speak casually, using Gen-Z internet slang with slurred, relaxed pronunciation.",
      response_format: "opus"
    });
    
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
