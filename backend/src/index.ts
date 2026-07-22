import Fastify from 'fastify';
import { polling, streaming, waitForSync } from './unleash.js';
import {
  registerMetrics,
  scheduleCalculationResponses,
  writeTransactionRequests,
} from './metrics.js';

const HEALTHY_SECONDS = Number(process.env.HEALTHY_SECONDS ?? 30);
const RAMP_SECONDS = Number(process.env.RAMP_SECONDS ?? 30);
const MAX_DELAY_MS = Number(process.env.MAX_DELAY_MS ?? 12_000);
const IDLE_RESET_SECONDS = Number(process.env.IDLE_RESET_SECONDS ?? 30);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const REGIONS = ['AMER', 'APAC', 'EEA', 'EU', 'US'];
const randomRegion = () => REGIONS[Math.floor(Math.random() * REGIONS.length)];

const serviceIntegration = (tier: string) => {
  if (tier === 'PREMIUM') return 'tier-0';
  if (tier === 'REGULAR') return Math.random() < 0.5 ? 'tier-1' : 'tier-2';
  return 'tier-3';
};

const app = Fastify({ logger: true });
registerMetrics(app);

app.get('/health', async () => ({ status: 'ok' }));

let transactionCount = 0;

app.get('/get-transaction', async (_request, reply) => {
  transactionCount++;
  const context = { properties: { region: randomRegion() } };
  if (polling.isEnabled('extend-get-transaction', context) && transactionCount % 5 === 0) {
    polling.impactMetrics?.incrementCounter('demo_get_transaction_error_total');
    return reply.code(500).send({ error: 'simulated failure' });
  }
  polling.impactMetrics?.incrementCounter('demo_get_transaction_success_total');
  return { ok: true, count: transactionCount };
});

// Traffic epoch starts at the first request and resets when the calculation
// flags disengage or after an idle gap - so every fresh load test starts healthy.
let epochStart: number | null = null;
let lastRequestAt = 0;
const CACHED_CALCULATION_RESPONSE = { value: 'CACHED', cached: true };

app.put('/schedule-calculation', async (request) => {
  const start = Date.now();
  const context = { properties: { region: randomRegion() } };
  const calculationOn =
    streaming.isEnabled('enable-progressive-calculation_quicker', context) ||
    polling.isEnabled('enable-progressive-calculation', context);
  if (!calculationOn) {
    epochStart = null;
    scheduleCalculationResponses.inc({ served: 'cached' });
    streaming.impactMetrics?.observeHistogram(
      'demo_schedule_calculation_duration_ms',
      Date.now() - start,
    );
    return CACHED_CALCULATION_RESPONSE;
  }
  const now = Date.now();
  if (epochStart === null || now - lastRequestAt > IDLE_RESET_SECONDS * 1000) epochStart = now;
  lastRequestAt = now;
  const t = (now - epochStart) / 1000;
  const ramp = Math.min(Math.max((t - HEALTHY_SECONDS) / RAMP_SECONDS, 0), 1);
  const delayMs = ramp * MAX_DELAY_MS * (0.85 + 0.3 * Math.random());
  if (delayMs > 0) await sleep(delayMs);
  const ts = (request.query as { ts?: string }).ts ?? String(Math.floor(now / 1000));
  scheduleCalculationResponses.inc({ served: 'calculated' });
  streaming.impactMetrics?.observeHistogram(
    'demo_schedule_calculation_duration_ms',
    Date.now() - start,
  );
  return { value: Buffer.from(ts).toString('base64'), epochSeconds: Math.round(t) };
});

const STATIC_TRANSACTION_RESPONSE = { now: 'STATIC', static: true };

app.post('/write-transaction', async (request, reply) => {
  const b64 = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
  const userTier = decoded || 'FREE';
  const region = randomRegion();
  const integration = serviceIntegration(userTier);
  const context = {
    properties: { region, userTier, 'service-integration': integration },
  };
  const labels = { tier: userTier, region, service_integration: integration };
  if (streaming.isEnabled('drop-write-transaction-traffic', context)) {
    writeTransactionRequests.inc({ ...labels, served: 'dropped' });
    reply.hijack();
    request.raw.socket.destroy();
    return;
  }
  if (streaming.isEnabled('static-response-for-write-transaction-traffic', context)) {
    writeTransactionRequests.inc({ ...labels, served: 'static' });
    return STATIC_TRANSACTION_RESPONSE;
  }
  writeTransactionRequests.inc({ ...labels, served: 'live' });
  return { now: new Date().toISOString(), userTier };
});

await waitForSync();
await app.listen({ port: 3000, host: '0.0.0.0' });
