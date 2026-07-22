-include .env
export

ENDPOINT    ?= /get-transaction
RPS         ?= 50
DURATION    ?= 300s
THREADS     ?= 2

# wrk2 splits RPS evenly across connections, and every connection fires its
# first request at connect - with CONNECTIONS far above RPS the "steady" load
# degenerates into phase-aligned bursts. CONNECTIONS ~= RPS keeps the healthy
# phase steady; when the scheduled calculation degrades, throughput collapses
# while p99 ramps (the honest picture) and recovers once the flag is disabled.
CONNECTIONS ?= $(RPS)

.PHONY: build up down clean logs seed install-wrk2 load-test load-test-local info

build:
	docker compose --profile load-test build

up:
	docker compose up -d --build --wait
	$(MAKE) seed

down:
	docker compose down

clean:
	docker compose down -v

logs:
	docker compose logs -f api

seed:
	UNLEASH_URL=http://localhost:4242 node seed/seed.mjs

install-wrk2:
	bash scripts/install-wrk2.sh

# For /write-transaction use RPS=60 to get 30/20/10 req/s across FREE/REGULAR/PREMIUM.
load-test:
	docker compose run --rm --build -e ENDPOINT=$(ENDPOINT) wrk2 -t$(THREADS) -c$(CONNECTIONS) -d$(DURATION) -R$(RPS) \
		--latency -s /scripts/tier.lua http://api:3000$(ENDPOINT)

# Runs wrk2 from the host through the Docker port forwarding: try to keep
# CONNECTIONS <= 150, or the forwarder chokes and blocks every published port.
load-test-local:
	wrk2 -t$(THREADS) -c$(CONNECTIONS) -d$(DURATION) -R$(RPS) \
		--latency -s loadtest/tier.lua http://localhost:3002$(ENDPOINT)

info:
	@echo "Unleash:    http://localhost:4242  (admin / unleash4all)"
	@echo "API:        http://localhost:3002"
	@echo "Prometheus: http://localhost:9090"
	@echo "Grafana:    http://localhost:3001"
