#!/usr/bin/env node
/**
 * DeFi Money Engine — Watchlist & Alert System.
 * Tracks user watchlists and detects significant changes for alerting.
 *
 * Storage: watchlist.json (per-project, multi-user)
 *
 * Usage:
 *   const wl = require('./watchlist');
 *   wl.add(chatId, 'aave');
 *   const items = wl.list(chatId);
 *   const alerts = wl.check(scanResults);  // returns alerts for changed items
 */

const fs = require('fs');
const path = require('path');

const WATCHLIST_FILE = path.join(__dirname, 'watchlist.json');

// ── Persistence ─────────────────────────────────────────────────────

function load() {
  if (fs.existsSync(WATCHLIST_FILE)) {
    try { return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8')); } catch { /* ignore */ }
  }
  return { users: {}, snapshots: {} };
}

function save(data) {
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(data, null, 2));
}

// ── User Watchlist CRUD ─────────────────────────────────────────────

/**
 * Add a protocol/project to a user's watchlist.
 * @param {string|number} chatId
 * @param {string} name - Protocol name (case-insensitive)
 * @returns {{added: boolean, alreadyExists: boolean}}
 */
function add(chatId, name) {
  const data = load();
  const key = String(chatId);
  const norm = name.toLowerCase().trim();
  if (!norm) return { added: false, alreadyExists: false };

  if (!data.users[key]) data.users[key] = [];
  if (data.users[key].includes(norm)) return { added: false, alreadyExists: true };

  data.users[key].push(norm);
  save(data);
  return { added: true, alreadyExists: false };
}

/**
 * Remove a protocol from a user's watchlist.
 * @param {string|number} chatId
 * @param {string} name
 * @returns {boolean} Whether it was removed
 */
function remove(chatId, name) {
  const data = load();
  const key = String(chatId);
  const norm = name.toLowerCase().trim();
  if (!data.users[key]) return false;

  const idx = data.users[key].indexOf(norm);
  if (idx === -1) return false;

  data.users[key].splice(idx, 1);
  save(data);
  return true;
}

/**
 * Get a user's watchlist.
 * @param {string|number} chatId
 * @returns {string[]}
 */
function list(chatId) {
  const data = load();
  return data.users[String(chatId)] || [];
}

/**
 * Get all watched protocol names across all users (for scanner dedup).
 * @returns {string[]}
 */
function allWatched() {
  const data = load();
  const set = new Set();
  for (const items of Object.values(data.users)) {
    for (const item of items) set.add(item);
  }
  return [...set];
}

/**
 * Get all chatIds watching a specific protocol.
 * @param {string} name
 * @returns {string[]}
 */
function watchers(name) {
  const data = load();
  const norm = name.toLowerCase().trim();
  const ids = [];
  for (const [chatId, items] of Object.entries(data.users)) {
    if (items.includes(norm)) ids.push(chatId);
  }
  return ids;
}

// ── Alert Detection ─────────────────────────────────────────────────

/**
 * Snapshot thresholds for triggering alerts.
 */
const ALERT_THRESHOLDS = {
  apyChangePct: 20,       // APY changed by >20%
  tvlChangePct: 15,       // TVL changed by >15%
  newAirdrop: true,       // New airdrop candidate for watched protocol
  newAnomaly: true,       // New TVL anomaly for watched protocol
};

/**
 * Store a scan snapshot for change detection.
 * @param {object[]} items - Scan results (yields, airdrops, anomalies, etc.)
 */
function snapshot(items) {
  const data = load();
  const now = Date.now();

  for (const item of items) {
    const key = item.project ? item.project.toLowerCase() : null;
    if (!key) continue;

    if (!data.snapshots[key]) data.snapshots[key] = {};
    const snap = data.snapshots[key];

    if (item.type === 'yield') {
      snap.lastApy = item.apy;
      snap.lastTvl = item.tvlUsd;
      snap.lastYieldScan = now;
    } else if (item.type === 'airdrop') {
      snap.lastTvl = item.tvlUsd;
      snap.lastAirdropScan = now;
    } else if (item.type === 'tvl_anomaly') {
      snap.lastAnomaly = now;
    } else if (item.type === 'momentum') {
      snap.lastTvl = item.tvlUsd;
      snap.lastMomentum = item.change_7d;
      snap.lastMomentumScan = now;
    }
  }

  save(data);
}

/**
 * Check scan results against snapshots and return alerts for watched protocols.
 * @param {object[]} items - Current scan results
 * @returns {{chatId: string, alert: object}[]} Alerts to send
 */
