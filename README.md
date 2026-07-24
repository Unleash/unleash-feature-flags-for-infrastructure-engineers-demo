# unleash-feature-flags-for-infrastructure-engineers-demo

Minimal demo of *Unleash v8 Enterprise* safeguards and impact metrics: a small *TypeScript* and *Fastify* API with three flag-controlled endpoints, *Prometheus* + *Grafana* observability inside *Docker Compose*, and a `wrk2` load generator.

## Prerequisites

Required:

- *Docker* with *Docker Compose*.
- GNU `make`.
- *Node.js 22* (host-side seeding runs `node seed/seed.mjs`).
- An *Unleash Enterprise* license key.

Optional:

- *mise* or *asdf-vm* - version files for both are committed (`mise.toml`, `.tool-versions`).
- *Homebrew* and a C toolchain - only for `make install-wrk2` + `make load-test-local`; the default `make load-test` builds and runs `wrk2` inside *Docker*.

## Quick Start

```bash
make setup
```

The first run creates `.env` from `.env.example` and stops - paste your `UNLEASH_LICENSE` into it and re-run `make setup`. It starts the stack and seeds *Unleash* (flags, context fields, external metrics source). Idempotent - safe to re-run.

| Service                                  | URL                   | Credentials         |
| ---------------------------------------- | --------------------- | ------------------- |
| Unleash                                  | http://localhost:4242 | admin / unleash4all |
| API                                      | http://localhost:3002 | -                   |
| Prometheus (external impact metrics)     | http://localhost:9090 | -                   |
| Prometheus for internal impact metrics   | http://localhost:9091 | -                   |
| Grafana                                  | http://localhost:3001 | anonymous (admin)   |

All credentials are insecure demo defaults - never expose this stack publicly.

*Unleash* uses two metric stores: a dedicated *Prometheus* scraping only its internal (SDK-reported) impact metrics, and the main *Prometheus* (application and *Unleash* server metrics) as the external impact-metrics source - so metric names never appear twice in the selector. See [docs/splunk-integration/unleash-metric-fanout.html](docs/splunk-integration/unleash-metric-fanout.html) (open in a browser) for the metric fan-out topologies when integrating alongside *Splunk*.

## Endpoints and Flags

| Endpoint                    | Client    | Flag                                                       | Behavior when flag is enabled                                     |
| --------------------------- | --------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /get-transaction`      | polling   | `extend-get-transaction` (release)                         | Every 5th request returns 500 (impact metrics count ok/error).    |
| `PUT /schedule-calculation` | streaming | `enable-progressive-calculation_quicker` (operational)     | Runs the live calculation (degrades over time); disabled = cached. |
| `PUT /schedule-calculation` | polling   | `enable-progressive-calculation` (operational)             | Same as above, but propagates at polling speed.                   |
| `POST /write-transaction`   | streaming | `drop-write-transaction-traffic` (kill-switch)             | Drops the connection without a response.                          |
| `POST /write-transaction`   | streaming | `static-response-for-write-transaction-traffic` (kill-switch) | Returns a static response (POST is not cacheable).             |

Every request gets a uniformly random `region` context field (AMER, APAC, EEA, EU, US). `POST /write-transaction` additionally derives `userTier` from the base64 `Bearer` token and maps it to `service-integration`: PREMIUM is `tier-0`, REGULAR splits 50/50 into `tier-1`/`tier-2`, FREE is `tier-3` - all usable in activation strategies.

## Demo Scenarios

Each scenario: start the load, toggle flags in *Unleash* (http://localhost:4242, environment `development`), watch the matching *Grafana* dashboard (http://localhost:3001).

### 1. Failed release, caught by impact metrics

```bash
make load-test ENDPOINT=/get-transaction RPS=10
```

Enable `extend-get-transaction` - every 5th request now fails. Watch *Get Transaction - Impact Metrics*: the red 500 series, the error ratio, and the impact-metrics panel fed by SDK counters (`demo_get_transaction_success_total` / `demo_get_transaction_error_total`) flowing through *Unleash* into the internal metric store. Attach a safeguard to the error counter so the breach disables the flag automatically - errors stop within seconds.

### 2. Progressive calculation degrading, instant rollback

```bash
make load-test ENDPOINT=/schedule-calculation RPS=30
```

The endpoint serves the constant `CACHED` value until a flag enables the live calculation: base64 of the `ts` query parameter, fast for `HEALTHY_SECONDS`, then degrading over `RAMP_SECONDS` up to a ~10-15s p99 while throughput collapses. Enable `enable-progressive-calculation_quicker` (streaming client, ~1s propagation) or `enable-progressive-calculation` (polling client, ~2s) and compare. Watch *Schedule Calculation - Streaming vs Polling*. A safeguard on `demo_schedule_calculation_duration_ms` p99 (or a manual disable) snaps traffic back to cached and resets the degradation. A gradual rollout percentage splits the calculated vs cached series live.

### 3. Load shedding with runtime targeting

```bash
make load-test ENDPOINT=/write-transaction RPS=60   # 30/20/10 req/s across FREE/REGULAR/PREMIUM
```

Enable `static-response-for-write-transaction-traffic` for graceful shedding (static body) or `drop-write-transaction-traffic` for hard shedding (severed connections; takes precedence). The point is runtime targeting: add constraints such as `userTier IN [FREE]`, `region IN [EU, EEA]`, or `service-integration IN [tier-3]`, or dial a rollout percentage - only the targeted series flip on *Write Transaction - Load Shedding* (per-tier, per-region, and per-integration panels), while the rest stay live.

## Load Testing

`make load-test` runs `wrk2` inside the *Docker Compose* network (the image rebuilds automatically when `loadtest/` changes), picking the HTTP method per endpoint (`PUT` for `/schedule-calculation`, `POST` for `/write-transaction`, `GET` otherwise) and randomizing user tiers 3:2:1. Parameters: `ENDPOINT`, `RPS`, `DURATION` (default 300s), `CONNECTIONS` (default `RPS`), `THREADS`.

`make load-test-local` uses the host `wrk2` (installed via `make install-wrk2`) - with *colima* keep `CONNECTIONS <= 150`, or its port forwarder chokes and blocks every published port (including *Unleash* and *Grafana*).

## Configuration

Set in `.env` (see `.env.example`):

| Variable                 | Default | Purpose                                              |
| ------------------------ | ------- | ---------------------------------------------------- |
| `UNLEASH_LICENSE`        | (empty) | Your *Unleash Enterprise* license - required.        |
| `UNLEASH_ADMIN_TOKEN`    | insecure demo token | Admin API token (seeding).               |
| `UNLEASH_BACKEND_TOKEN`  | insecure demo token | SDK client token.                        |
| `HEALTHY_SECONDS`        | 30      | Healthy phase of the progressive calculation.        |
| `RAMP_SECONDS`           | 30      | Ramp from healthy to fully degraded.                 |
| `MAX_DELAY_MS`           | 12000   | Peak artificial delay (p99 lands at ~10-15s).        |
| `IDLE_RESET_SECONDS`     | 30      | Idle gap after which the degradation epoch resets.   |

*Grafana* dashboards are generated - edit `grafana/gen-dashboards.mjs` and run `node grafana/gen-dashboards.mjs` (provisioning picks the JSONs up automatically).

## Cleaning Up

```bash
make clean
```
