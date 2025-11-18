import { openai } from './openaiClient.js';
import type { KnowledgeEntry } from './knowledgeStore.js';

const TEXT_FORMAT: any = {
  type: 'json_schema',
  name: 'learn_facts_format',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      facts: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        description: 'Unique, concise factual statements to add to the knowledge base.',
        items: {
          type: 'string',
        },
      },
    },
    required: ['facts'],
  },
};

export async function extractLearnedFacts(
  messagesBlock: string,
  existingKnowledge: KnowledgeEntry[],
  focus?: string,
): Promise<string[]> {
  const prompt = `You maintain a short bullet list of facts that help a support bot answer questions accurately.
Existing knowledge (newest first):
${existingKnowledge.map((entry) => `- ${entry.text}`).join('\n')}

Recent conversation transcript:
${messagesBlock}

Instructions:
- Identify only new facts or procedures that are not already covered in the existing knowledge.
- Facts must be accurate statements from the transcript, phrased in ONE sentence each.
- Ignore small talk, opinions, or temporary offers.
- If nothing new is present, return an empty array.
- Focus/topic hint from staff: ${focus ?? 'none provided, use your best judgment.'}
`;

  const response = await openai.responses.create({
    model: 'gpt-5.1',
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: 'Respond using the provided JSON schema only.' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: prompt }],
      },
    ],
    reasoning: {
      effort: 'minimal',
      summary: 'auto',
    },
    text: {
      format: TEXT_FORMAT,
      verbosity: 'medium',
    },
    metadata: { purpose: 'learn-extraction' },
  });

  const facts: string[] = [];
  const outputs = Array.isArray((response as any).output) ? (response as any).output : [];

  for (const item of outputs) {
    const parts = Array.isArray(item?.content) ? item.content : [];
    for (const part of parts) {
      if (part?.refusal) {
        console.warn('Learn extraction refusal:', part.refusal);
        continue;
      }
      const parsedFacts = part?.parsed?.facts;
      if (Array.isArray(parsedFacts)) {
        parsedFacts
          .map((entry: unknown) => String(entry ?? '').trim())
          .filter((entry: string) => entry.length > 0)
          .forEach((entry: string) => facts.push(entry));
        continue;
      }

      if (part?.type === 'output_text' && typeof part?.text === 'string') {
        try {
          const text = part.text.trim();
          if (text.startsWith('{')) {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed?.facts)) {
              parsed.facts
                .map((entry: unknown) => String(entry ?? '').trim())
                .filter((entry: string) => entry.length > 0)
                .forEach((entry: string) => facts.push(entry));
            }
          }
        } catch (err) {
          console.warn('[learn] Failed to parse output_text JSON', err);
        }
      }
    }
  }

  if (facts.length === 0 && typeof (response as any).output_text === 'string') {
    try {
      const parsed = JSON.parse(((response as any).output_text as string).trim());
      if (Array.isArray(parsed?.facts)) {
        parsed.facts
          .map((entry: unknown) => String(entry ?? '').trim())
          .filter((entry: string) => entry.length > 0)
          .forEach((entry: string) => facts.push(entry));
      }
    } catch (err) {
      console.warn('[learn] Failed to parse response.output_text JSON', err);
    }
  }

  const unique = Array.from(new Set(facts));
  if (unique.length === 0) {
    try {
      console.debug('[learn] No facts parsed, raw response:', JSON.stringify(response, null, 2));
    } catch (logErr) {
      console.warn('[learn] Failed to stringify raw response', logErr);
    }
  }
  return unique;
}


