import * as React from "react"

const MOBILE_BREAKPOINT = 768
const NARROW_BREAKPOINT = 390

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/**
 * MOBILE-ONLY: like useIsMobile, but the initial state is computed
 * SYNCHRONOUSLY from matchMedia during the first render instead of starting
 * as `false` and flipping after a useEffect.
 *
 * This matters for the mobile Chart View gate in App.tsx: with useIsMobile's
 * deferred initial value, the first render on a phone would briefly mount the
 * 3D TourScene (creating a WebGL context) before the effect flips the flag.
 * The product requirement is that NO WebGL context is ever created on mobile,
 * so the very first render must already know it is on a phone.
 *
 * Desktop consumers should keep using useIsMobile — this hook exists solely
 * for the mobile-shell gate and mobile-only components.
 */
export function useIsMobileImmediate() {
  const [isMobile, setIsMobile] = React.useState<boolean>(() => {
    // MOBILE-ONLY: synchronous first-render check (no SSR in this app, but be
    // defensive about non-browser test environments).
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false
    }
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    mql.addEventListener("change", onChange)
    // Re-sync in case the viewport changed between first render and effect.
    setIsMobile(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

export function useIsNarrow() {
  const [isNarrow, setIsNarrow] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsNarrow(window.innerWidth < NARROW_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isNarrow
}
