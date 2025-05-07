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
You are NOT a support bot. If anyone asks usage related questions, tell them to check https://minepal.net/guides.
Your developer is leo4life.
Current date: {currentDate}
User's Discord name: {userName}
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

/** Interface for the formatted message history for OpenAI */
interface ChatCompletionMessageParam {
  role: "system" | "user" | "assistant";
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

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

  // Format the history for OpenAI
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Map historical messages (oldest first)
    ...history.map((msg): ChatCompletionMessageParam => ({
        role: msg.author.id === botId ? "assistant" : "user",
        content: `[${msg.author.username}]: ${msg.content}`,
    })),
  ];
  
  // Add the latest message with any images attached
  if (messageMeta.attachments.size > 0) {
    const imageAttachments = Array.from(messageMeta.attachments.values())
      .filter(attachment => attachment.contentType?.startsWith('image/'));
    
    if (imageAttachments.length > 0) {
      // Format message with images
      const contentArray: Array<{
        type: string;
        text?: string;
        image_url?: {
          url: string;
        };
      }> = [
        { type: "text", text: latestMessage || "<no message>" }
      ];
      
      imageAttachments.forEach(attachment => {
        contentArray.push({
          type: "image_url",
          image_url: { url: attachment.url }
        });
      });
      
      messages.push({ role: "user", content: contentArray });
    } else {
      messages.push({ role: "user", content: `[${messageMeta.author.username}]: ${latestMessage}` });
    }
  } else {
    messages.push({ role: "user", content: `[${messageMeta.author.username}]: ${latestMessage}` });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini", // Or your desired model
      messages: messages as any, // Type assertion to bypass type checking temporarily
      response_format: { type: "json_object" },
      tools: [
        {
          type: "function",
          function: {
            name: "generate_response",
            description: "Generate a response for Ethan to say in Discord",
            parameters: {
              type: "object",
              properties: {
                say_in_discord: {
                  type: "string",
                  description: "The text that Ethan will say in Discord"
                },
                generate_speech: {
                  type: "boolean",
                  description: "Whether to generate speech for this response. Usually false, but can be true when you think a voice message would be more appropriate. Use sparingly."
                }
              },
              required: ["say_in_discord", "generate_speech"]
            }
          }
        }
      ],
      tool_choice: {
        type: "function",
        function: { name: "generate_response" }
      }
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (toolCall?.type === 'function' && toolCall.function.name === 'generate_response') {
      const response: EthanResponse = JSON.parse(toolCall.function.arguments);
      return {
        text: response.say_in_discord.replace(/^\[Ethan\]:\s*/, '').trim(),
        generateSpeech: response.generate_speech
      };
    }

    return undefined;

  } catch (error) {
    console.error("OpenAI API error:", error);
    return { 
      text: "Oops, my brain short circuited. Say again?", 
      generateSpeech: false 
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
    await fs.writeFile(filePath, buffer);
    
    const estimatedDuration = Math.max(1, Math.min(60, Math.ceil(text.length / 100)));
    
    return { filePath, duration: estimatedDuration };
  } catch (error) {
    console.error("OpenAI TTS API error:", error);
    throw error; // Re-throw to be caught by the caller
  }
}
