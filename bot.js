#!/usr/bin/env node
/**
 * DeFi Money Engine — Telegram Bot.
 * Wraps scanner.js + defillama-scanner.js + format.js into an interactive Telegram bot.
 *
 * Commands:
 *   /start     — Welcome & overview
 *   /scan      — Full scan (yield pools + protocol intelligence)
 *   /yields    — Yield pools only (stablecoins + ETH best APY)
 *   /airdrops  — Airdrop candidates only
 *   /protocols — Protocol intelligence (TVL anomalies, momentum, chain expansion)
 *   /watch     — Show watchlist items
 *   /filter    — Set filters (min APY, stablecoins only)
 *   /help      — Command reference
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=xxx node bot.js
 *
 * The bot runs scanners on-demand via child processes and pipes through format.js.
 * Each user gets independent filter settings stored in memory.
 */

const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const path = require('path');
const wl = require('./watchlist');
const premium = require('./premium');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN env var required');
  process.exit(1);
}

const ALERT_INTERVAL_MS = parseInt(process.env.ALERT_INTERVAL_MINUTES || '30', 10) * 60 * 1000;

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('💰 DeFi Money Engine bot started');

// Initialize premium module (Telegram Stars payments)
premium.setup(bot);
premium.setupCallbacks(bot);

// ── Per-user filter state ──────────────────────────────────────────
const userFilters = new Map();

function getFilters(chatId) {
  if (!userFilters.has(chatId)) {
    userFilters.set(chatId, { minApy: 0, minTvl: 0, stablecoinsOnly: false });
  }
  return userFilters.get(chatId);
}

// ── Scanner runner ─────────────────────────────────────────────────
const BASE_DIR = __dirname;

/**
 * Run a scanner command and return its stdout.
 * @param {string} script - Script filename (scanner.js or defillama-scanner.js)
 * @param {string[]} args - Additional CLI arguments
 * @param {number} timeoutMs - Kill after this many ms (default 30s)
 * @returns {Promise<string>}
 */
function runScanner(script, args = [], timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [script, '--once', ...args], {
      cwd: BASE_DIR,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) reject(new Error('Scanner timed out'));
      else if (code !== 0 && !stdout) reject(new Error(stderr || `Exit code ${code}`));
      else resolve(stdout);
    });
  });
}

/**
 * Run scanner(s) and pipe through format.js with filters.
 * @param {string[]} scanners - Which scanner scripts to run
 * @param {object} filters - User filter settings
 * @returns {Promise<string>} Formatted Telegram message
 */
function scanAndFormat(scanners, filters) {
  return new Promise((resolve, reject) => {
    const formatArgs = [];
    if (filters.minApy > 0) formatArgs.push(`--min-apy=${filters.minApy}`);
    if (filters.minTvl > 0) formatArgs.push(`--min-tvl=${filters.minTvl}`);
    if (filters.stablecoinsOnly) formatArgs.push('--stablecoins-only');

    // Run all scanners, combine their JSONL output, pipe through format.js
    const scannerProcs = scanners.map((script) =>
      spawn('node', [script, '--once'], {
        cwd: BASE_DIR,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      })
    );

    const formatter = spawn('node', ['format.js', ...formatArgs], {
      cwd: BASE_DIR,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let output = '';
    let errorOutput = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        scannerProcs.forEach((p) => p.kill('SIGTERM'));
        formatter.kill('SIGTERM');
        reject(new Error('Scan timed out'));
      }
    }, 45000);

    // Pipe all scanner outputs into formatter
    scannerProcs.forEach((proc) => {
      proc.stdout.on('data', (d) => formatter.stdin.write(d));
      proc.on('error', () => {}); // individual scanner failures are non-fatal
    });

    // Close formatter stdin when all scanners are done
    let done = 0;
    scannerProcs.forEach((proc) => {
      proc.on('close', () => {
        done++;
        if (done === scannerProcs.length) formatter.stdin.end();
      });
    });

    formatter.stdout.on('data', (d) => { output += d; });
    formatter.stderr.on('data', (d) => { errorOutput += d; });

    formatter.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0 && !output) reject(new Error(errorOutput || `Formatter exit ${code}`));
      else resolve(output.trim() || 'No results found.');
    });
  });
}

