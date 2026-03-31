# Changelog

## [1.4.0] — 2026-03-31
### Added
- `watchlist.js` — Per-user watchlist & alert system
  - `add/remove/list` — CRUD for tracked protocols per Telegram chat
  - `snapshot()` — Stores scan results for change detection
  - `checkAlerts()` — Compares new scans against snapshots, triggers on APY >20% change or TVL >15% shift
  - `formatAlert()` — Telegram-ready alert messages with direction indicators
  - `allWatched()` / `watchers()` — Cross-user dedup and notification routing
  - Persistent storage via `watchlist.json`
- Watchlist bot commands: `/watch`, `/watch add <name>`, `/watch remove <name>`
- Background alert scanner — runs every 30min (configurable via `ALERT_INTERVAL_MINUTES`), notifies watchers of significant changes
- `watchlist.js` added to `npm run test:syntax`

## [1.3.0] — 2026-03-31
### Added
- `bot.js` — Telegram bot interface for DeFi Money Engine
  - `/scan` — full scan (yields + protocols + airdrops)
  - `/yields` — yield pools only
  - `/airdrops` — airdrop candidates only
  - `/protocols` — protocol intelligence (TVL anomalies, momentum, chain expansion)
  - `/filter` — per-user filters (min APY, min TVL, stablecoins only)
  - Pipe architecture: bot spawns scanners and pipes through format.js
- `node-telegram-bot-api` dependency
- `npm run bot` script for quick start
- README: Telegram Bot section with setup, commands, and deployment guide

## [1.2.0] — 2026-03-30
### Added
- `defillama-scanner.js` - Protocol intelligence scanner with 4 scan types:
  - TVL anomaly detection (extreme TVL/mcap ratios, divergence signals)
  - Chain airdrop candidate finder (high TVL chains without native tokens)
  - TVL momentum scanning (rapid growth/decline, sustained trends)
  - Chain expansion tracking (protocols deploying to new chains)
- `format.js`: formatters for all 4 new finding types (anomaly, chain airdrop, momentum, expansion)
- Pipe architecture: both scanners compose via stdin JSONL → format.js
- JSDoc annotations on all formatter functions
### Changed
- README rewritten: documents both scanners, pipe architecture, combined usage
- `format.js` header updated to reflect dual-scanner support

## [1.1.0] - 2026-03-30
### Added
- Test suite: 31 tests across 7 suites (state, filtering, airdrop detection, formatter, dedup, config, rate limiter)
- GitHub Actions CI workflow (Node 18/20/22 matrix)
- Config validation tests
### Fixed
- Updated ROADMAP to reflect completed milestones
- Updated products.json: scannerWorking + opportunitiesFound now true

## [1.0.0] - 2026-03-28
### Added
- Initial release
- Core functionality
- README documentation
- MIT license
