import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, type DB } from '../db/client.js';
import { activityAiPreviews, activityRecommendations, blockActivitySummaries, blocks, computerActivityEvents, tasks } from '../db/schema.js';
import { ActivityWatchAdapter, ActivityWatchAdapterError } from '../integrations/activitywatch/adapter.js';
import { registerActivityRoutes } from './activity.js';

function response(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

describe('ActivityWatch adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('probes only loopback read endpoints and detects available watchers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ version: '0.13.2', hostname: 'workstation' }))
      .mockResolvedValueOnce(response({
        'aw-watcher-window_workstation': {},
        'aw-watcher-afk_workstation': {},
        'aw-watcher-web-firefox': {},
      }));
    const probe = await new ActivityWatchAdapter(5600, fetchMock).probe();

    expect(probe).toMatchObject({ version: '0.13.2', capabilities: { window: true, afk: true, browser: true, editor: false, input: false } });
    expect(probe.sourceKey).not.toContain('workstation');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:5600/api/0/info',
      'http://127.0.0.1:5600/api/0/buckets/',
    ]);
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
  });

  it('rejects malformed or oversized local API responses', async () => {
    const malformed = new ActivityWatchAdapter(5600, vi.fn().mockImplementation(() => Promise.resolve(new Response('not json', { headers: { 'Content-Type': 'application/json' } }))));
    await expect(malformed.probe()).rejects.toMatchObject({ code: 'invalid_response' } satisfies Partial<ActivityWatchAdapterError>);

    const large = new ActivityWatchAdapter(5600, vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ padding: 'x'.repeat(600_000) }), { headers: { 'Content-Type': 'application/json' } }))));
    await expect(large.probe()).rejects.toMatchObject({ code: 'response_too_large' } satisfies Partial<ActivityWatchAdapterError>);
  });

  it('uses the current ActivityWatch query payload without requiring server-side categories', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([[]]));
    await expect(new ActivityWatchAdapter(5600, fetchMock).canonicalEvents('2026-08-18T00:00:00.000Z', '2026-08-18T01:00:00.000Z')).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5600/api/0/query/', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      body: expect.any(String),
    }));
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { query: string[] };
    expect(payload.query).toEqual(expect.arrayContaining([
      'events = flood(query_bucket(find_bucket("aw-watcher-window_")));',
      'RETURN = events;',
    ]));
    expect(payload.query).not.toContain('events = categorize(events, __CATEGORIES__);');
  });
});

