/**
 * Sonic Lab Messenger Bot - Conversation State Manager
 * إدارة حالات المحادثة وتتبع العملاء المحتملين
 */

const { RESPONSES, INTENTS, QUICK_REPLIES } = require('./prompts');

// In-memory conversation store (production: use Redis/DB)
const conversations = new Map();
const leads = new Map();

// Conversation states
const STATES = {
  NEW: 'NEW',
  GREETED: 'GREETED',
  DISCOVERING: 'DISCOVERING',
  PRICING: 'PRICING',
  LEAD_NAME: 'LEAD_NAME',
  LEAD_PHONE: 'LEAD_PHONE',
  LEAD_BUDGET: 'LEAD_BUDGET',
  LEAD_COMPLETE: 'LEAD_COMPLETE',
  GENERAL_QA: 'GENERAL_QA'
};

// Get or create conversation
function getConversation(senderId) {
  if (!conversations.has(senderId)) {
    conversations.set(senderId, {
      state: STATES.NEW,
      messageCount: 0,
      occasion: null,
      name: null,
      phone: null,
      budget: null,
      notes: [],
      lastIntent: null,
      lastResponse: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  return conversations.get(senderId);
}

// Detect intent from message
function detectIntent(message) {
  const text = message.toLowerCase().trim();

  // Check patterns in order of priority
  if (INTENTS.objection.test(text)) return 'objection';
  if (INTENTS.wedding.test(text)) return 'wedding';
  if (INTENTS.birthday.test(text)) return 'birthday';
  if (INTENTS.anniversary.test(text)) return 'anniversary';
  if (INTENTS.graduation.test(text)) return 'graduation';
  if (INTENTS.pricing.test(text)) return 'pricing';
  if (INTENTS.howItWorks.test(text)) return 'howItWorks';
  if (INTENTS.contact.test(text)) return 'contact';
  if (INTENTS.customSong.test(text)) return 'customSong';
  if (INTENTS.thanks.test(text)) return 'thanks';
  if (INTENTS.greeting.test(text)) return 'greeting';

  return null;
}

// Get a random response from array
function randomResponse(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Build conversation context for AI
function buildContext(conv) {
  const parts = [];
  parts.push(`حالة المحادثة: ${conv.state}`);
  parts.push(`عدد الرسائل: ${conv.messageCount}`);
  if (conv.occasion) parts.push(`المناسبة: ${conv.occasion}`);
  if (conv.name) parts.push(`اسم العميل: ${conv.name}`);
  if (conv.phone) parts.push(`رقم العميل: ${conv.phone}`);
  if (conv.budget) parts.push(`الميزانية: ${conv.budget}`);
  if (conv.notes.length > 0) parts.push(`ملاحظات: ${conv.notes.slice(-3).join(', ')}`);
  return parts.join('\n');
}

// Process incoming message and generate response
function processMessage(senderId, messageText, payload) {
  const conv = getConversation(senderId);
  conv.messageCount++;
  conv.updatedAt = Date.now();

  let response = '';
  let quickReplies = null;

  // Handle Quick Reply payloads first
  if (payload) {
    switch (payload) {
      case 'WEDDING_SONG':
        conv.occasion = 'فرح';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.wedding);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'BIRTHDAY_SONG':
        conv.occasion = 'عيد ميلاد';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.birthday);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'ANNIVERSARY_SONG':
        conv.occasion = 'ذكرى';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.anniversary);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'PRICING':
        conv.state = STATES.PRICING;
        response = randomResponse(RESPONSES.pricing);
        quickReplies = QUICK_REPLIES.afterInfo;
        break;

      case 'ORDER_SONG':
      case 'START_LEAD':
        conv.state = STATES.LEAD_NAME;
        response = randomResponse(RESPONSES.askName);
        break;

      case 'CONTACT':
        response = `بتتواصل معانا على:\n\n📞 هاتف: 00962786127583\n📧 إيميل: jadjbara10@gmail.com\n📍 موقعنا: عمان - الأردن\n\nأو ممكن تعطيني رقمك وبنتصل فيك! 😊`;
        quickReplies = QUICK_REPLIES.afterInfo;
        break;

      case 'MORE_QUESTIONS':
        conv.state = STATES.GENERAL_QA;
        response = "أسأل براحتك! 🎵 أنا هون لمساعدتك. شو بتحب تعرف؟";
        break;

      default:
        break;
    }

    if (response) {
      conv.lastResponse = response;
      return { response, quickReplies, needsAI: false };
    }
  }

  // Handle state-based responses
  switch (conv.state) {
    case STATES.LEAD_NAME:
      conv.name = messageText.trim();
      conv.state = STATES.LEAD_PHONE;
      response = randomResponse(RESPONSES.askPhone).replace('{name}', conv.name);
      conv.lastResponse = response;
      return { response, quickReplies: null, needsAI: false };

    case STATES.LEAD_PHONE:
      conv.phone = messageText.trim();
      conv.state = STATES.LEAD_BUDGET;
      response = randomResponse(RESPONSES.askBudget);
      conv.lastResponse = response;
      return { response, quickReplies: null, needsAI: false };

    case STATES.LEAD_BUDGET:
      conv.budget = messageText.trim();
      conv.state = STATES.LEAD_COMPLETE;
      // Save lead
      saveLead(senderId, conv);
      response = randomResponse(RESPONSES.leadComplete).replace('{name}', conv.name || 'حبيبي');
      conv.lastResponse = response;
      return { response, quickReplies: null, needsAI: false };

    case STATES.LEAD_COMPLETE:
      response = "شكراً كتير! 🎵 رح نتصل فيك قريباً إن شاء الله. إذا عندك أي سؤال ثاني أنا هون!";
      conv.lastResponse = response;
      return { response, quickReplies: null, needsAI: false };

    default:
      break;
  }

  // Detect intent
  const intent = detectIntent(messageText);
  conv.lastIntent = intent;

  // Handle known intents
  if (intent) {
    switch (intent) {
      case 'greeting':
        conv.state = STATES.GREETED;
        response = randomResponse(RESPONSES.greeting);
        quickReplies = QUICK_REPLIES.initial;
        break;

      case 'wedding':
        conv.occasion = 'فرح';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.wedding);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'birthday':
        conv.occasion = 'عيد ميلاد';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.birthday);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'anniversary':
        conv.occasion = 'ذكرى';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.anniversary);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'graduation':
        conv.occasion = 'تخرج';
        conv.state = STATES.DISCOVERING;
        response = randomResponse(RESPONSES.graduation);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'pricing':
        conv.state = STATES.PRICING;
        response = randomResponse(RESPONSES.pricing);
        quickReplies = QUICK_REPLIES.afterInfo;
        break;

      case 'howItWorks':
        response = randomResponse(RESPONSES.howItWorks);
        quickReplies = QUICK_REPLIES.ready;
        break;

      case 'thanks':
        response = randomResponse(RESPONSES.thanks);
        break;

      case 'contact':
        response = `بتتواصل معانا على:\n\n📞 هاتف: 00962786127583\n📧 إيميل: jadjbara10@gmail.com\n📍 موقعنا: عمان - الأردن\n\nأو أعطينا رقمك وبنتصل فيك! 😊`;
        quickReplies = QUICK_REPLIES.afterInfo;
        break;

      case 'customSong':
        conv.occasion = 'مخصصة';
        conv.state = STATES.DISCOVERING;
        response = "يا سلام! 🎵 بنعمل أغاني مخصصة لأي فكرة ببالك! شو المناسبة أو الفكرة الي بتحب الأغنية تحكي عنها؟";
        break;

      case 'objection':
        response = randomResponse(RESPONSES.reassurance);
        quickReplies = QUICK_REPLIES.afterInfo;
        break;

      default:
        break;
    }

    if (response) {
      conv.lastResponse = response;
      return { response, quickReplies, needsAI: false };
    }
  }

  // Proactive lead capture after 3+ messages without capturing
  if (conv.messageCount >= 3 && !conv.name && conv.state !== STATES.LEAD_NAME) {
    conv.state = STATES.LEAD_NAME;
    response = "بحب أخدمك أحسن! 😊 شو اسمك الكريم؟";
    conv.lastResponse = response;
    return { response, quickReplies: null, needsAI: false };
  }

  // Unknown intent - needs AI response
  conv.notes.push(messageText);
  return { response: null, quickReplies: null, needsAI: true, context: buildContext(conv) };
}

