import { writeFileSync } from 'node:fs';

const DS = { type: 'prometheus', uid: 'prometheus' };
const DS_IMPACT = { type: 'prometheus', uid: 'prometheus-internal-impact-metrics' };
const APP = 'route!~"/metrics|/health"';

// Unified palette: red = failures/max, green = success, yellow/orange = p99/p99.9,
// blue/purple/magenta = tiers, grays = cached, cyans = memory, earth tones = GC.
const QUANTILES = { p99: 'yellow', 'p99.9': 'orange', 'max (bucketed)': 'red' };
const TIERS = { FREE: 'blue', REGULAR: 'purple', PREMIUM: '#E02F9C' };
const TIER_COMBOS = {
  'FREE (live)': '#5794F2',
  'FREE (static)': '#E6E6E6',
  'FREE (dropped)': '#FFA6A6',
  'REGULAR (live)': '#B877D9',
  'REGULAR (static)': '#B3B3B3',
  'REGULAR (dropped)': '#F2495C',
  'PREMIUM (live)': '#E02F9C',
  'PREMIUM (static)': '#808080',
  'PREMIUM (dropped)': '#C4162A',
};
const REGIONS = { AMER: '#8AB8FF', APAC: '#B877D9', EEA: '#2CC7C7', EU: '#FADE2A', US: '#E02F9C' };
// Service-integration tiers echo the user-tier colors they derive from.
const SERVICE_INTEGRATION = {
  'tier-0': '#E02F9C',
  'tier-1': '#B877D9',
  'tier-2': '#7C43A0',
  'tier-3': '#5794F2',
};
const MEMORY = { RSS: '#2CC7C7', 'heap used': '#1F8F8F', 'heap total': '#8FE3E3' };
const GC_KINDS = { minor: '#A9A9A9', major: '#8F6E4B', incremental: '#D2B48C', weakcb: '#6B6B6B' };

const colorOverrides = (map) =>
  Object.entries(map).map(([name, color]) => ({
    matcher: { id: 'byName', options: name },
    properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: color } }],
  }));

let id = 0;
const panel = (title, unit, targets, gridPos, datasource = DS, defaults = {}, overrides = []) => ({
  id: ++id,
  title,
  type: 'timeseries',
  gridPos,
  datasource,
  fieldConfig: { defaults: { unit, ...defaults }, overrides },
  targets: targets.map(([expr, legendFormat], i) => ({
    refId: String.fromCharCode(65 + i),
    expr,
    legendFormat,
  })),
});

// ">= 0" drops NaN samples (histogram_quantile / 0-by-0 division over idle
// counters), then "or" backfills 0 - so idle charts draw a zero line instead
// of gaps.
const zeroFill = (expr) => `((${expr}) >= 0) or vector(0)`;

const q = (quantile, filter) =>
  `histogram_quantile(${quantile}, sum by (le) (rate(http_request_duration_seconds_bucket{${filter}}[$__rate_interval])))`;

const latencyTargets = (filter) => [
  [zeroFill(q('0.99', filter)), 'p99'],
  [zeroFill(q('0.999', filter)), 'p99.9'],
  [zeroFill(q('1', filter)), 'max (bucketed)'],
];

const common = (route, y) => [
  panel(`${route} latency (p99 / p99.9 / max)`, 's', latencyTargets(`route="${route}"`),
    { h: 8, w: 12, x: 0, y }, DS, { min: 0 }, colorOverrides(QUANTILES)),
  panel('Latency overall (p99 / p99.9 / max)', 's', latencyTargets(APP),
    { h: 8, w: 12, x: 12, y }, DS, { min: 0 }, colorOverrides(QUANTILES)),
  panel('TCP connections', 'short', [
    ['nodejs_active_resources{type="TCPSocketWrap", job="api"}', 'sockets'],
  ], { h: 8, w: 12, x: 0, y: y + 8 }, DS, {}, colorOverrides({ sockets: '#CCCCDC' })),
  panel('Memory', 'bytes', [
    ['process_resident_memory_bytes{job="api"}', 'RSS'],
    ['nodejs_heap_size_used_bytes{job="api"}', 'heap used'],
    ['nodejs_heap_size_total_bytes{job="api"}', 'heap total'],
  ], { h: 8, w: 12, x: 12, y: y + 8 }, DS, {}, colorOverrides(MEMORY)),
  panel('GC pause p99 by kind', 's', [
    ['histogram_quantile(0.99, sum by (le, kind) (rate(nodejs_gc_duration_seconds_bucket{job="api"}[$__rate_interval])))', '{{kind}}'],
  ], { h: 8, w: 12, x: 0, y: y + 16 }, DS, {}, colorOverrides(GC_KINDS)),
  panel('GC time per second by kind', 's', [
    ['sum by (kind) (rate(nodejs_gc_duration_seconds_sum{job="api"}[$__rate_interval]))', '{{kind}}'],
  ], { h: 8, w: 12, x: 12, y: y + 16 }, DS, {}, colorOverrides(GC_KINDS)),
];

