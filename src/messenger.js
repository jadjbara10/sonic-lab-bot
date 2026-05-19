/**
 * Sonic Lab - Facebook Messenger API Integration
 */

const axios = require('axios');
const FB_GRAPH_API = 'https://graph.facebook.com/v19.0';

async function sendMessage(pageAccessToken, recipientId, text, quickReplies = null) {
  const message = { text };
  if (quickReplies && quickReplies.length > 0) {
    message.quick_replies = quickReplies.map(qr => ({
      content_type: 'text',
      title: qr.title.substring(0, 20),
      payload: qr.payload
    }));
  }
  try {
    const response = await axios.post(
      `${FB_GRAPH_API}/me/messages?access_token=${pageAccessToken}`,
      { recipient: { id: recipientId }, message }
    );
    console.log(`[MSG SENT] To: ${recipientId}, Len: ${text.length}`);
    return response.data;
  } catch (error) {
    console.error('[MSG SEND ERROR]', error.response?.data || error.message);
    throw error;
  }
}

async function sendTypingIndicator(pageAccessToken, recipientId) {
  try {
    await axios.post(
      `${FB_GRAPH_API}/me/messages?access_token=${pageAccessToken}`,
      { recipient: { id: recipientId }, sender_action: 'typing_on' }
    );
  } catch (error) {}
}

async function getUserProfile(pageAccessToken, userId) {
  try {
    const response = await axios.get(
      `${FB_GRAPH_API}/${userId}?fields=first_name,last_name,locale,timezone,gender&access_token=${pageAccessToken}`
    );
    return response.data;
  } catch (error) {
    console.error('[PROFILE ERROR]', error.response?.data || error.message);
    return null;
  }
}

function verifySignature(appSecret, payload, signature) {
  const crypto = require('crypto');
  if (!signature) return false;
  const elements = signature.split('=');
  const method = elements[0];
  const signatureHash = elements[1];
  const expectedHash = crypto
    .createHmac(method === 'sha1' ? 'sha1' : 'sha256', appSecret)
    .update(payload)
    .digest('hex');
  return signatureHash === expectedHash;
}

async function setPersistentMenu(pageAccessToken) {
  try {
    await axios.post(
      `${FB_GRAPH_API}/me/messenger_profile?access_token=${pageAccessToken}`,
      {
        persistent_menu: [{
          locale: 'default',
          composer_input_disabled: false,
          call_to_actions: [
            { title: '🎵 اطلب أغنية', type: 'postback', payload: 'START_LEAD' },
            { title: '💰 الأسعار', type: 'postback', payload: 'PRICING' },
            { title: '📞 تواصل معنا', type: 'postback', payload: 'CONTACT' }
          ]
        }]
      }
    );
    console.log('[PERSISTENT MENU] Set successfully');
  } catch (error) {
    console.error('[PERSISTENT MENU ERROR]', error.response?.data || error.message);
  }
}

async function setGetStarted(pageAccessToken) {
  try {
    await axios.post(
      `${FB_GRAPH_API}/me/messenger_profile?access_token=${pageAccessToken}`,
      { get_started: { payload: 'GET_STARTED' } }
    );
    console.log('[GET STARTED] Set successfully');
  } catch (error) {
    console.error('[GET STARTED ERROR]', error.response?.data || error.message);
  }
}

async function setGreeting(pageAccessToken) {
  try {
    await axios.post(
      `${FB_GRAPH_API}/me/messenger_profile?access_token=${pageAccessToken}`,
      {
        greeting: [{
          locale: 'default',
          text: 'هلا! 🎵 أهلاً فيك في سونيك لاب - بنصنع أغاني مخصصة لكل المناسبات! اضغط "ابدأ" وكيف بنقدر نخدمك 😊'
        }]
      }
    );
    console.log('[GREETING] Set successfully');
  } catch (error) {
    console.error('[GREETING ERROR]', error.response?.data || error.message);
  }
}

module.exports = {
  sendMessage, sendTypingIndicator, getUserProfile,
  verifySignature, setPersistentMenu, setGetStarted, setGreeting
};
