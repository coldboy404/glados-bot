// Appended to worker.js by scripts/build-pages.mjs; business logic stays shared.
// Pages has no scheduled() events: an authenticated external timer drives this route.
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname !== '/internal/cron') return worker.fetch(request, env, ctx);
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
        }
        const secret = String(env.BOT_TOKEN || '');
        // Hash both sides before comparing: do not expose secret length or early-match timing.
        const provided = request.headers.get('Authorization') || '';
        const [actual, expected] = await Promise.all([
            botTokenFingerprint(provided), botTokenFingerprint('Bearer ' + secret)
        ]);
        let difference = 0;
        for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
        if (!secret || difference !== 0) return new Response('Forbidden', { status: 403 });
        if (!env.GLADOS_DB || !env.BOT_TOKEN || !/^\d+$/.test(String(env.ADMIN_ID || '').trim())) {
            return new Response('Missing required runtime configuration', { status: 503 });
        }
        // Await the work, not waitUntil: Pages background tasks have a short lifetime.
        // The three phases are isolated on purpose. Webhook reconciliation and
        // a queued manual task are maintenance; neither may abort the daily
        // check-in, which is the whole point of this tick. Previously any
        // reconciliation error (or one permanently failing manual task)
        // failed the request before handleScheduled ever ran.
        const result = { ok: true, taskProcessed: false, webhookOk: null, scheduled: 'not-run', version: 'pages-delivery-diagnostics-v2' };
        try {
            await reconcileTelegramWebhook(env);
            result.webhookOk = true;
        } catch (e) {
            result.webhookOk = false;
            // No exception text here: upstream errors must never reach logs
            // or responses with a Cookie or Bot Token embedded in them.
            console.log('Webhook reconciliation failed; continuing with scheduled work');
        }
        try {
            const taskKey = 'PAGES_MANUAL_TASK_' + getAdminUserId(env);
            const pending = await env.GLADOS_DB.get(taskKey);
            if (pending) {
                // Consume before running: a task that throws must neither be
                // retried forever nor block the scheduled check-in below.
                await env.GLADOS_DB.delete(taskKey);
                result.taskProcessed = true;
                const task = JSON.parse(pending);
                if (String(task.userId) === getAdminUserId(env) && ['checkin', 'view_all', 'sub_all'].includes(task.type)) {
                    await executeTask(task, { ...env, PAGES_TASK_RUNNER: true }, url.origin);
                }
            }
        } catch (e) {
            result.taskError = true;
            console.log('Pages manual task failed; continuing with scheduled work');
        }
        try {
            result.scheduled = await handleScheduled(env);
        } catch (_) {
            // Never return an upstream exception that might contain a Cookie or Bot Token.
            // The scheduled handler has already released its daily claim, so
            // the caller's retry (or the next tick) can still finish the day.
            return Response.json({ ...result, ok: false, error: 'Scheduled task failed' }, { status: 500 });
        }
        return Response.json(result);
    }
};
