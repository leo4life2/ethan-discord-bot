import { openai } from './openaiClient.js';
import type { KnowledgeEntry } from './knowledgeStore.js';

export async function extractLearnedFacts(
  messagesBlock: string,
  existingKnowledge: KnowledgeEntry[],
): Promise<string[]> {
  const prompt = `You maintain a short bullet list of facts that help a support bot answer questions accurately.
Existing knowledge (newest first):
${existingKnowledge.map((entry) => `- ${entry.text}`).join('\n')}

Recent conversation transcript:
${messagesBlock}

Instructions:
- Identify only new facts or procedures that are not already covered in the existing knowledge.
- Facts must be accurate statements from the transcript, phrased in one concise sentence.
- Ignore small talk or policy reminders.
- Return a JSON array of strings. Return [] if there is nothing new.
`;

  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: 'You respond with valid JSON only.' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
    metadata: { purpose: 'learn-extraction' },
  });

  const raw = response.output_text;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter((item) => item.length > 0);
    }
    if (Array.isArray(parsed.items)) {
      return parsed.items
        .map((item: unknown) => String(item ?? '').trim())
        .filter((candidate: string) => candidate.length > 0);
    }
  } catch (err) {
    console.error('Failed to parse learn extraction response:', err, raw);
  }
  return [];
}


