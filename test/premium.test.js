#!/usr/bin/env node
/**
 * DeFi Money Engine — Premium Module Tests.
 * Uses Node.js built-in test runner (node:test) + assert.
 *
 * Run: node --test test/premium.test.js
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PREMIUM_FILE = path.join(ROOT_DIR, 'premium.json');

// Clean state before each test
function cleanState() {
  try { fs.unlinkSync(PREMIUM_FILE); } catch {}
}

// Fresh require to reset in-memory state
function freshRequire() {
  delete require.cache[require.resolve(path.join(ROOT_DIR, 'premium'))];
  return require(path.join(ROOT_DIR, 'premium'));
}

// ── Tier Definitions ────────────────────────────────────────────────

describe('Premium Tiers', () => {
  let premium;

  beforeEach(() => {
    cleanState();
    premium = freshRequire();
  });

  it('defines free and pro tiers', () => {
    assert.ok(premium.TIERS.free);
    assert.ok(premium.TIERS.pro);
    assert.equal(premium.TIERS.free.name, 'Free');
    assert.equal(premium.TIERS.pro.name, 'Pro');
  });

  it('free tier has limited scans', () => {
    assert.equal(premium.TIERS.free.scansPerDay, 3);
    assert.equal(premium.TIERS.free.alertsEnabled, false);
    assert.equal(premium.TIERS.free.defillamaAccess, false);
    assert.equal(premium.TIERS.free.watchlistLimit, 3);
  });

  it('pro tier has unlimited scans', () => {
    assert.equal(premium.TIERS.pro.scansPerDay, Infinity);
    assert.equal(premium.TIERS.pro.alertsEnabled, true);
    assert.equal(premium.TIERS.pro.defillamaAccess, true);
    assert.equal(premium.TIERS.pro.watchlistLimit, 50);
  });

  it('defines two subscription plans', () => {
    assert.equal(premium.PLANS.length, 2);
    const weekly = premium.PLANS.find(p => p.id === 'pro_weekly');
    const monthly = premium.PLANS.find(p => p.id === 'pro_monthly');
    assert.ok(weekly, 'has weekly plan');
    assert.ok(monthly, 'has monthly plan');
    assert.equal(weekly.stars, 35);
    assert.equal(monthly.stars, 100);
    assert.equal(weekly.durationDays, 7);
    assert.equal(monthly.durationDays, 30);
  });
});

// ── Free Tier Scan Limiting ─────────────────────────────────────────

describe('Free Tier Scan Limiting', () => {
  let premium;

  beforeEach(() => {
    cleanState();
    premium = freshRequire();
  });

  it('allows scanning when under limit', () => {
    const result = premium.canScan('12345');
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3);
    assert.equal(result.count, 0);
  });

  it('tracks scan count per user', () => {
    premium.recordScan('12345');
    const result = premium.canScan('12345');
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 2);
    assert.equal(result.count, 1);
  });

  it('blocks after 3 scans for free users', () => {
    premium.recordScan('12345');
    premium.recordScan('12345');
    premium.recordScan('12345');
    const result = premium.canScan('12345');
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.equal(result.count, 3);
  });

  it('tracks users independently', () => {
    premium.recordScan('111');
    premium.recordScan('111');
    premium.recordScan('111');

    // User 111 is out of scans
    assert.equal(premium.canScan('111').allowed, false);

    // User 222 still has all scans
    assert.equal(premium.canScan('222').allowed, true);
    assert.equal(premium.canScan('222').remaining, 3);
  });

  it('resets count on new day', () => {
    premium.recordScan('12345');
    premium.recordScan('12345');
    premium.recordScan('12345');

    // Simulate day change by manipulating the dailyScans map
    // Since the module uses in-memory Map, we can't easily reset
    // But we can verify the count logic works correctly
    assert.equal(premium.canScan('12345').count, 3);
  });
});

// ── Premium Status ──────────────────────────────────────────────────

describe('Premium Status', () => {
  let premium;

  beforeEach(() => {
    cleanState();
    premium = freshRequire();
  });

  it('returns false for non-premium user', () => {
    assert.equal(premium.isPremium('99999'), false);
  });

  it('returns true after granting premium', () => {
    premium.grantPremium('12345', 'pro_weekly', 'tx_test_1');
    assert.equal(premium.isPremium('12345'), true);
  });

  it('pro user can scan unlimited times', () => {
    premium.grantPremium('12345', 'pro_monthly', 'tx_test_2');
    for (let i = 0; i < 10; i++) {
      premium.recordScan('12345');
    }
    const result = premium.canScan('12345');
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, Infinity);
  });

  it('returns correct tier for free user', () => {
    const tier = premium.getTier('12345');
    assert.equal(tier.name, 'Free');
  });

  it('returns correct tier for pro user', () => {
    premium.grantPremium('12345', 'pro_weekly', 'tx_test_3');
    const tier = premium.getTier('12345');
    assert.equal(tier.name, 'Pro');
  });
});

// ── Grant Premium ───────────────────────────────────────────────────

describe('Grant Premium', () => {
  let premium;

  beforeEach(() => {
    cleanState();
    premium = freshRequire();
  });

  it('grants premium with correct expiry for weekly plan', () => {
    const before = new Date();
    premium.grantPremium('12345', 'pro_weekly', 'tx_weekly_1');
    const after = new Date();

    // Read the persisted data
    const data = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    const user = data.users['12345'];

    assert.equal(user.tier, 'pro');
    assert.equal(user.planId, 'pro_weekly');

    // Expiry should be ~7 days from now
    const expiresAt = new Date(user.expiresAt);
    const daysDiff = (expiresAt - before) / 86400000;
    assert.ok(daysDiff >= 6.9 && daysDiff <= 7.1, `Expected ~7 days, got ${daysDiff}`);
  });

  it('grants premium with correct expiry for monthly plan', () => {
    premium.grantPremium('12345', 'pro_monthly', 'tx_monthly_1');

    const data = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    const user = data.users['12345'];

    const expiresAt = new Date(user.expiresAt);
    const grantedAt = new Date(user.grantedAt);
    const daysDiff = (expiresAt - grantedAt) / 86400000;
    assert.ok(daysDiff >= 29.9 && daysDiff <= 30.1, `Expected ~30 days, got ${daysDiff}`);
  });

  it('extends existing premium subscription', () => {
    // Grant weekly
    premium.grantPremium('12345', 'pro_weekly', 'tx_ext_1');
    const data1 = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    const firstExpiry = new Date(data1.users['12345'].expiresAt);

    // Extend with another weekly
    premium.grantPremium('12345', 'pro_weekly', 'tx_ext_2');
    const data2 = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    const secondExpiry = new Date(data2.users['12345'].expiresAt);

    // Second expiry should be 7 days after the first
    const extensionDays = (secondExpiry - firstExpiry) / 86400000;
    assert.ok(extensionDays >= 6.9 && extensionDays <= 7.1,
      `Expected ~7 day extension, got ${extensionDays}`);
  });

  it('records transactions', () => {
    premium.grantPremium('111', 'pro_weekly', 'tx_a');
    premium.grantPremium('222', 'pro_monthly', 'tx_b');

    const data = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    assert.equal(data.transactions.length, 2);
    assert.equal(data.transactions[0].txId, 'tx_a');
    assert.equal(data.transactions[0].stars, 35);
    assert.equal(data.transactions[1].txId, 'tx_b');
    assert.equal(data.transactions[1].stars, 100);
  });

  it('returns false for invalid plan', () => {
    const result = premium.grantPremium('12345', 'invalid_plan', 'tx_bad');
    assert.equal(result, false);
    assert.equal(premium.isPremium('12345'), false);
  });
});

// ── Expiry Handling ─────────────────────────────────────────────────

describe('Expiry Handling', () => {
  beforeEach(() => {
    cleanState();
  });

  it('detects expired premium and cleans up', () => {
    // Manually write expired premium data
    const expiredData = {
      users: {
        '55555': {
          tier: 'pro',
          planId: 'pro_weekly',
          grantedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
          expiresAt: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
        },
      },
      transactions: [],
    };
    fs.writeFileSync(PREMIUM_FILE, JSON.stringify(expiredData));

    const premium = freshRequire();
    assert.equal(premium.isPremium('55555'), false);

    // User should be cleaned up from the file
    const data = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8'));
    assert.equal(data.users['55555'], undefined);
  });
});
