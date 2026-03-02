import { GoogleGenAI } from '@google/genai';

const KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);

if (KEYS.length === 0) throw new Error('No GEMINI_API_KEY_* found in environment');

let currentKeyIndex = 0;

function getClient() {
  return new GoogleGenAI({ apiKey: KEYS[currentKeyIndex] });
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % KEYS.length;
}

export async function generateContent(prompt, history = []) {
  let lastError;

  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    try {
      const client = getClient();
      const contents = [
        ...history,
        { role: 'user', parts: [{ text: prompt }] },
      ];

      const response = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents,
      });

      return response.text;
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      // Rotate on rate limit or quota errors
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
        rotateKey();
      } else {
        throw err;
      }
    }
  }

  throw lastError;
}
