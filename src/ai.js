/**
 * Sonic Lab Messenger Bot - AI Response Generator (Google Gemini)
 * توليد الردود الذكية باستخدام Google Gemini AI (مجاني!)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { SYSTEM_PROMPT, RESPONSES } = require('./prompts');

let genAI = null;
let model = null;

/**
 * Initialize Gemini AI
 */
function initAI(apiKey) {
  if (!apiKey) {
    console.error('[AI] No Gemini API key provided!');
    return false;
  }

  try {
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 300
      }
    });
    console.log('[AI] Gemini initialized successfully');
    return true;
  } catch (error) {
    console.error('[AI INIT ERROR]', error.message);
    return false;
  }
}

/**
 * Generate AI response for unknown intents
 * Uses Jordanian Arabic dialect
 */
async function generateResponse(userMessage, conversationContext) {
  if (!model) {
    console.error('[AI] Model not initialized');
    return RESPONSES.fallback[0];
  }

  try {
    const prompt = SYSTEM_PROMPT
      .replace('{conversation_context}', conversationContext || 'محادثة جديدة')
      .replace('{user_message}', userMessage);

    const result = await model.generateContent(prompt);
    const response = result.response.text();

    // Clean up the response
    let cleaned = response
      .replace(/^["']|["']$/g, '') // Remove quotes
      .replace(/^(Bot|Assistant|سونيك):\s*/i, '') // Remove prefix
      .trim();

    // Ensure response is not too long (Messenger limit: 2000 chars)
    if (cleaned.length > 1500) {
      cleaned = cleaned.substring(0, 1500) + '...';
    }

    // Ensure minimum length
    if (cleaned.length < 10) {
      return RESPONSES.fallback[0];
    }

    console.log(`[AI RESPONSE] Len: ${cleaned.length}`);
    return cleaned;

  } catch (error) {
    console.error('[AI GENERATE ERROR]', error.message);

    // Fallback to pre-built responses on error
    if (error.message?.includes('quota')) {
      return "سامحني، صارلي شي ثواني بس بنحاول مرة ثانية! 😊 شو بتحب تسأل؟";
    }
    return RESPONSES.fallback[Math.floor(Math.random() * RESPONSES.fallback.length)];
  }
}

module.exports = { initAI, generateResponse };
