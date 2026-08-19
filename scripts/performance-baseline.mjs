import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sampleSchemaVersion = "1";
const stressTestName = "loads and operates a deterministic large or stress design";

function usage() {
  return [
    "Usage: pnpm performance:baseline -- --runs <1-10>",
    "",
    "Runs the history and Chromium 1000/2000 stress scenarios repeatedly,",
    "then writes raw versioned samples and an observation-only trend report",
    "under performance-results/. No release thresholds are applied.",
  ].join("\n");
}

function parseRunCount(args) {
  let runs = 3;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(`${usage()}\n`);
      return undefined;
    }
    if (argument.startsWith("--runs=")) {
      runs = Number(argument.slice("--runs=".length));
      continue;
    }
    if (argument === "--runs") {
      runs = Number(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}.\n${usage()}`);
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new Error(`--runs must be an integer from 1 to 10, received ${runs}.`);
  }
  return runs;
}

function executeNode(args, environment) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Performance subprocess failed with exit code ${result.status ?? "unknown"}.`);
  }
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function environmentFingerprint(environment) {
  return JSON.stringify(sortedObject(environment));
}

async function readSample(path, expectedSuite, expectedRunIndex) {
  const sample = JSON.parse(await readFile(path, "utf8"));
  if (
    sample?.schemaVersion !== sampleSchemaVersion ||
    sample?.kind !== "performance-sample" ||
    sample?.suite !== expectedSuite ||
    sample?.runIndex !== expectedRunIndex ||
    typeof sample?.scenario !== "string" ||
    !sample?.environment ||
    typeof sample.environment !== "object" ||
    !sample?.metrics ||
    typeof sample.metrics !== "object"
  ) {
    throw new Error(`Invalid ${expectedSuite} performance sample at ${path}.`);
  }
  const metricEntries = Object.entries(sample.metrics);
  if (
    metricEntries.length === 0 ||
    metricEntries.some(([, value]) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error(`Performance sample ${path} contains missing or non-finite metrics.`);
  }
  return sample;
}

function round(value) {
  return Number(value.toFixed(2));
}

function summarizeValues(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  return {
    min: sorted[0],
    median: round(median),
    max: sorted.at(-1),
    mean: round(mean),
    relativeSpreadPercent: median === 0 ? 0 : round(((sorted.at(-1) - sorted[0]) / median) * 100),
  };
}

function summarizeSuite(samples) {
  const first = samples[0];
  const expectedKeys = Object.keys(first.metrics).sort();
  const expectedEnvironment = environmentFingerprint(first.environment);
  samples.forEach((sample) => {
    if (sample.scenario !== first.scenario) {
      throw new Error(`Scenario changed within ${first.suite} samples.`);
    }
    if (environmentFingerprint(sample.environment) !== expectedEnvironment) {
      throw new Error(`Environment changed within ${first.suite} samples.`);
    }
    if (JSON.stringify(Object.keys(sample.metrics).sort()) !== JSON.stringify(expectedKeys)) {
      throw new Error(`Metric fields changed within ${first.suite} samples.`);
    }
  });
  return {
    scenario: first.scenario,
    environment: sortedObject(first.environment),
    metrics: Object.fromEntries(expectedKeys.map((key) => [
      key,
      summarizeValues(samples.map((sample) => sample.metrics[key])),
    ])),
  };
}

async function persistReport(samples, runCount) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const outputDirectory = join(repoRoot, "performance-results", timestamp);
  await mkdir(outputDirectory, { recursive: true });
  for (const sample of samples) {
    const source = sample.__sourcePath;
    const target = join(outputDirectory, `${sample.suite}-run-${sample.runIndex}.json`);
    await copyFile(source, target);
  }
  const publicSamples = samples.map(({ __sourcePath: _sourcePath, ...sample }) => sample);
  const suites = Object.fromEntries(
    [...new Set(publicSamples.map((sample) => sample.suite))]
      .sort()
      .map((suite) => [suite, summarizeSuite(publicSamples.filter((sample) => sample.suite === suite))]),
  );
  const report = {
    schemaVersion: sampleSchemaVersion,
    kind: "performance-trend-report",
    mode: "observation-only",
    generatedAt: new Date().toISOString(),
    runCount,
    policy: {
      thresholds: null,
      statement: "Functional failures, missing samples, schema drift, and environment drift fail the run. Numeric performance thresholds remain unset until a fixed CI environment has enough samples.",
    },
    suites,
  };
  const reportPath = join(outputDirectory, "trend-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { outputDirectory, reportPath, report };
}

async function main() {
  const runCount = parseRunCount(process.argv.slice(2));
  if (runCount === undefined) return;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "architecture-block-studio-performance-"));
  const samples = [];
  try {
    for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
      const historyPath = join(temporaryDirectory, `history-stress-run-${runIndex}.json`);
      executeNode([
        join(repoRoot, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--config",
        "vitest.performance.config.ts",
      ], {
        PERFORMANCE_RUN_INDEX: String(runIndex),
        PERFORMANCE_SAMPLE_PATH: historyPath,
      });
      samples.push({
        ...await readSample(historyPath, "history-stress", runIndex),
        __sourcePath: historyPath,
      });

      const browserPath = join(temporaryDirectory, `browser-stress-run-${runIndex}.json`);
      executeNode([
        join(repoRoot, "node_modules", "@playwright", "test", "cli.js"),
        "test",
        "tests/studio.spec.ts",
        "--project=chromium",
        "--grep",
        stressTestName,
      ], {
        STRESS_DESIGN: "1",
        PERFORMANCE_RUN_INDEX: String(runIndex),
        PERFORMANCE_SAMPLE_PATH: browserPath,
      });
      samples.push({
        ...await readSample(browserPath, "browser-stress", runIndex),
        __sourcePath: browserPath,
      });
    }

    const { outputDirectory, reportPath, report } = await persistReport(samples, runCount);
    process.stdout.write(`\nPerformance evidence: ${reportPath}\n`);
    process.stdout.write(`Raw samples: ${outputDirectory}\n`);
    process.stdout.write(`${JSON.stringify(report.suites, null, 2)}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