// ── Commands ───────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    '💰 *DeFi Money Engine*\n\n' +
    'Automated scanner for DeFi yield opportunities, airdrop candidates, and protocol intelligence.\n\n' +
    '*Commands:*\n' +
    '/scan — Full scan (yields + airdrops)\n' +
    '/yields — Best yield pools (stablecoins & ETH)\n' +
    '/airdrops — Airdrop candidates (high TVL, no token)\n' +
    '/protocols — TVL anomalies, momentum, chain expansion 💎\n' +
    '/filter — Set min APY, min TVL, stablecoins only\n' +
    '/premium — Upgrade for unlimited scans & alerts\n' +
    '/help — Command reference\n\n' +
    '🆓 Free tier: 3 scans/day | 💎 Pro: unlimited + real-time alerts',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '💰 *Commands*\n\n' +
    '/scan — Full scan (yields + airdrops)\n' +
    '/yields — Yield pools only\n' +
    '/airdrops — Airdrop candidates only\n' +
    '/protocols — Protocol intelligence 💎\n' +
    '/filter apy=5 — Min APY filter\n' +
    '/filter stablecoins — Toggle stablecoins only\n' +
    '/filter tvl=5000000 — Min TVL filter\n' +
    '/filter reset — Clear all filters\n' +
    '/filter — Show current filters\n' +
    '/premium — Upgrade to Pro (unlimited scans)\n\n' +
    '🆓 Free: 3 scans/day | 💎 Pro: unlimited + alerts + protocol intel',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/scan/, async (msg) => {
  const chatId = msg.chat.id;

  // Rate limit check (free tier)
  const scanCheck = premium.canScan(chatId);
  if (!scanCheck.allowed) {
    premium.sendUpgradePrompt(bot, chatId);
    return;
  }

  const statusMsg = await bot.sendMessage(chatId, '⏳ Running full scan...');
  try {
    premium.recordScan(chatId);
    const filters = getFilters(chatId);
    const result = await scanAndFormat(['scanner.js', 'defillama-scanner.js'], filters);
    await bot.deleteMessage(chatId, statusMsg.message_id);
    // Telegram message limit is 4096 chars
    const chunks = result.match(/[\s\S]{1,4000}/g) || [result];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await bot.deleteMessage(chatId, statusMsg.message_id);
    bot.sendMessage(chatId, `❌ Scan failed: ${err.message}`);
  }
});

bot.onText(/\/yields/, async (msg) => {
  const chatId = msg.chat.id;

  // Rate limit check (free tier)
  const scanCheck = premium.canScan(chatId);
  if (!scanCheck.allowed) {
    premium.sendUpgradePrompt(bot, chatId);
    return;
  }

  const statusMsg = await bot.sendMessage(chatId, '⏳ Scanning yield pools...');
  try {
    premium.recordScan(chatId);
    const filters = getFilters(chatId);
    const result = await scanAndFormat(['scanner.js'], filters);
    await bot.deleteMessage(chatId, statusMsg.message_id);
    const chunks = result.match(/[\s\S]{1,4000}/g) || [result];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await bot.deleteMessage(chatId, statusMsg.message_id);
    bot.sendMessage(chatId, `❌ Yield scan failed: ${err.message}`);
  }
});

