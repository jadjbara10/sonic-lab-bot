// ============================================================
// Facebook Webhook Handler
// Handles verification (GET) and incoming messages (POST)
// ============================================================

const crypto = require('crypto');
const { processMessage } = require('./conversation');

const APP_SECRET = process.env.FB_APP_SECRET;
const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

// ── Webhook Verification (GET) ─────────────────────────────
// Facebook calls this to verify your webhook endpoint
function handleWebhookGet(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('📡 Webhook verification request received');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Webhook verification failed - invalid token');
    res.status(403).send('Forbidden');
  }
}

// ── Incoming Messages (POST) ───────────────────────────────
function handleWebhookPost(req, res) {
  // Verify request signature for security
  if (!verifySignature(req)) {
    console.error('❌ Invalid signature - rejecting request');
    return res.status(403).send('Forbidden');
  }

  const body = req.body;

  // Check this is a page subscription
  if (body.object !== 'page') {
    return res.sendStatus(404);
  }

  // Process each entry (can batch multiple events)
  body.entry.forEach(entry => {
    // Handle messaging events
    if (entry.messaging) {
      entry.messaging.forEach(event => {
        handleMessagingEvent(event);
      });
    }
  });

  // Must return 200 quickly (Facebook retries if slow)
  res.status(200).send('EVENT_RECEIVED');
}

// ── Verify Facebook Signature ──────────────────────────────
function verifySignature(req) {
  if (!APP_SECRET) return true; // Skip in development

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expectedHash = crypto
    .createHmac('sha256', APP_SECRET)
    .update(req.rawBody)
    .digest('hex');

  const signatureHash = signature.split('=')[1];
  return signatureHash === expectedHash;
}

// ── Handle Individual Messaging Event ──────────────────────
async function handleMessagingEvent(event) {
  const senderPSID = event.sender.id;

  // Ignore delivered/read echoes
  if (event.delivery || event.read) return;

  // Handle incoming text messages
  if (event.message && event.message.text) {
    const messageText = event.message.text;
    const messageTimestamp = event.timestamp;

    console.log(`💬 Message from ${senderPSID}: ${messageText}`);

    try {
      await processMessage(senderPSID, messageText);
    } catch (error) {
      console.error(`❌ Error processing message from ${senderPSID}:`, error);
      // Send fallback error message
      const { sendMessage } = require('./messenger');
      await sendMessage(senderPSID, 'عذراً، صار خطأ بسيط 🙏 جرب تراسلني مرة تانية');
    }
  }

  // Handle postback (Get Started button, quick replies, etc.)
  if (event.postback) {
    const payload = event.postback.payload;
    console.log(`🔘 Postback from ${senderPSID}: ${payload}`);

    try {
      await processMessage(senderPSID, payload, true);
    } catch (error) {
      console.error(`❌ Error processing postback from ${senderPSID}:`, error);
    }
  }

  // Handle attachments (images, audio, etc.)
  if (event.message && event.message.attachments) {
    console.log(`📎 Attachment from ${senderPSID}`);
    const { sendMessage } = require('./messenger');
    await sendMessage(senderPSID, 'شكراً على الصورة/الملف! 😊 بس للاستفسارات عن خدماتنا، اكتبلي وانا برد عليك');
  }
}

module.exports = { handleWebhookGet, handleWebhookPost };
