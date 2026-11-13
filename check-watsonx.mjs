// check-watsonx.mjs — verifies the watsonx.ai settings in .env
// Run from the Maestro folder:  node --env-file=.env check-watsonx.mjs
// Never prints your API key.

const { WATSONX_URL, WATSONX_API_KEY, WATSONX_PROJECT_ID } = process.env;
const VERSION = '2024-05-01';

function fail(step, msg) {
  console.error(`\n✗ ${step} failed: ${msg}`);
  process.exit(1);
}

// ── 1. Are the three values present? ─────────────────────────────────────────
console.log('1. Reading .env');
for (const [name, val] of Object.entries({ WATSONX_URL, WATSONX_API_KEY, WATSONX_PROJECT_ID })) {
  if (!val || val.includes('your_')) fail('Step 1', `${name} is missing or still the placeholder`);
}
console.log(`   ✓ URL = ${WATSONX_URL}`);
console.log(`   ✓ Project ID = ${WATSONX_PROJECT_ID.slice(0, 8)}…`);
console.log(`   ✓ API key found (${WATSONX_API_KEY.length} characters)`);

// ── 2. Can the API key get an IAM token? ─────────────────────────────────────
console.log('\n2. Exchanging API key for an IBM Cloud token');
const tokenRes = await fetch('https://iam.cloud.ibm.com/identity/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams({
    grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
    apikey: WATSONX_API_KEY,
  }),
});
if (!tokenRes.ok) fail('Step 2', `HTTP ${tokenRes.status} — the API key is wrong or was deleted`);
const { access_token } = await tokenRes.json();
console.log('   ✓ Token received');

const auth = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json', Accept: 'application/json' };

// ── 3. Which Granite models are available in this region? ────────────────────
console.log('\n3. Listing models in your region');
const specsRes = await fetch(`${WATSONX_URL}/ml/v1/foundation_model_specs?version=${VERSION}&limit=200`, { headers: auth });
if (!specsRes.ok) fail('Step 3', `HTTP ${specsRes.status} — check WATSONX_URL (wrong region?)`);
const specs = (await specsRes.json()).resources ?? [];
const hasFn = (m, fn) => (m.functions ?? []).some(f => f.id === fn);
const chatModels = specs.filter(m => m.model_id.includes('granite') && hasFn(m, 'text_chat')).map(m => m.model_id);
const embedModels = specs.filter(m => hasFn(m, 'embedding')).map(m => m.model_id);
console.log(`   Granite chat models: ${chatModels.join(', ') || '(none)'}`);
console.log(`   Embedding models:    ${embedModels.join(', ') || '(none)'}`);
if (!chatModels.length) fail('Step 3', 'no Granite chat model in this region');

// ── 4. Can we actually call a model with this project? ───────────────────────
const chatModel = chatModels[0];
console.log(`\n4. Test chat call with ${chatModel}`);
const chatRes = await fetch(`${WATSONX_URL}/ml/v1/text/chat?version=${VERSION}`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    model_id: chatModel,
    project_id: WATSONX_PROJECT_ID,
    messages: [{ role: 'user', content: 'Reply with exactly: watsonx works' }],
    max_tokens: 20,
  }),
});
if (!chatRes.ok) {
  const text = await chatRes.text();
  fail('Step 4', `HTTP ${chatRes.status} — ${text.slice(0, 300)}\n   (403/404 usually means the project ID is wrong or the project has no watsonx.ai Runtime service associated)`);
}
const reply = (await chatRes.json()).choices?.[0]?.message?.content ?? '(empty)';
console.log(`   ✓ Model replied: "${reply.trim()}"`);

// ── 5. Embeddings ────────────────────────────────────────────────────────────
const embedModel = embedModels.find(m => m.includes('granite')) ?? embedModels[0];
if (embedModel) {
  console.log(`\n5. Test embedding call with ${embedModel}`);
  const embRes = await fetch(`${WATSONX_URL}/ml/v1/text/embeddings?version=${VERSION}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ model_id: embedModel, project_id: WATSONX_PROJECT_ID, inputs: ['fix login bug'] }),
  });
  if (!embRes.ok) fail('Step 5', `HTTP ${embRes.status} — ${(await embRes.text()).slice(0, 300)}`);
  const vec = (await embRes.json()).results?.[0]?.embedding ?? [];
  console.log(`   ✓ Got a vector with ${vec.length} numbers`);
}

console.log('\nAll good. Tell Claude which chat and embedding model names were listed above.');
