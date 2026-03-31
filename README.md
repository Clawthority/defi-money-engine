# 💰 DeFi Money Engine

Automated scanner for DeFi yield opportunities, airdrop candidates, and protocol intelligence. Finds money-making opportunities across chains so you don't have to.

## Two Scanners, One Output

The engine has two scanners that compose via pipe:

| Scanner | What It Finds | Input |
|---------|---------------|-------|
| `scanner.js` | Yield pools + airdrop candidates | DeFi Llama yields API |
| `defillama-scanner.js` | TVL anomalies, chain expansion, tokenless chains, momentum | DeFi Llama protocols + chains API |

Both output JSON lines — pipe either or both into `format.js` for Telegram-ready output.

## What It Finds

### Yield Scanner (`scanner.js`)
- **🪂 Airdrop Candidates** — High TVL protocols with no token (likely future airdrops)
- **📈 Yield Pools** — Best APY on stablecoins and ETH across DeFi
- **🧪 Testnet Rewards** — Active testnets with airdrop potential

### Protocol Scanner (`defillama-scanner.js`)
- **🚨 TVL Anomalies** — Extreme TVL/mcap ratios flagging potential mispricing (e.g. SSV Network at 440x)
- **⛓️ Chain Airdrop Candidates** — High TVL chains without native tokens (Plasma, MegaETH, etc.)
- **📈📉 TVL Momentum** — Rapid growth (>$10M TVL, >20% 7d) or decline signals
- **🌐 Chain Expansion** — Protocols deploying to new chains (watchlist priority)

## Who It's For

- **Yield farmers** — Find the best stablecoin and ETH yields across chains without manually checking every protocol.
- **Airdrop hunters** — Identify high-TVL protocols with no token (strongest airdrop signal). Get ahead of announcements.
- **DeFi researchers** — Track TVL anomalies, chain expansion, and protocol momentum from a single feed.
- **Crypto traders** — Spot mispriced tokens via TVL/mcap anomalies before the market catches on.
- **Alpha groups** — Curate and share automated DeFi intelligence with your community.

## Data Sources

- [DeFi Llama](https://defillama.com) — Protocol TVL, yield pools, chain data (fully integrated)
- Public chain RPCs — On-chain balance checks (configured)

## Quick Start

```bash
cp config.example.json config.json
# Edit config.json with your settings (wallet address optional)

# Yield scanner only
node scanner.js --once | node format.js

# Protocol scanner only
node defillama-scanner.js --once | node format.js

# Both scanners combined (full picture)
node scanner.js --once | cat - <(node defillama-scanner.js --once) | node format.js
```

### Filter Options

```bash
# Only stablecoin yields ≥5% APY
node scanner.js --once | node format.js --min-apy=5 --stablecoins-only

# Only yields with ≥$5M TVL
node scanner.js --once | node format.js --min-tvl=5000000

# Top 10 protocol findings only
node defillama-scanner.js --once --top=10 | node format.js
```

### Continuous Mode

```bash
# Run every 60 minutes (configured in config.json)
node scanner.js

# Protocol scanner also supports continuous mode
node defillama-scanner.js
```

## Output

```
💰 DeFi Money Engine — 12 findings found

━━━ 🚨 TVL Anomalies ━━━
🔴 **SSV Network** ($SSV)
  📊 TVL/Mcap: 440x ⚡ | 7d: +4.8%
  💰 TVL: $1.7B | MCap: $3.9M
  🏷️ Liquid Staking | Ethereum
  ⚠️ Extreme ratio — investigate for mispricing or TVL counting nuance

━━━ ⛓️ Chain Airdrop Candidates ━━━
🔴 **Plasma** 🆕
  💰 TVL: $1.4B | 2 protocols
  🪂 NO NATIVE TOKEN — airdrop candidate

━━━ 🪂 Yield Scanner Airdrop Candidates ━━━
💎 **Kelp**
  💰 TVL: $1.2B (-4.05% 7d) — no token
  ⛓️ Multi-Chain | Liquid Restaking
  🎯 Est: $500-$10,000+
```

## Architecture

```
scanner.js ──────┐
                 ├──► format.js ──► Telegram output
defillama-scanner.js ┘
```

Both scanners output one JSON object per line (JSONL). The formatter reads stdin, parses all findings, and renders a grouped Telegram message. This pipe architecture means:

- Run either scanner independently or combine them
- Add new scanners without changing the formatter
- Filter/format options apply to all finding types

## Related Products

- **[Crypto Alpha Feed](../crypto-alpha-feed)** — Blog/RSS monitoring and on-chain signals for airdrop announcements and protocol launches. Complements DeFi Money Engine with faster signal detection.

## Telegram Bot

The fastest way to use DeFi Money Engine — scan from Telegram, no terminal needed.

### Setup

```bash
# 1. Get a bot token from @BotFather on Telegram
# 2. Set the token and run:
TELEGRAM_BOT_TOKEN=your_token node bot.js

# Or add to config.json and use a .env file
```

### Bot Commands

| Command | What It Does |
|---------|-------------|
| `/start` | Welcome & overview |
| `/scan` | Full scan (yields + protocols + airdrops) |
| `/yields` | Best yield pools (stablecoins & ETH) |
| `/airdrops` | Airdrop candidates (high TVL, no token) |
| `/protocols` | TVL anomalies, momentum, chain expansion |
| `/filter apy=5` | Min APY filter |
| `/filter tvl=5000000` | Min TVL filter |
| `/filter stablecoins` | Toggle stablecoins only |
| `/filter reset` | Clear all filters |

### Deploy

The bot runs via `node bot.js` with polling. For production, use PM2 or systemd:

```bash
pm2 start bot.js --name defi-engine -- --token=$TELEGRAM_BOT_TOKEN
```

## Related Products

## Tests

```bash
node --test test/scanner.test.js
```

31 tests across 7 suites: state management, filtering, airdrop detection, formatting, dedup, config validation, rate limiting.

## License

MIT
