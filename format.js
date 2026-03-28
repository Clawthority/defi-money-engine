#!/usr/bin/env node
/**
 * DeFi Money Engine — Telegram formatter.
 * Reads JSON lines from stdin (scanner.js output) and formats for Telegram.
 *
 * Usage: node scanner.js --once | node format.js [--min-apy N] [--min-tvl N] [--stablecoins-only]
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

  // Apply filters
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
  const total = filteredYields.length + airdrops.length;
  if (total === 0) {
    return '✅ No new opportunities matching your filters. Try lowering min-apy or min-tvl.';
  }

  parts.push(`💰 **DeFi Money Engine** — ${total} opportunit${total > 1 ? 'ies' : 'y'} found\n`);

  // Airdrop candidates first (highest value)
  if (airdrops.length > 0) {
    parts.push('━━━ 🪂 **Airdrop Candidates** ━━━');
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
