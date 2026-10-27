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
        try {
            // Await the work, not waitUntil: Pages background tasks have a short lifetime.
            // Reconciliation failure must not prevent the independent daily check-in.
            await reconcileTelegramWebhook(env);
            const taskKey = 'PAGES_MANUAL_TASK_' + getAdminUserId(env);
            const pending = await env.GLADOS_DB.get(taskKey);
            if (pending) {
                const task = JSON.parse(pending);
                if (String(task.userId) === getAdminUserId(env) && ['checkin', 'view_all', 'sub_all'].includes(task.type)) {
                    await executeTask(task, { ...env, PAGES_TASK_RUNNER: true }, url.origin);
                }
                await env.GLADOS_DB.delete(taskKey);
            }
            await handleScheduled(env);
            return Response.json({ ok: true });
        } catch (_) {
            // Never return an upstream exception that might contain a Cookie or Bot Token.
            return Response.json({ ok: false, error: 'Scheduled task failed' }, { status: 500 });
        }
    }
};
