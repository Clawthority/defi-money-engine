#!/usr/bin/env node
/**
 * DeFi Money Engine — Watchlist Module Tests.
 * Uses Node.js built-in test runner (node:test) + assert.
 *
 * Run: node --test test/watchlist.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WATCHLIST_FILE = path.join(ROOT_DIR, 'watchlist.json');

function cleanState() {
  try { fs.unlinkSync(WATCHLIST_FILE); } catch {}
}

function freshRequire() {
  delete require.cache[require.resolve(path.join(ROOT_DIR, 'watchlist'))];
  return require(path.join(ROOT_DIR, 'watchlist'));
}

// ── Add ─────────────────────────────────────────────────────────────

describe('Watchlist Add', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('adds a protocol to watchlist', () => {
    const result = wl.add('123', 'aave');
    assert.equal(result.added, true);
    assert.equal(result.alreadyExists, false);
  });

  it('normalizes name to lowercase', () => {
    wl.add('123', 'Aave');
    const items = wl.list('123');
    assert.deepEqual(items, ['aave']);
  });

  it('trims whitespace', () => {
    wl.add('123', '  lido  ');
    const items = wl.list('123');
    assert.deepEqual(items, ['lido']);
  });

  it('prevents duplicate entries', () => {
    wl.add('123', 'aave');
    const result = wl.add('123', 'aave');
    assert.equal(result.added, false);
    assert.equal(result.alreadyExists, true);
  });

  it('handles empty name gracefully', () => {
    const result = wl.add('123', '');
    assert.equal(result.added, false);
  });

  it('handles whitespace-only name', () => {
    const result = wl.add('123', '   ');
    assert.equal(result.added, false);
  });

  it('supports multiple users independently', () => {
    wl.add('111', 'aave');
    wl.add('222', 'lido');
    assert.deepEqual(wl.list('111'), ['aave']);
    assert.deepEqual(wl.list('222'), ['lido']);
  });
});

// ── Remove ──────────────────────────────────────────────────────────

describe('Watchlist Remove', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('removes a protocol from watchlist', () => {
    wl.add('123', 'aave');
    const result = wl.remove('123', 'aave');
    assert.equal(result, true);
    assert.deepEqual(wl.list('123'), []);
  });

  it('returns false when removing non-existent item', () => {
    const result = wl.remove('123', 'nonexistent');
    assert.equal(result, false);
  });

  it('returns false when user has no watchlist', () => {
    const result = wl.remove('999', 'aave');
    assert.equal(result, false);
  });

  it('normalizes name on remove', () => {
    wl.add('123', 'aave');
    wl.remove('123', 'AAVE');
    assert.deepEqual(wl.list('123'), []);
  });
});

// ── List ────────────────────────────────────────────────────────────

describe('Watchlist List', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('returns empty array for new user', () => {
    assert.deepEqual(wl.list('999'), []);
  });

  it('returns all items for a user', () => {
    wl.add('123', 'aave');
    wl.add('123', 'lido');
    wl.add('123', 'compound');
    assert.deepEqual(wl.list('123'), ['aave', 'lido', 'compound']);
  });
});

// ── AllWatched ──────────────────────────────────────────────────────

describe('AllWatched', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('returns empty array when no users', () => {
    assert.deepEqual(wl.allWatched(), []);
  });

  it('returns deduplicated list across all users', () => {
    wl.add('111', 'aave');
    wl.add('222', 'aave');
    wl.add('111', 'lido');
    const all = wl.allWatched();
    assert.ok(all.includes('aave'));
    assert.ok(all.includes('lido'));
    assert.equal(all.length, 2);
  });
});

// ── Watchers ────────────────────────────────────────────────────────

describe('Watchers', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('returns empty array when nobody watches', () => {
    assert.deepEqual(wl.watchers('aave'), []);
  });

  it('returns all chatIds watching a protocol', () => {
    wl.add('111', 'aave');
    wl.add('222', 'aave');
    wl.add('333', 'lido');
    const ids = wl.watchers('aave');
    assert.ok(ids.includes('111'));
    assert.ok(ids.includes('222'));
    assert.equal(ids.length, 2);
  });

  it('normalizes name on lookup', () => {
    wl.add('111', 'aave');
    const ids = wl.watchers('AAVE');
    assert.ok(ids.includes('111'));
  });
});

// ── Snapshot ────────────────────────────────────────────────────────

describe('Snapshot', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('stores yield snapshot data', () => {
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 5.2,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    // Verify by running checkAlerts against same data (no prior snapshot = no alert)
    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 5.2,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);
    assert.equal(alerts.length, 0); // No change = no alert
  });

  it('stores airdrop snapshot', () => {
    wl.snapshot([{
      type: 'airdrop',
      project: 'arbitrum',
      tvlUsd: 5000000000,
      tier: 'high',
    }]);
    // First airdrop scan → no alert (need prior scan to compare)
    const alerts = wl.checkAlerts([{
      type: 'airdrop',
      project: 'arbitrum',
      tvlUsd: 5000000000,
      tier: 'high',
    }]);
    assert.equal(alerts.length, 0);
  });

  it('stores anomaly snapshot', () => {
    wl.snapshot([{
      type: 'tvl_anomaly',
      project: 'sus_protocol',
      tvlMcapRatio: 15.5,
      tvlUsd: 200000000,
    }]);
  });
});

// ── Check Alerts ────────────────────────────────────────────────────

describe('Check Alerts', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('triggers APY change alert when threshold exceeded', () => {
    // Setup: user watches aave, snapshot with initial APY
    wl.add('123', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 5.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    // APY jumps from 5% to 7% (40% change > 20% threshold)
    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 7.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].chatId, '123');
    assert.ok(alerts[0].alert.parts.some(p => p.includes('APY')));
    assert.ok(alerts[0].alert.parts.some(p => p.includes('📈')));
  });

  it('triggers APY decrease alert', () => {
    wl.add('123', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 10.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    // APY drops from 10% to 7% (30% change > 20% threshold)
    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 7.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].alert.parts.some(p => p.includes('📉')));
  });

  it('triggers TVL change alert', () => {
    wl.add('123', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 5.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    // TVL drops from $1B to $800M (20% change > 15% threshold)
    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 5.0,
      tvlUsd: 800000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].alert.parts.some(p => p.includes('TVL')));
  });

  it('does not alert when change is below threshold', () => {
    wl.add('123', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 5.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    // APY changes from 5% to 5.5% (10% change < 20% threshold)
    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 5.5,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 0);
  });

  it('triggers new airdrop alert for first-time detection', () => {
    wl.add('123', 'arbitrum');
    // No prior airdrop snapshot → should trigger
    const alerts = wl.checkAlerts([{
      type: 'airdrop',
      project: 'arbitrum',
      tvlUsd: 5000000000,
      tier: 'high',
    }]);

    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].alert.parts.some(p => p.includes('airdrop')));
  });

  it('triggers new anomaly alert for first-time detection', () => {
    wl.add('123', 'sus_protocol');
    const alerts = wl.checkAlerts([{
      type: 'tvl_anomaly',
      project: 'sus_protocol',
      tvlMcapRatio: 15.5,
      tvlUsd: 200000000,
    }]);

    assert.equal(alerts.length, 1);
    assert.ok(alerts[0].alert.parts.some(p => p.includes('anomaly')));
  });

  it('does not alert for unwatched protocols', () => {
    wl.add('123', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'compound',
      apy: 5.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'compound',
      apy: 10.0,
      tvlUsd: 500000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 0);
  });

  it('notifies multiple watchers of same protocol', () => {
    wl.add('111', 'aave');
    wl.add('222', 'aave');
    wl.snapshot([{
      type: 'yield',
      project: 'aave',
      apy: 5.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    const alerts = wl.checkAlerts([{
      type: 'yield',
      project: 'aave',
      apy: 8.0,
      tvlUsd: 1000000000,
      chain: 'ethereum',
    }]);

    assert.equal(alerts.length, 2);
    const chatIds = alerts.map(a => a.chatId).sort();
    assert.deepEqual(chatIds, ['111', '222']);
  });

  it('handles partial name matching (user watches "ave" matches "aave")', () => {
    wl.add('123', 'ave');
    const alerts = wl.checkAlerts([{
      type: 'airdrop',
      project: 'aave',
      tvlUsd: 1000000000,
      tier: 'high',
    }]);
    assert.equal(alerts.length, 1);
  });
});

// ── Format Alert ────────────────────────────────────────────────────

describe('Format Alert', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('formats yield alert with APY and TVL', () => {
    const msg = wl.formatAlert({
      project: 'aave',
      type: 'yield',
      parts: ['APY 📈 up: 5% → 7%'],
      item: { type: 'yield', project: 'aave', apy: 7, tvlUsd: 1000000000, chain: 'ethereum' },
    });

    assert.ok(msg.includes('aave'));
    assert.ok(msg.includes('APY'));
    assert.ok(msg.includes('7'));
    assert.ok(msg.includes('$1.0B'));
    assert.ok(msg.includes('ethereum'));
  });

  it('formats airdrop alert', () => {
    const msg = wl.formatAlert({
      project: 'arbitrum',
      type: 'airdrop',
      parts: ['🪂 New airdrop candidate detected!'],
      item: { type: 'airdrop', project: 'arbitrum', tvlUsd: 5000000000, tier: 'high' },
    });

    assert.ok(msg.includes('arbitrum'));
    assert.ok(msg.includes('🪂'));
    assert.ok(msg.includes('high'));
  });

  it('formats anomaly alert', () => {
    const msg = wl.formatAlert({
      project: 'sus',
      type: 'tvl_anomaly',
      parts: ['🚨 New TVL anomaly detected!'],
      item: { type: 'tvl_anomaly', project: 'sus', tvlMcapRatio: 15.5, tvlUsd: 200000000 },
    });

    assert.ok(msg.includes('sus'));
    assert.ok(msg.includes('15.5x'));
    assert.ok(msg.includes('$200M'));
  });

  it('formats TVL in millions for mid-range values', () => {
    const msg = wl.formatAlert({
      project: 'test',
      type: 'yield',
      parts: ['TVL changed'],
      item: { type: 'yield', project: 'test', apy: 5, tvlUsd: 50000000, chain: 'ethereum' },
    });
    assert.ok(msg.includes('$50M'));
  });

  it('formats TVL in raw dollars for small values', () => {
    const msg = wl.formatAlert({
      project: 'small',
      type: 'yield',
      parts: ['TVL changed'],
      item: { type: 'yield', project: 'small', apy: 5, tvlUsd: 50000, chain: 'ethereum' },
    });
    assert.ok(msg.includes('$50000'));
  });
});

// ── Alert Thresholds ────────────────────────────────────────────────

describe('Alert Thresholds', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('exports threshold constants', () => {
    assert.equal(wl.ALERT_THRESHOLDS.apyChangePct, 20);
    assert.equal(wl.ALERT_THRESHOLDS.tvlChangePct, 15);
    assert.equal(wl.ALERT_THRESHOLDS.newAirdrop, true);
    assert.equal(wl.ALERT_THRESHOLDS.newAnomaly, true);
  });
});

// ── Digest ──────────────────────────────────────────────────────────

describe('Alert Digest', () => {
  let wl;

  beforeEach(() => {
    cleanState();
    wl = freshRequire();
  });

  it('records an alert to digest', () => {
    wl.recordAlert('123', {
      project: 'aave',
      type: 'yield',
      parts: ['APY up: 5% → 7%'],
      item: { type: 'yield', project: 'aave', apy: 7, tvlUsd: 1000000000, chain: 'ethereum' },
    });

    const digest = wl.getDigest('123');
    assert.equal(digest.count, 1);
    assert.ok(digest.message.includes('aave'));
    assert.ok(digest.message.includes('APY'));
  });

  it('records multiple alerts from different projects', () => {
    wl.recordAlert('123', {
      project: 'aave',
      type: 'yield',
      parts: ['APY up'],
      item: {},
    });
    wl.recordAlert('123', {
      project: 'lido',
      type: 'yield',
      parts: ['TVL down'],
      item: {},
    });

    const digest = wl.getDigest('123');
    assert.equal(digest.count, 2);
    assert.ok(digest.message.includes('aave'));
    assert.ok(digest.message.includes('lido'));
  });

  it('returns empty message when no alerts', () => {
    const digest = wl.getDigest('999');
    assert.equal(digest.count, 0);
    assert.ok(digest.message.includes('quiet'));
  });

  it('groups alerts by project in digest message', () => {
    wl.recordAlert('123', { project: 'aave', type: 'yield', parts: ['Alert 1'], item: {} });
    wl.recordAlert('123', { project: 'aave', type: 'yield', parts: ['Alert 2'], item: {} });
    wl.recordAlert('123', { project: 'lido', type: 'yield', parts: ['Alert 3'], item: {} });

    const digest = wl.getDigest('123');
    assert.equal(digest.count, 3);
    // aave should appear once as header with 2 alerts under it
    const aaveMatches = (digest.message.match(/\*aave\*/g) || []).length;
    assert.equal(aaveMatches, 1);
  });

  it('clears digest for a user', () => {
    wl.recordAlert('123', { project: 'aave', type: 'yield', parts: ['Alert'], item: {} });
    wl.recordAlert('123', { project: 'lido', type: 'yield', parts: ['Alert'], item: {} });

    const cleared = wl.clearDigest('123');
    assert.equal(cleared, 2);

    const digest = wl.getDigest('123');
    assert.equal(digest.count, 0);
  });

  it('clear returns 0 for user with no digest', () => {
    const cleared = wl.clearDigest('999');
    assert.equal(cleared, 0);
  });

  it('digests are per-user', () => {
    wl.recordAlert('111', { project: 'aave', type: 'yield', parts: ['Alert'], item: {} });
    wl.recordAlert('222', { project: 'lido', type: 'yield', parts: ['Alert'], item: {} });

    const digest1 = wl.getDigest('111');
    const digest2 = wl.getDigest('222');

    assert.equal(digest1.count, 1);
    assert.equal(digest2.count, 1);
    assert.ok(digest1.message.includes('aave'));
    assert.ok(digest2.message.includes('lido'));
  });

  it('includes timestamp in alert data', () => {
    wl.recordAlert('123', { project: 'aave', type: 'yield', parts: ['Alert'], item: {} });

    const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    const alert = data.digests['123'][0];
    assert.ok(alert.timestamp);
    assert.ok(new Date(alert.timestamp).getTime() > 0);
  });

  it('caps digest at 50 alerts per user', () => {
    for (let i = 0; i < 60; i++) {
      wl.recordAlert('123', { project: `proto${i}`, type: 'yield', parts: [`Alert ${i}`], item: {} });
    }

    const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    assert.equal(data.digests['123'].length, 50);
    // Should keep the last 50
    assert.equal(data.digests['123'][0].project, 'proto10');
    assert.equal(data.digests['123'][49].project, 'proto59');
  });
});