function checkAlerts(items) {
  const data = load();
  const alerts = [];

  for (const item of items) {
    const key = item.project ? item.project.toLowerCase() : null;
    if (!key) continue;

    // Find who's watching this
    const chatIds = [];
    for (const [cid, watched] of Object.entries(data.users)) {
      if (watched.some(w => key.includes(w) || w.includes(key))) {
        chatIds.push(cid);
      }
    }
    if (chatIds.length === 0) continue;

    const snap = data.snapshots[key] || {};
    const alertParts = [];

    if (item.type === 'yield') {
      // APY change
      if (snap.lastApy != null) {
        const changePct = Math.abs((item.apy - snap.lastApy) / snap.lastApy * 100);
        if (changePct >= ALERT_THRESHOLDS.apyChangePct) {
          const dir = item.apy > snap.lastApy ? '📈 up' : '📉 down';
          alertParts.push(`APY ${dir}: ${snap.lastApy}% → ${item.apy}%`);
        }
      }
      // TVL change
      if (snap.lastTvl != null && snap.lastTvl > 0) {
        const changePct = Math.abs((item.tvlUsd - snap.lastTvl) / snap.lastTvl * 100);
        if (changePct >= ALERT_THRESHOLDS.tvlChangePct) {
          const dir = item.tvlUsd > snap.lastTvl ? '📈' : '📉';
          const fmt = n => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${n}`;
          alertParts.push(`TVL ${dir}: ${fmt(snap.lastTvl)} → ${fmt(item.tvlUsd)}`);
        }
      }
    }

    if (item.type === 'airdrop' && !snap.lastAirdropScan) {
      alertParts.push('🪂 New airdrop candidate detected!');
    }

    if (item.type === 'tvl_anomaly' && !snap.lastAnomaly) {
      alertParts.push('🚨 New TVL anomaly detected!');
    }

    if (alertParts.length > 0) {
      for (const cid of chatIds) {
        alerts.push({
          chatId: cid,
          alert: {
            project: item.project,
            type: item.type,
            parts: alertParts,
            item,
          },
        });
      }
    }
  }

  return alerts;
}

/**
 * Format an alert into a Telegram message.
 * @param {{project: string, type: string, parts: string[], item: object}} alert
 * @returns {string}
 */
function formatAlert(alert) {
  const fmt = n => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : `$${n}`;

  let msg = `🔔 *Watchlist Alert: ${alert.project}*\n\n`;
  msg += alert.parts.map(p => `  • ${p}`).join('\n');

  if (alert.item.type === 'yield') {
    msg += `\n\n  📊 APY: ${alert.item.apy}% | TVL: ${fmt(alert.item.tvlUsd)}`;
    msg += `\n  ⛓️ ${alert.item.chain}`;
  } else if (alert.item.type === 'airdrop') {
    msg += `\n\n  💰 TVL: ${fmt(alert.item.tvlUsd)} | Tier: ${alert.item.tier}`;
  } else if (alert.item.type === 'tvl_anomaly') {
    msg += `\n\n  📊 TVL/Mcap: ${alert.item.tvlMcapRatio}x`;
    msg += `\n  💰 TVL: ${fmt(alert.item.tvlUsd)}`;
  } else if (alert.item.type === 'momentum') {
    msg += `\n\n  📊 7d: ${alert.item.change_7d > 0 ? '+' : ''}${alert.item.change_7d}%`;
    msg += `\n  💰 TVL: ${fmt(alert.item.tvlUsd)}`;
  }

  return msg;
}

// ── Alert Digest ─────────────────────────────────────────────────────

/**
 * Record an alert to the digest history for a user.
 * @param {string} chatId
 * @param {{project: string, type: string, parts: string[], item: object}} alert
 */
function recordAlert(chatId, alert) {
  const data = load();
  if (!data.digests) data.digests = {};
  if (!data.digests[chatId]) data.digests[chatId] = [];

  data.digests[chatId].push({
    ...alert,
    timestamp: new Date().toISOString(),
  });

  // Keep last 50 alerts per user
  if (data.digests[chatId].length > 50) {
    data.digests[chatId] = data.digests[chatId].slice(-50);
  }

  save(data);
}

/**
 * Get all pending (unread) alerts for a user as a digest message.
 * @param {string} chatId
 * @returns {{alerts: object[], message: string, count: number}}
 */
function getDigest(chatId) {
  const data = load();
  const alerts = (data.digests && data.digests[chatId]) || [];

  if (alerts.length === 0) {
    return { alerts: [], message: '📭 No pending alerts. Your watchlist is quiet!', count: 0 };
  }

  let msg = `📬 *Alert Digest* (${alerts.length} alert${alerts.length > 1 ? 's' : ''})\n\n`;

  // Group by project
  const byProject = {};
  for (const a of alerts) {
    const proj = a.project || 'unknown';
    if (!byProject[proj]) byProject[proj] = [];
    byProject[proj].push(a);
  }

  for (const [project, projectAlerts] of Object.entries(byProject)) {
    msg += `*${project}*\n`;
    for (const a of projectAlerts) {
      for (const part of a.parts) {
        msg += `  • ${part}\n`;
      }
    }
    msg += '\n';
  }

  msg += 'Use `/digest clear` to mark as read.';

  return { alerts, message: msg, count: alerts.length };
}

/**
 * Clear digest history for a user.
 * @param {string} chatId
 * @returns {number} Number of cleared alerts
 */
function clearDigest(chatId) {
  const data = load();
  if (!data.digests || !data.digests[chatId]) return 0;

  const count = data.digests[chatId].length;
  data.digests[chatId] = [];
  save(data);
  return count;
}

module.exports = {
  add, remove, list, allWatched, watchers,
  snapshot, checkAlerts, formatAlert,
  recordAlert, getDigest, clearDigest,
  ALERT_THRESHOLDS,
};