// Save lead data
function saveLead(senderId, conv) {
  const lead = {
    id: senderId,
    name: conv.name,
    phone: conv.phone,
    occasion: conv.occasion,
    budget: conv.budget,
    notes: conv.notes.join('; '),
    messageCount: conv.messageCount,
    source: 'messenger',
    capturedAt: new Date().toISOString()
  };

  leads.set(senderId, lead);
  console.log(`[LEAD CAPTURED] ${JSON.stringify(lead)}`);

  // TODO: Save to Google Sheets or external storage
  // For now, save to local file
  try {
    const fs = require('fs');
    const path = require('path');
    const leadsPath = path.join(__dirname, '..', 'leads.json');
    let existing = [];
    if (fs.existsSync(leadsPath)) {
      existing = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    }
    existing.push(lead);
    fs.writeFileSync(leadsPath, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error('[LEAD SAVE ERROR]', e.message);
  }

  return lead;
}

// Get all leads
function getLeads() {
  return Array.from(leads.values());
}

// Cleanup old conversations (older than 24 hours)
function cleanup() {
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [id, conv] of conversations.entries()) {
    if (now - conv.updatedAt > ONE_DAY) {
      conversations.delete(id);
    }
  }
}

// Run cleanup every hour
setInterval(cleanup, 60 * 60 * 1000);

module.exports = {
  processMessage,
  getConversation,
  getLeads,
  STATES,
  buildContext
};
