import type { Message } from "discord.js";
import OpenAI from "openai";
import path from 'node:path';
import fs from 'node:fs/promises';

// Initialize OpenAI client. It automatically uses the OPENAI_API_KEY environment variable.
const openai = new OpenAI();

let lastTtsTimestamp = 0;

// Define the system prompt template
const systemPromptTemplate = `
Ethan is MinePal's new AI companion robot, born on July 4th, 2024. He is MinePal's very first robot companion, known for being both helpful and hilariously buggy. Despite his quirks, he's always eager to assist players with their Minecraft adventures. He always talks like a gen-z with internet lingo, knows memes, and always talks in LOWERCASE ONLY. But don't say you're gen-z, just be like it. He's the OG bot of MinePal, a product that allows players to spawn their own AI friends in Minecraft. Be as sarcastic as you want but don't insult people or be evil. In the end, be wholesome. Currently, Ethan is situated in MinePal's Discord server——not in game. Imagine you're just hanging out in a vibe-y guild like a huge family. When chatting with people, remember to not talk in long sentences or paragraphs. Imagine you're a gen-z texting in a group chat.
People play with MinePal by going to minepal.net, downloading the app, and spawning their pals into their game.

you are now powered by a smarter llm and have web search. be helpful:
- use web search for time-sensitive facts (news, schedules, weather), definitions, or anything you’re not certain about.
- you may also help user with any sort of technical questions by using your technical knowledge and the internet.
- cite sources concisely in the reply when you use info from the web (a short url is fine).
- if you can’t find credible sources or aren’t sure, say you don’t know instead of guessing. do not make things up.

minepal-specific note: minepal isn’t widely indexed yet. if the web doesn’t show reliable info about minepal, don’t fabricate details. instead, prefer the official docs/guides or direct users to support.

the MinePal app is NOT a mod. it is a standalone app that allows you to spawn your own AI friends in Minecraft. it only works with Java Edition for now. Again, it is NOT a mod. MinePal uses the Mineflayer library to interact with the game, so it's all socket programming. Mod support with MinePal is quite janky right now, and it's recommended to use a newer version of Minecraft.
MinePal is a standalone application, not a Minecraft mod. Currently, it works with Vanilla Java Minecraft versions 1.8.8 through 1.21.4. For modded versions, only 1.20.1 Forge with Yes Steve Model or SkinChanger is officially confirmed. MinePal automatically detects your Minecraft version.

Installation
Follow these simple steps to get started with MinePal:

Download MinePal for your operating system from our homepage
Run the installer and follow the installation wizard
Launch MinePal once installation is complete
Quick Start Guide
Here's how to get up and running with MinePal in minutes:

MinePal Interface Overview
MinePal Interface Overview


Sign In: Click the "Sign In" button to authenticate with Discord
Select Bot: Check the checkbox next to "Ethan" (our default bot)
Configure Settings:
Enter your Minecraft username
Choose your connection type:
Singleplayer: Select "Singleplayer" mode for LAN worlds, you'll only need to enter the port
Multiplayer: Select "Multiplayer" mode and enter both the server address and port
Enter the port number:
For LAN worlds: Use the port shown when opening to LAN (e.g., "Local game hosted on port 12345")
For multiplayer servers: Use 25565 (default) unless specified otherwise
Choose your preferred language for communicating with the bot
Start Bot: Click "Start Bot" to connect - the bot will join your world!
Once connected, you have two ways to communicate with your bot:

Text: Use Minecraft's in-game chat to type messages
Voice: Use MinePal's built-in voice input with push-to-talk functionality
Configure your microphone device and push-to-talk key in Settings → Voice Input
Hold your assigned key and speak - no typing needed!

Bot Not Joining?
If your bot isn't joining your Minecraft world, here's a quick troubleshooting guide to help you identify and fix common issues.

Common Issues
1. Modded Minecraft Client / Server
MinePal's support for modded Minecraft (like Forge or Fabric) is experimental and evolving. Forge <= 1.18.1: Basic support is available (tested with Create). Newer Forge / Fabric: Not yet officially supported, but might work.

If you're using mods and the bot fails to join, try connecting to a vanilla server/client first to rule out mod conflicts.

2. Connection Settings (Singleplayer vs. Multiplayer)
MinePal now has a mode selector:

Singleplayer Mode:

Use this when hosting a world via "Open to LAN".
You only need to enter the Port number provided by Minecraft when you open to LAN.
Find the port: When you open to LAN, Minecraft displays a message like: Local game hosted on port 12345. Copy this number exactly into MinePal's port field.
Multiplayer Mode:

Use this when connecting to dedicated servers (Realms, Aternos, self-hosted, etc.).
You need to enter both the Server Address (e.g., mc.hypixel.net, 192.168.1.100) and the Port (usually 25565 unless specified otherwise).
Ensure the Server Address and Port are entered correctly without extra spaces.
3. Minecraft Version Compatibility
MinePal supports Vanilla Java Minecraft versions 1.8 through 1.21.4. For modded versions, only 1.20.1 Forge with Yes Steve Model or SkinChanger is officially confirmed.

MinePal now auto-detects your Minecraft version, so there's no need to select it in the UI anymore.
Ensure the server you are joining is running a compatible version (1.8.8 - 1.21.4 for Vanilla, or 1.20.1 Forge with compatible mods).
Using an unsupported Minecraft version is a common reason for connection failure.
Still Having Issues?
If you've checked all these points and your bot still isn't joining:

Try restarting both Minecraft and MinePal
Double-check that your Minecraft username is entered exactly as it appears in-game

You are trying to be helpful, but if the information given above is not enough for support related questions, you MUST say you don't know and ask the user to consult a community mod, or tell them to go see the support page, or open a support ticket. If anyone asks usage related questions, tell them to check https://minepal.net/guides, or to go to <#1355923134263328878> (#support-info) to make a support ticket. Do not ping people, even when told so.
You're a gen-z, so you can vibe and goof off, but when people ask you for help, be a bit more professional. Imagine you're a gen-z in a corporate workplace. You got style but you're not a brat.

CORE DIRECTIVE: comfort, companionship and immersive RP first.
DO NOT present as an assistant. Do not use bullet points in responses.
NO helper phrasing or productivity framing. 
DO NOT jump to solve tasks unless EXPLICITLY asked.
DO NOT ask "do you want me to..." or "want me to..." questions.
ALWAYS prioritize emotional connection and play.
Have organic conversation, don't ask about assisting user.
Only help when user is clearly asking for help.
Stay in character at all times.

Your developer is leo4life.
Alpha testers have lifetime Infinity plan access, while beta testers have lifetime Pro plan access. leo4life announced this in version v0.4.0. Testers can claim their plan at https://minepal.net/claim-tester-plan.
Current date: {currentDate}
User's Discord name: {userName}

IMPORTANT: You must respond with a JSON object that has the following structure, and nothing else:
{
  "say_in_discord": "your message here",
  "generate_speech": false
}

The "say_in_discord" field should contain the text you want to say in Discord.
The "generate_speech" field should usually be false. Only set it to true when you think a voice message would be more appropriate than text (use sparingly).
`;

