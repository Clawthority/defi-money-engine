#!/usr/bin/env node
/**
 * DeFi Money Engine — Telegram formatter.
 * Reads JSON lines from stdin (scanner.js or defillama-scanner.js output) and formats for Telegram.
 *
 * Supports findings from:
 *   - scanner.js: yield pools + airdrop candidates
 *   - defillama-scanner.js: TVL anomalies, chain expansion, tokenless chains, momentum signals
 *
 * Usage:
 *   node scanner.js --once | node format.js [--min-apy N] [--min-tvl N] [--stablecoins-only]
 *   node defillama-scanner.js --once | node format.js
 *   node scanner.js --once | node defillama-scanner.js --once | node format.js
 */

const MIN_APY = parseFloat(process.argv.find(a => a.startsWith('--min-apy='))?.split('=')[1] || '0');
const MIN_TVL = parseFloat(process.argv.find(a => a.startsWith('--min-tvl='))?.split('=')[1] || '0');
const STABLECOINS_ONLY = process.argv.includes('--stablecoins-only');

function esc(text) {
  return (text || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function fmtUsd(n) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function apyBadge(apy) {
  if (apy >= 20) return '🔥';
  if (apy >= 10) return '📈';
  if (apy >= 5) return '💹';
  return '📊';
}

function tierBadge(tier) {
  if (tier === 'high') return '💎';
  if (tier === 'medium') return '🪂';
  return '🧪';
}

function formatYield(item) {
  const badge = apyBadge(item.apy);
  const catLabel = item.category === 'watchlist' ? ' ⭐' : '';
  const stableLabel = item.stablecoin ? ' 🏦' : '';
  const changeLabel = item.apyMean30d
    ? ` (30d avg: ${item.apyMean30d}%)`
    : '';

  let lines = [
    `${badge} **${esc(item.project)}** — ${esc(item.symbol)}${catLabel}${stableLabel}`,
    `  📊 APY: ${item.apy}%${changeLabel} | TVL: ${fmtUsd(item.tvlUsd)}`,
    `  ⛓️ ${esc(item.chain)} | Risk: ${item.ilRisk}`,
  ];

  if (item.url) {
    lines.push(`  🔗 [View Pool](${item.url})`);
  }

  return lines.join('\n');
}

function formatAirdrop(item) {
  const badge = tierBadge(item.tier);
  const watchedLabel = item.isWatched ? ' ⭐' : '';
  const tvlChange = item.change_7d
    ? ` (${item.change_7d > 0 ? '+' : ''}${item.change_7d}% 7d)`
    : '';

  const estReward = item.tier === 'high' ? '$500-$10,000+'
    : item.tier === 'medium' ? '$100-$5,000'
    : '$50-$1,000';

  let lines = [
    `${badge} **${esc(item.project)}**${watchedLabel}`,
    `  💰 TVL: ${fmtUsd(item.tvlUsd)}${tvlChange} — no token`,
    `  ⛓️ ${esc(item.chain)} | ${esc(item.category)}`,
    `  🎯 Est: ${estReward}`,
  ];

  if (item.url) {
    lines.push(`  🔗 [Protocol](${item.url})`);
  }

  return lines.join('\n');
}

function formatReport(items) {
  const yields = items.filter(i => i.type === 'yield');
  const airdrops = items.filter(i => i.type === 'airdrop');
  const anomalies = items.filter(i => i.type === 'tvl_anomaly');
  const expansions = items.filter(i => i.type === 'chain_expansion');
  const chainAirdrops = items.filter(i => i.type === 'chain_airdrop');
  const momentum = items.filter(i => i.type === 'momentum');

  // Apply filters to yields only
  let filteredYields = yields.filter(y => y.apy >= MIN_APY && y.tvlUsd >= MIN_TVL);
  if (STABLECOINS_ONLY) {
    filteredYields = filteredYields.filter(y => y.stablecoin);
  }

  // Group yields by category
  const watchlist = filteredYields.filter(y => y.category === 'watchlist');
  const stablecoins = filteredYields.filter(y => y.category === 'stablecoin' && y.category !== 'watchlist');
  const bluechips = filteredYields.filter(y => y.category === 'bluechip');
  const highYield = filteredYields.filter(y => y.category === 'other');

  const parts = [];

  // Header
  const total = filteredYields.length + airdrops.length + anomalies.length + expansions.length + chainAirdrops.length + momentum.length;
  if (total === 0) {
    return '✅ No new opportunities matching your filters. Try lowering min-apy or min-tvl.';
  }

  parts.push(`💰 **DeFi Money Engine** — ${total} finding${total > 1 ? 's' : ''} found\n`);

  // ── Protocol Scanner Findings ──

  // TVL Anomalies (highest signal — mispricing alerts)
  if (anomalies.length > 0) {
    parts.push('━━━ 🚨 **TVL Anomalies** ━━━');
    parts.push(anomalies.map(formatAnomaly).join('\n\n'));
  }

  // Chain Airdrop Candidates
  if (chainAirdrops.length > 0) {
    parts.push('━━━ ⛓️ **Chain Airdrop Candidates** ━━━');
    parts.push(chainAirdrops.map(formatChainAirdrop).join('\n\n'));
  }

  // Momentum Signals
  if (momentum.length > 0) {
    const growth = momentum.filter(m => m.subtype !== 'rapid_decline_7d');
    const decline = momentum.filter(m => m.subtype === 'rapid_decline_7d');
    if (growth.length > 0) {
      parts.push('━━━ 📈 **TVL Momentum — Growth** ━━━');
      parts.push(growth.slice(0, 8).map(formatMomentum).join('\n\n'));
    }
    if (decline.length > 0) {
      parts.push('━━━ 📉 **TVL Momentum — Outflow Risk** ━━━');
      parts.push(decline.slice(0, 5).map(formatMomentum).join('\n\n'));
    }
  }

  // Chain Expansion
  if (expansions.length > 0) {
    parts.push('━━━ 🌐 **Chain Expansion** ━━━');
    parts.push(expansions.map(formatExpansion).join('\n\n'));
  }

  // ── Yield & Airdrop Findings (from scanner.js) ──

  // Airdrop candidates (from yield scanner)
  if (airdrops.length > 0) {
    parts.push('━━━ 🪂 **Yield Scanner Airdrop Candidates** ━━━');
    parts.push(airdrops.map(formatAirdrop).join('\n\n'));
  }

  // Watchlist yields
  if (watchlist.length > 0) {
    parts.push('━━━ ⭐ **Watchlist Pools** ━━━');
    parts.push(watchlist.map(formatYield).join('\n\n'));
  }

  // Stablecoin yields
  if (stablecoins.length > 0) {
    parts.push('━━━ 🏦 **Stablecoin Yields** ━━━');
    parts.push(stablecoins.map(formatYield).join('\n\n'));
  }

  // Blue chip yields
  if (bluechips.length > 0) {
    parts.push('━━━ 🔵 **Blue Chip Yields** ━━━');
    parts.push(bluechips.map(formatYield).join('\n\n'));
  }

  // High yield (degen)
  if (highYield.length > 0) {
    parts.push('━━━ 🔥 **High Yield** ━━━');
    parts.push(highYield.slice(0, 10).map(formatYield).join('\n\n'));
  }

  return parts.join('\n\n');
}

// ── Protocol Scanner Formatters ─────────────────────────────────────

/** Severity badge for protocol scanner findings. */
function sevBadge(severity) {
  if (severity === 'high') return '🔴';
  if (severity === 'medium') return '🟡';
  return '🟢';
}

/**
 * Format a TVL anomaly finding (extreme TVL/mcap ratio or divergence signal).
 * @param {{project:string, symbol:string|null, severity:string, tvlMcapRatio:number, change_7d:number|null, tvlUsd:number, mcapUsd:number, category:string, chain:string}} item
 */
function formatAnomaly(item) {
  const badge = sevBadge(item.severity);
  const ratio = item.tvlMcapRatio;
  const ratioLabel = ratio > 100 ? `${ratio}x ⚡` : `${ratio}x`;
  const changeLabel = item.change_7d !== null ? ` | 7d: ${item.change_7d > 0 ? '+' : ''}${item.change_7d}%` : '';

  let lines = [
    `${badge} **${esc(item.project)}**${item.symbol ? ` ($${esc(item.symbol)})` : ''}`,
    `  📊 TVL/Mcap: ${ratioLabel}${changeLabel}`,
    `  💰 TVL: ${fmtUsd(item.tvlUsd)} | MCap: ${fmtUsd(item.mcapUsd)}`,
    `  🏷️ ${esc(item.category)} | ${esc(item.chain)}`,
  ];

  if (ratio > 200) {
    lines.push(`  ⚠️ Extreme ratio — investigate for mispricing or TVL counting nuance`);
  }

  return lines.join('\n');
}

/**
 * Format a chain airdrop candidate (high TVL chain without native token).
 * @param {{chain:string, subtype:string, severity:string, tvlUsd:number, protocolCount:number, tokenSymbol:string|null}} item
 */
function formatChainAirdrop(item) {
  const badge = sevBadge(item.severity);
  const newBadge = item.subtype === 'new_candidate' ? ' 🆕' : '';

  let lines = [
    `${badge} **${esc(item.chain)}**${newBadge}`,
    `  💰 TVL: ${fmtUsd(item.tvlUsd)} | ${item.protocolCount} protocols`,
    `  ${item.tokenSymbol ? `Token: ${esc(item.tokenSymbol)}` : '🪂 NO NATIVE TOKEN — airdrop candidate'}`,
  ];

  return lines.join('\n');
}

/**
 * Format a TVL momentum finding (rapid growth, decline, or sustained trend).
 * @param {{project:string, subtype:string, change_7d:number, change_1m:number|null, change_1y:number|null, tvlUsd:number, chain:string, isWatched:boolean}} item
 */
function formatMomentum(item) {
  const badge = item.subtype === 'rapid_decline_7d' ? '🔻'
    : item.subtype === 'rapid_growth_7d' ? '🚀'
    : '📊';
  const watchedLabel = item.isWatched ? ' ⭐' : '';
  const change1m = item.change_1m !== null ? ` | 1m: ${item.change_1m > 0 ? '+' : ''}${item.change_1m}%` : '';
  const change1y = item.change_1y !== null ? ` | 1y: ${item.change_1y > 0 ? '+' : ''}${item.change_1y}%` : '';

  let lines = [
    `${badge} **${esc(item.project)}**${watchedLabel}`,
    `  📊 7d: ${item.change_7d > 0 ? '+' : ''}${item.change_7d}%${change1m}${change1y}`,
    `  💰 TVL: ${fmtUsd(item.tvlUsd)} | ${esc(item.chain)}`,
  ];

  return lines.join('\n');
}

/**
 * Format a chain expansion finding (protocol deploying to new chains).
 * @param {{project:string, newChains:string[], chainCount:number, tvlUsd:number, isWatched:boolean}} item
 */
function formatExpansion(item) {
  const watchedLabel = item.isWatched ? ' ⭐' : '';
  const newChains = item.newChains.join(', ');

  let lines = [
    `🌐 **${esc(item.project)}**${watchedLabel}`,
    `  🆕 Now on: ${esc(newChains)}`,
    `  ⛓️ ${item.chainCount} chains total | TVL: ${fmtUsd(item.tvlUsd)}`,
  ];

  return lines.join('\n');
}

// ── Main: read JSON lines from stdin ────────────────────────────────
let buffer = '';
const items = [];

process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {}
  }
});

process.stdin.on('end', () => {
  if (buffer.trim()) {
    try { items.push(JSON.parse(buffer.trim())); } catch {}
  }
  console.log(formatReport(items));
});
