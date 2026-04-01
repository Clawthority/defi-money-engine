#!/usr/bin/env node
/**
 * DeFi Money Engine — Premium / Telegram Stars Payment Module.
 *
 * Manages user premium status and handles Telegram Stars invoicing.
 * Designed to be reusable across all Clawthority bots.
 *
 * Premium features (DeFi Money Engine):
 *   - Unlimited scans (free: 3/day)
 *   - Real-time alerts (free: daily digest)
 *   - DefiLlama protocol intelligence (free: basic yield scan)
 *   - Custom watchlist alerts with thresholds
 *   - Priority support
 *
 * Usage:
 *   const premium = require('./premium')(bot);
 *   if (premium.isPremium(chatId)) { ... }
 *   premium.sendUpgradePrompt(chatId);
 */

const fs = require('fs');
const path = require('path');

const PREMIUM_FILE = path.join(__dirname, 'premium.json');

// ── Data persistence ───────────────────────────────────────────────

function loadPremiumData() {
  try {
    return JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf-8'));
  } catch {
    return { users: {}, transactions: [] };
  }
}

function savePremiumData(data) {
  fs.writeFileSync(PREMIUM_FILE, JSON.stringify(data, null, 2));
}

// ── Tier definitions ───────────────────────────────────────────────

const TIERS = {
  free: {
    name: 'Free',
    scansPerDay: 3,
    alertsEnabled: false,
    defillamaAccess: false,
    watchlistLimit: 3,
  },
  pro: {
    name: 'Pro',
    scansPerDay: Infinity,
    alertsEnabled: true,
    defillamaAccess: true,
    watchlistLimit: 50,
  },
};

// Prices in Telegram Stars (XTR)
const PLANS = [
  {
    id: 'pro_monthly',
    name: '💰 DeFi Money Engine — Pro Monthly',
    description: 'Unlimited scans, real-time alerts, protocol intelligence, and priority watchlist.',
    stars: 100, // ~$2-3 USD equivalent
    durationDays: 30,
    tier: 'pro',
  },
  {
    id: 'pro_weekly',
    name: '💰 DeFi Money Engine — Pro Weekly',
    description: 'Try Pro for 7 days. Unlimited scans and alerts.',
    stars: 35, // ~$0.70-1 USD equivalent
    durationDays: 7,
    tier: 'pro',
  },
];

// ── Rate limiting (free tier) ──────────────────────────────────────

const dailyScans = new Map(); // chatId → { date, count }

function getScanCount(chatId) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyScans.get(chatId);
  if (!entry || entry.date !== today) {
    dailyScans.set(chatId, { date: today, count: 0 });
    return 0;
  }
  return entry.count;
}

function incrementScan(chatId) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyScans.get(chatId);
  if (!entry || entry.date !== today) {
    dailyScans.set(chatId, { date: today, count: 1 });
    return 1;
  }
  entry.count++;
  return entry.count;
}

// ── Core API ───────────────────────────────────────────────────────

function isPremium(chatId) {
  const data = loadPremiumData();
  const user = data.users[String(chatId)];
  if (!user) return false;
  if (user.expiresAt && new Date(user.expiresAt) > new Date()) return true;
  // Expired — clean up
  if (user.expiresAt && new Date(user.expiresAt) <= new Date()) {
    delete data.users[String(chatId)];
    savePremiumData(data);
  }
  return false;
}

function canScan(chatId) {
  if (isPremium(chatId)) return { allowed: true, remaining: Infinity };
  const count = getScanCount(chatId);
  const limit = TIERS.free.scansPerDay;
  return {
    allowed: count < limit,
    remaining: Math.max(0, limit - count),
    count,
    limit,
  };
}

function recordScan(chatId) {
  if (!isPremium(chatId)) {
    incrementScan(chatId);
  }
}

function getTier(chatId) {
  if (isPremium(chatId)) return TIERS.pro;
  return TIERS.free;
}

