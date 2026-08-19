import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const PERFORMANCE_SAMPLE_SCHEMA_VERSION = "1" as const;

export type PerformanceSuite = "history-stress" | "browser-large" | "browser-stress";

export interface PerformanceEnvironment extends Record<string, string | number | boolean> {
  nodeVersion: string;
  platform: string;
  architecture: string;
  ci: boolean;
}

export interface PerformanceSample {
  schemaVersion: typeof PERFORMANCE_SAMPLE_SCHEMA_VERSION;
  kind: "performance-sample";
  suite: PerformanceSuite;
  scenario: string;
  runIndex: number;
  collectedAt: string;
  environment: PerformanceEnvironment;
  metrics: Record<string, number>;
}

function performanceRunIndex(): number {
  const value = process.env.PERFORMANCE_RUN_INDEX ?? "1";
  const runIndex = Number(value);
  if (!Number.isInteger(runIndex) || runIndex < 1) {
    throw new Error(`PERFORMANCE_RUN_INDEX must be a positive integer, received ${value}.`);
  }
  return runIndex;
}

export function createPerformanceSample({
  suite,
  scenario,
  metrics,
  environment = {},
}: {
  suite: PerformanceSuite;
  scenario: string;
  metrics: Record<string, number>;
  environment?: Record<string, string | number | boolean>;
}): PerformanceSample {
  return {
    schemaVersion: PERFORMANCE_SAMPLE_SCHEMA_VERSION,
    kind: "performance-sample",
    suite,
    scenario,
    runIndex: performanceRunIndex(),
    collectedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      ci: process.env.CI === "true",
      ...environment,
    },
    metrics,
  };
}

export async function emitPerformanceSample(sample: PerformanceSample): Promise<void> {
  const serialized = `${JSON.stringify(sample, null, 2)}\n`;
  const requestedPath = process.env.PERFORMANCE_SAMPLE_PATH;
  if (requestedPath) {
    const target = resolve(requestedPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serialized, "utf8");
  }
  process.stdout.write(`${sample.suite} performance sample ${JSON.stringify(sample)}\n`);
}
