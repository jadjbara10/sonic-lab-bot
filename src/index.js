/**
 * Sonic Lab Messenger Bot - Main Server
 * الخادم الرئيسي لبوت سونيك لاب للمسنجر
 *
 * FREE 24/7 Cloud Deployment on Render.com
 * AI-Powered with Google Gemini (Free Tier)
 * Jordanian Arabic Dialect
 */

require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const { processMessage, STATES } = require('./conversation');
const { sendMessage, sendTypingIndicator, verifySignature, setPersistentMenu, setGetStarted, setGreeting, getUserProfile } = require('./messenger');
const { initAI, generateResponse } = require('./ai');

const app = express();

// Config
const PORT = process.env.PORT || 3000;
const PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const APP_SECRET = process.env.FB_APP_SECRET;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'sonic_lab_verify_2026';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://sonic-lab-bot.onrender.com';

// Middleware - raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Health check endpoint (for UptimeRobot keep-alive)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'sonic-lab-messenger-bot',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Keep-alive self-ping (every 14 minutes to prevent Render spin-down)
function startKeepAlive() {
  const interval = 14 * 60 * 1000; // 14 minutes
  setInterval(() => {
    const url = `${RENDER_URL}/health`;
    const module = url.startsWith('https') ? https : http;
    module.get(url, (res) => {
      console.log(`[KEEP-ALIVE] Ping sent, status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`[KEEP-ALIVE] Error: ${err.message}`);
    });
  }, interval);
  console.log(`[KEEP-ALIVE] Self-ping enabled every 14 min → ${RENDER_URL}/health`);
}

// Webhook verification (Facebook requires this)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[WEBHOOK VERIFY] Mode: ${mode}, Token: ${token}`);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WEBHOOK] Verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('[WEBHOOK] Verification failed');
    res.sendStatus(403);
  }
});

// Webhook message handler
app.post('/webhook', (req, res) => {
  const body = req.body;

  // Skip signature verification for now (app in development mode)
  // TODO: Enable when App Secret is properly configured
  console.log('[WEBHOOK] Signature verification skipped (development mode)');

  // Check this is a page subscription
  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  // Process each entry
  for (const entry of body.entry) {
    const pageId = entry.id;
    const timeOfEvent = entry.time;

    // Process each messaging event
    for (const event of entry.messaging || []) {
      const senderId = event.sender.id;

      // Skip if message is from the page itself
      if (senderId === pageId) continue;

      // Handle different event types
      if (event.message) {
        handleMessage(senderId, event.message);
      } else if (event.postback) {
        handlePostback(senderId, event.postback);
      }
    }
  }

  // Return 200 quickly (Facebook requires fast response)
  res.status(200).send('EVENT_RECEIVED');
});

/**
 * Handle incoming messages
 */
async function handleMessage(senderId, message) {
  try {
    // Ignore echoes and non-text messages (for now)
    if (message.is_echo || message.app_id) return;

    console.log(`[MSG RECEIVED] From: ${senderId}`);

    // Get message text
    const messageText = message.text || '';
    const quickReplyPayload = message.quick_reply?.payload || null;

    // If it's just a quick reply without text, use the payload
    const inputText = messageText || quickReplyPayload || '';

    if (!inputText) {
      // Handle attachments (images, etc.)
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "حلو! 😊 بس بقدر أتعامل مع الرسائل النصية أكتر. شو بتحب تسأل عن خدماتنا؟ 🎵"
      );
      return;
    }

    // Show typing indicator
    await sendTypingIndicator(PAGE_ACCESS_TOKEN, senderId);

    // Process the message through conversation manager
    const result = processMessage(senderId, inputText, quickReplyPayload);

    if (result.needsAI) {
      // Need AI-generated response
      const aiResponse = await generateResponse(inputText, result.context);
      await sendMessage(PAGE_ACCESS_TOKEN, senderId, aiResponse);
    } else if (result.response) {
      // Pre-built response
      await sendMessage(PAGE_ACCESS_TOKEN, senderId, result.response, result.quickReplies);
    }

  } catch (error) {
    console.error('[HANDLE MSG ERROR]', error.message);
    // Try to send fallback response
    try {
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "سامحني، صار شي غلط! 😅 جرب مرة ثانية أو راسلنا على 00962786127583"
      );
    } catch (e) {
      // Give up silently
    }
  }
}

/**
 * Handle postbacks (Get Started, Persistent Menu)
 */
async function handlePostback(senderId, postback) {
  const payload = postback.payload;
  console.log(`[POSTBACK] From: ${senderId}, Payload: ${payload}`);

  await sendTypingIndicator(PAGE_ACCESS_TOKEN, senderId);

  switch (payload) {
    case 'GET_STARTED':
      // First interaction
      const result = processMessage(senderId, '', 'GET_STARTED');
      // Override with greeting
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "هلا والله! 🎵 منورتنا في سونيك لاب! بنصنع أغاني مخصصة لكل المناسبات - فرح، عيد ميلاد، ذكرى، أو أي شي ببالك! كيف بقدر أخدمك؟",
        [
          { title: "💍 أغنية فرح", payload: "WEDDING_SONG" },
          { title: "🎂 أغنية عيد ميلاد", payload: "BIRTHDAY_SONG" },
          { title: "💕 أغنية ذكرى", payload: "ANNIVERSARY_SONG" },
          { title: "📋 الأسعار", payload: "PRICING" }
        ]
      );
      break;

    case 'START_LEAD':
    case 'ORDER_SONG':
      const leadResult = processMessage(senderId, '', 'START_LEAD');
      await sendMessage(PAGE_ACCESS_TOKEN, senderId, leadResult.response, leadResult.quickReplies);
      break;

    default:
      // Use conversation manager for other payloads
      const defaultResult = processMessage(senderId, '', payload);
      if (defaultResult.response) {
        await sendMessage(PAGE_ACCESS_TOKEN, senderId, defaultResult.response, defaultResult.quickReplies);
      }
      break;
  }
}

// ===== Start Server =====
async function start() {
  console.log('==========================================');
  console.log('🎵 Sonic Lab Messenger Bot v1.0');
  console.log('==========================================');

  // Validate required env vars
  if (!PAGE_ACCESS_TOKEN) {
    console.error('[FATAL] FB_PAGE_ACCESS_TOKEN not set!');
  }

  // Initialize AI
  if (process.env.GEMINI_API_KEY) {
    initAI(process.env.GEMINI_API_KEY);
  } else {
    console.warn('[WARN] GEMINI_API_KEY not set - AI responses disabled');
  }

  // Start Express server
  app.listen(PORT, () => {
    console.log(`[SERVER] Running on port ${PORT}`);
    console.log(`[WEBHOOK] http://localhost:${PORT}/webhook`);
    console.log(`[HEALTH] http://localhost:${PORT}/health`);
  });

  // Start keep-alive self-ping
  startKeepAlive();

  // Set up Messenger profile (only if token is available)
  if (PAGE_ACCESS_TOKEN) {
    console.log('[SETUP] Configuring Messenger profile...');
    await setGetStarted(PAGE_ACCESS_TOKEN);
    await setGreeting(PAGE_ACCESS_TOKEN);
    await setPersistentMenu(PAGE_ACCESS_TOKEN);
    console.log('[SETUP] Messenger profile configured!');
  }

  console.log('==========================================');
  console.log('🎵 Bot is ready! Waiting for messages...');
  console.log('==========================================');
}

start().catch(err => {
  console.error('[FATAL START ERROR]', err);
  process.exit(1);
});
