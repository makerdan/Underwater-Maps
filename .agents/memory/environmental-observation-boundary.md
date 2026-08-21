---
name: Environmental observation boundary
description: Domain-level access for weather, tide, marine temperature, and profile observations
---

The environmental domain exposes observation operations through a service facade while provider adapters retain their own caches, fallbacks, timeouts, and response normalization.

**Why:** Environmental upstreams need to evolve independently from catalog, upload, and API composition work without duplicating or changing established provider behavior.

**How to apply:** New observation routes and pack jobs should depend on the environmental service; add provider-specific logic behind the facade and preserve existing public contracts.