describe('activity routes', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => { await app?.close(); });

  it('stays off by default and requires explicit shadow mode before sync', async () => {
    const db: DB = createDb(':memory:');
    const probe = vi.fn().mockResolvedValue({
      version: '0.13.2',
      sourceKey: 'activitywatch:opaque-source',
      capabilities: { window: true, afk: true, browser: false, editor: false, input: false },
    });
    app = Fastify();
    registerActivityRoutes(app, db, { createAdapter: () => ({ probe }) as unknown as ActivityWatchAdapter });
    await app.ready();

    expect((await app.inject({ method: 'GET', url: '/activity/status' })).json()).toMatchObject({ configured: false, mode: 'off', health: 'disconnected' });

    const connected = await app.inject({ method: 'POST', url: '/activity/connect', payload: { port: 5600, mode: 'shadow' } });
    expect(connected.statusCode).toBe(200);
    expect(connected.json()).toMatchObject({ mode: 'shadow', health: 'healthy', requiredSourcesAvailable: true });
    expect(connected.body).not.toContain('opaque-source');
    expect((await app.inject({ method: 'POST', url: '/activity/sync' })).json()).toMatchObject({ sync: 'health_check_only' });

    const off = await app.inject({ method: 'POST', url: '/activity/connect', payload: { port: 5600, mode: 'off' } });
    expect(off.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/activity/sync' })).statusCode).toBe(409);
  });

  it('serves corrected evidence, aggregate analytics, and suggestion decisions without changing the block', async () => {
    const db: DB = createDb(':memory:');
    const blockId = 'block-activity-test';
    db.insert(tasks).values({ id: 'task-activity-test', content: 'Implementation', projectName: 'TimeBlocking', durationMin: 75, difficulty: 'hard' }).run();
    db.insert(blocks).values({ id: blockId, taskId: 'task-activity-test', startUtc: '2026-08-03T09:00:00.000Z', endUtc: '2026-08-03T10:00:00.000Z', status: 'scheduled' }).run();
    db.insert(blockActivitySummaries).values({
      id: 'summary-activity-test', blockId, formulaVersion: 'v1', coverage: 88, relevantMin: 47, supportingMin: 0, distractionMin: 9, idleMin: 4, unknownMin: 0,
      contextSwitches: 2, longestFocusSessionMin: 35, continuity: 0.74, focusRatio: 0.84, focusQuality: 78, overrunMin: 3, confidence: 81,
      verificationState: 'verified', updatedAtUtc: '2026-08-03T10:05:00.000Z',
    }).run();
    db.insert(activityRecommendations).values({
      id: 'recommendation-activity-test', blockId, kind: 'extension', title: 'Continue this block?', detail: 'Relevant work continued after the scheduled end.',
      status: 'active', createdAtUtc: '2026-08-03T10:05:00.000Z', updatedAtUtc: '2026-08-03T10:05:00.000Z',
    }).run();
    app = Fastify();
    registerActivityRoutes(app, db);
    await app.ready();

    expect((await app.inject({ method: 'GET', url: `/blocks/${blockId}/activity` })).json()).toMatchObject({ verificationState: 'verified', relevantMin: 47 });
    const corrected = await app.inject({ method: 'POST', url: `/blocks/${blockId}/activity/correction`, payload: { primaryCategory: 'coding', note: 'Wrong project mapping' } });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json()).toMatchObject({ verificationState: 'corrected', primaryCategory: 'coding' });
    expect(db.select().from(blocks).get()?.status).toBe('scheduled');

    expect((await app.inject({ method: 'GET', url: '/activity/analytics?from=2026-08-03T00:00:00.000Z&to=2026-08-04T00:00:00.000Z' })).json()).toMatchObject({ blockCount: 1, relevantMin: 47, overrunMin: 3 });
    const personal = await app.inject({ method: 'GET', url: '/activity/personal-analytics?from=2026-08-03T00:00:00.000Z&to=2026-08-04T00:00:00.000Z' });
    expect(personal.statusCode).toBe(200);
    expect(personal.json()).toMatchObject({
      sample: { blockCount: 1, verifiedBlockCount: 0 },
      calibration: { taskEstimateMin: 75, calendarMin: 60, observedWorkMin: 47 },
      focusHeatmaps: { byProject: [{ label: 'TimeBlocking' }], byTaskClass: [{ label: 'hard' }] },
      schedulerPreviews: [],
    });
    expect(personal.body).not.toContain('application');
    expect(personal.body).not.toContain('registrableDomain');
    expect((await app.inject({ method: 'POST', url: '/activity/recommendations/recommendation-activity-test/accept' })).json()).toMatchObject({ status: 'accepted' });
  });

  it('keeps scheduler previews proposal-only and caps their potential influence', async () => {
    const db: DB = createDb(':memory:');
    db.insert(tasks).values({ id: 'task-scheduler-preview', content: 'Deep work', projectName: 'TimeBlocking', durationMin: 60, difficulty: 'hard' }).run();
    for (let day = 0; day < 10; day++) {
      for (const hour of [9, 14]) {
        const start = new Date(Date.UTC(2026, 7, 1 + day, hour, 0, 0)).toISOString();
        const end = new Date(Date.UTC(2026, 7, 1 + day, hour + 1, 0, 0)).toISOString();
        const id = `preview-${day}-${hour}`;
        db.insert(blocks).values({ id, taskId: 'task-scheduler-preview', startUtc: start, endUtc: end, status: 'scheduled' }).run();
        db.insert(blockActivitySummaries).values({
          id: `summary-${id}`, blockId: id, formulaVersion: 'v1', coverage: 95, relevantMin: 52, supportingMin: 0, distractionMin: 2, idleMin: 3, unknownMin: 0,
          contextSwitches: 1, longestFocusSessionMin: 42, continuity: 0.8, focusRatio: 0.9, focusQuality: 82, overrunMin: 0, confidence: 88,
          verificationState: 'verified', updatedAtUtc: end,
        }).run();
      }
    }
    app = Fastify();
    registerActivityRoutes(app, db);
    await app.ready();

    const body = (await app.inject({ method: 'GET', url: '/activity/personal-analytics?from=2026-08-01T00:00:00.000Z&to=2026-08-12T00:00:00.000Z' })).json();
    expect(body.sample).toMatchObject({ verifiedBlockCount: 20, distinctDays: 10 });
    expect(body.schedulerPreviews).toContainEqual(expect.objectContaining({ dimension: 'task_class', key: 'hard', appliedScoreImpactPct: 0 }));
    for (const preview of body.schedulerPreviews) {
      expect(preview.potentialScoreImpactPct).toBeLessThanOrEqual(15);
      expect(preview.appliedScoreImpactPct).toBe(0);
    }
  });

  it('creates a reviewable aggregate-only AI preview and consumes it once', async () => {
    const db: DB = createDb(':memory:');
    const blockId = 'block-ai-preview';
    db.insert(tasks).values({ id: 'task-ai-preview', content: 'Private implementation title', projectName: 'TimeBlocking', durationMin: 60, difficulty: 'hard' }).run();
    db.insert(blocks).values({ id: blockId, taskId: 'task-ai-preview', startUtc: '2026-08-03T09:00:00.000Z', endUtc: '2026-08-03T10:00:00.000Z', status: 'scheduled' }).run();
    db.insert(blockActivitySummaries).values({
      id: 'summary-ai-preview', blockId, formulaVersion: 'activity-v1', coverage: 90, relevantMin: 45, supportingMin: 5, distractionMin: 4, idleMin: 6, unknownMin: 0,
      contextSwitches: 2, longestFocusSessionMin: 35, continuity: 0.7, focusRatio: 0.9, focusQuality: 79, overrunMin: 3, confidence: 84,
      verificationState: 'verified', updatedAtUtc: '2026-08-03T10:03:00.000Z',
    }).run();
    db.insert(computerActivityEvents).values([
      { id: 'activity-ai-editor', sourceId: 'source', bucketId: 'bucket', sourceEventId: 'editor', startUtc: '2026-08-03T09:05:00.000Z', durationSec: 1_200, application: 'Visual Studio Code', registrableDomain: 'private.example.test', category: 'relevant', ingestedAtUtc: '2026-08-03T10:03:00.000Z', updatedAtUtc: '2026-08-03T10:03:00.000Z' },
      { id: 'activity-ai-sensitive', sourceId: 'source', bucketId: 'bucket', sourceEventId: 'sensitive', startUtc: '2026-08-03T09:30:00.000Z', durationSec: 600, application: 'secret-client-123', category: 'sensitive', ingestedAtUtc: '2026-08-03T10:03:00.000Z', updatedAtUtc: '2026-08-03T10:03:00.000Z' },
    ]).run();
    const generateText = vi.fn().mockResolvedValue({ value: '- Observed work was concentrated in the reviewed sample.\n- Treat this as a small-sample heuristic.' });
    app = Fastify();
    registerActivityRoutes(app, db, { createModelGateway: () => ({ configured: () => true, generateText }) as never });
    await app.ready();

    const withoutFamilies = await app.inject({ method: 'POST', url: '/activity/ai/preview', payload: { fromUtc: '2026-08-03T00:00:00.000Z', toUtc: '2026-08-04T00:00:00.000Z' } });
    expect(withoutFamilies.statusCode).toBe(200);
    expect(withoutFamilies.json()).toMatchObject({ payload: { schemaVersion: 'activity-ai-preview-v1', applicationFamilies: null, byProject: [{ label: 'TimeBlocking' }], byTaskClass: [{ label: 'hard' }] } });
    expect(withoutFamilies.body).not.toContain('Private implementation title');
    expect(withoutFamilies.body).not.toContain('Visual Studio Code');
    expect(withoutFamilies.body).not.toContain('private.example.test');
    expect(withoutFamilies.body).not.toContain('secret-client-123');

    const preview = await app.inject({ method: 'POST', url: '/activity/ai/preview', payload: { fromUtc: '2026-08-03T00:00:00.000Z', toUtc: '2026-08-04T00:00:00.000Z', includeApplicationFamilies: true } });
    const previewBody = preview.json();
    expect(previewBody.payload.applicationFamilies).toEqual([{ family: 'editor', activeMin: 20 }]);
    const analyzed = await app.inject({ method: 'POST', url: '/activity/ai/analyze', payload: { previewId: previewBody.id, payloadHash: previewBody.payloadHash } });
    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json()).toMatchObject({ previewId: previewBody.id, payloadHash: previewBody.payloadHash });
    expect(generateText).toHaveBeenCalledTimes(1);
    const prompt = generateText.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain(JSON.stringify(previewBody.payload));
    expect(prompt).not.toContain('Private implementation title');
    expect(prompt).not.toContain('Visual Studio Code');
    expect(prompt).not.toContain('private.example.test');
    expect(prompt).not.toContain('secret-client-123');
    expect(db.select().from(activityAiPreviews).all().find((row) => row.id === previewBody.id)?.status).toBe('consumed');

    expect((await app.inject({ method: 'POST', url: '/activity/ai/analyze', payload: { previewId: previewBody.id, payloadHash: previewBody.payloadHash } })).statusCode).toBe(409);
  });
});
