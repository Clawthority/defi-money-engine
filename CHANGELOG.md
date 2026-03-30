# Changelog

## [1.2.0] - 2026-03-30
### Added
- `defillama-scanner.js` — Protocol intelligence scanner with 4 scan types:
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
