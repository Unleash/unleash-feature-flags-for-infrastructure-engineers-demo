const BASE = process.env.UNLEASH_URL ?? 'http://localhost:4242';
const HEADERS = {
  Authorization: process.env.UNLEASH_ADMIN_TOKEN,
  'Content-Type': 'application/json',
};

const FLAGS = [
  { name: 'extend-get-transaction', type: 'release' },
  { name: 'enable-progressive-calculation_quicker', type: 'operational' },
  { name: 'enable-progressive-calculation', type: 'operational' },
  { name: 'drop-write-transaction-traffic', type: 'kill-switch' },
  { name: 'static-response-for-write-transaction-traffic', type: 'kill-switch' },
];

const CONTEXT_FIELDS = [
  {
    name: 'userTier',
    description: 'Demo user tier',
    legalValues: [{ value: 'FREE' }, { value: 'REGULAR' }, { value: 'PREMIUM' }],
  },
  {
    name: 'region',
    description: 'Region of the incoming request',
    legalValues: [
      { value: 'AMER', description: 'Americas (🌎)' },
      { value: 'APAC', description: 'Asia-Pacific (🌏)' },
      { value: 'EEA', description: 'European Economic Area (🌍)' },
      { value: 'EU', description: 'European Union (🇪🇺)' },
      { value: 'US', description: 'United States (🇺🇸)' },
    ],
  },
  {
    name: 'service-integration',
    description: 'Service integration tier derived from the user tier',
    legalValues: [
      { value: 'tier-0', description: 'PREMIUM users' },
      { value: 'tier-1', description: 'REGULAR users (50%)' },
      { value: 'tier-2', description: 'REGULAR users (50%)' },
      { value: 'tier-3', description: 'FREE users' },
    ],
  },
];

const get = (path) => fetch(BASE + path, { headers: HEADERS });

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
};

async function seed() {
  for (const field of CONTEXT_FIELDS) {
    if (!(await get(`/api/admin/context/${field.name}`)).ok) {
      await post('/api/admin/context', { ...field, stickiness: false });
    }
  }

  // The EXTERNAL_PROMETHEUS_IMPACT_METRICS_API env var only seeds the URL;
  // enabling the external source must be persisted through the API.
  await post('/api/admin/impact-metrics/external-source', {
    enabled: true,
    url: 'http://prometheus:9090',
  });

  for (const flag of FLAGS) {
    if (!(await get(`/api/admin/projects/default/features/${flag.name}`)).ok) {
      await post('/api/admin/projects/default/features', {
        name: flag.name,
        type: flag.type,
        impressionData: false,
      });
    } else {
      // Enforce the type on existing flags, so type changes roll out on re-seed.
      const res = await fetch(`${BASE}/api/admin/projects/default/features/${flag.name}`, {
        method: 'PUT',
        headers: HEADERS,
        body: JSON.stringify({ type: flag.type, impressionData: false }),
      });
      if (!res.ok) throw new Error(`PUT feature ${flag.name} -> ${res.status}: ${await res.text()}`);
    }
    // Strategy creation is not idempotent, so only add one when none exist.
    // The environment toggle stays off: every flag starts disabled.
    const strategiesPath = `/api/admin/projects/default/features/${flag.name}/environments/development/strategies`;
    const existing = await (await get(strategiesPath)).json();
    if (!Array.isArray(existing) || existing.length === 0) {
      await post(strategiesPath, {
        name: 'flexibleRollout',
        constraints: [],
        parameters: { rollout: '100', stickiness: 'default', groupId: flag.name },
      });
    }
  }
}

for (let attempt = 1; ; attempt++) {
  try {
    await seed();
    console.log('Seed complete.');
    break;
  } catch (error) {
    if (attempt >= 10) throw error;
    console.warn(`Seed attempt ${attempt} failed, retrying: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
