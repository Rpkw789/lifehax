/**
 * Minimal ambient types for `bun:test`, scoped to what the test suites in
 * this project use. Frontend has no `@types/bun` (no new dependencies were
 * added for this task); this keeps `tsc --noEmit` resolving the module that
 * `bun test` provides at runtime without pulling in a package.
 */
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;

  interface Matchers<T> {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toContain(expected: unknown): void;
    toHaveLength(expected: number): void;
  }

  export function expect<T>(actual: T): Matchers<T>;
}