const dashboard = (uid, title, route, topPanels, commonY = 9) => ({
  uid,
  title,
  schemaVersion: 39,
  refresh: '1s',
  graphTooltip: 1,
  time: { from: 'now-5m', to: 'now' },
  timepicker: { refresh_intervals: ['1s', '2s', '5s', '10s', '30s', '1m'] },
  panels: [...topPanels, ...common(route, commonY)],
});

const dashboards = {
  'simple.json': dashboard('simple-demo', 'Get Transaction - Impact Metrics', '/get-transaction', [
    panel('/get-transaction RPS by status', 'reqps', [
      ['sum by (status) (rate(http_responses_total{route="/get-transaction"}[$__rate_interval]))', '{{status}}'],
    ], { h: 9, w: 8, x: 0, y: 0 }, DS, {}, colorOverrides({ 200: 'green', 500: 'red' })),
    panel('/get-transaction error ratio', 'percentunit', [
      [zeroFill('sum(rate(http_responses_total{route="/get-transaction",status=~"5.."}[$__rate_interval])) / sum(rate(http_responses_total{route="/get-transaction"}[$__rate_interval]))'), 'errors'],
    ], { h: 9, w: 8, x: 8, y: 0 }, DS, { min: 0, max: 1, color: { mode: 'fixed', fixedColor: 'red' } }),
    panel('Impact metrics (via Unleash)', 'reqps', [
      ['sum(rate(demo_get_transaction_success_total{job="unleash-impact-metrics"}[$__rate_interval]))', 'success'],
      ['sum(rate(demo_get_transaction_error_total{job="unleash-impact-metrics"}[$__rate_interval]))', 'error'],
    ], { h: 9, w: 8, x: 16, y: 0 }, DS_IMPACT, {}, colorOverrides({ success: 'green', error: 'red' })),
  ]),
  'streaming.json': dashboard('streaming-demo', 'Schedule Calculation - Streaming vs Polling', '/schedule-calculation', [
    panel('/schedule-calculation RPS: calculated vs cached', 'reqps', [
      ['(sum by (served) (rate(demo_schedule_calculation_responses_total[$__rate_interval]))) or label_replace(vector(0), "served", "calculated", "", "") or label_replace(vector(0), "served", "cached", "", "")', '{{served}}'],
    ], { h: 9, w: 24, x: 0, y: 0 }, DS, { min: 0 }, colorOverrides({ calculated: 'green', cached: '#FFFFFF' })),
  ]),
  'load-shedding.json': dashboard('load-shedding-demo', 'Write Transaction - Load Shedding', '/write-transaction', [
    panel('/write-transaction RPS by tier', 'reqps', [
      ['sum by (tier) (rate(demo_write_transaction_requests_total[$__rate_interval]))', '{{tier}}'],
    ], { h: 9, w: 12, x: 0, y: 0 }, DS, {}, colorOverrides(TIERS)),
    panel('/write-transaction RPS by tier: live vs static vs dropped', 'reqps', [
      ['sum by (tier, served) (rate(demo_write_transaction_requests_total[$__rate_interval]))', '{{tier}} ({{served}})'],
    ], { h: 9, w: 12, x: 12, y: 0 }, DS, {}, colorOverrides(TIER_COMBOS)),
    panel('/write-transaction RPS by region', 'reqps', [
      ['sum by (region) (rate(demo_write_transaction_requests_total[$__rate_interval]))', '{{region}}'],
    ], { h: 9, w: 12, x: 0, y: 9 }, DS, {}, colorOverrides(REGIONS)),
    panel('/write-transaction RPS by service-integration', 'reqps', [
      ['sum by (service_integration) (rate(demo_write_transaction_requests_total[$__rate_interval]))', '{{service_integration}}'],
    ], { h: 9, w: 12, x: 12, y: 9 }, DS, {}, colorOverrides(SERVICE_INTEGRATION)),
  ], 18),
};

const outDir = new URL('./dashboards/', import.meta.url);
for (const [file, content] of Object.entries(dashboards)) {
  writeFileSync(new URL(file, outDir), JSON.stringify(content, null, 2) + '\n');
  console.log('wrote', file);
}
