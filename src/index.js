/**
 * Sonic Lab Messenger Bot - Main Server
 * v2.0 - Enhanced diagnostics, event logging, improved message handling
 */

require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
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
const ADMIN_KEY = process.env.ADMIN_KEY || 'JBARA2026';

// ===== Event Log (in-memory, last 100 events) =====
const eventLog = [];
const MAX_LOG = 100;

function logEvent(type, data) {
  const entry = {
    time: new Date().toISOString(),
    type,
    data
  };
  eventLog.push(entry);
  if (eventLog.length > MAX_LOG) eventLog.shift();
  console.log(`[${type}]`, JSON.stringify(data).substring(0, 200));
}

// Log config on startup
console.log('[CONFIG] FB_APP_SECRET set:', !!APP_SECRET, 'starts with:', APP_SECRET ? APP_SECRET.substring(0, 6) + '...' : 'NOT SET');
console.log('[CONFIG] FB_PAGE_ACCESS_TOKEN set:', !!PAGE_ACCESS_TOKEN);
console.log('[CONFIG] FB_VERIFY_TOKEN:', VERIFY_TOKEN);
console.log('[CONFIG] GEMINI_API_KEY set:', !!process.env.GEMINI_API_KEY);

// Middleware - raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'sonic-lab-messenger-bot',
    version: '2.0',
    uptime: process.uptime(),
    eventCount: eventLog.length,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint (protected by admin key)
app.get('/debug', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json({
    fb_app_secret_set: !!APP_SECRET,
    fb_app_secret_prefix: APP_SECRET ? APP_SECRET.substring(0, 6) + '...' : 'NOT_SET',
    fb_page_token_set: !!PAGE_ACCESS_TOKEN,
    fb_page_token_prefix: PAGE_ACCESS_TOKEN ? PAGE_ACCESS_TOKEN.substring(0, 10) + '...' : 'NOT_SET',
    verify_token: VERIFY_TOKEN,
    gemini_key_set: !!process.env.GEMINI_API_KEY,
    render_url: RENDER_URL,
    node_env: process.env.NODE_ENV,
    event_log_count: eventLog.length,
    last_events: eventLog.slice(-5)
  });
});

// Event log endpoint (protected by admin key)
app.get('/logs', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    total: eventLog.length,
    events: eventLog.slice(-limit)
  });
});

// Test send endpoint - allows testing message sending (protected by admin key)
app.get('/test-send', async (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const recipientId = req.query.recipient;
  const message = req.query.message || 'رسالة تجريبية من سونيك لاب! 🎵';

  if (!recipientId) {
    return res.status(400).json({ error: 'Missing recipient parameter. Use ?recipient=PSID' });
  }

  if (!PAGE_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'PAGE_ACCESS_TOKEN not configured' });
  }

  try {
    const result = await sendMessage(PAGE_ACCESS_TOKEN, recipientId, message);
    logEvent('TEST_SEND', { recipientId, success: true, result });
    res.json({ success: true, recipientId, message, result });
  } catch (error) {
    logEvent('TEST_SEND_ERROR', { recipientId, error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// App status endpoint - check if the Facebook app is in live mode
app.get('/app-status', async (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const axios = require('axios');
    // Check app status using the app access token
    const appToken = `${process.env.FB_APP_ID || '1489339369559090'}|${APP_SECRET}`;
    const response = await axios.get(`https://graph.facebook.com/v19.0/1489339369559090`, {
      params: { access_token: appToken, fields: 'id,name,category,is_live,contact_email' }
    });
    res.json({ status: 'accessible', data: response.data });
  } catch (error) {
    const errData = error.response?.data?.error;
    const isBlocked = errData?.message === 'API access blocked.';
    res.json({
      status: isBlocked ? 'development_mode' : 'error',
      likely_issue: isBlocked ? 'App is in DEVELOPMENT MODE. Switch to LIVE mode in Facebook Developer Dashboard for the bot to receive messages from all users.' : errData?.message || error.message,
      fix: isBlocked ? 'Go to https://developers.facebook.com/apps/1489339369559090/settings/ and switch the app to Live mode.' : null,
      error_detail: errData
    });
  }
});

// Set live mode endpoint - attempts to switch the Facebook app to live mode
app.get('/set-live', async (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const results = [];

  // Approach 1: Try with app access token (app_id|app_secret)
  try {
    const appToken = `${process.env.FB_APP_ID || '1489339369559090'}|${APP_SECRET}`;
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/1489339369559090`,
      { is_live: true },
      { params: { access_token: appToken } }
    );
    results.push({ approach: 'app_token', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'app_token', success: false, error: error.response?.data?.error || error.message });
  }

  // Approach 2: Try with page access token
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/1489339369559090`,
      { is_live: true },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    results.push({ approach: 'page_token', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'page_token', success: false, error: error.response?.data?.error || error.message });
  }

  // Approach 3: Try with page token + appsecret_proof
  try {
    const appsecretProof = crypto.createHmac('sha256', APP_SECRET).update(PAGE_ACCESS_TOKEN).digest('hex');
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/1489339369559090`,
      { is_live: true },
      { params: { access_token: PAGE_ACCESS_TOKEN, appsecret_proof: appsecretProof } }
    );
    results.push({ approach: 'page_token_with_proof', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'page_token_with_proof', success: false, error: error.response?.data?.error || error.message });
  }

  // Approach 4: Try GET to check current status with page token
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/1489339369559090`, {
      params: { access_token: PAGE_ACCESS_TOKEN, fields: 'id,name,is_live,category' }
    });
    results.push({ approach: 'page_token_get', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'page_token_get', success: false, error: error.response?.data?.error || error.message });
  }

  // Approach 5: Try to use the /me endpoint to get page info
  try {
    const response = await axios.get(`https://graph.facebook.com/v19.0/me`, {
      params: { access_token: PAGE_ACCESS_TOKEN, fields: 'id,name,category' }
    });
    results.push({ approach: 'me_endpoint', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'me_endpoint', success: false, error: error.response?.data?.error || error.message });
  }

  // Approach 6: Try to get the page's connected apps
  try {
    const meResponse = await axios.get(`https://graph.facebook.com/v19.0/me`, {
      params: { access_token: PAGE_ACCESS_TOKEN, fields: 'id' }
    });
    const pageId = meResponse.data.id;
    const response = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { access_token: PAGE_ACCESS_TOKEN, fields: 'id,name,category_list,is_verified' }
    });
    results.push({ approach: 'page_info', success: true, data: response.data });
  } catch (error) {
    results.push({ approach: 'page_info', success: false, error: error.response?.data?.error || error.message });
  }

  // Also expose the tokens for manual API calls
  results.push({
    approach: 'tokens_for_manual_use',
    app_token: `${process.env.FB_APP_ID || '1489339369559090'}|${APP_SECRET}`,
    page_token: PAGE_ACCESS_TOKEN,
    app_secret: APP_SECRET,
    note: 'Use these tokens to try the Facebook Graph API directly'
  });

  res.json({ results });
});

