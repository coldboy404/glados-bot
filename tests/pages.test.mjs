import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/build-pages.mjs']);
const source = readFileSync('worker.js', 'utf8');
const built = readFileSync('pages/dist/_worker.js', 'utf8');
const adapter = readFileSync('pages/adapter.js', 'utf8');
function fixture() {
    const data = new Map();
    const writes = [];
    const calls = [];
    const context = vm.createContext({
        Request, Response, URL, TextEncoder, crypto, console,
        setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
        fetch: async (url, options) => {
            calls.push({ url: String(url), body: options?.body });
            return Response.json({ ok: true, result: { url: 'https://bot.example.com/webhook' } });
        }
    });
    vm.runInContext(built.replace('export default {', 'globalThis.app = {'), context);
    const env = {
        BOT_TOKEN: '123:dummy', ADMIN_ID: '200',
        WEBHOOK_URL: 'https://bot.example.com/webhook',
        GLADOS_DB: {
            get: async key => data.get(key) ?? null,
            put: async (key, value) => { writes.push(key); data.set(key, value); },
            delete: async key => data.delete(key)
        }
    };
    const request = (method = 'POST', token = '123:dummy', path = '/internal/cron') => new Request('https://bot.example.com' + path, {
        method, headers: { Authorization: 'Bearer ' + token }
    });
    const ctx = { waitUntil() { throw new Error('Cron must await its work'); } };
    return { context, env, data, calls, writes, request, ctx };
}
test('Pages artifact exactly combines current shared source and adapter', () => {
    assert.equal(built, source.replace('export default {', 'const worker = {') + '\n' + adapter);
    assert.equal((built.match(/export default/g) || []).length, 1);
});
test('root remains side-effect free and original protected routes are preserved', async () => {
    const f = fixture();
    assert.equal((await f.context.app.fetch(f.request('GET', '', '/'), f.env, f.ctx)).status, 200);
    assert.equal((await f.context.app.fetch(f.request('GET', '', '/setup'), f.env, f.ctx)).status, 403);
    assert.equal((await f.context.app.fetch(f.request('POST', '', '/internal/task'), f.env, f.ctx)).status, 403);
    assert.equal(f.calls.length, 0);
});
test('timer rejects bad method, missing/wrong token before side effects', async () => {
    const f = fixture();
    assert.equal((await f.context.app.fetch(f.request('GET'), f.env, f.ctx)).status, 405);
    for (const token of ['', 'wrong', 's'.repeat(31)]) {
        assert.equal((await f.context.app.fetch(f.request('POST', token), f.env, f.ctx)).status, 403);
    }
    f.env.BOT_TOKEN = '';
    assert.equal((await f.context.app.fetch(f.request('POST'), f.env, f.ctx)).status, 403);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 0);
});
test('timer validates configuration and suppresses exception details', async () => {
    const f = fixture();
    delete f.env.BOT_TOKEN;
    assert.equal((await f.context.app.fetch(f.request(), f.env, f.ctx)).status, 403);
    f.env.BOT_TOKEN = '123:dummy';
    f.env.GLADOS_DB.get = async () => { throw new Error('SECRET-cookie'); };
    const result = await f.context.app.fetch(f.request(), f.env, f.ctx);
    assert.equal(result.status, 500);
    assert.ok(!(await result.text()).includes('SECRET'));
});
test('Pages manual batch persists then runs within authenticated timer request', async () => {
    const f = fixture();
    f.env.CF_PAGES = '1';
    f.context.tgSend = async () => {};
    await f.context.executeTask({type:'checkin',userId:'200',chatId:200,startIndex:0}, f.env, 'https://bot.example.com');
    assert.ok(f.data.has('PAGES_MANUAL_TASK_200'));
    vm.runInContext(`handleScheduled = async () => {}; globalThis.ran = []; executeTask = async (task, env) => { if (!env.PAGES_TASK_RUNNER) throw Error('background'); ran.push(task.type); };`, f.context);
    const response = await f.context.app.fetch(f.request(), f.env, f.ctx);
    assert.equal(response.status, 200);
    assert.deepEqual(Array.from(f.context.ran), ['checkin']);
    assert.equal(f.data.has('PAGES_MANUAL_TASK_200'), false);
});
test('same token with stale Worker webhook is repaired on Pages migration', async () => {
    const f = fixture();
    await f.context.app.fetch(f.request(), f.env, f.ctx);
    f.calls.length = 0;
    f.context.fetch = async (url, options) => {
        f.calls.push({url: String(url), body: options?.body});
        return Response.json({ok: true, result: {url: 'https://old-worker.example.com/webhook'}});
    };
    const response = await f.context.app.fetch(f.request(), f.env, f.ctx);
    assert.equal(response.status, 200);
    const registration = f.calls.find(c => c.url.endsWith('/setWebhook'));
    assert.equal(JSON.parse(registration.body).url, f.env.WEBHOOK_URL);
});
test('registration failure and missing URL cannot report timer success', async () => {
    for (const missingUrl of [true, false]) {
        const f = fixture();
        if (missingUrl) delete f.env.WEBHOOK_URL;
        else f.context.fetch = async () => Response.json({ok: false, description: 'Unauthorized'});
        const response = await f.context.app.fetch(f.request(), f.env, f.ctx);
        assert.equal(response.status, 500);
        assert.equal(f.data.has('SYSTEM_BOT_TOKEN_FINGERPRINT'), false);
    }
});
test('timer reconciles token only once and checks only current admin once per day', async () => {
    const f = fixture();
    f.data.set('ALL_USERS', JSON.stringify(['100', '200']));
    f.data.set('USER_100', '[{"cookie":"old-secret"}]');
    vm.runInContext(`
        getBeijingDateParts = () => ({date: '2026-10-27', hour: 12});
        globalThis.seenCookies = [];
        getAccountDataObj = async acc => {
            seenCookies.push(acc.cookie);
            return {checkinState: 'success', statusMsg: 'ok'};
        };
        formatCheckinResultRow = () => 'row';
        tgSendResultList = async () => {};
    `, f.context);
    f.data.set('USER_200', JSON.stringify([{domain: 'glados.network', cookie: 'current-secret', email: 'test@example.com'}]));
    for (let i = 0; i < 2; i++) {
        assert.equal((await f.context.app.fetch(f.request(), f.env, f.ctx)).status, 200);
    }
    assert.deepEqual(Array.from(f.context.seenCookies), ['current-secret']);
    assert.equal(f.calls.filter(call => call.url.endsWith('/setWebhook')).length, 1);
    assert.equal(f.calls.filter(call => call.url.endsWith('/setMyCommands')).length, 1);
    assert.ok(f.data.has('SCHEDULED_CHECKIN_200_2026-10-27'));
    assert.equal(f.writes.includes('USER_100'), false);
    assert.equal(f.data.get('USER_100'), '[{"cookie":"old-secret"}]');
});
