---
name: Nix pip vs uv for Python deps
description: How to correctly install Python packages in Replit's NixOS env — uv and python3 -m pip both fail; bare pip wrapper works.
---

# Python package installation in Replit NixOS

## The rule
Never use `python3 -m pip install` or `uv add` to install Python packages in scripts or workflows. Use the bare `pip` command (the Replit pip wrapper) with `PYTHONUSERBASE` pointing to `.pythonlibs`.

**Why:** In Replit's NixOS environment, `python3 -m pip` is blocked by an "externally-managed-environment" error. `uv add` (including via `installLanguagePackages()`) fails with "Permission denied" because it targets the read-only Nix store at `/nix/store/…/python3-3.11.14/lib/python3.11/site-packages`. The bare `pip` wrapper (`/nix/store/…-pip-wrapper/bin/pip`) just unsets `PYTHONNOUSERSITE` and calls the real pip, which respects `PYTHONUSERBASE` and installs to `.pythonlibs`.

**How to apply:**
1. Install: `PYTHONUSERBASE=/home/runner/workspace/.pythonlibs pip install -q package`
2. Check in subprocesses: pass `{ PYTHONUSERBASE, PYTHONPATH: userSite + ":" + existing }` explicitly in `execFileSync` env — workflow subprocesses may not inherit these.
3. Auto-install check pattern (in Node):
   ```js
   try {
     execFileSync("python3", ["-c", "import numpy; import laspy"], { stdio: "pipe", env: pythonEnv });
   } catch {
     execFileSync("pip", ["install", "-q", "-r", reqFile], { stdio: "inherit", env: pythonEnv });
   }
   ```
4. Do NOT name deps files `requirements*.txt` — Replit auto-detects that pattern, runs `uv sync`, and fails before the script starts.

## The file-naming trap
Any file named `requirements*.txt` anywhere in the project triggers Replit's uv auto-install at workflow startup (before the workflow command runs). Rename to something like `gen_laz_deps.txt` to avoid this.

## Packages already installed
numpy 2.4.6, laspy 2.7.0, lazrs 0.8.1 are in `/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages`.
