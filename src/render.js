// A small Render API client: just what's needed to put a mission's website online as its own
// static site, watch the deploy, and take old demo sites down again.
const config = require('./config');

const BASE_URL = 'https://api.render.com/v1';

class RenderError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function isConfigured() {
    return Boolean(config.renderApiKey);
}

async function request(method, path, body) {
    if (!isConfigured()) throw new RenderError('RENDER_API_KEY is not set.', 0);
    const res = await fetch(BASE_URL + path, {
        method,
        headers: { Authorization: `Bearer ${config.renderApiKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
    });
    const json = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) throw new RenderError(`Render returned ${res.status}${json && json.message ? `: ${json.message}` : ''}`, res.status);
    return json;
}

let ownerId = null;
// The workspace sites go into: RENDER_OWNER_ID, or the only one the key can see.
async function owner() {
    if (config.renderOwnerId) return config.renderOwnerId;
    if (ownerId) return ownerId;
    const owners = await request('GET', '/owners?limit=20');
    if (owners.length !== 1) throw new RenderError(`this Render key sees ${owners.length} workspaces, so set RENDER_OWNER_ID to pick one`, 0);
    ownerId = owners[0].owner.id;
    return ownerId;
}

// A site is created once and never changed, so it deploys once, when it's created.
async function createStaticSite({ name, repo, rootDir, headers }) {
    const { service, deployId } = await request('POST', '/services', {
        type: 'static_site',
        name,
        ownerId: await owner(),
        repo,
        branch: 'main',
        rootDir,
        autoDeployTrigger: 'off',
        serviceDetails: { buildCommand: '', publishPath: '.', headers, previews: { generation: 'off' } },
    });
    return { id: service.id, url: service.serviceDetails.url, deployId };
}

async function deployStatus(serviceId, deployId) {
    const deploy = await request('GET', `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`);
    return deploy.status;
}

const sameRepo = (a, b) => String(a || '').toLowerCase().replace(/(\.git)?\/?$/, '') === String(b).toLowerCase().replace(/(\.git)?\/?$/, '');

// Every static site built from `repo`. Nothing else in the workspace is ever counted or deleted.
async function listSites(repo) {
    const found = [];
    let cursor = '';
    for (let page = 0; page < 20; page += 1) {
        const params = new URLSearchParams({ type: 'static_site', ownerId: await owner(), limit: '100' });
        if (cursor) params.set('cursor', cursor);
        const rows = await request('GET', `/services?${params}`);
        for (const { service } of rows) {
            if (sameRepo(service.repo, repo)) found.push({ id: service.id, name: service.name, rootDir: service.rootDir, createdAt: service.createdAt });
        }
        if (rows.length < 100) break;
        cursor = rows[rows.length - 1].cursor;
    }
    return found;
}

async function deleteService(serviceId) {
    await request('DELETE', `/services/${encodeURIComponent(serviceId)}`);
}

module.exports = { isConfigured, createStaticSite, deployStatus, listSites, deleteService, RenderError };
