import client from '@prometheus-io/client';
import type { FastifyInstance } from 'fastify';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const labelNames = ['method', 'route', 'status'];

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames,
  buckets: [0.005, 0.02, 0.1, 0.5, 1, 2.5, 5, 8, 10, 12, 15, 20],
  registers: [registry],
});

const httpResponses = new client.Counter({
  name: 'http_responses_total',
  help: 'HTTP responses by route, method, and status',
  labelNames,
  registers: [registry],
});

export const scheduleCalculationResponses = new client.Counter({
  name: 'demo_schedule_calculation_responses_total',
  help: '/schedule-calculation responses, split into calculated and cached',
  labelNames: ['served'],
  registers: [registry],
});

export const writeTransactionRequests = new client.Counter({
  name: 'demo_write_transaction_requests_total',
  help: '/write-transaction requests by user tier, split into live, static, and dropped',
  labelNames: ['tier', 'served', 'region', 'service_integration'],
  registers: [registry],
});

export function registerMetrics(app: FastifyInstance) {
  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      method: request.method,
      route: request.routeOptions?.url ?? 'unmatched',
      status: String(reply.statusCode),
    };
    httpDuration.observe(labels, reply.elapsedTime / 1000);
    httpResponses.inc(labels);
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });
}
