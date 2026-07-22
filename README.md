# unleash-safeguards-demo

Minimal demo of *Unleash v8 Enterprise* safeguards and impact metrics: a small *TypeScript* and *Fastify* API with three flag-controlled endpoints, *Prometheus* + *Grafana* observability inside *Docker Compose*, and a `wrk2` load generator running on the host.

## Requirements

- *Docker* with *Docker Compose*.
- GNU `make` and *Homebrew*.
- *Node.js 22* (via `mise install` or `asdf install`).
- An *Unleash Enterprise* license key.

## Quick Start

```bash
mise install           # or: asdf install
make install-wrk2      # builds wrk2 with Apple Silicon fixes (giltene/wrk2#145)
cp .env.example .env   # paste your UNLEASH_LICENSE into .env
make up                # starts the stack and seeds Unleash from localhost
```

| Service                                  | URL                   | Credentials         |
| ---------------------------------------- | --------------------- | ------------------- |
| Unleash                                  | http://localhost:4242 | admin / unleash4all |
| API                                      | http://localhost:3002 | -                   |
| Prometheus (external impact metrics)     | http://localhost:9090 | -                   |
| Prometheus for internal impact metrics   | http://localhost:9091 | -                   |
| Grafana                                  | http://localhost:3001 | anonymous (admin)   |

*Unleash* uses two metric stores: a dedicated *Prometheus* scraping only its internal (SDK-reported) impact metrics, and the main *Prometheus* (application and *Unleash* server metrics) as the external impact-metrics source - so metric names never appear twice in the selector.

## Endpoints and Flags

| Endpoint                    | Client    | Flag                                                       | Behavior when flag is enabled                                     |
| --------------------------- | --------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /get-transaction`      | polling   | `extend-get-transaction` (release)                         | Every 5th request returns 500 (impact metrics count ok/error).    |
| `PUT /schedule-calculation` | streaming | `enable-progressive-calculation_quicker` (operational)     | Runs the live calculation (degrades over time); disabled = cached. |
| `PUT /schedule-calculation` | polling   | `enable-progressive-calculation` (operational)             | Same as above, but propagates at polling speed.                   |
| `POST /write-transaction`   | streaming | `drop-write-transaction-traffic` (kill-switch)             | Drops the connection without a response.                          |
| `POST /write-transaction`   | streaming | `static-response-for-write-transaction-traffic` (kill-switch) | Returns a static response (POST is not cacheable).             |

Every request gets a uniformly random `region` context field (AMER, APAC, EEA, EU, US). `POST /write-transaction` additionally derives `userTier` from the base64 `Bearer` token and maps it to `service-integration`: PREMIUM is `tier-0`, REGULAR splits 50/50 into `tier-1`/`tier-2`, FREE is `tier-3` - all usable in activation strategies.

`PUT /schedule-calculation` serves the constant `CACHED` value while both flags are disabled. With either flag enabled it calculates live - answering with the base64 of the `ts` query parameter (`wrk2` sends the current UNIX timestamp), fast for `HEALTHY_SECONDS`, then degrading over `RAMP_SECONDS` up to a ~10-15s 99th percentile. Disabling the flags (or a safeguard doing it for you) restores the fast cached response and resets the degradation.

*Grafana* provisions one dashboard per endpoint (use-case charts on top, runtime charts below): *Get Transaction - Impact Metrics*, *Schedule Calculation - Streaming vs Polling*, and *Write Transaction - Load Shedding*.

## Load Testing

```bash
make load-test ENDPOINT=/get-transaction RPS=10        # 5 minutes of steady load
make load-test ENDPOINT=/schedule-calculation RPS=30
make load-test ENDPOINT=/write-transaction RPS=60      # 30/20/10 req/s across FREE/REGULAR/PREMIUM
```

The load generator picks the HTTP method per endpoint (`PUT` for `/schedule-calculation`, `POST` for `/write-transaction`, `GET` otherwise).

`make load-test` runs `wrk2` inside the *Docker Compose* network, keeping the load off the *Docker* port forwarding. `make load-test-local` uses the host `wrk2` (installed via `make install-wrk2`) instead - with *colima* keep `CONNECTIONS <= 150` there, or its port forwarder chokes and blocks every published port (including *Unleash* and *Grafana*).

## Cleaning Up

```bash
make clean
```
