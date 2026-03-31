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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN env var required');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('💰 DeFi Money Engine bot started');

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
    '/scan — Full scan (yields + protocols + airdrops)\n' +
    '/yields — Best yield pools (stablecoins & ETH)\n' +
    '/airdrops — Airdrop candidates (high TVL, no token)\n' +
    '/protocols — TVL anomalies, momentum, chain expansion\n' +
    '/filter — Set min APY, min TVL, stablecoins only\n' +
    '/help — Command reference\n\n' +
    '🆓 Free while in beta!',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '💰 *Commands*\n\n' +
    '/scan — Full scan of everything\n' +
    '/yields — Yield pools only\n' +
    '/airdrops — Airdrop candidates only\n' +
    '/protocols — Protocol intelligence\n' +
    '/filter apy=5 — Min APY filter\n' +
    '/filter stablecoins — Toggle stablecoins only\n' +
    '/filter tvl=5000000 — Min TVL filter\n' +
    '/filter reset — Clear all filters\n' +
    '/filter — Show current filters\n\n' +
    'Scans use DeFi Llama data. Results update on each scan.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/scan/, async (msg) => {
  const chatId = msg.chat.id;
  const statusMsg = await bot.sendMessage(chatId, '⏳ Running full scan...');
  try {
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
  const statusMsg = await bot.sendMessage(chatId, '⏳ Scanning yield pools...');
  try {
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

// ── Graceful shutdown ──────────────────────────────────────────────
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
