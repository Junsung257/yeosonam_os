import fs from 'node:fs';

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_ORG_ID;
const branch = process.env.BLOG_V4_PREVIEW_BRANCH;
const sha = process.env.GITHUB_SHA;

for (const [name, value] of Object.entries({ token, projectId, teamId, branch, sha })) {
  if (!value) throw new Error(`missing_${name}`);
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(`vercel_api_${response.status}:${body?.error?.code || 'request_failed'}`);
  }
  return body;
};

const query = `?teamId=${encodeURIComponent(teamId)}`;
const envs = await api(`/v9/projects/${encodeURIComponent(projectId)}/env${query}&decrypt=false`);
const existing = Array.isArray(envs?.envs) ? envs.envs : [];

const values = [
  ['SUPABASE_URL', process.env.SUPABASE_URL, 'encrypted'],
  ['NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL, 'encrypted'],
  ['SUPABASE_PROJECT_REF', process.env.SUPABASE_PROJECT_REF, 'encrypted'],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY, 'sensitive'],
  ['DEEPSEEK_API_KEY', process.env.DEEPSEEK_STAGING_API_KEY, 'sensitive'],
  ['BLOG_V4_SHARED_KEY_USED', process.env.BLOG_V4_SHARED_KEY_USED, 'encrypted'],
  ['CRON_SECRET', process.env.CRON_SECRET, 'sensitive'],
  ['BLOG_OPS_READ_TOKEN', process.env.BLOG_OPS_READ_TOKEN, 'sensitive'],
  ['BLOG_V4_ENVIRONMENT', 'staging', 'encrypted'],
  ['BLOG_ENVIRONMENT', 'staging', 'encrypted'],
  ['BLOG_GENERATION_CRON_ENABLED', 'false', 'encrypted'],
  ['BLOG_CONTENT_FACTORY_ENABLED', 'true', 'encrypted'],
  ['BLOG_AI_CONTROL_PLANE_ENABLED', '1', 'encrypted'],
  // SERP is advisory metadata. Keep the staging canary independent from any
  // inherited Naver credentials or a slow external search provider.
  ['BLOG_PUBLISHER_SERP_RESEARCH_ENABLED', '0', 'encrypted'],
  ['BLOG_AUTOPUBLISH_MODE', 'draft_only', 'encrypted'],
  ['BLOG_CONTENT_FACTORY_WORKFLOW_START_LIMIT', '1', 'encrypted'],
  // The staging branch contains two audited research-backlog operations.
  // Allow one additional operation slot for this canary while
  // BLOG_AUTOPUBLISH_MODE remains draft_only and publication stays at zero.
  ['BLOG_DAILY_PUBLISH_CAP', '3', 'encrypted'],
  // Historical staging audit rows have consumed the pilot_3 new-URL/type
  // slots. This only raises the Preview inventory ceiling; draft_only still
  // makes the effective publication count zero.
  ['BLOG_PUBLICATION_RAMP_STAGE', 'ramp_10', 'encrypted'],
  ['BLOG_AUTO_RAMP_ENABLED', 'false', 'encrypted'],
  ['BLOG_AUTO_ROLLBACK_ENABLED', 'true', 'encrypted'],
  ['BLOG_DAILY_AI_COST_CAP_USD', '0.25', 'encrypted'],
  ['BLOG_OPS_ALLOW_CRON_FALLBACK', '0', 'encrypted'],
].map(([key, value, type]) => ({ key, value, type }));

for (const env of values) {
  if (!env.value) throw new Error(`missing_preview_env_${env.key}`);
  const match = existing.find(
    (candidate) =>
      candidate.key === env.key &&
      candidate.gitBranch === branch &&
      Array.isArray(candidate.target) &&
      candidate.target.includes('preview'),
  );
  const payload = {
    key: env.key,
    value: env.value,
    target: ['preview'],
    type: env.type,
    gitBranch: branch,
  };
  if (match?.id) {
    await api(`/v9/projects/${encodeURIComponent(projectId)}/env/${encodeURIComponent(match.id)}${query}`, {
      method: 'DELETE',
    });
    await api(`/v10/projects/${encodeURIComponent(projectId)}/env${query}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } else {
    await api(`/v10/projects/${encodeURIComponent(projectId)}/env${query}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

const project = await api(`/v9/projects/${encodeURIComponent(projectId)}${query}`);
const repoId = project?.link?.repoId;
if (!repoId) throw new Error('vercel_github_repo_id_missing');

const deployment = await api(`/v13/deployments${query}&forceNew=1`, {
  method: 'POST',
  body: JSON.stringify({
    name: project.name,
    project: projectId,
    gitSource: {
      type: 'github',
      repoId,
      ref: branch,
      sha,
    },
  }),
});

if (!deployment?.id && !deployment?.uid) throw new Error('vercel_preview_deployment_id_missing');
const deploymentId = deployment.id || deployment.uid;
const deadline = Date.now() + 12 * 60 * 1000;
let latest = deployment;
while (Date.now() < deadline) {
  const current = await api(`/v13/deployments/${encodeURIComponent(deploymentId)}${query}`);
  latest = current;
  const state = current.readyState || current.state;
  if (state === 'READY') break;
  if (['ERROR', 'CANCELED'].includes(state)) throw new Error(`vercel_preview_${String(state).toLowerCase()}`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const finalState = latest.readyState || latest.state;
if (finalState !== 'READY' || !latest.url) throw new Error(`vercel_preview_not_ready:${finalState || 'unknown'}`);

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `url=https://${latest.url}\n`);
if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `preview_url=https://${latest.url}\n`);
console.log(JSON.stringify({ state: 'READY', target: 'preview', branch, sha, deploymentId, url: `https://${latest.url}` }));
