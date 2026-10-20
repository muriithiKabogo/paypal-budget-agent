// Real hosting for the websites missions build. Once the agent has paid for hosting, the page is
// pushed to its own folder in a public GitHub repo and Render serves that folder as a static site
// at <site>.onrender.com. The domain the agent bought stays simulated. If this isn't set up, or any
// part of it fails, the mission still ends with the copy served here at /sites/<slug>.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const render = require('./render');
const { CSP } = require('./sites');

// GitHub's SSH host keys (from https://api.github.com/meta), so a push can only ever go to GitHub.
const KNOWN_HOSTS = path.join(__dirname, 'github_known_hosts');
const CHECKOUT = path.join(os.tmpdir(), `allowance-sites-${process.pid}`);
const DAY_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 3000;
const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000;
const FAILED = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);
// The same lockdown as /sites/<slug>: the page can't run scripts, load anything or submit forms.
const HEADERS = [
    { path: '/*', name: 'Content-Security-Policy', value: CSP },
    { path: '/*', name: 'X-Content-Type-Options', value: 'nosniff' },
];
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

class HostingError extends Error {}

function isConfigured() {
    return Boolean(config.sitesGitUrl && config.sitesDeployKeyFile && render.isConfigured());
}

const repoUrl = () => `https://github.com/${config.sitesRepo}`;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// ssh refuses a private key that anyone else can read, and a secret file mounted by a host may be,
// so in that case use a copy only this process can read.
let keyCopy = null;
function privateKey() {
    const key = config.sitesDeployKeyFile;
    if (keyCopy) return keyCopy;
    const stat = fs.statSync(key);
    if (stat.uid === process.getuid() && !(stat.mode & 0o077)) return key;
    keyCopy = path.join(os.tmpdir(), `allowance-sites-key-${process.pid}`);
    fs.writeFileSync(keyCopy, fs.readFileSync(key), { mode: 0o600 });
    return keyCopy;
}

function git(args, cwd) {
    let key;
    try {
        key = privateKey();
    } catch (err) {
        return Promise.reject(new HostingError(`can't read the deploy key (${err.message})`));
    }
    if (key.includes("'")) return Promise.reject(new HostingError('SITES_DEPLOY_KEY_FILE has a quote in it'));
    const ssh = `ssh -i '${key}' -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='${KNOWN_HOSTS}'`;
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, timeout: 60000, env: { ...process.env, GIT_SSH_COMMAND: ssh, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
            if (err) return reject(new HostingError(`git ${args[0]} failed: ${String(stderr || err.message).trim().split('\n').pop()}`));
            return resolve(stdout);
        });
    });
}

// One change to the repo at a time, so two missions finishing together don't trip over each other.
let queue = Promise.resolve();
function serially(job) {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
}

async function checkout() {
    if (fs.existsSync(path.join(CHECKOUT, '.git'))) {
        await git(['fetch', '--quiet', '--depth', '1', 'origin', 'main'], CHECKOUT);
        await git(['reset', '--quiet', '--hard', 'origin/main'], CHECKOUT);
        await git(['clean', '-fdq'], CHECKOUT);
        return;
    }
    fs.rmSync(CHECKOUT, { recursive: true, force: true });
    await git(['clone', '--quiet', '--depth', '1', '--branch', 'main', config.sitesGitUrl, CHECKOUT], os.tmpdir());
}

// Makes a change on top of the latest main and pushes it. If another server pushed in between,
// it starts again from theirs.
function changeRepo(message, change) {
    return serially(async () => {
        for (let attempt = 1; ; attempt += 1) {
            await checkout();
            change(CHECKOUT);
            await git(['add', '-A'], CHECKOUT);
            if (!(await git(['status', '--porcelain'], CHECKOUT)).trim()) return;
            await git(['-c', 'user.name=Allowance agent', '-c', 'user.email=agent@allowance.invalid', 'commit', '--quiet', '-m', message], CHECKOUT);
            try {
                await git(['push', '--quiet', 'origin', 'HEAD:main'], CHECKOUT);
                return;
            } catch (err) {
                if (attempt === 2) throw err;
            }
        }
    });
}

const removeFolders = (slugs) => (dir) => slugs.forEach((slug) => fs.rmSync(path.join(dir, 'sites', slug), { recursive: true, force: true }));

// Render can report "live" a moment before the CDN answers, so wait briefly for the page itself.
async function answers(url) {
    for (let i = 0; i < 10; i += 1) {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (res && res.ok) return true;
        await sleep(2000);
    }
    return false;
}

const deploying = new Set();

// Puts one site online and waits until Render says it's live. `progress` hears each stage:
// 'push', 'create', then 'build'.
async function deploy({ slug, html }, progress = () => {}) {
    if (!SLUG.test(slug)) throw new HostingError('that site id is not valid');
    const today = (await render.listSites(repoUrl())).filter((s) => Date.now() - Date.parse(s.createdAt) < DAY_MS).length;
    if (today + deploying.size >= config.sitesPerDay) throw new HostingError(`the demo's ${config.sitesPerDay} new sites for today are used up`);
    deploying.add(slug);
    let service = null;
    try {
        progress('push');
        await changeRepo(`Add ${slug}`, (dir) => {
            fs.mkdirSync(path.join(dir, 'sites', slug), { recursive: true });
            fs.writeFileSync(path.join(dir, 'sites', slug, 'index.html'), html);
        });
        progress('create');
        service = await render.createStaticSite({ name: slug, repo: repoUrl(), rootDir: `sites/${slug}`, headers: HEADERS });
        progress('build');
        const started = Date.now();
        for (;;) {
            const status = await render.deployStatus(service.id, service.deployId);
            if (status === 'live') break;
            if (FAILED.has(status)) throw new HostingError(`Render's deploy ended as "${status.replace(/_/g, ' ')}"`);
            if (Date.now() - started > DEPLOY_TIMEOUT_MS) throw new HostingError('Render took more than 5 minutes');
            await sleep(POLL_MS);
        }
        await answers(service.url);
        return { url: service.url, serviceId: service.id };
    } catch (err) {
        // Leave nothing half-made behind.
        if (service) await render.deleteService(service.id).catch(() => {});
        await changeRepo(`Remove ${slug}`, removeFolders([slug])).catch(() => {});
        throw err;
    } finally {
        deploying.delete(slug);
    }
}

// Takes down demo sites older than SITES_KEEP_DAYS: the Render site and its folder in the repo.
// A folder with a KEEP file in it is pinned (the landing page replays that mission) and stays up.
async function cleanup() {
    if (!isConfigured()) return [];
    const cutoff = Date.now() - config.sitesKeepDays * DAY_MS;
    let old = (await render.listSites(repoUrl())).filter((s) => Date.parse(s.createdAt) < cutoff && /^sites\/[a-z0-9-]+$/.test(s.rootDir));
    if (!old.length) return [];
    const pinned = await serially(async () => {
        await checkout();
        return (slug) => fs.existsSync(path.join(CHECKOUT, 'sites', slug, 'KEEP'));
    });
    old = old.filter((s) => !pinned(s.rootDir.slice('sites/'.length)));
    for (const site of old) await render.deleteService(site.id);
    const slugs = old.map((s) => s.rootDir.slice('sites/'.length));
    if (slugs.length) await changeRepo(`Remove ${slugs.length} expired site${slugs.length === 1 ? '' : 's'}`, removeFolders(slugs));
    return slugs;
}

module.exports = { isConfigured, deploy, cleanup, HostingError };
