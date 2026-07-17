---
name: vitest v3 sequencer types
description: BaseSequencer.sort() takes TestFile[] in vitest v3; WorkspaceSpec is a v2 type that doesn't exist in v3.
---

In vitest v3 (v3.2.7), the correct type for a custom sequencer is:

```typescript
import { BaseSequencer } from "vitest/node";
import type { TestFile } from "vitest/node";

class MySequencer extends BaseSequencer {
  override async sort(files: TestFile[]) { ... }
}
```

**Why:** `WorkspaceSpec` (vitest v2 name for the same concept) was renamed to `TestFile` in v3. Using `WorkspaceSpec` causes a TS2305 "Module has no exported member" error at compile time and vitest ignores the sequencer silently.

**How to apply:** Any time a custom BaseSequencer subclass is written for a v3 vitest project, use `TestFile` as the argument type. Check `vitest/node` exports if the project upgrades vitest again.
