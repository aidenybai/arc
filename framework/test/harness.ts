// Minimal mocha-style test harness (describe / it / done) for running the
// Volt test suite on the Arc runtime. Tests run sequentially; a test either
// takes a `done` callback (socket.io style) or returns a promise.

declare const Arc: any;

export type Done = (err?: unknown) => void;
export type TestFn = ((done: Done) => void) | (() => Promise<void> | void);

interface Test {
  name: string;
  fn: TestFn;
}

interface Suite {
  name: string;
  tests: Test[];
}

const suites: Suite[] = [];
let current: Suite | null = null;

const TIMEOUT_MS = 4000;

export function describe(name: string, body: () => void): void {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

export function it(name: string, fn: TestFn): void {
  if (!current) {
    throw new Error("it() called outside describe()");
  }
  current.tests.push({ name, fn });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => Arc.setTimeout(resolve, ms));
}

export function expect(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(label + ": expected " + e + ", got " + a);
  }
}

function runTest(test: Test): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err === undefined || err === null) resolve();
      else reject(err);
    };
    Arc.setTimeout(() => finish(new Error("timed out after " + TIMEOUT_MS + "ms")), TIMEOUT_MS);
    try {
      const fn = test.fn as any;
      if (fn.length >= 1) {
        fn(finish);
      } else {
        const result = fn();
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).then(() => finish(), finish);
        } else {
          finish();
        }
      }
    } catch (err) {
      finish(err);
    }
  });
}

export interface RunSummary {
  passed: number;
  failed: number;
  failures: string[];
}

export async function run(): Promise<RunSummary> {
  let passed = 0;
  const failures: string[] = [];
  for (const suite of suites) {
    Arc.log(suite.name);
    for (const test of suite.tests) {
      try {
        await runTest(test);
        passed++;
        Arc.log("  ok " + test.name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(suite.name + " > " + test.name + ": " + message);
        Arc.log("  FAIL " + test.name + " — " + message);
      }
    }
  }
  return { passed, failed: failures.length, failures };
}
