const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');

const source = readFileSync(resolve(__dirname, '../gmail2obsidian.gs'), 'utf8');

// In-memory Gmail, Drive, and lock services; never access a Google account.
function fixture({ routes, threads = [], files = { '@inbox.md': 'Existing notes\n' }, failWrites = [] } = {}) {
  const events = [];
  const cacheEntries = new Map();
  const properties = new Map();
  const clock = { now: 1000 };
  let uuidCounter = 0;
  const contents = { ...files };
  const gmailThreads = threads.map((item, index) => {
    const names = new Set(item.labels);
    return {
      names,
      archived: false,
      getId: () => item.id || String(index),
      getFirstMessageSubject: () => item.subject || 'Subject',
      getMessages: () => [{ getPlainBody: () => item.body || '' }],
      getLabels: () => [...names].map((name) => labels.get(name)),
      removeLabel(label) {
        events.push('remove:' + label.getName());
        names.delete(label.getName());
      },
      moveToArchive() {
        events.push('archive');
        this.archived = true;
      },
    };
  });
  const config = {
    VAULT_FOLDER_ID: 'test-vault',
    ROUTES: routes || [{ label: 'obsidian', file: '@inbox.md' }],
  };
  const labelNames = new Set([
    ...config.ROUTES.map((route) => route.label),
    ...threads.flatMap((thread) => thread.labels),
  ]);
  const labels = new Map([...labelNames].map((name) => [name, {
    getName: () => name,
    getThreads: (start, count) => gmailThreads.filter((thread) => thread.names.has(name)).slice(start, start + count),
  }]));
  const context = vm.createContext({
    CONFIG: config,
    GmailApp: {
      getUserLabels: () => [...labels.values()],
      getUserLabelByName: (name) => labels.get(name),
    },
    DriveApp: {
      getFolderById: () => ({
        getFilesByName: (name) => ({
          hasNext: () => Object.hasOwn(contents, name),
          next: () => ({
            getBlob: () => ({ getDataAsString: () => contents[name] }),
            setContent(value) {
              if (failWrites.includes(name)) throw new Error('Drive write failed');
              events.push('write:' + name);
              contents[name] = value;
            },
          }),
        }),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (timeout) => { events.push('lock:' + timeout); return true; },
        waitLock: (timeout) => events.push('lock:' + timeout),
        releaseLock: () => events.push('unlock'),
      }),
    },
    CacheService: { getUserCache: () => ({
      put: (key, value) => cacheEntries.set(key, value),
      get: (key) => cacheEntries.get(key) || null,
      remove: (key) => cacheEntries.delete(key),
    }) },
    Date: { now: () => clock.now },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || null,
      setProperty: (key, value) => properties.set(key, value),
    }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      computeHmacSha256Signature: (payload, secret) => [...createHmac('sha256', secret).update(payload).digest()],
      formatDate: () => '2026-01-01',
      getUuid: () => (++uuidCounter).toString(16).padStart(32, '0'),
    },
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'default' },
      createHtmlOutput: (html) => ({ html, setXFrameOptionsMode() { return this; } }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Session: {
      getScriptTimeZone: () => 'UTC',
      getActiveUser: () => ({ getEmail: () => 'owner@example.test' }),
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }),
    },
  });
  vm.runInContext(source, context, { filename: 'gmail2obsidian.gs' });
  // Retain the real Date constructor for dated flush headers; override only now.
  const TestDate = class extends Date { static now() { return clock.now; } };
  context.Date = TestDate;
  return { context, config, contents, events, gmailThreads, cacheEntries, clock, properties };
}

test('flush prepends tasks before clearing labels and is idempotent on retry', () => {
  const { context, contents, events, gmailThreads } = fixture({
    threads: [{ labels: ['obsidian'], subject: 'Review notes', body: 'Please\n review   them.' }],
  });
  assert.equal(context.flushToObsidian_()[0].count, 1);
  assert.equal(contents['@inbox.md'], '#process\n\n## Flushed 2026-01-01\n- [ ] Review notes (body: Please review them\\.)\n\nExisting notes\n');
  assert.deepEqual(events, ['lock:30000', 'write:@inbox.md', 'remove:obsidian', 'archive', 'unlock']);
  assert.equal(gmailThreads[0].archived, true);
  const afterFirstFlush = contents['@inbox.md'];
  assert.equal(context.flushToObsidian_()[0].count, 0);
  assert.equal(contents['@inbox.md'], afterFirstFlush);
});