function grantPremium(chatId, planId, txId) {
  const plan = PLANS.find(p => p.id === planId);
  if (!plan) return false;

  const data = loadPremiumData();
  const now = new Date();
  const existing = data.users[String(chatId)];

  // Extend if already premium, otherwise start fresh
  const startDate = existing?.expiresAt && new Date(existing.expiresAt) > now
    ? new Date(existing.expiresAt)
    : now;

  const expiresAt = new Date(startDate.getTime() + plan.durationDays * 86400000);

  data.users[String(chatId)] = {
    tier: plan.tier,
    planId: plan.id,
    grantedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  data.transactions.push({
    txId,
    chatId: String(chatId),
    planId: plan.id,
    stars: plan.stars,
    timestamp: now.toISOString(),
  });

  savePremiumData(data);
  return true;
}

// ── Telegram Bot Integration ───────────────────────────────────────

function setup(bot) {
  // Pre-checkout handler (required for Telegram Stars)
  bot.on('pre_checkout_query', (query) => {
    const plan = PLANS.find(p => p.id === query.invoice_payload);
    if (plan) {
      bot.answerPreCheckoutQuery(query.id, true)
        .catch(err => console.error('[premium] Pre-checkout error:', err.message));
    } else {
      bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Invalid plan. Please try again.',
      }).catch(err => console.error('[premium] Pre-checkout reject:', err.message));
    }
  });

  // Successful payment handler
  bot.on('successful_payment', (msg) => {
    const payment = msg.successful_payment;
    const chatId = msg.chat.id;
    const planId = payment.invoice_payload;
    const txId = payment.telegram_payment_charge_id;

    const success = grantPremium(chatId, planId, txId);
    const plan = PLANS.find(p => p.id === planId);

    if (success && plan) {
      bot.sendMessage(chatId,
        `🎉 *Welcome to ${plan.name.replace('💰 DeFi Money Engine — ', '')}!*\n\n` +
        `✅ Unlimited scans activated\n` +
        `✅ Real-time alerts enabled\n` +
        `✅ Protocol intelligence unlocked\n` +
        `✅ Watchlist limit: ${TIERS.pro.watchlistLimit}\n\n` +
        `Your access is valid for ${plan.durationDays} days.\n` +
        `Use /premium to check your status anytime.`,
        { parse_mode: 'Markdown' }
      ).catch(err => console.error('[premium] Payment confirm error:', err.message));

      console.error(`[premium] ${chatId} upgraded to ${planId} (tx: ${txId})`);
    }
  });

  // /premium command — show status + upgrade options
  bot.onText(/^\/premium(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;

    if (isPremium(chatId)) {
      const data = loadPremiumData();
      const user = data.users[String(chatId)];
      const expires = new Date(user.expiresAt);
      const daysLeft = Math.ceil((expires - new Date()) / 86400000);

      bot.sendMessage(chatId,
        `💎 *Premium Active*\n\n` +
        `Tier: ${TIERS.pro.name}\n` +
        `Expires: ${expires.toISOString().slice(0, 10)} (${daysLeft} days)\n` +
        `Plan: ${user.planId}\n\n` +
        `Use /premium extend to renew early.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Show upgrade options
    sendUpgradePrompt(bot, chatId);
  });

  // /premium extend — show renewal invoice
  bot.onText(/^\/premium(@\w+)?\s+extend$/, (msg) => {
    const chatId = msg.chat.id;
    sendUpgradePrompt(bot, chatId);
  });

  console.error('[premium] Module initialized');
}

function sendUpgradePrompt(bot, chatId) {
  const scanInfo = canScan(chatId);
  const lines = [
    `📊 *Your Usage Today:* ${scanInfo.count || 0}/${scanInfo.limit || 3} scans`,
    '',
    `💎 *Upgrade to Pro:*`,
    '',
  ];

  const keyboard = PLANS.map(plan => [{
    text: `${plan.name.replace('💰 DeFi Money Engine — ', '')} — ⭐ ${plan.stars} Stars`,
    callback_data: `premium_buy_${plan.id}`,
  }]);

  keyboard.push([{
    text: 'ℹ️ What do I get?',
    callback_data: 'premium_info',
  }]);

  bot.sendMessage(chatId, lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

// Callback query handler for inline buttons
function setupCallbacks(bot) {
  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'premium_info') {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(chatId,
        `💎 *DeFi Money Engine — Pro Features*\n\n` +
        `🆓 *Free:*\n` +
        `• ${TIERS.free.scansPerDay} scans per day\n` +
        `• Basic yield pool scanning\n` +
        `• ${TIERS.free.watchlistLimit} watchlist items\n` +
        `• Daily digest alerts\n\n` +
        `💎 *Pro:*\n` +
        `• Unlimited scans\n` +
        `• Real-time alerts (every 30 min)\n` +
        `• DefiLlama protocol intelligence\n` +
        `  (TVL anomalies, chain expansion, momentum)\n` +
        `• ${TIERS.pro.watchlistLimit} watchlist items\n` +
        `• Custom alert thresholds\n` +
        `• Priority support\n\n` +
        `Tap a plan below to upgrade via Telegram Stars.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (data.startsWith('premium_buy_')) {
      const planId = data.replace('premium_buy_', '');
      const plan = PLANS.find(p => p.id === planId);
      if (!plan) {
        bot.answerCallbackQuery(query.id, { text: 'Plan not found' });
        return;
      }

      bot.answerCallbackQuery(query.id);

      // Send Telegram Stars invoice
      bot.sendInvoice(
        chatId,
        plan.name,                    // title
        plan.description,             // description
        plan.id,                      // payload (used to identify plan on payment)
        '',                           // provider_token (empty for Stars)
        'XTR',                        // currency (Telegram Stars)
        [{ label: plan.name, amount: plan.stars }], // prices (amount in Stars)
        {
          max_tip_amount: 0,
          protect_content: true,
        }
      ).catch(err => {
        console.error('[premium] Invoice error:', err.message);
        bot.sendMessage(chatId, '❌ Failed to create invoice. Please try /premium again.');
      });
      return;
    }
  });
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = {
  setup,
  setupCallbacks,
  isPremium,
  canScan,
  recordScan,
  getTier,
  grantPremium,
  sendUpgradePrompt,
  TIERS,
  PLANS,
};