bot.onText(/\/airdrops/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(chatId, '⏳ Scanning airdrop candidates...');
  try {
    const result = await runScanner('scanner.js');
    const lines = result.split('\n').filter(Boolean);
    const airdrops = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((item) => item && item.type === 'airdrop');

    await bot.deleteMessage(chatId, statusMsg.message_id);

    if (airdrops.length === 0) {
      bot.sendMessage(chatId, 'No airdrop candidates found right now.');
      return;
    }

    let msg_text = '🪂 *Airdrop Candidates*\n\n';
    for (const a of airdrops.slice(0, 15)) {
      const tier = a.tier === 'high' ? '💎' : a.tier === 'medium' ? '🪂' : '🧪';
      const tvl = a.tvl >= 1e9 ? `$${(a.tvl / 1e9).toFixed(1)}B` : a.tvl >= 1e6 ? `$${(a.tvl / 1e6).toFixed(0)}M` : `$${a.tvl}`;
      msg_text += `${tier} *${a.name || a.protocol}*${a.symbol ? ` ($${a.symbol})` : ''}\n`;
      msg_text += `  💰 TVL: ${tvl}${a.change_7d ? ` | 7d: ${a.change_7d > 0 ? '+' : ''}${a.change_7d.toFixed(1)}%` : ''}\n`;
      if (a.chains) msg_text += `  ⛓️ ${Array.isArray(a.chains) ? a.chains.join(', ') : a.chains}\n`;
      msg_text += '\n';
    }

    const chunks = msg_text.match(/[\s\S]{1,4000}/g) || [msg_text];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await bot.deleteMessage(chatId, statusMsg.message_id);
    bot.sendMessage(chatId, `❌ Airdrop scan failed: ${err.message}`);
  }
});

bot.onText(/\/protocols/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(chatId, '⏳ Scanning protocol intelligence...');
  try {
    const result = await scanAndFormat(['defillama-scanner.js'], getFilters(chatId));
    await bot.deleteMessage(chatId, statusMsg.message_id);
    const chunks = result.match(/[\s\S]{1,4000}/g) || [result];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    await bot.deleteMessage(chatId, statusMsg.message_id);
    bot.sendMessage(chatId, `❌ Protocol scan failed: ${err.message}`);
  }
});

