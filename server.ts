import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '2mb' }));

// Shared Gemini client with telemetry header
const getAIClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
};

// API: Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

// API: AI Cipher Detective
// Analyzes mystery or unknown encrypted/encoded messages
app.post('/api/ai/detective', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Please provide a message to analyze.' });
    }

    const ai = getAIClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini API key is not configured in the environment. Please check the Secrets panel.',
      });
    }

    const trimmed = message.trim();
    const prompt = `You are an expert cryptanalyst and detective analyzing a secret or mysterious cipher message for students.
Analyze this mysterious message carefully:
"""
${trimmed}
"""

Instructions:
1. Examine character distribution, frequency, length, symbols, spacing, and known cipher patterns (such as Caesar shifts, Atbash, ROT13, Vigenère, Substitution, Morse, Binary, Base64, Hexadecimal, Reverse text, Pig Latin, Book cipher, Rail Fence, etc.).
2. Determine the most probable cipher used.
3. Determine a realistic confidence rating (e.g. "85%", "70%", "35%").
4. Provide a clear, educational "why" explanation pointing out specific structural clues (letter frequencies, shifts, symbol patterns, endings).
5. Provide the "suggestedDecode" (the decoded plaintext). If the evidence is weak, incomplete, or it looks like random gibberish/unbreakable one-time pad, set needsMoreInfo to true and do NOT invent or hallucinate a false decode.
6. Provide up to 2 alternative interpretations or plausible other ciphers in "otherPossibilities".

Return strictly structured JSON.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            possibleCipher: {
              type: Type.STRING,
              description: 'The primary identified cipher or encoding method, e.g. "Caesar Cipher (Shift 3)" or "Atbash Cipher"',
            },
            confidence: {
              type: Type.STRING,
              description: 'Confidence percentage string, e.g. "88%" or "45%"',
            },
            why: {
              type: Type.STRING,
              description: 'Clear, concise explanation of the clues, letter patterns, and reasons for this deduction.',
            },
            suggestedDecode: {
              type: Type.STRING,
              description: 'The most probable decoded message. If undecodable, state what was determined.',
            },
            otherPossibilities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Up to 2 alternative possible ciphers or interpretations.',
            },
            needsMoreInfo: {
              type: Type.BOOLEAN,
              description: 'True if evidence is weak or more ciphertext is needed before a confident decode can be made.',
            },
          },
          required: ['possibleCipher', 'confidence', 'why', 'suggestedDecode', 'otherPossibilities', 'needsMoreInfo'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const parsed = JSON.parse(jsonText);
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/ai/detective:', error);
    return res.status(500).json({
      error: 'AI Detective analysis encountered an issue: ' + (error?.message || 'Unknown error'),
    });
  }
});

// API: AI Explain This Decode
// Explains the cipher and transformation for students in simple, friendly terms
app.post('/api/ai/explain', async (req, res) => {
  try {
    const { cipher, originalMessage, decodedMessage, shift } = req.body;
    if (!cipher || !originalMessage) {
      return res.status(400).json({ error: 'Missing cipher or message details.' });
    }

    const ai = getAIClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini API key is not configured in the environment. Please check the Secrets panel.',
      });
    }

    const prompt = `You are a friendly cryptography teacher explaining a decoded secret message to a student.
Cipher Used: ${cipher} ${shift ? `(Shift ${shift})` : ''}
Original Ciphertext: "${originalMessage}"
Decoded Plaintext: "${decodedMessage}"

Please provide a beginner-friendly, educational explanation:
1. What cipher was used and its general concept.
2. How the mechanics work (rules, formula, or substitution pattern).
3. Exactly what happened to this specific message (walk through 1 or 2 letters from the original).
4. A mini example showing 1 short word decoded.
5. A fun historical or real-world fact about this cipher (e.g. Julius Caesar, telegraphs, spies, computer history).

Return strictly structured JSON.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cipherName: { type: Type.STRING },
            summary: { type: Type.STRING, description: 'One-sentence summary of how this message was cracked' },
            howItWorks: { type: Type.STRING, description: 'Clear simple explanation of the cipher rules' },
            transformation: { type: Type.STRING, description: 'Step-by-step transformation applied to this message' },
            miniExample: { type: Type.STRING, description: 'Bite-sized example, e.g. "A -> D"' },
            historicalFact: { type: Type.STRING, description: 'Engaging real-world or historical trivia' },
          },
          required: ['cipherName', 'summary', 'howItWorks', 'transformation', 'miniExample', 'historicalFact'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const parsed = JSON.parse(jsonText);
    return res.json(parsed);
  } catch (error: any) {
    console.error('Error in /api/ai/explain:', error);
    return res.status(500).json({
      error: 'AI Explanation encountered an issue: ' + (error?.message || 'Unknown error'),
    });
  }
});

// Setup dev server with Vite middlewares or static files for production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Mystery Message Decoder server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
