/**
 * Manual mock for "three" (node_modules).
 *
 * Vitest picks this file up automatically when a test calls
 *   vi.mock("three")
 * with no factory argument.  The actual stub implementations live in
 * src/__tests__/mocks/three.ts; this file just re-exports them.
 */
export * from "../src/__tests__/mocks/three";
