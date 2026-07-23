// Vitest alias target for the `server-only` package (which throws when
// imported outside a React Server Components graph). Unit/integration tests
// run in plain node — the guard is irrelevant there.
export {};
