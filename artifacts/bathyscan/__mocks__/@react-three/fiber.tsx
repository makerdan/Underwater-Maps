/**
 * Manual mock for "@react-three/fiber" (node_modules).
 *
 * Vitest picks this file up automatically when a test calls
 *   vi.mock("@react-three/fiber")
 * with no factory argument.  The actual stub implementations live in
 * src/__tests__/mocks/r3f.tsx; this file just re-exports them.
 */
export * from "../../src/__tests__/mocks/r3f";
