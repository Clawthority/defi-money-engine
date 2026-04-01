#!/usr/bin/env node
/**
 * DeFi Money Engine — DefiLlama Protocol Scanner.
 * Detects TVL anomalies, cross-chain expansion, and airdrop candidates.
 *
 * Features:
 *   - TVL/mcap ratio anomaly detection (flags extreme mispricing)
 *   - New chain deployments without native tokens (airdrop candidates)
 *   - Cross-chain expansion tracking (protocols adding chains)
 *   - TVL momentum scanning (7d/30d changes with thresholds)
 *
 * Usage: node defillama-scanner.js [--once] [--config path/to/config.json] [--top=20]
 *
 * Output: JSON lines (one per finding) — pipe to format.js for Telegram output.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────
const CONFIG_PATH = path.resolve(
  process.argv.find(a => a.startsWith('--config='))?.split('=')[1] || 'config.json'
);
const RUN_ONCE = process.argv.includes('--once');
const TOP_N = parseInt(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || '20', 10);

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
    const mod = url.startsWith('https') ? https : require('http');
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
  }));
}

// ── State persistence ───────────────────────────────────────────────
function loadState(stateFile) {
  const p = path.resolve(stateFile);
  let state;
  if (fs.existsSync(p)) {
    try {
      state = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { state = null; }
  }
  if (!state) state = {};
  // Ensure nested objects exist
  if (!state.knownChains || typeof state.knownChains !== 'object') state.knownChains = {};
  if (!state.protocolSnapshots || typeof state.protocolSnapshots !== 'object') state.protocolSnapshots = {};
  return state;
}

function saveState(stateFile, state) {
  state.lastScan = new Date().toISOString();
  // Prune protocol snapshots older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, snap] of Object.entries(state.protocolSnapshots || {})) {
    if (snap.ts < cutoff) delete state.protocolSnapshots[key];
  }
  fs.writeFileSync(path.resolve(stateFile), JSON.stringify(state, null, 2));
}

// ── Helpers ─────────────────────────────────────────────────────────
function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function pct(n) {
  if (n === null || n === undefined) return 'n/a';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ── DefiLlama API Endpoints ─────────────────────────────────────────
const API = {
  protocols: 'https://api.llama.fi/protocols',
  chains: 'https://api.llama.fi/v2/chains',
  protocolTvl: (slug) => `https://api.llama.fi/protocol/${slug}`,
};

// ── Scan: TVL Anomalies ─────────────────────────────────────────────
async function scanTvlAnomalies(protocols, config) {
  const findings = [];
  const minTvl = (config.sources?.defillama?.minTvlUsd || 1_000_000) * 5; // 5x base threshold

  for (const proto of protocols) {
    if (!proto.tvl || proto.tvl < minTvl) continue;
    if (!proto.mcap || proto.mcap <= 0) continue;

    const ratio = proto.tvl / proto.mcap;

    // Flag extreme TVL/mcap ratios (TVL >> mcap = potential mispricing)
    // SSV Network at 440x is the reference extreme; flag anything >50x
    if (ratio > 50) {
      findings.push({
        type: 'tvl_anomaly',
        subtype: 'extreme_ratio',
        severity: ratio > 200 ? 'high' : ratio > 100 ? 'medium' : 'low',
        project: proto.name,
        symbol: proto.symbol || null,
        chain: proto.chain || 'Multi-chain',
        tvlUsd: Math.round(proto.tvl),
        mcapUsd: Math.round(proto.mcap),
        tvlMcapRatio: Math.round(ratio * 10) / 10,
        change_7d: proto.change_7d ? Math.round(proto.change_7d * 100) / 100 : null,
        category: proto.category || 'Unknown',
        url: proto.url || null,
        message: `${proto.name}: TVL/Mcap = ${ratio.toFixed(0)}x (${fmtUsd(proto.tvl)} TVL vs ${fmtUsd(proto.mcap)} mcap)`,
      });
    }

    // Flag protocols growing TVL while market cap declines (divergence signal)
    if (proto.change_7d && proto.change_7d > 5 && ratio > 10) {
      findings.push({
        type: 'tvl_anomaly',
        subtype: 'tvl_growing_mcap_compressed',
        severity: 'medium',
        project: proto.name,
        symbol: proto.symbol || null,
        chain: proto.chain || 'Multi-chain',
        tvlUsd: Math.round(proto.tvl),
        mcapUsd: Math.round(proto.mcap),
        tvlMcapRatio: Math.round(ratio * 10) / 10,
        change_7d: Math.round(proto.change_7d * 100) / 100,
        message: `${proto.name}: TVL +${proto.change_7d.toFixed(1)}% (7d) with ${ratio.toFixed(0)}x TVL/mcap — growing while compressed`,
      });
    }
  }

  // Sort by severity then ratio
  const sevOrder = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3) || b.tvlMcapRatio - a.tvlMcapRatio);
  return findings.slice(0, TOP_N);
}

// ── Scan: Chain Expansion (protocols deploying to new chains) ────────
async function scanChainExpansion(protocols, state, config) {
  const findings = [];
  const watchNames = (config.watchlist || []).map(w => w.name.toLowerCase());

  for (const proto of protocols) {
    if (!proto.tvl || proto.tvl < 10_000_000) continue; // $10M minimum
    const chains = proto.chains || [];
    if (chains.length < 2) continue;

    const isWatched = watchNames.some(w => (proto.name || '').toLowerCase().includes(w));
    const snapKey = `proto-${proto.name}`;

    // Compare with previous snapshot
    const prev = state.protocolSnapshots?.[snapKey];
    if (prev) {
      const newChains = chains.filter(c => !prev.chains.includes(c));
      if (newChains.length > 0) {
        findings.push({
          type: 'chain_expansion',
          subtype: 'new_deployments',
          severity: isWatched ? 'high' : 'medium',
          project: proto.name,
          tvlUsd: Math.round(proto.tvl),
          chainCount: chains.length,
          newChains,
          allChains: chains,
          isWatched,
          message: `${proto.name}: Deployed to ${newChains.join(', ')} (now on ${chains.length} chains, ${fmtUsd(proto.tvl)} TVL)`,
        });
      }
    }

    // Update snapshot
    state.protocolSnapshots[snapKey] = {
      chains: [...chains],
      tvl: proto.tvl,
      ts: Date.now(),
    };
  }

  findings.sort((a, b) => (b.isWatched ? 1 : 0) - (a.isWatched ? 1 : 0) || b.tvlUsd - a.tvlUsd);
  return findings.slice(0, TOP_N);
}

// ── Scan: Chains Without Native Tokens ──────────────────────────────
async function scanTokenlessChains(chains, protocols, state) {
  const findings = [];

  // Known major chains with native tokens (exclude from analysis)
  const hasToken = new Set([
    'Ethereum', 'BSC', 'Avalanche', 'Polygon', 'Solana', 'Arbitrum', 'Optimism',
    'Base', 'Tron', 'Cardano', 'Polkadot', 'Cosmos', 'Near', 'Fantom',
    'Cronos', 'Klaytn', 'Harmony', 'Gnosis', 'Celo', 'Moonbeam', 'Astar',
    'Blast', 'Mantle', 'zkSync', 'Starknet', 'Scroll', 'Linea', 'Metis',
    'Kava', 'Aurora', 'Canto', 'Osmosis', 'Injective', 'Sei', 'Sui',
    'Aptos', 'TON', 'Hedera', 'IOTA', 'VeChain', 'Algorand', 'Stacks',
    'Filecoin', 'ICP', 'THORChain', 'Kujira', 'Dydx', 'Osmosis',
    'Immutable X', 'Ronin', 'Flow', 'Wax', 'Hive', 'EOS', 'Telos',
    'Waves', 'Syscoin', 'Rootstock', 'KCC', 'Evmos', 'Kava EVM',
    'Sonic', 'Corn', 'Abstract', 'ApeChain', 'Fraxtal', 'Worldchain',
    'X Layer', 'Zora', 'Manta', 'Mode', 'RSS3', 'Degen', 'B3',
  ]);

  // Chains with high TVL but no recognized native token → potential airdrop targets
  for (const chain of (chains || [])) {
    const name = chain.name;
    if (hasToken.has(name)) continue;
    if (!chain.tvl || chain.tvl < 50_000_000) continue; // $50M minimum TVL

    // Count protocols on this chain
    const chainProtos = (protocols || []).filter(p =>
      (p.chains || []).includes(name) && p.tvl > 1_000_000
    ).length;

    // Check if this is a known airdrop candidate (already tracked)
    const known = state.knownChains?.[name] || null;

    findings.push({
      type: 'chain_airdrop',
      subtype: known ? 'tracking_update' : 'new_candidate',
      severity: chain.tvl > 1_000_000_000 ? 'high' : chain.tvl > 200_000_000 ? 'medium' : 'low',
      chain: name,
      tvlUsd: Math.round(chain.tvl),
      protocolCount: chainProtos,
      tokenSymbol: chain.tokenSymbol || null,
      geckoId: chain.gecko_id || null,
      isKnown: !!known,
      message: `${name}: ${fmtUsd(chain.tvl)} TVL, ${chainProtos} protocols, ${chain.tokenSymbol ? `token: ${chain.tokenSymbol}` : 'NO NATIVE TOKEN'}`,
    });

    state.knownChains[name] = { tvl: chain.tvl, lastSeen: Date.now() };
  }

  const sevOrder = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3) || b.tvlUsd - a.tvlUsd);
  return findings.slice(0, TOP_N);
}

// ── Scan: TVL Momentum ──────────────────────────────────────────────
async function scanTvlMomentum(protocols, config) {
  const findings = [];
  const minTvl = config.sources?.defillama?.minTvlUsd || 1_000_000;
  const watchNames = (config.watchlist || []).map(w => w.name.toLowerCase());

  for (const proto of protocols) {
    if (!proto.tvl || proto.tvl < minTvl * 10) continue; // $10M+ only for momentum

    const change7d = proto.change_7d;
    const change1m = proto.change_1m;
    const change1y = proto.change_1y;
    const isWatched = watchNames.some(w => (proto.name || '').toLowerCase().includes(w));

    // Rapid growth: >20% in 7d
    if (change7d && change7d > 20) {
      findings.push({
        type: 'momentum',
        subtype: 'rapid_growth_7d',
        severity: change7d > 50 ? 'high' : 'medium',
        project: proto.name,
        chain: proto.chain || 'Multi-chain',
        tvlUsd: Math.round(proto.tvl),
        change_7d: Math.round(change7d * 100) / 100,
        change_1m: change1m ? Math.round(change1m * 100) / 100 : null,
        isWatched,
        message: `${proto.name}: TVL +${change7d.toFixed(1)}% (7d) → ${fmtUsd(proto.tvl)}`,
      });
    }

    // Rapid decline: >-20% in 7d (risk signal)
    if (change7d && change7d < -20) {
      findings.push({
        type: 'momentum',
        subtype: 'rapid_decline_7d',
        severity: change7d < -40 ? 'high' : 'medium',
        project: proto.name,
        chain: proto.chain || 'Multi-chain',
        tvlUsd: Math.round(proto.tvl),
        change_7d: Math.round(change7d * 100) / 100,
        change_1m: change1m ? Math.round(change1m * 100) / 100 : null,
        isWatched,
        message: `${proto.name}: TVL ${change7d.toFixed(1)}% (7d) → ${fmtUsd(proto.tvl)} — outflow risk`,
      });
    }

    // Sustained growth: positive 7d + 1m + 1y
    if (change7d > 0 && change1m > 10 && change1y > 50) {
      findings.push({
        type: 'momentum',
        subtype: 'sustained_growth',
        severity: 'low',
        project: proto.name,
        chain: proto.chain || 'Multi-chain',
        tvlUsd: Math.round(proto.tvl),
        change_7d: Math.round(change7d * 100) / 100,
        change_1m: change1m ? Math.round(change1m * 100) / 100 : null,
        change_1y: change1y ? Math.round(change1y * 100) / 100 : null,
        isWatched,
        message: `${proto.name}: Sustained growth — 7d ${pct(change7d)}, 1m ${pct(change1m)}, 1y ${pct(change1y)} → ${fmtUsd(proto.tvl)}`,
      });
    }
  }

  findings.sort((a, b) => (b.isWatched ? 1 : 0) - (a.isWatched ? 1 : 0) || (b.change_7d || 0) - (a.change_7d || 0));
  return findings.slice(0, TOP_N);
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const config = loadConfig();
  const state = loadState(config.stateFile || 'state.json');

  console.error('DefiLlama Protocol Scanner — fetching data...');

  // Fetch all data in parallel
  let protocols, chains;
  try {
    const [protoRaw, chainsRaw] = await Promise.all([
      fetch(API.protocols),
      fetch(API.chains),
    ]);
    protocols = JSON.parse(protoRaw);
    chains = JSON.parse(chainsRaw);
  } catch (err) {
    console.error('Failed to fetch DefiLlama data:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(protocols)) {
    console.error('Unexpected protocols response format');
    process.exit(1);
  }

  console.error(`Loaded ${protocols.length} protocols, ${Array.isArray(chains) ? chains.length : '?'} chains`);

  // Run all scans in parallel
  const [anomalies, expansions, tokenlessChains, momentum] = await Promise.all([
    scanTvlAnomalies(protocols, config).catch(err => { console.error('Anomaly scan failed:', err.message); return []; }),
    scanChainExpansion(protocols, state, config).catch(err => { console.error('Expansion scan failed:', err.message); return []; }),
    scanTokenlessChains(chains, protocols, state).catch(err => { console.error('Tokenless chain scan failed:', err.message); return []; }),
    scanTvlMomentum(protocols, config).catch(err => { console.error('Momentum scan failed:', err.message); return []; }),
  ]);

  // Combine and output
  const allFindings = [...anomalies, ...expansions, ...tokenlessChains, ...momentum];

  for (const finding of allFindings) {
    console.log(JSON.stringify(finding));
  }

  saveState(config.stateFile || 'state.json', state);

  console.error(`\nScan complete: ${anomalies.length} anomalies, ${expansions.length} expansions, ${tokenlessChains.length} tokenless chains, ${momentum.length} momentum signals`);
  console.error(`Total findings: ${allFindings.length}`);

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
