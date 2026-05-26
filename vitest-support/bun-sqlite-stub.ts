/**
 * Minimal Vitest/Vite stub for Bun's built-in `bun:sqlite` module so test files
 * can be transformed when the runner is Node-based Vitest.
 *
 * This is not a functional SQLite implementation. Any code path that executes
 * real SQL against a persisted database requires `bun test` (see `bun run test`
 * and `scripts/run-bun-tests.sh`), which loads the native module.
 *
 * Shapes align with `bun-types/sqlite.d.ts` where it matters for null checks:
 * `get()` returns `null` when there is no row (not `undefined`); `run`/`exec`
 * return a `Changes` object instead of `void`.
 */
interface SqliteChanges {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

const noopChanges = (): SqliteChanges => ({
  changes: 0,
  lastInsertRowid: 0,
});

export class Database {
  constructor(_path?: string, _options?: Readonly<{ readonly?: boolean }>) {}

  get inTransaction(): boolean {
    return false;
  }

  /**
   * No-op transaction wrapper: runs the callback directly without isolation.
   * Real atomic behaviour is only available under `bun test`.
   */
  transaction<TArgs extends readonly unknown[], TReturn>(
    insideTransaction: (...args: TArgs) => TReturn,
  ): ((...args: TArgs) => TReturn) & {
    deferred: (...args: TArgs) => TReturn;
    immediate: (...args: TArgs) => TReturn;
    exclusive: (...args: TArgs) => TReturn;
  } {
    const run = (...args: TArgs): TReturn => insideTransaction(...args);
    const wrapped = run as typeof run & {
      deferred: typeof run;
      immediate: typeof run;
      exclusive: typeof run;
    };
    wrapped.deferred = run;
    wrapped.immediate = run;
    wrapped.exclusive = run;
    return wrapped;
  }

  close(): void {}

  run(_sql: string, ..._params: unknown[]): SqliteChanges {
    return noopChanges();
  }

  exec(_sql: string, ..._params: unknown[]): SqliteChanges {
    return noopChanges();
  }

  query(_sql: string): {
    all(): unknown[];
    get(): unknown;
  } {
    return {
      all: () => [],
      get: () => null,
    };
  }

  prepare(_sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): SqliteChanges;
  } {
    return {
      all: () => [],
      get: () => null,
      run: () => noopChanges(),
    };
  }
}