test('failed writes preserve email labels and allow other routes to continue', () => {
  const { context, contents, gmailThreads, events } = fixture({
    routes: [{ label: 'obsidian', file: '@inbox.md' }, { label: 'notes', file: 'notes.md' }],
    threads: [{ labels: ['obsidian'] }, { labels: ['notes'] }],
    files: { '@inbox.md': 'Unchanged', 'notes.md': '' },
    failWrites: ['@inbox.md'],
  });
  const results = context.flushToObsidian_();
  assert.equal(results.find((result) => result.label === 'obsidian').error, 'Drive write failed');
  assert.equal(results.find((result) => result.label === 'notes').count, 1);
  assert.equal(contents['@inbox.md'], 'Unchanged');
  assert.equal(gmailThreads[0].names.has('obsidian'), true);
  assert.equal(gmailThreads[0].archived, false);
  assert.equal(gmailThreads[1].archived, true);
  assert.equal(events.at(-1), 'unlock');
});

test('child routes win over parent labels and clear both after a successful write', () => {
  const { context, contents, gmailThreads } = fixture({
    threads: [{ labels: ['obsidian', 'obsidian/parsefood'], subject: 'Recipe' }],
    files: { '@inbox.md': 'Inbox', 'parsefood.md': '' },
  });
  const results = context.flushToObsidian_();
  assert.equal(results.find((result) => result.label === 'obsidian/parsefood').count, 1);
  assert.equal(results.find((result) => result.label === 'obsidian').count, 0);
  assert.match(contents['parsefood.md'], /- \[ \] Recipe/);
  assert.equal(contents['@inbox.md'], 'Inbox');
  assert.equal(gmailThreads[0].names.size, 0);
});

