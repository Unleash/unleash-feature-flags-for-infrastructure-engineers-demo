import { Unleash } from 'unleash-client';

const url = process.env.UNLEASH_URL ?? 'http://unleash:4242/api/';
const token = process.env.UNLEASH_BACKEND_TOKEN ?? '';

export const polling = new Unleash({
  url,
  appName: 'safeguards-demo-api',
  instanceId: 'polling',
  customHeaders: { Authorization: token },
  refreshInterval: 2_000,
  metricsInterval: 1_000,
});

export const streaming = new Unleash({
  url,
  appName: 'safeguards-demo-api',
  instanceId: 'streaming',
  customHeaders: { Authorization: token },
  refreshInterval: 2_000,
  metricsInterval: 1_000,
  experimentalMode: { type: 'streaming' },
});

for (const client of [polling, streaming]) {
  client.on('error', (error) => console.error('unleash error', error));
  client.on('warn', (message) => console.warn('unleash warn', message));
}

polling.impactMetrics?.defineCounter(
  'demo_get_transaction_success_total',
  'Successful /get-transaction responses',
);
polling.impactMetrics?.defineCounter(
  'demo_get_transaction_error_total',
  'Failed /get-transaction responses',
);
streaming.impactMetrics?.defineHistogram(
  'demo_schedule_calculation_duration_ms',
  'Duration of /schedule-calculation responses in milliseconds',
  [5, 25, 100, 500, 1000, 2500, 5000, 10000, 15000, 20000],
);

export const waitForSync = () =>
  Promise.race([
    Promise.all(
      [polling, streaming].map(
        (client) => new Promise<void>((resolve) => client.once('synchronized', resolve)),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
