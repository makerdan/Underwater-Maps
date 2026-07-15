---
name: Disposed texture bound to uniform gets resurrected
description: three.js re-uploads a disposed texture if a shader samples it again; always rebind uniforms before disposing.
---

Rule: when disposing a texture that is bound to a shader uniform, rebind the uniform to its replacement (new texture or a shared placeholder) BEFORE calling dispose(), and never leave a uniform pointing at a disposed texture.

**Why:** three.js WebGLTextures re-initializes (re-uploads) a disposed texture on the next render that samples it. The re-uploaded GPU allocation is invisible to the app (refs already nulled) so nothing ever disposes it — a permanent leak. In BathyScan this hit the habitat-score DataTexture: `activeSpecies` can be truthy while scores are null/mismatched, so the shader kept sampling the stale uniform.

**How to apply:** any `material.uniforms[x].value = texture` site paired with `texture.dispose()` — swap order: assign replacement first, dispose superseded second. Terrain shader exposes `getPlaceholderHabitatTexture()` as the safe fallback binding.
