# 💰 DeFi Money Engine

Automated scanner for DeFi yield opportunities, airdrop candidates, and testnet rewards. Finds money-making opportunities across chains so you don't have to.

## What It Finds

- **🪂 Airdrop Candidates** — High TVL protocols with no token (likely future airdrops)
- **📈 Yield Pools** — Best APY on stablecoins and ETH across DeFi
- **🧪 Testnet Rewards** — Active testnets with airdrop potential
- **🔮 Alpha Signals** — Fresh airdrop announcements from aggregator feeds

## Data Sources

- [DeFi Llama](https://defillama.com) — Protocol TVL, yield pools (fully integrated)
- Public chain RPCs — On-chain balance checks (configured)

## Quick Start

```bash
cp config.example.json config.json
# Edit config.json with your wallet address (optional)
node scanner.js --once | node format.js
```

### Filter Options

```bash
# Only stablecoin yields ≥5% APY
node scanner.js --once | node format.js --min-apy=5 --stablecoins-only

# Only yields with ≥$5M TVL
node scanner.js --once | node format.js --min-tvl=5000000
```

### Continuous Mode

```bash
# Run every 60 minutes (configured in config.json)
node scanner.js
```

## Output

```
💰 DeFi Money Engine — 20 opportunities found

━━━ 🪂 Airdrop Candidates ━━━
💎 **Kelp**
  💰 TVL: $1.2B (-4.05% 7d) — no token
  ⛓️ Multi-Chain | Liquid Restaking
  🎯 Est: $500-$10,000+

━━━ ⭐ Watchlist Pools ━━━
📈 **Pendle** — USDG ⭐
  📊 APY: 5.4% (30d avg: 5.25%) | TVL: $74.9M
  ⛓️ Ethereum | Risk: no
```

## License

MIT