test('missing child files fall back to the inbox with the label tag', () => {
  const { context, contents } = fixture({
    threads: [{ labels: ['obsidian/parsefood'], subject: 'Recipe' }],
  });
  assert.equal(context.flushToObsidian_()[0].file, '@inbox.md');
  assert.match(contents['@inbox.md'], /- \[ \] #parsefood Recipe/);
});

test('legacy thread markers prevent duplicate writes while cleaning up labels', () => {
  const existing = '<!-- gmail2obsidian-thread:abc -->\nOld task\n';
  const { context, contents, gmailThreads } = fixture({
    threads: [{ id: 'abc', labels: ['obsidian'] }],
    files: { '@inbox.md': existing },
  });
  assert.equal(context.flushToObsidian_()[0].count, 0);
  assert.equal(contents['@inbox.md'], existing);
  assert.equal(gmailThreads[0].names.size, 0);
  assert.equal(gmailThreads[0].archived, true);
});

test('configuration errors release the lock', () => {
  const { context, config, events } = fixture();
  config.ROUTES = [];
  assert.throws(() => context.flushToObsidian_(), /CONFIG.ROUTES must be a non-empty array/);
  assert.deepEqual(events, ['lock:30000', 'unlock']);
});

test('process tags match whole tags and are only added once', () => {
  const { context } = fixture();
  assert.equal(context.ensureProcessTag_('#process\nTask'), '#process\nTask');
  assert.equal(context.ensureProcessTag_('#processing\nTask'), '#process\n\n#processing\nTask');
});

test('display escaping protects Markdown links and HTML summaries', () => {
  const { context } = fixture();
  assert.equal(context.escapeMd_('[Title](url)'), '\\[Title\\]\\(url\\)');
  assert.equal(context.escapeHtml_('<script a="b">&'), '&lt;script a=&quot;b&quot;&gt;&amp;');
});

function prepareIntent(context) {
  const page = context.doGet();
  const token = page.html.match(/\.confirmFlush\("([a-f0-9]{64})"\)/)[1];
  return { page, token };
}

test('opening GET prepares confirmation without reading or mutating Gmail/Drive', () => {
  const { context, events, contents, cacheEntries, gmailThreads } = fixture({
    threads: [{ labels: ['obsidian'], subject: 'Queued email' }],
  });
  context.GmailApp = new Proxy({}, { get() { throw new Error('GET accessed Gmail'); } });
  context.DriveApp = new Proxy({}, { get() { throw new Error('GET accessed Drive'); } });
  const { page } = prepareIntent(context);
  assert.match(page.html, /addEventListener\('click'/);
  assert.equal(cacheEntries.size, 1);
  assert.deepEqual(events, []);
  assert.equal(contents['@inbox.md'], 'Existing notes\n');
  assert.equal(gmailThreads[0].archived, false);
});

test('explicit confirmation mutates once; forged and replayed tokens do not', () => {
  const { context, events, contents, gmailThreads } = fixture({
    threads: [{ labels: ['obsidian'], subject: 'Queued email' }],
  });
  assert.throws(() => context.confirmFlush(null), /Invalid flush confirmation/);
  assert.throws(() => context.confirmFlush('f'.repeat(64)), /expired or already used/);
  assert.equal(gmailThreads[0].archived, false);
  const { token } = prepareIntent(context);
  assert.match(context.confirmFlush(token), /Flushed 1 email/);
  assert.equal(gmailThreads[0].archived, true);
  const written = contents['@inbox.md'];
  const writes = events.filter((item) => item.startsWith('write:')).length;
  assert.throws(() => context.confirmFlush(token), /expired or already used/);
  assert.equal(contents['@inbox.md'], written);
  assert.equal(events.filter((item) => item.startsWith('write:')).length, writes);
  assert.equal(events.at(-1), 'unlock');
});

test('expired intent fails before target operations and releases the lock', () => {
  const { context, events, clock, gmailThreads } = fixture({ threads: [{ labels: ['obsidian'] }] });
  const { token } = prepareIntent(context);
  clock.now += 300001;
  assert.throws(() => context.confirmFlush(token), /expired or already used/);
  assert.deepEqual(events, ['lock:30000', 'unlock']);
  assert.equal(gmailThreads[0].archived, false);
});

test('a failed confirmed write preserves labels and consumes the intent', () => {
  const { context, gmailThreads } = fixture({
    threads: [{ labels: ['obsidian'] }], failWrites: ['@inbox.md'],
  });
  const { token } = prepareIntent(context);
  assert.match(context.confirmFlush(token), /Drive write failed/);
  assert.equal(gmailThreads[0].archived, false);
  assert.equal(gmailThreads[0].names.has('obsidian'), true);
  assert.throws(() => context.confirmFlush(token), /expired or already used/);
});

for (const linked of [false, true]) {
  test('whole entries keep sender images, embeds, HTML and backslashes literal; linked=' + linked, () => {
    const { context, config, contents } = fixture({ threads: [{
      id: 'abc', labels: ['obsidian'],
      subject: String.raw`\[fake](https://attacker.invalid)`,
      body: '![receipt](https://attacker.invalid/pixel) ![[Private Note]] <img src="https://attacker.invalid">',
    }] });
    config.ENTRY_LINK = linked;
    context.flushToObsidian_();
    const output = contents['@inbox.md'];
    assert.ok(output.includes(String.raw`\\\[fake\]\(https\:\/\/attacker\.invalid\)`));
    assert.ok(output.includes(String.raw`\!\[receipt\]\(https\:\/\/attacker\.invalid\/pixel\)`));
    assert.ok(output.includes(String.raw`\!\[\[Private Note\]\]`));
    assert.ok(!output.includes('<img'));
    assert.ok(!output.includes('!['));
    assert.equal(output.includes('](https://mail.google.com/mail/u/0/#all/abc)'), linked);
  });
}

test('every internal flush entry is private to Apps Script client RPC', () => {
  const names = [...source.matchAll(/function (flushToObsidian\w*)\(/g)].map((match) => match[1]);
  assert.ok(names.length > 0);
  assert.ok(names.every((name) => name.endsWith('_')));
});

test('only guarded browser handlers and the signed POST are exposed to client RPC', () => {
  const publicNames = [...source.matchAll(/^function (\w+)\(/gm)]
    .map((match) => match[1]).filter((name) => !name.endsWith('_')).sort();
  assert.deepEqual(publicNames, ['confirmFlush', 'doGet', 'doPost']);
});

// Independent Node HMAC signer checks compatibility with the Apps Script code.
const webhookTestSecret = 'ab'.repeat(32);
function signedRequest(f, overrides = {}, secret = webhookTestSecret) {
  const request = {
    action: 'flush', timestamp: Math.floor(f.clock.now / 1000), requestId: '12'.repeat(16),
    ...overrides,
  };
  request.signature = createHmac('sha256', secret)
    .update(`gmail2obsidian:v1\nflush\n${request.timestamp}\n${request.requestId}`).digest('hex');
  return request;
}
function postWebhook(f, request) {
  return JSON.parse(f.context.doPost({
    postData: { type: 'application/json; charset=utf-8', contents: JSON.stringify(request) },
  }).text);
}
function webhookFixture(options) {
  const f = fixture(options);
  f.clock.now = 1000000;
  f.properties.set('WEBHOOK_SECRET', webhookTestSecret);
  return f;
}

test('a signed POST imports configured mail once without disclosing subjects or paths', () => {
  const f = webhookFixture({ threads: [{ labels: ['obsidian'], subject: 'Private subject' }] });
  const request = signedRequest(f);
  assert.deepEqual(postWebhook(f, request), {
    ok: true, status: 'complete', imported: 1, errors: 0, warnings: 0,
  });
  assert.equal(f.gmailThreads[0].archived, true);
  assert.deepEqual(f.events, ['lock:1000', 'write:@inbox.md', 'remove:obsidian', 'archive', 'unlock']);
  const contents = f.contents['@inbox.md'];
  assert.deepEqual(postWebhook(f, request), { ok: false, status: 'already_used' });
  assert.equal(f.contents['@inbox.md'], contents);
  // Replay rejection depends on durable properties, not the evictable cache.
  f.cacheEntries.clear();
  assert.equal(postWebhook(f, request).status, 'already_used');
});

test('unsigned, malformed, stale, future, altered, and wrong-key requests cannot read Gmail or Drive', () => {
  const f = webhookFixture();
  f.context.GmailApp = new Proxy({}, { get() { throw new Error('Unauthorized Gmail read'); } });
  f.context.DriveApp = new Proxy({}, { get() { throw new Error('Unauthorized Drive read'); } });
  for (const request of [
    null, [], {}, signedRequest(f, {}, 'cd'.repeat(32)),
    signedRequest(f, { timestamp: 879 }), signedRequest(f, { timestamp: 1031 }),
    signedRequest(f, { timestamp: '1000' }), signedRequest(f, { timestamp: 1000.5 }),
    signedRequest(f, { action: 'search' }), signedRequest(f, { requestId: '__proto__' }),
    { ...signedRequest(f), timestamp: 999 }, { ...signedRequest(f), file: 'other.md' },
    { ...signedRequest(f), signature: 'f'.repeat(64) },
  ]) assert.deepEqual(postWebhook(f, request), { ok: false, status: 'unauthorized' });
  for (const event of [undefined, {}, { postData: { contents: '{', type: 'application/json' } },
    { postData: { contents: 'x'.repeat(1025), type: 'application/json' } },
    { postData: { contents: JSON.stringify(signedRequest(f)), type: 'text/plain' } },
  ]) assert.equal(JSON.parse(f.context.doPost(event).text).status, 'unauthorized');
  assert.deepEqual(f.events, []);
  assert.equal(f.properties.has('WEBHOOK_USED_REQUESTS'), false);
});

test('missing or invalid webhook secrets disable the endpoint without affecting owner GET', () => {
  const f = webhookFixture();
  const request = signedRequest(f);
  for (const secret of ['', 'short', 'G'.repeat(64)]) {
    f.properties.set('WEBHOOK_SECRET', secret);
    assert.equal(postWebhook(f, request).status, 'unauthorized');
  }
  assert.deepEqual(f.events, []);
  assert.match(f.context.doGet().html, /Flush labeled emails/);
});

test('external and unidentified visitors cannot mint or consume browser confirmation tokens', () => {
  const f = webhookFixture({ threads: [{ labels: ['obsidian'] }] });
  const { token } = prepareIntent(f.context);
  for (const visitor of ['', 'betty@example.test']) {
    f.context.Session.getActiveUser = () => ({ getEmail: () => visitor });
    assert.throws(() => f.context.doGet(), /deployment owner/);
    assert.throws(() => f.context.confirmFlush(token), /deployment owner/);
  }
  assert.equal(f.cacheEntries.size, 1);
  assert.deepEqual(f.events, []);
  assert.equal(f.gmailThreads[0].archived, false);
});

test('busy imports do not consume request IDs', () => {
  const f = webhookFixture();
  f.context.LockService.getScriptLock = () => ({ tryLock: () => false });
  assert.equal(postWebhook(f, signedRequest(f)).status, 'busy');
  assert.equal(f.properties.has('WEBHOOK_USED_REQUESTS'), false);
});

test('route failures and batch limits return incomplete status without private error text', () => {
  const f = webhookFixture({ threads: [{ labels: ['obsidian'] }], failWrites: ['@inbox.md'] });
  assert.deepEqual(postWebhook(f, signedRequest(f)), {
    ok: false, status: 'partial_failure', imported: 0, errors: 1, warnings: 0,
  });
  assert.equal(f.gmailThreads[0].archived, false);
  const capped = webhookFixture({ threads: [{ labels: ['obsidian'] }] });
  capped.config.MAX_THREADS = 1;
  assert.equal(postWebhook(capped, signedRequest(capped)).status, 'more_may_remain');
});

test('unexpected failure consumes the request, releases the lock, and reports an unknown outcome', () => {
  const f = webhookFixture();
  f.context.flushToObsidianLocked_ = () => { throw new Error('Private provider details'); };
  const request = signedRequest(f);
  assert.deepEqual(postWebhook(f, request), { ok: false, status: 'failed_or_unknown' });
  assert.equal(f.events.at(-1), 'unlock');
  assert.equal(postWebhook(f, request).status, 'already_used');
});

test('replay-state failures stop before import; expired IDs can be pruned', () => {
  const f = webhookFixture();
  f.properties.set('WEBHOOK_USED_REQUESTS', '{');
  assert.equal(postWebhook(f, signedRequest(f)).status, 'failed_or_unknown');
  assert.deepEqual(f.events, ['lock:1000', 'unlock']);
  f.properties.set('WEBHOOK_USED_REQUESTS', JSON.stringify({ ['34'.repeat(16)]: 999 }));
  assert.equal(postWebhook(f, signedRequest(f)).status, 'complete');
  assert.deepEqual(Object.keys(JSON.parse(f.properties.get('WEBHOOK_USED_REQUESTS'))), ['12'.repeat(16)]);
});

test('waiting requests recheck expiry and key rotation under the script lock', () => {
  for (const change of ['expiry', 'rotation']) {
    const f = webhookFixture();
    f.context.LockService.getScriptLock = () => ({
      tryLock: () => {
        if (change === 'expiry') f.clock.now += 121000;
        else f.properties.set('WEBHOOK_SECRET', 'cd'.repeat(32));
        return true;
      },
      releaseLock: () => f.events.push('unlock'),
    });
    assert.equal(postWebhook(f, signedRequest(f)).status, 'unauthorized');
    assert.deepEqual(f.events, ['unlock']);
    assert.equal(f.properties.has('WEBHOOK_USED_REQUESTS'), false);
  }
});

function proxyRequest(f, overrides = {}) {
  return { action: 'flush', timestamp: Math.floor(f.clock.now / 1000),
    requestId: '56'.repeat(16), token: 'cd'.repeat(32), ...overrides };
}

test('proxy-token check authenticates without accessing Gmail, Drive, locks, or replay state', () => {
  const f = webhookFixture();
  f.properties.set('WEBHOOK_PROXY_TOKEN', 'cd'.repeat(32));
  f.context.GmailApp = new Proxy({}, { get() { throw new Error('CHECK read Gmail'); } });
  f.context.DriveApp = new Proxy({}, { get() { throw new Error('CHECK read Drive'); } });
  assert.deepEqual(postWebhook(f, proxyRequest(f, { action: 'check' })), { ok: true, status: 'authenticated' });
  assert.deepEqual(f.events, []);
  assert.equal(f.properties.has('WEBHOOK_USED_REQUESTS'), false);
});

test('proxy-token imports retain durable replay protection and configured routing', () => {
  const f = webhookFixture({ threads: [{ labels: ['obsidian'], subject: 'Private subject' }] });
  f.properties.set('WEBHOOK_PROXY_TOKEN', 'cd'.repeat(32));
  const request = proxyRequest(f);
  assert.deepEqual(postWebhook(f, request), { ok: true, status: 'complete', imported: 1, errors: 0, warnings: 0 });
  assert.deepEqual(postWebhook(f, request), { ok: false, status: 'already_used' });
  assert.equal(f.gmailThreads[0].archived, true);
});

test('proxy authentication fails closed without its own key and rejects altered schemas and stale requests', () => {
  const f = webhookFixture();
  // A valid legacy HMAC key never enables the token-based protocol.
  assert.equal(postWebhook(f, proxyRequest(f, { token: webhookTestSecret })).status, 'unauthorized');
  f.properties.set('WEBHOOK_PROXY_TOKEN', 'cd'.repeat(32));
  for (const change of [
    { token: 'gmail2obsidian_proxy_placeholder' }, { token: webhookTestSecret },
    { signature: 'f'.repeat(64) }, { action: 'search' }, { query: 'in:inbox' },
    { timestamp: 879 }, { timestamp: 1031 },
  ]) assert.equal(postWebhook(f, proxyRequest(f, change)).status, 'unauthorized');
  assert.deepEqual(f.events, []);
});