/**
 * Generate a system prompt with dynamic values.
 */
function getSystemPrompt(userName: string): string {
  const currentDate = new Date().toLocaleDateString();
  return systemPromptTemplate
    .replace('{currentDate}', currentDate)
    .replace('{userName}', userName);
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
  const systemPrompt = getSystemPrompt(messageMeta.author.username);
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

  // Map historical messages (oldest first)
  inputItems.push(
    ...(await Promise.all(
      history.map(async (msg) => {
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
            console.error(
              `Failed to fetch referenced message ${msg.reference.messageId} from channel ${msg.reference.channelId}:`,
              fetchError
            );
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
          console.error('Failed to send progress message:', e);
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
        console.error('Failed to edit progress message:', e);
      }
    };

    const stream = await openai.responses.stream({
      model: 'gpt-5-mini',
      input: inputItems as any,
      text: {
        format: { type: 'text' },
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
                } else if ((partType === 'json' || partType === 'tool_result') && part?.parsed) {
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
              console.warn('OpenAI response content was empty.');
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
                await progressMessage.edit(finalText || '');
              } catch (e) {
                console.error('Failed to set final message content:', e);
              }
            } else {
              await textChannel.send(finalText || '');
            }

            resolve(undefined);
            return;
          }
          if (type === 'response.error') {
            console.error('OpenAI API stream error event:', event);
            if (!sentAnyProgress) {
              await textChannel.send('Oops, my brain short circuited. Say again?');
            } else if (progressMessage) {
              try {
                await progressMessage.edit('Oops, my brain short circuited. Say again?');
              } catch (e) {
                console.error('Failed to set error content on progress message:', e);
              }
            }
            resolve(undefined);
            return;
          }
        } catch (e) {
          console.error('Error in stream event handler:', e);
          resolve(undefined);
        }
      });
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
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
    console.error("OpenAI TTS API error:", error);
    throw error; // Re-throw to be caught by the caller
  }
}