// Token exposure endpoint - get full tokens for manual API use
app.get('/tokens', (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json({
    app_id: process.env.FB_APP_ID || '1489339369559090',
    app_secret: APP_SECRET,
    app_access_token: `${process.env.FB_APP_ID || '1489339369559090'}|${APP_SECRET}`,
    page_access_token: PAGE_ACCESS_TOKEN,
    verify_token: VERIFY_TOKEN,
    appsecret_proof_for_page_token: crypto.createHmac('sha256', APP_SECRET).update(PAGE_ACCESS_TOKEN).digest('hex')
  });
});

// Keep-alive self-ping
function startKeepAlive() {
  const interval = 14 * 60 * 1000;
  setInterval(() => {
    const url = `${RENDER_URL}/health`;
    const module = url.startsWith('https') ? https : http;
    module.get(url, (res) => {
      console.log(`[KEEP-ALIVE] Ping sent, status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`[KEEP-ALIVE] Error: ${err.message}`);
    });
  }, interval);
  console.log(`[KEEP-ALIVE] Self-ping enabled every 14 min -> ${RENDER_URL}/health`);
}

// Webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`[WEBHOOK VERIFY] Mode: ${mode}, Token: ${token}`);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WEBHOOK] Verified successfully');
    logEvent('WEBHOOK_VERIFY', { success: true });
    res.status(200).send(challenge);
  } else {
    console.error('[WEBHOOK] Verification failed');
    logEvent('WEBHOOK_VERIFY', { success: false, mode, token });
    res.sendStatus(403);
  }
});

// Webhook message handler
app.post('/webhook', (req, res) => {
  const body = req.body;
  const signature = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];

  // Log the raw event for diagnostics
  logEvent('WEBHOOK_POST', {
    object: body.object,
    entryCount: body.entry?.length,
    hasSignature: !!signature,
    signaturePrefix: signature ? signature.substring(0, 20) + '...' : 'NONE'
  });

  // Verify webhook signature for security
  if (APP_SECRET) {
    if (!verifySignature(APP_SECRET, req.rawBody, signature)) {
      console.error('[WEBHOOK] Invalid signature. Secret prefix:', APP_SECRET.substring(0, 6));
      logEvent('SIG_VERIFY_FAIL', {
        signaturePrefix: signature ? signature.substring(0, 20) : 'NONE',
        rawBodyLength: req.rawBody?.length
      });
      return res.sendStatus(403);
    }
    logEvent('SIG_VERIFY_OK', { method: signature?.split('=')[0] });
  } else {
    console.warn('[WEBHOOK] WARNING: FB_APP_SECRET not set, skipping signature verification');
    logEvent('SIG_VERIFY_SKIP', { reason: 'no_app_secret' });
  }

  // Check this is a page subscription
  if (body.object !== 'page') {
    logEvent('NOT_PAGE_OBJECT', { object: body.object });
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
      if (senderId === pageId) {
        logEvent('SKIP_ECHO', { senderId, reason: 'same_as_page' });
        continue;
      }

      logEvent('MSG_EVENT', {
        senderId,
        pageId,
        hasMessage: !!event.message,
        hasPostback: !!event.postback,
        messageText: event.message?.text?.substring(0, 50),
        postbackPayload: event.postback?.payload,
        isEcho: !!event.message?.is_echo
      });

      // Handle different event types
      if (event.message) {
        handleMessage(senderId, event.message);
      } else if (event.postback) {
        handlePostback(senderId, event.postback);
      }
    }
  }

  // Return 200 quickly
  res.status(200).send('EVENT_RECEIVED');
});

/**
 * Handle incoming messages
 */
async function handleMessage(senderId, message) {
  try {
    // Ignore echoes and non-text messages (for now)
    if (message.is_echo || message.app_id) {
      logEvent('IGNORE_ECHO', { senderId, isEcho: !!message.is_echo, appId: message.app_id });
      return;
    }

    console.log(`[MSG RECEIVED] From: ${senderId}, Text: ${message.text || '(no text)'}`);

    // Get message text
    const messageText = message.text || '';
    const quickReplyPayload = message.quick_reply ? message.quick_reply.payload : null;

    // If it's just a quick reply without text, use the payload
    const inputText = messageText || quickReplyPayload || '';

    if (!inputText) {
      // Handle attachments (images, etc.)
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "حلو! 😊 بس بقدر أتعامل مع الرسائل النصية أكتر. شو بتحب تسأل عن خدماتنا؟ 🎵"
      );
      logEvent('ATTACHMENT_RESPONSE', { senderId });
      return;
    }

    // Show typing indicator
    await sendTypingIndicator(PAGE_ACCESS_TOKEN, senderId);

    // Process the message through conversation manager
    const result = processMessage(senderId, inputText, quickReplyPayload);

    if (result.needsAI) {
      // Need AI-generated response
      logEvent('AI_REQUEST', { senderId, inputText: inputText.substring(0, 50) });
      const aiResponse = await generateResponse(inputText, result.context);
      await sendMessage(PAGE_ACCESS_TOKEN, senderId, aiResponse);
      logEvent('AI_RESPONSE_SENT', { senderId, responseLength: aiResponse.length });
    } else if (result.response) {
      // Pre-built response
      await sendMessage(PAGE_ACCESS_TOKEN, senderId, result.response, result.quickReplies);
      logEvent('PREBUILT_RESPONSE_SENT', { senderId, responseLength: result.response.length });
    }

  } catch (error) {
    console.error('[HANDLE MSG ERROR]', error.message);
    logEvent('HANDLE_MSG_ERROR', { senderId, error: error.message });
    // Try to send fallback response
    try {
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "سامحني، صار شي غلط! 😅 جرب مرة ثانية أو راسلنا على 00962786127583"
      );
    } catch (e) {
      logEvent('FALLBACK_SEND_ERROR', { senderId, error: e.message });
    }
  }
}

/**
 * Handle postbacks (Get Started, Persistent Menu)
 */
async function handlePostback(senderId, postback) {
  const payload = postback.payload;
  console.log(`[POSTBACK] From: ${senderId}, Payload: ${payload}`);
  logEvent('POSTBACK', { senderId, payload });

  await sendTypingIndicator(PAGE_ACCESS_TOKEN, senderId);

  switch (payload) {
    case 'GET_STARTED':
      // First interaction
      await sendMessage(PAGE_ACCESS_TOKEN, senderId,
        "هلا والله! 🎵 منورتنا في سونيك لاب! بنصنع أغاني مخصصة لكل المناسبات - فرح، عيد ميلاد، ذكرى، أو أي شي ببالك! كيف بقدر أخدمك؟",
        [
          { title: "أغنية فرح", payload: "WEDDING_SONG" },
          { title: "أغنية عيد ميلاد", payload: "BIRTHDAY_SONG" },
          { title: "أغنية ذكرى", payload: "ANNIVERSARY_SONG" },
          { title: "الأسعار", payload: "PRICING" }
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
  console.log('Sonic Lab Messenger Bot v2.0');
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
  console.log('Bot is ready! Waiting for messages...');
  console.log('==========================================');
}

start().catch(err => {
  console.error('[FATAL START ERROR]', err);
  process.exit(1);
});
