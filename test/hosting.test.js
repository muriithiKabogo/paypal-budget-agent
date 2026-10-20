// Real hosting, with a local git repo standing in for GitHub and Render stubbed out.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const config = require('../src/config');
const render = require('../src/render');
const hosting = require('../src/hosting');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allowance-hosting-test-'));
const bare = path.join(tmp, 'sites.git');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const files = () => git('--git-dir', bare, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n');

let server;
let siteUrl;
let services; // what our fake Render workspace holds
let created;
let deleted;
let statuses;

test.before(async () => {
    git('init', '--quiet', '--bare', '-b', 'main', bare);
    const seed = path.join(tmp, 'seed');
    git('init', '--quiet', '-b', 'main', seed);
    git('-C', seed, 'remote', 'add', 'origin', bare);
    fs.mkdirSync(path.join(seed, 'sites'));
    fs.writeFileSync(path.join(seed, 'sites', '.gitkeep'), '');
    git('-C', seed, 'add', '-A');
    git('-C', seed, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', 'commit', '--quiet', '-m', 'seed');
    git('-C', seed, 'push', '--quiet', 'origin', 'HEAD:main');

    Object.assign(config, { sitesRepo: 'someone/allowance-sites', sitesGitUrl: bare, sitesDeployKeyFile: '/dev/null', renderApiKey: 'test', sitesPerDay: 10, sitesKeepDays: 7 });
    server = http.createServer((req, res) => res.end('ok'));
    await new Promise((resolve) => { server.listen(0, resolve); });
    siteUrl = `http://127.0.0.1:${server.address().port}/`;
});
test.after(() => {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});
test.beforeEach(() => {
    services = [];
    created = [];
    deleted = [];
    statuses = [];
    render.listSites = async (repo) => {
        assert.equal(repo, 'https://github.com/someone/allowance-sites');
        return services;
    };
    render.createStaticSite = async (details) => {
        created.push(details);
        return { id: `srv-${created.length}`, url: siteUrl, deployId: 'dep-1' };
    };
    render.deployStatus = async () => statuses.shift() || 'live';
    render.deleteService = async (id) => { deleted.push(id); };
});

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

test('deploy pushes the page to its own folder and serves that folder as a locked-down static site', async () => {
    const stages = [];
    const live = await hosting.deploy({ slug: 'mamasbakery-shop-a1b2c3', html: '<p>Hello</p>' }, (stage) => stages.push(stage));
    assert.deepEqual(live, { url: siteUrl, serviceId: 'srv-1' });
    assert.deepEqual(stages, ['push', 'create', 'build']);
    assert.ok(files().includes('sites/mamasbakery-shop-a1b2c3/index.html'));
    assert.equal(git('--git-dir', bare, 'show', 'main:sites/mamasbakery-shop-a1b2c3/index.html'), '<p>Hello</p>');
    assert.equal(created[0].rootDir, 'sites/mamasbakery-shop-a1b2c3');
    assert.equal(created[0].name, 'mamasbakery-shop-a1b2c3');
    assert.match(created[0].headers.find((h) => h.name === 'Content-Security-Policy').value, /default-src 'none'/);
    assert.match(git('--git-dir', bare, 'log', '-1', '--format=%an <%ae> %s', 'main'), /^Allowance agent <agent@allowance\.invalid> Add mamasbakery-shop-a1b2c3/);
});

test('a failed Render deploy leaves nothing behind', async () => {
    statuses = ['build_failed'];
    await assert.rejects(hosting.deploy({ slug: 'broken-site-000000', html: 'x' }), /build failed/);
    assert.deepEqual(deleted, ['srv-1']);
    assert.ok(!files().some((f) => f.startsWith('sites/broken-site-000000/')));
});

test('after the day\'s cap, nothing is pushed or created', async () => {
    services = Array.from({ length: 10 }, (_, i) => ({ id: `srv-${i}`, rootDir: `sites/s${i}`, createdAt: daysAgo(0.1) }));
    await assert.rejects(hosting.deploy({ slug: 'one-too-many-000000', html: 'x' }), /10 new sites for today are used up/);
    assert.equal(created.length, 0);
    assert.ok(!files().some((f) => f.startsWith('sites/one-too-many-000000/')));
});

test('a site id that could escape its folder is refused', async () => {
    await assert.rejects(hosting.deploy({ slug: '../server', html: 'x' }), /not valid/);
    assert.equal(created.length, 0);
});

test('cleanup takes down only week-old sites, on Render and in the repo', async () => {
    await hosting.deploy({ slug: 'old-site-111111', html: 'old' });
    await hosting.deploy({ slug: 'new-site-222222', html: 'new' });
    services = [
        { id: 'srv-old', rootDir: 'sites/old-site-111111', createdAt: daysAgo(8) },
        { id: 'srv-new', rootDir: 'sites/new-site-222222', createdAt: daysAgo(1) },
    ];
    assert.deepEqual(await hosting.cleanup(), ['old-site-111111']);
    assert.deepEqual(deleted, ['srv-old']);
    assert.ok(!files().some((f) => f.startsWith('sites/old-site-111111/')));
    assert.ok(files().includes('sites/new-site-222222/index.html'));
});
