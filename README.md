# 💰 DeFi Money Engine

Automated scanner for DeFi yield opportunities, airdrop candidates, and testnet rewards. Finds money-making opportunities across chains so you don't have to.

## What It Finds

- **🪂 Airdrop Candidates** — High TVL protocols with no token (likely future airdrops)
- **📈 Yield Pools** — Best APY on stablecoins and ETH across DeFi
- **🧪 Testnet Rewards** — Active testnets with airdrop potential
- **🔮 Alpha Signals** — Fresh airdrop announcements from aggregator feeds

## Data Sources

- [DeFi Llama](https://defillama.com) — Protocol TVL, yield pools
- [Airdrops.io](https://airdrops.io) — Airdrop news and guides
- Public chain RPCs — On-chain balance checks

## Quick Start

```bash
npm install
cp config.example.json config.json
# Edit config.json with your wallet address
node money-engine.js | node format.js
```

## Output

```
💰 Money Engine Report

🎯 Top Opportunities:
🪂 Airdrop Candidates:
  • Protocol Name (Ethereum)
    TVL: $500M, no token — likely airdrop
    Est: $100-$5,000+

📈 Yield Pools:
  • Project — USDC (Ethereum)
    APY: 12.5% | TVL: $200M

🧪 Testnets:
  • Monad (Monad L1)
    $225M funded, testnet live
    Est: $500-$5,000+
```

## License

MIT
