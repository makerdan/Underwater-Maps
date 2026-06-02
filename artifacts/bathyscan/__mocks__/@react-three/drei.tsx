/**
 * Manual mock for "@react-three/drei" (node_modules).
 *
 * Vitest picks this file up automatically when a test calls
 *   vi.mock("@react-three/drei")
 * with no factory argument.  The actual stub implementations live in
 * src/__tests__/mocks/drei.tsx; this file just re-exports them.
 */
export * from "../../src/__tests__/mocks/drei";
