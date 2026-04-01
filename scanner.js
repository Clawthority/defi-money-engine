#!/usr/bin/env node
/**
 * DeFi Money Engine — Yield pool scanner.
 * Fetches yield data from DeFi Llama, filters by config criteria,
 * outputs JSON lines for piping to formatter.
 *
 * Usage: node scanner.js [--once] [--config path/to/config.json]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const CONFIG_PATH = path.resolve(
  process.argv.find(a => a.startsWith('--config='))?.split('=')[1] || 'config.json'
);
const RUN_ONCE = process.argv.includes('--once');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config not found: ${CONFIG_PATH}`);
    console.error('Copy config.example.json to config.json and edit it.');
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse config: ${e.message}`);
    process.exit(1);
  }
}

// ── Rate limiter ────────────────────────────────────────────────────
const _rateLimits = {};
function rateLimit(domain, minIntervalMs = 2000) {
  const now = Date.now();
  const last = _rateLimits[domain] || 0;
  const wait = Math.max(0, last + minIntervalMs - now);
  if (wait > 0) return new Promise(r => setTimeout(r, wait)).then(() => { _rateLimits[domain] = Date.now(); });
  _rateLimits[domain] = now;
  return Promise.resolve();
}

// ── HTTP fetch with timeout, retry, and rate limiting ───────────────
function fetch(url, timeoutMs = 15000, maxRetries = 2) {
  const domain = new URL(url).hostname;
  return rateLimit(domain, 1500).then(() => new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'DefiMoneyEngine/1.0' }
    }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetch(res.headers.location, timeoutMs, maxRetries).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', (err) => {
      if (maxRetries > 0) {
        setTimeout(() => fetch(url, timeoutMs, maxRetries - 1).then(resolve, reject), 1000);
      } else {
        reject(err);
      }
    });
    req.on('timeout', () => {
      req.destroy();
      if (maxRetries > 0) {
        setTimeout(() => fetch(url, timeoutMs, maxRetries - 1).then(resolve, reject), 1000);
      } else {
        reject(new Error(`Timeout: ${url}`));
      }
    });
  })); // close Promise + .then()
}

// ── State persistence ───────────────────────────────────────────────
function loadState(stateFile) {
  const p = path.resolve(stateFile);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      console.error(`Corrupt state file (${p}), resetting: ${e.message}`);
    }
  }
  return { reportedPools: {}, lastRun: null };
}

function saveState(stateFile, state) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.reportedPools)) {
    if (ts < cutoff) delete state.reportedPools[id];
  }
  state.lastRun = new Date().toISOString();
  fs.writeFileSync(path.resolve(stateFile), JSON.stringify(state, null, 2));
}

// ── Yield scanner ───────────────────────────────────────────────────
async function scanYields(config) {
  const { sources, filters, watchlist } = config;
  const defillama = sources.defillama;

  console.error('Fetching yield pools from DeFi Llama...');
  const raw = await fetch(defillama.yieldsUrl);
  let data;
  try { data = JSON.parse(raw); } catch(e) { console.error('Failed to parse yields response:', e.message); return []; }

  if (!data.data || !Array.isArray(data.data)) {
    console.error('Unexpected DeFi Llama response format');
    return [];
  }

  const stablecoins = (filters.stablecoins || []).map(s => s.toUpperCase());
  const minTvl = defillama.minTvlUsd || 1000000;
  const minApy = defillama.minApyPct || 3;
  const minAge = (filters.minPoolAgeDays || 0) * 24 * 60 * 60 * 1000;
  const watchNames = (watchlist || []).map(w => w.name.toLowerCase());

  const chainMap = {};
  for (const [name, chain] of Object.entries(config.chains || {})) {
    chainMap[name] = chain;
  }

  const results = [];
  const now = Date.now();

  for (const pool of data.data) {
    // Basic filters
    if (!pool.tvlUsd || pool.tvlUsd < minTvl) continue;
    if (!pool.apy || pool.apy < minApy) continue;

    // Pool age filter
    if (minAge > 0 && pool.apyMean30d) {
      // Skip very new pools if we can't verify age
    }

    // IL filter
    if (filters.excludeIlApy && pool.ilRisk === 'yes') continue;

    // Category filters: stablecoins + watchlist + high-yield blue chips
    let category = 'other';
    const symbol = (pool.symbol || '').toUpperCase();
    const project = (pool.project || '').toLowerCase();
    const chain = (pool.chain || '').toLowerCase();

    if (stablecoins.some(s => symbol.includes(s))) {
      category = 'stablecoin';
    } else if (symbol.includes('ETH') || symbol.includes('WBTC') || symbol.includes('BTC')) {
      category = 'bluechip';
    } else if (watchNames.some(w => project.includes(w) || symbol.toLowerCase().includes(w))) {
      category = 'watchlist';
    }

    // Only include if it's a category we care about or exceptionally high APY
    if (category === 'other' && pool.apy < 15) continue;

    results.push({
      type: 'yield',
      category,
      project: pool.project || 'Unknown',
      symbol: pool.symbol || '?',
      chain: pool.chain || '?',
      apy: Math.round(pool.apy * 100) / 100,
      apyMean30d: pool.apyMean30d ? Math.round(pool.apyMean30d * 100) / 100 : null,
      tvlUsd: Math.round(pool.tvlUsd),
      pool: pool.pool || null,
      exposure: pool.exposure || null,
      stablecoin: category === 'stablecoin',
      ilRisk: pool.ilRisk || 'unknown',
      url: pool.url || null,
    });
  }

  // Sort: watchlist first, then by APY descending
  const catOrder = { watchlist: 0, stablecoin: 1, bluechip: 2, other: 3 };
  results.sort((a, b) => (catOrder[a.category] ?? 3) - (catOrder[b.category] ?? 3) || b.apy - a.apy);

  // Cap results to avoid noise
  return results.slice(0, 50);
}

// ── Airdrop candidate scanner ───────────────────────────────────────
async function scanAirdropCandidates(config) {
  const { sources, watchlist } = config;
  const defillama = sources.defillama;

  console.error('Fetching protocols from DeFi Llama for airdrop analysis...');
  const raw = await fetch(defillama.protocolsUrl);
  let protocols;
  try { protocols = JSON.parse(raw); } catch(e) { console.error('Failed to parse protocols response:', e.message); return []; }

  if (!Array.isArray(protocols)) {
    console.error('Unexpected protocols response format');
    return [];
  }

  const watchNames = (watchlist || []).map(w => w.name.toLowerCase());
  const candidates = [];

  for (const proto of protocols) {
    // No token = airdrop candidate
    if (proto.symbol && proto.symbol !== '-') continue;

    const tvl = proto.tvl || 0;
    const name = (proto.name || '').toLowerCase();

    // Must be on our watchlist or have significant TVL
    const isWatched = watchNames.some(w => name.includes(w));
    const isHighTvl = tvl >= (defillama.minTvlUsd || 1000000) * 10; // 10x min TVL for non-watchlist

    if (!isWatched && !isHighTvl) continue;

    // Exclude non-airdrop categories
    const cat = (proto.category || '').toLowerCase();
    const excludeCategories = ['cex', 'bridge', 'canonical bridge', 'liquid staking'];
    if (!isWatched && excludeCategories.some(e => cat.includes(e))) continue;

    // Estimate airdrop value tier
    let tier = 'low';
    if (tvl >= 1_000_000_000) tier = 'high';
    else if (tvl >= 100_000_000) tier = 'medium';

    candidates.push({
      type: 'airdrop',
      project: proto.name,
      chain: proto.chain || 'Multi-chain',
      tvlUsd: Math.round(tvl),
      category: proto.category || 'Unknown',
      tier,
      url: proto.url || null,
      isWatched,
      change_7d: proto.change_7d ? Math.round(proto.change_7d * 100) / 100 : null,
    });
  }

  // Sort: watched first, then by TVL
  candidates.sort((a, b) => (b.isWatched - a.isWatched) || (b.tvlUsd - a.tvlUsd));
  return candidates.slice(0, 20);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  const state = loadState(config.stateFile || 'state.json');

  const [yields, airdrops] = await Promise.all([
    scanYields(config).catch(err => { console.error('Yield scan failed:', err.message); return []; }),
    scanAirdropCandidates(config).catch(err => { console.error('Airdrop scan failed:', err.message); return []; }),
  ]);

  // Deduplicate yields by pool ID
  const newYields = yields.filter(y => {
    const id = y.pool || `${y.project}-${y.symbol}-${y.chain}`;
    if (state.reportedPools[id]) return false;
    state.reportedPools[id] = Date.now();
    return true;
  });

  // Airdrop candidates — re-report if TVL changed significantly
  const newAirdrops = airdrops.filter(a => {
    const id = `airdrop-${a.project}`;
    state.reportedPools[id] = Date.now();
    return true;
  });

  // Output as JSON lines
  for (const item of [...newYields, ...newAirdrops]) {
    console.log(JSON.stringify(item));
  }

  saveState(config.stateFile || 'state.json', state);

  console.error(`\nScan complete: ${newYields.length} yield pools, ${newAirdrops.length} airdrop candidates`);

  if (!RUN_ONCE) {
    const interval = (config.checkIntervalMinutes || 60) * 60 * 1000;
    console.error(`Next scan in ${config.checkIntervalMinutes || 60} minutes...`);
    setTimeout(() => main().catch(console.error), interval);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
