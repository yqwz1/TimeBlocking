import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { asc, eq, inArray } from 'drizzle-orm';
import { WorkoutJobSchema, type WorkoutEngineResult, type WorkoutJobDTO } from '@timeblock/shared';
import type { DB } from '../db/client.js';
import { workoutJobs } from '../db/schema.js';
import { nowUtcIso, WORKOUT_BRIDGE_PATH, WORKOUT_CONFIG_DIR, WORKOUT_DATA_DIR, WORKOUT_ENGINE_PATH } from '../config.js';

const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

function jsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonValue(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function dto(row: typeof workoutJobs.$inferSelect): WorkoutJobDTO {
  return WorkoutJobSchema.parse({
    id: row.id,
    command: row.command,
    status: row.status,
    progress: row.progress,
    result: jsonValue(row.result),
    error: row.error,
    createdAtUtc: row.createdAtUtc,
    updatedAtUtc: row.updatedAtUtc,
    completedAtUtc: row.completedAtUtc,
  });
}

export class WorkoutEngineService {
  private running = false;
  private invocationTail: Promise<void> = Promise.resolve();

  constructor(private readonly db: DB) {
    fs.mkdirSync(WORKOUT_DATA_DIR, { recursive: true });
    const now = nowUtcIso();
    db.update(workoutJobs)
      .set({ status: 'interrupted', error: 'TimeBlock stopped while this workout operation was running.', updatedAtUtc: now, completedAtUtc: now })
      .where(eq(workoutJobs.status, 'running'))
      .run();
    void this.pump();
  }

  available(): boolean {
    return WORKOUT_ENGINE_PATH ? fs.existsSync(WORKOUT_ENGINE_PATH) : fs.existsSync(WORKOUT_BRIDGE_PATH);
  }

  getJob(id: string): WorkoutJobDTO | null {
    const row = this.db.select().from(workoutJobs).where(eq(workoutJobs.id, id)).get();
    return row ? dto(row) : null;
  }

  listJobs(limit = 20): WorkoutJobDTO[] {
    return this.db.select().from(workoutJobs).orderBy(asc(workoutJobs.createdAtUtc)).limit(limit).all().map(dto).reverse();
  }

  activeJob(): WorkoutJobDTO | null {
    const row = this.db.select().from(workoutJobs).where(inArray(workoutJobs.status, ['queued', 'running'])).orderBy(asc(workoutJobs.createdAtUtc)).get();
    return row ? dto(row) : null;
  }

  enqueue(command: string, payload: Record<string, unknown> = {}): WorkoutJobDTO {
    const id = randomUUID();
    const now = nowUtcIso();
    this.db.insert(workoutJobs).values({
      id,
      command,
      payload: JSON.stringify(payload),
      status: 'queued',
      progress: 0,
      createdAtUtc: now,
      updatedAtUtc: now,
    }).run();
    void this.pump();
    return this.getJob(id)!;
  }

  async execute<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const invocation = this.invocationTail.then(() => this.invoke<T>(command, payload));
    this.invocationTail = invocation.then(() => undefined, () => undefined);
    return invocation;
  }

  private async invoke<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const invocation = WORKOUT_ENGINE_PATH
      ? { executable: WORKOUT_ENGINE_PATH, args: [command] }
      : { executable: process.env.TB_WORKOUT_PYTHON || 'python', args: [WORKOUT_BRIDGE_PATH, command] };
    if (!this.available()) throw new Error('Workout engine is not installed. Rebuild the desktop resources or restore the engine source.');

    return await new Promise<T>((resolve, reject) => {
      const child = spawn(invocation.executable, invocation.args, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          TB_WORKOUT_DATA_DIR: WORKOUT_DATA_DIR,
          ...(fs.existsSync(WORKOUT_CONFIG_DIR) ? { TB_WORKOUT_CONFIG_DIR: WORKOUT_CONFIG_DIR } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let killedForSize = false;
      const collect = (target: Buffer[], chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) {
          killedForSize = true;
          child.kill();
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
      child.on('error', reject);
      child.on('close', () => {
        if (killedForSize) return reject(new Error('Workout engine produced too much output.'));
        const raw = Buffer.concat(stdout).toString('utf8').trim();
        let envelope: WorkoutEngineResult<T>;
        try { envelope = JSON.parse(raw) as WorkoutEngineResult<T>; }
        catch { return reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Workout engine returned an invalid response.')); }
        if (!envelope.ok) return reject(new Error(envelope.error || 'Workout operation failed.'));
        resolve(envelope.data as T);
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  async saveCredential(apiKey: string): Promise<void> {
    await fsp.mkdir(WORKOUT_DATA_DIR, { recursive: true });
    const destination = path.join(WORKOUT_DATA_DIR, 'secrets.json');
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify({ hevy_api_key: apiKey }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, destination);
  }

  summaryPath(): string {
    return path.join(WORKOUT_DATA_DIR, 'latest-summary.json');
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const row = this.db.select().from(workoutJobs).where(eq(workoutJobs.status, 'queued')).orderBy(asc(workoutJobs.createdAtUtc)).get();
        if (!row) break;
        const started = nowUtcIso();
        this.db.update(workoutJobs).set({ status: 'running', progress: 0.08, updatedAtUtc: started, error: null }).where(eq(workoutJobs.id, row.id)).run();
        try {
          const result = await this.execute(row.command, jsonObject(row.payload));
          const completed = nowUtcIso();
          this.db.update(workoutJobs).set({
            status: 'completed', progress: 1, result: JSON.stringify(result), updatedAtUtc: completed, completedAtUtc: completed,
          }).where(eq(workoutJobs.id, row.id)).run();
        } catch (error) {
          const completed = nowUtcIso();
          this.db.update(workoutJobs).set({
            status: 'failed', progress: 1, error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000), updatedAtUtc: completed, completedAtUtc: completed,
          }).where(eq(workoutJobs.id, row.id)).run();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
