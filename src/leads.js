// ============================================================
// Lead Storage System
// Dual storage: Google Sheets (primary) + Local JSON (fallback)
// Both are FREE
// ============================================================

const fs = require('fs');
const path = require('path');

const LEADS_FILE = path.join(__dirname, '..', 'leads.json');

// ── Initialize Storage ─────────────────────────────────────
async function initLeadStorage() {
  // Ensure local JSON file exists
  if (!fs.existsSync(LEADS_FILE)) {
    fs.writeFileSync(LEADS_FILE, JSON.stringify([], null, 2));
    console.log('✅ Local leads file created');
  }

  // Try to initialize Google Sheets
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID) {
    try {
      const { GoogleSpreadsheet } = require('google-spreadsheet');
      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
      
      await doc.useServiceAccountAuth({
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
      
      await doc.loadInfo();
      console.log(`✅ Google Sheets connected: "${doc.title}"`);
    } catch (error) {
      console.error('⚠️ Google Sheets init failed (leads will be saved locally):', error.message);
    }
  } else {
    console.log('ℹ️ Google Sheets not configured - using local JSON storage only');
  }
}

// ── Save Lead ──────────────────────────────────────────────
async function saveLead(leadData) {
  const lead = {
    id: generateId(),
    name: leadData.name || 'Unknown',
    phone: leadData.phone || 'N/A',
    occasion: leadData.occasion || 'N/A',
    budget: leadData.budget || 'N/A',
    notes: leadData.notes ? leadData.notes.map(n => `${n.role}: ${n.text}`).join(' | ') : '',
    createdAt: new Date().toISOString(),
    source: 'facebook_messenger_bot'
  };

  // Save to local JSON (always)
  await saveToLocal(lead);

  // Try Google Sheets (if configured)
  await saveToGoogleSheets(lead);

  console.log(`📋 Lead saved: ${lead.name} - ${lead.occasion}`);
  return lead;
}

// ── Save to Local JSON ─────────────────────────────────────
async function saveToLocal(lead) {
  try {
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    leads.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error saving lead locally:', error);
    return false;
  }
}

// ── Save to Google Sheets ──────────────────────────────────
async function saveToGoogleSheets(lead) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return false;
  }

  try {
    const { GoogleSpreadsheet } = require('google-spreadsheet');
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
    
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0]; // First sheet
    
    // Add header row if sheet is empty
    const rows = await sheet.getRows();
    if (rows.length === 0) {
      await sheet.setHeaderRow([
        'ID', 'Name', 'Phone', 'Occasion', 'Budget', 'Notes', 'Created At', 'Source'
      ]);
    }
    
    await sheet.addRow({
      'ID': lead.id,
      'Name': lead.name,
      'Phone': lead.phone,
      'Occasion': lead.occasion,
      'Budget': lead.budget,
      'Notes': lead.notes.substring(0, 500), // Truncate long notes
      'Created At': lead.createdAt,
      'Source': lead.source
    });
    
    console.log('📊 Lead saved to Google Sheets');
    return true;
  } catch (error) {
    console.error('⚠️ Google Sheets save failed (saved locally instead):', error.message);
    return false;
  }
}

// ── Get All Leads ──────────────────────────────────────────
async function getAllLeads() {
  try {
    const leads = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    return leads;
  } catch (error) {
    console.error('❌ Error reading leads:', error);
    return [];
  }
}

// ── Update Lead Conversation ───────────────────────────────
async function updateLeadConversation(psid, message) {
  // This would be used for more advanced tracking
  // For now, conversations are stored in memory
}

// ── Generate Simple ID ─────────────────────────────────────
function generateId() {
  return 'SL' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

module.exports = { initLeadStorage, saveLead, getAllLeads, updateLeadConversation };
