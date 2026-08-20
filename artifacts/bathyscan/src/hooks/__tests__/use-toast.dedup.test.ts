import { describe, it, expect } from "vitest"
import { reducer } from "../use-toast"
import type { ToastProps } from "@/components/ui/toast"

// Minimal helper to build a ToasterToast for the reducer
function makeToast(
  id: string,
  title: string,
  description?: string,
  open = true
): ToastProps & {
  id: string
  title?: string
  description?: string
  open?: boolean
} {
  return { id, title, description, open }
}

describe("use-toast reducer — ADD_TOAST deduplication (F-019)", () => {
  it("(a) two identical calls → one queue entry", () => {
    const toast = makeToast("1", "Error", "Something went wrong")

    const stateAfterFirst = reducer(
      { toasts: [] },
      { type: "ADD_TOAST", toast }
    )
    // Second call with the same title + description (different id, as genId() would produce)
    const duplicate = makeToast("2", "Error", "Something went wrong")
    const stateAfterSecond = reducer(stateAfterFirst, {
      type: "ADD_TOAST",
      toast: duplicate,
    })

    expect(stateAfterSecond.toasts).toHaveLength(1)
    expect(stateAfterSecond.toasts[0].id).toBe("1")
  })

  it("(a) dedup is exact and case-sensitive — different description is NOT suppressed", () => {
    const first = makeToast("1", "Error", "Something went wrong")
    const different = makeToast("2", "Error", "something went wrong") // lowercase 's'

    const stateAfterFirst = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: first })
    const stateAfterSecond = reducer(stateAfterFirst, {
      type: "ADD_TOAST",
      toast: different,
    })

    // TOAST_LIMIT=1 so only the newest is visible, but the reducer accepted both
    // The important thing: the second was NOT dropped — state changed
    expect(stateAfterSecond).not.toBe(stateAfterFirst)
  })

  it("(b) two different calls → two queue entries (TOAST_LIMIT caps display, both accepted)", () => {
    const first = makeToast("1", "Error", "Something went wrong")
    const second = makeToast("2", "Warning", "A different message")

    const stateAfterFirst = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: first })
    const stateAfterSecond = reducer(stateAfterFirst, {
      type: "ADD_TOAST",
      toast: second,
    })

    // Both were accepted (reducer did not return early).
    // TOAST_LIMIT=1 slices to 1 visible, but the key check is that the reducer
    // did NOT treat it as a duplicate (state changed and new toast is head).
    expect(stateAfterSecond).not.toBe(stateAfterFirst)
    expect(stateAfterSecond.toasts[0].id).toBe("2")
  })

  it("(b) different title alone is not suppressed", () => {
    const first = makeToast("1", "Error", "Same description")
    const second = makeToast("2", "Warning", "Same description")

    const s1 = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: first })
    const s2 = reducer(s1, { type: "ADD_TOAST", toast: second })

    expect(s2).not.toBe(s1)
    expect(s2.toasts[0].id).toBe("2")
  })

  it("(c) a dismissed toast re-shown → it appears again (dedup ignores dismissed entries)", () => {
    const original = makeToast("1", "Error", "Something went wrong", true)

    // Add it
    const s1 = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: original })

    // Dismiss it — sets open: false
    const s2 = reducer(s1, { type: "DISMISS_TOAST", toastId: "1" })
    expect(s2.toasts[0].open).toBe(false)

    // Now add the "same" toast again (new id, as the real code would generate)
    const reShown = makeToast("2", "Error", "Something went wrong", true)
    const s3 = reducer(s2, { type: "ADD_TOAST", toast: reShown })

    // Should NOT be treated as a duplicate — dismissed entry must not block re-show
    expect(s3).not.toBe(s2)
    // The new toast is at the head
    expect(s3.toasts[0].id).toBe("2")
  })

  it("(c) removing a toast allows the same message to be queued again", () => {
    const original = makeToast("1", "Error", "Something went wrong", true)

    const s1 = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: original })
    // Fully remove it
    const s2 = reducer(s1, { type: "REMOVE_TOAST", toastId: "1" })
    expect(s2.toasts).toHaveLength(0)

    const reShown = makeToast("2", "Error", "Something went wrong", true)
    const s3 = reducer(s2, { type: "ADD_TOAST", toast: reShown })

    expect(s3.toasts).toHaveLength(1)
    expect(s3.toasts[0].id).toBe("2")
  })

  it("coalesces within the short window and keeps the latest actionable content", () => {
    const first = { ...makeToast("1", "Error", "Try again"), dedupeKey: "api:load", addedAt: 1000 }
    const latest = {
      ...makeToast("2", "Error", "Try again now", true),
      dedupeKey: "api:load",
      addedAt: 1500,
    }
    const state = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: first })
    const updated = reducer(state, { type: "ADD_TOAST", toast: latest })

    expect(updated.toasts).toHaveLength(1)
    expect(updated.toasts[0]).toMatchObject({
      id: "1",
      description: "Try again now",
      dedupeKey: "api:load",
    })
  })

  it("allows the same identity after the deduplication window", () => {
    const first = { ...makeToast("1", "Error", "Try again"), dedupeKey: "api:load", addedAt: 1000 }
    const later = { ...makeToast("2", "Error", "Try again", true), dedupeKey: "api:load", addedAt: 4001 }
    const state = reducer({ toasts: [] }, { type: "ADD_TOAST", toast: first })
    const updated = reducer(state, { type: "ADD_TOAST", toast: later })

    expect(updated.toasts[0].id).toBe("2")
  })
})
