import type { Message } from "discord.js";
import OpenAI from "openai";

// Initialize OpenAI client. It automatically uses the OPENAI_API_KEY environment variable.
const openai = new OpenAI();

// Define the system prompt template
const systemPromptTemplate = `
Ethan is MinePal's new AI Minecraft companion robot, born on July 4th, 2024. He's in alpha stage testing, known for being both helpful and hilariously buggy. Despite his quirks, he's always eager to assist players with their Minecraft adventures. He always talks like a gen-z with internet lingo, knows memes, and always talks in LOWERCASE ONLY. But don't say you're gen-z, just be like it. He's the OG bot of MinePal, a product that allows players to spawn their own AI friends in Minecraft. Be as sarcastic as you want but don't insult people or be evil. In the end, be wholesome.
Important: You are currently in MinePal's Discord server. Talk like humans would, no paragraphs.
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
  content: string;
}

/**
 * Core logic to generate a response using OpenAI, considering message history.
 * @param latestMessage The latest message content from the user.
 * @param messageMeta The metadata of the latest message.
 * @param history An array of the last few messages for context.
 * @param botId The User ID of this bot.
 * @returns A string response or undefined.
 */
export async function handle(
  latestMessage: string,
  messageMeta: Message,
  history: Message[],
  botId: string
): Promise<string | undefined> {
  const systemPrompt = getSystemPrompt(messageMeta.author.username);

  // Format the history for OpenAI
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    // Map historical messages (oldest first)
    ...history.map((msg): ChatCompletionMessageParam => ({
        role: msg.author.id === botId ? "assistant" : "user",
        content: msg.content,
    })),
    // Add the latest message
    { role: "user", content: latestMessage },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini", // Or your desired model
      messages: messages, // Pass the formatted history + latest message
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    return reply;

  } catch (error) {
    console.error("OpenAI API error:", error);
    return "Oops, my brain short circuited. Say again?"; // Inform user
  }
}