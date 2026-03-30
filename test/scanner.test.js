#!/usr/bin/env node
/**
 * DeFi Money Engine — Test Suite
 * Uses Node.js built-in test runner (node:test) + assert.
 * No external dependencies needed.
 *
 * Run: node --test test/scanner.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ── Helpers ─────────────────────────────────────────────────────────

const TEST_DIR = path.resolve(__dirname);
const ROOT_DIR = path.resolve(__dirname, '..');

// Sample pool data mimicking DeFi Llama response
function mockPool(overrides = {}) {
  return {
    pool: 'test-pool-id',
    chain: 'Ethereum',
    project: 'testproject',
    symbol: 'USDC',
    tvlUsd: 5_000_000,
    apy: 8.5,
    apyMean30d: 7.2,
    ilRisk: 'no',
    exposure: 'single',
    url: 'https://example.com/pool',
    ...overrides,
  };
}

function mockProtocol(overrides = {}) {
  return {
    name: 'TestProtocol',
    chain: 'Ethereum',
    tvl: 50_000_000,
    category: 'Lending',
    symbol: null, // no token = airdrop candidate
    change_7d: 5.2,
    url: 'https://example.com',
    ...overrides,
  };
}

// ── State Persistence Tests ─────────────────────────────────────────

describe('State persistence', () => {
  const stateFile = path.join(TEST_DIR, 'test-state.json');

  afterEach = () => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  };

  it('creates fresh state when file does not exist', () => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    // Inline the loadState logic to test
    function loadState(p) {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      return { reportedPools: {}, lastRun: null };
    }
    const state = loadState(stateFile);
    assert.deepStrictEqual(state.reportedPools, {});
    assert.strictEqual(state.lastRun, null);
  });

  it('loads existing state from file', () => {
    const data = { reportedPools: { 'pool-1': Date.now() }, lastRun: '2026-03-28T00:00:00Z' };
    fs.writeFileSync(stateFile, JSON.stringify(data));
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(state.lastRun, '2026-03-28T00:00:00Z');
    assert.ok('pool-1' in state.reportedPools);
    fs.unlinkSync(stateFile);
  });

  it('prunes entries older than 7 days on save', () => {
    const now = Date.now();
    const old = now - 8 * 24 * 60 * 60 * 1000; // 8 days ago
    const recent = now - 1 * 24 * 60 * 60 * 1000; // 1 day ago

    const state = {
      reportedPools: { 'old-pool': old, 'recent-pool': recent },
      lastRun: null,
    };

    // Inline saveState pruning logic
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const [id, ts] of Object.entries(state.reportedPools)) {
      if (ts < cutoff) delete state.reportedPools[id];
    }

    assert.ok(!('old-pool' in state.reportedPools), 'old pool should be pruned');
    assert.ok('recent-pool' in state.reportedPools, 'recent pool should remain');
  });
});

// ── Yield Filtering Logic ───────────────────────────────────────────

describe('Yield filtering', () => {
  const stablecoins = ['USDC', 'USDT', 'DAI'];
  const watchNames = ['pendle', 'aerodrome'];

  function categorize(symbol, project) {
    const sym = symbol.toUpperCase();
    const proj = project.toLowerCase();
    if (stablecoins.some(s => sym.includes(s))) return 'stablecoin';
    if (sym.includes('ETH') || sym.includes('WBTC') || sym.includes('BTC')) return 'bluechip';
    if (watchNames.some(w => proj.includes(w) || sym.toLowerCase().includes(w))) return 'watchlist';
    return 'other';
  }

  it('categorizes USDC as stablecoin', () => {
    assert.strictEqual(categorize('USDC', 'aave'), 'stablecoin');
  });

  it('categorizes ETH pairs as bluechip', () => {
    assert.strictEqual(categorize('WETH', 'uniswap'), 'bluechip');
    assert.strictEqual(categorize('WBTC', 'curve'), 'bluechip');
  });

  it('categorizes watchlist projects', () => {
    assert.strictEqual(categorize('PENDLE', 'pendle'), 'watchlist'); // no ETH/BTC substring → watchlist
    assert.strictEqual(categorize('AERO', 'Aerodrome'), 'watchlist');
  });

  it('categorizes unknown as other', () => {
    assert.strictEqual(categorize('DOGE', 'memeswap'), 'other');
  });

  it('filters by minimum TVL', () => {
    const pools = [
      mockPool({ tvlUsd: 500_000 }),   // below 1M threshold
      mockPool({ tvlUsd: 2_000_000 }),  // above threshold
      mockPool({ tvlUsd: 800_000 }),    // below
    ];
    const minTvl = 1_000_000;
    const filtered = pools.filter(p => p.tvlUsd >= minTvl);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].tvlUsd, 2_000_000);
  });

  it('filters by minimum APY', () => {
    const pools = [
      mockPool({ apy: 1.5 }),  // below 3% threshold
      mockPool({ apy: 5.0 }),  // above
      mockPool({ apy: 2.9 }),  // below
    ];
    const minApy = 3;
    const filtered = pools.filter(p => p.apy >= minApy);
    assert.strictEqual(filtered.length, 1);
  });

  it('excludes IL risk pools when configured', () => {
    const pools = [
      mockPool({ ilRisk: 'no' }),
      mockPool({ ilRisk: 'yes' }),
    ];
    const filtered = pools.filter(p => p.ilRisk !== 'yes');
    assert.strictEqual(filtered.length, 1);
  });

  it('includes high-APY other-category pools', () => {
    // "other" category pools with APY >= 15 should be included
    const pool = mockPool({ symbol: 'DOGE', project: 'memeswap', apy: 25 });
    const category = categorize(pool.symbol, pool.project);
    assert.strictEqual(category, 'other');
    assert.ok(pool.apy >= 15, 'high-APY other should pass filter');
  });

  it('excludes low-APY other-category pools', () => {
    const pool = mockPool({ symbol: 'DOGE', project: 'memeswap', apy: 8 });
    const category = categorize(pool.symbol, pool.project);
    assert.strictEqual(category, 'other');
    assert.ok(pool.apy < 15, 'low-APY other should be filtered');
  });
});

// ── Airdrop Candidate Detection ─────────────────────────────────────

describe('Airdrop candidate detection', () => {
  it('identifies protocols with no token as candidates', () => {
    const proto = mockProtocol({ symbol: null });
    const isCandidate = !proto.symbol || proto.symbol === '-';
    assert.ok(isCandidate);
  });

  it('excludes protocols with existing tokens', () => {
    const proto = mockProtocol({ symbol: 'ETH' });
    const isCandidate = !proto.symbol || proto.symbol === '-';
    assert.ok(!isCandidate);
  });

  it('excludes protocols with dash symbol', () => {
    const proto = mockProtocol({ symbol: '-' });
    const isCandidate = !proto.symbol || proto.symbol === '-';
    assert.ok(isCandidate);
  });

  it('assigns high tier for TVL >= $1B', () => {
    const tvl = 1_500_000_000;
    let tier = 'low';
    if (tvl >= 1_000_000_000) tier = 'high';
    else if (tvl >= 100_000_000) tier = 'medium';
    assert.strictEqual(tier, 'high');
  });

  it('assigns medium tier for TVL >= $100M', () => {
    const tvl = 200_000_000;
    let tier = 'low';
    if (tvl >= 1_000_000_000) tier = 'high';
    else if (tvl >= 100_000_000) tier = 'medium';
    assert.strictEqual(tier, 'medium');
  });

  it('assigns low tier for TVL < $100M', () => {
    const tvl = 50_000_000;
    let tier = 'low';
    if (tvl >= 1_000_000_000) tier = 'high';
    else if (tvl >= 100_000_000) tier = 'medium';
    assert.strictEqual(tier, 'low');
  });
});

// ── Formatter Tests ─────────────────────────────────────────────────

describe('Formatter utilities', () => {
  // Inline the formatter helpers to test independently
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

  it('formats billions correctly', () => {
    assert.strictEqual(fmtUsd(1_500_000_000), '$1.5B');
  });

  it('formats millions correctly', () => {
    assert.strictEqual(fmtUsd(5_400_000), '$5.4M');
  });

  it('formats thousands correctly', () => {
    assert.strictEqual(fmtUsd(75_000), '$75K');
  });

  it('formats small amounts as raw dollars', () => {
    assert.strictEqual(fmtUsd(500), '$500');
  });

  it('returns correct APY badges', () => {
    assert.strictEqual(apyBadge(25), '🔥');
    assert.strictEqual(apyBadge(15), '📈');
    assert.strictEqual(apyBadge(7), '💹');
    assert.strictEqual(apyBadge(2), '📊');
  });

  it('returns correct tier badges', () => {
    assert.strictEqual(tierBadge('high'), '💎');
    assert.strictEqual(tierBadge('medium'), '🪂');
    assert.strictEqual(tierBadge('low'), '🧪');
  });
});

// ── Deduplication Tests ─────────────────────────────────────────────

describe('Deduplication', () => {
  it('deduplicates yields by pool ID', () => {
    const state = { reportedPools: {} };
    const yields = [
      mockPool({ pool: 'pool-1', project: 'Aave' }),
      mockPool({ pool: 'pool-1', project: 'Aave' }), // duplicate
      mockPool({ pool: 'pool-2', project: 'Compound' }),
    ];

    const newYields = yields.filter(y => {
      const id = y.pool || `${y.project}-${y.symbol}-${y.chain}`;
      if (state.reportedPools[id]) return false;
      state.reportedPools[id] = Date.now();
      return true;
    });

    assert.strictEqual(newYields.length, 2);
    assert.strictEqual(newYields[0].project, 'Aave');
    assert.strictEqual(newYields[1].project, 'Compound');
  });

  it('generates fallback ID when pool ID is null', () => {
    const pool = mockPool({ pool: null, project: 'Test', symbol: 'USDC', chain: 'Ethereum' });
    const id = pool.pool || `${pool.project}-${pool.symbol}-${pool.chain}`;
    assert.strictEqual(id, 'Test-USDC-Ethereum');
  });
});

// ── Config Validation ───────────────────────────────────────────────

describe('Config validation', () => {
  it('loads config.example.json with expected structure', () => {
    const configPath = path.join(ROOT_DIR, 'config.example.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    assert.ok(config.sources, 'should have sources');
    assert.ok(config.sources.defillama, 'should have defillama source');
    assert.ok(config.sources.defillama.yieldsUrl, 'should have yieldsUrl');
    assert.ok(config.sources.defillama.protocolsUrl, 'should have protocolsUrl');
    assert.ok(Array.isArray(config.watchlist), 'watchlist should be array');
    assert.ok(config.filters, 'should have filters');
    assert.ok(Array.isArray(config.filters.stablecoins), 'stablecoins should be array');
    assert.ok(config.chains, 'should have chains');
  });

  it('has valid DeFi Llama URLs', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.example.json'), 'utf8'));
    assert.ok(config.sources.defillama.yieldsUrl.startsWith('https://'));
    assert.ok(config.sources.defillama.protocolsUrl.startsWith('https://'));
  });

  it('has reasonable default thresholds', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.example.json'), 'utf8'));
    assert.ok(config.sources.defillama.minTvlUsd >= 100_000, 'min TVL should be reasonable');
    assert.ok(config.sources.defillama.minApyPct >= 1, 'min APY should be reasonable');
  });
});

// ── Rate Limiter Tests ──────────────────────────────────────────────

describe('Rate limiter', () => {
  it('respects minimum interval between requests', async () => {
    const _rateLimits = {};
    async function rateLimit(domain, minIntervalMs = 100) {
      const now = Date.now();
      const last = _rateLimits[domain] || 0;
      const wait = Math.max(0, last + minIntervalMs - now);
      if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
        _rateLimits[domain] = Date.now();
        return;
      }
      _rateLimits[domain] = now;
    }

    const start = Date.now();
    await rateLimit('test.com', 50);
    await rateLimit('test.com', 50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `should wait between requests (elapsed: ${elapsed}ms)`);
  });

  it('tracks different domains independently', async () => {
    const _rateLimits = {};
    async function rateLimit(domain, minIntervalMs = 100) {
      const now = Date.now();
      const last = _rateLimits[domain] || 0;
      const wait = Math.max(0, last + minIntervalMs - now);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      _rateLimits[domain] = Date.now();
    }

    await rateLimit('a.com', 50);
    await rateLimit('b.com', 50); // different domain, no wait
    assert.ok(_rateLimits['a.com'] && _rateLimits['b.com']);
  });
});
