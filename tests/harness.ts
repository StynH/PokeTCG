interface CardTest {
  name: string;
  fn: () => void;
}

interface Suite {
  name: string;
  tests: CardTest[];
}

const suites: Suite[] = [];
let registering: Suite | null = null;

export function suite(name: string, body: () => void): void {
  registering = { name, tests: [] };
  suites.push(registering);
  body();
  registering = null;
}

export function test(name: string, fn: () => void): void {
  if (!registering) throw new Error(`test("${name}") called outside suite()`);
  registering.tests.push({ name, fn });
}

export function assertEqual<T>(actual: T, expected: T, label = "value"): void {
  if (actual !== expected)
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

export function assertTrue(value: boolean, label = "condition"): void {
  if (!value) throw new Error(`${label}: expected true`);
}

export function assertFalse(value: boolean, label = "condition"): void {
  if (value) throw new Error(`${label}: expected false`);
}

export function run(filter?: string): number {
  const selected = filter
    ? suites.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
    : suites;
  if (selected.length === 0) {
    console.log(`No suites match "${filter}". Available: ${suites.map((s) => s.name).join(", ")}`);
    return 1;
  }
  let passed = 0;
  let failed = 0;
  for (const s of selected) {
    console.log(`\n=== ${s.name} ===`);
    for (const t of s.tests) {
      try {
        t.fn();
        passed++;
        console.log(`  PASS  ${t.name}`);
      } catch (e) {
        failed++;
        console.log(`  FAIL  ${t.name}`);
        console.log(`        ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed;
}