bot.onText(/\/filter(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const filters = getFilters(chatId);
  const arg = (match[1] || '').trim().toLowerCase();

  if (!arg) {
    bot.sendMessage(chatId,
      '⚙️ *Current Filters*\n\n' +
      `Min APY: ${filters.minApy > 0 ? filters.minApy + '%' : 'off'}\n` +
      `Min TVL: ${filters.minTvl > 0 ? '$' + filters.minTvl.toLocaleString() : 'off'}\n` +
      `Stablecoins only: ${filters.stablecoinsOnly ? 'yes' : 'no'}\n\n` +
      'Set: /filter apy=5 | /filter tvl=5000000 | /filter stablecoins | /filter reset',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (arg === 'reset') {
    userFilters.set(chatId, { minApy: 0, minTvl: 0, stablecoinsOnly: false });
    bot.sendMessage(chatId, '✅ Filters reset.');
    return;
  }

  if (arg === 'stablecoins') {
    filters.stablecoinsOnly = !filters.stablecoinsOnly;
    bot.sendMessage(chatId, `✅ Stablecoins only: ${filters.stablecoinsOnly ? 'ON' : 'OFF'}`);
    return;
  }

  const apyMatch = arg.match(/apy[=:]?\s*(\d+)/);
  if (apyMatch) {
    filters.minApy = parseInt(apyMatch[1], 10);
    bot.sendMessage(chatId, `✅ Min APY set to ${filters.minApy}%`);
    return;
  }

  const tvlMatch = arg.match(/tvl[=:]?\s*(\d+)/);
  if (tvlMatch) {
    filters.minTvl = parseInt(tvlMatch[1], 10);
    bot.sendMessage(chatId, `✅ Min TVL set to $${filters.minTvl.toLocaleString()}`);
    return;
  }

  bot.sendMessage(chatId, '❓ Unknown filter. Try: /filter apy=5 | /filter tvl=5000000 | /filter stablecoins | /filter reset');
});

// ── Watchlist Commands ──────────────────────────────────────────────

bot.onText(/\/watch(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const arg = (match[1] || '').trim();

  // Show watchlist
  if (!arg || arg.toLowerCase() === ' list') {
    const items = wl.list(chatId);
    if (items.length === 0) {
      bot.sendMessage(chatId,
        '📋 *Your Watchlist*\n\nEmpty! Add protocols to track:\n' +
        '/watch add aave\n/watch add lido\n\n' +
        'You\'ll get alerts when APY changes >20% or TVL shifts >15%.',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    bot.sendMessage(chatId,
      `📋 *Your Watchlist* (${items.length})\n\n` +
      items.map(i => `  • ${i}`).join('\n') +
      '\n\n/remove <name> to stop tracking',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Add
  const addMatch = arg.match(/^add\s+(.+)/i);
  if (addMatch) {
    const name = addMatch[1].trim();
    const result = wl.add(chatId, name);
    if (result.added) {
      bot.sendMessage(chatId, `✅ Now watching *${name}*. You'll get alerts on significant changes.`, { parse_mode: 'Markdown' });
    } else if (result.alreadyExists) {
      bot.sendMessage(chatId, `ℹ️ Already watching *${name}*`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, '❓ Usage: /watch add <protocol name>');
    }
    return;
  }

  // Remove
  const removeMatch = arg.match(/^remove\s+(.+)/i);
  if (removeMatch) {
    const name = removeMatch[1].trim();
    if (wl.remove(chatId, name)) {
      bot.sendMessage(chatId, `✅ Removed *${name}* from watchlist`, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `ℹ️ *${name}* wasn't on your watchlist`, { parse_mode: 'Markdown' });
    }
    return;
  }

  bot.sendMessage(chatId,
    '❓ Usage:\n' +
    '/watch — Show watchlist\n' +
    '/watch add <name> — Track a protocol\n' +
    '/watch remove <name> — Stop tracking'
  );
});

// ── Background Alert Scanner ────────────────────────────────────────

let alertTimer = null;

async function runAlertScan() {
  try {
    // Check if anyone has watchlist items
    const watched = wl.allWatched();
    if (watched.length === 0) return;

    console.error(`[alerts] Scanning for ${watched.length} watched protocols...`);

    const result = await scanAndFormat(['scanner.js', 'defillama-scanner.js'], { minApy: 0, minTvl: 0, stablecoinsOnly: false });

    // Parse the raw JSONL by running scanners without formatter
    const [yields, protocols] = await Promise.all([
      runScanner('scanner.js').catch(() => ''),
      runScanner('defillama-scanner.js').catch(() => ''),
    ]);

    const allLines = `${yields}\n${protocols}`.split('\n').filter(Boolean);
    const items = allLines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // Check for alerts
    const alerts = wl.checkAlerts(items);

    // Snapshot current state for next comparison
    wl.snapshot(items);

    // Send alerts
    for (const { chatId, alert } of alerts) {
      try {
        await bot.sendMessage(chatId, wl.formatAlert(alert), { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`[alerts] Failed to send to ${chatId}: ${err.message}`);
      }
    }

    if (alerts.length > 0) {
      console.error(`[alerts] Sent ${alerts.length} alert(s)`);
    }
  } catch (err) {
    console.error(`[alerts] Scan failed: ${err.message}`);
  }
}

function startAlertScanner() {
  if (alertTimer) return;
  console.error(`[alerts] Background scanner started (every ${ALERT_INTERVAL_MS / 60000} min)`);
  alertTimer = setInterval(runAlertScan, ALERT_INTERVAL_MS);
  // Run once after 1 minute (give bot time to initialize)
  setTimeout(runAlertScan, 60000);
}

function stopAlertScanner() {
  if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
}

startAlertScanner();

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGINT', () => { stopAlertScanner(); bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { stopAlertScanner(); bot.stopPolling(); process.exit(0); });
