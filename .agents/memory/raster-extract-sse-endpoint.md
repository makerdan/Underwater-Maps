---
name: raster-extract endpoint uses SSE, not plain JSON
description: POST /api/datasets/raster-extract always returns HTTP 200 text/event-stream; errors and success are SSE events, never HTTP error codes or JSON body.
---

`POST /api/datasets/raster-extract` (and `raster-commit`) uses Server-Sent Events:
- HTTP status is **always 200** regardless of errors
- Errors come as `data: {"stage":"error","message":"..."}` events
- Success comes as `data: {"stage":"done","result":{token,labels,...}}` events

**Why:** The route streams progress events during potentially long raster operations. The first HTTP header (200) is sent before processing begins; actual outcome arrives in the event stream.

**How to apply:** tests must parse SSE text instead of checking `res.status` for 4xx or `res.body` for JSON. Use a helper like:
```typescript
function parseSseText(raw: string): Array<Record<string, unknown>> {
  return raw.split(/\n\n+/).flatMap(block =>
    block.split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => JSON.parse(l.slice(5).trim()) as Record<string, unknown>)
  );
}
```
Then assert on `events.find(e => e.stage === "error")` or `events.find(e => e.stage === "done")`.
Relevant file: `artifacts/api-server/src/__tests__/raster-routes.test.ts`
