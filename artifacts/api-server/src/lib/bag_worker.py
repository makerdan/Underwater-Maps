#!/usr/bin/env python3
"""
bag_worker.py — Persistent stdin/stdout worker for BAG file parsing.

Stays alive between calls so Python + h5py + pyproj are loaded only once,
eliminating per-request cold-start overhead (~500–700 ms each).

Protocol (one request/response cycle per file):
  Stdin  (one line):  <absolute path to .bag file>\\n
                      __WARMUP__\\n  (no-op ping — imports h5py, sends __WARMUP_OK__)
  Stdout (response):
    \\n                          separator (always present, aids marker search)
    <lon,lat,depth lines>       CSV (may be empty on error path)
    __OK__\\n                    on success  OR
    __ERR__\\t<msg>\\n            on failure  (\\n in msg replaced by \\\\n)
    __WARMUP_OK__\\n             on __WARMUP__ request

The worker reads until EOF then exits cleanly.
"""

import sys
import os
import traceback

# Allow importing bag_parser helpers from the same directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from bag_parser import parse_standard_bag, parse_vr_bag, MAX_POINTS  # type: ignore
except ImportError as _import_err:
    # Surface the error at request time rather than at startup so the
    # caller's stderr-based error path still works.
    def parse_standard_bag(*_a, **_kw):  # type: ignore
        raise ImportError(_import_err)
    def parse_vr_bag(*_a, **_kw):  # type: ignore
        raise ImportError(_import_err)
    MAX_POINTS = 2_000_000

# Import h5py at module scope so the cost is paid once on startup, not per
# request.  The warmup() call on the TypeScript side sends __WARMUP__ which
# triggers this import path and receives __WARMUP_OK__ as an ACK.
try:
    import h5py  # type: ignore  # noqa: F401 — import triggers JIT compilation
    _H5PY_AVAILABLE = True
    _H5PY_ERR: str | None = None
except ImportError as _h5py_err:
    _H5PY_AVAILABLE = False
    _H5PY_ERR = (
        f"Missing Python dependency: {_h5py_err}. "
        "Run: PYTHONUSERBASE=.pythonlibs pip install h5py numpy pyproj --user"
    )


def _send_err(msg: str) -> None:
    one_line = msg.replace("\n", "\\n").replace("\r", "")
    sys.stdout.write(f"\n__ERR__\t{one_line}\n")
    sys.stdout.flush()


def handle_warmup() -> None:
    """Respond to a __WARMUP__ ping — h5py is already imported at module level."""
    sys.stdout.write("__WARMUP_OK__\n")
    sys.stdout.flush()


def handle_one(path: str) -> None:
    if not _H5PY_AVAILABLE:
        _send_err(_H5PY_ERR or "h5py not available")
        return

    try:
        with h5py.File(path, "r") as f:
            if "BAG_root" not in f:
                raise ValueError("Not a valid BAG file: missing BAG_root group")

            bag = f["BAG_root"]

            meta_xml = ""
            if "metadata" in bag:
                raw = bag["metadata"][()]
                if isinstance(raw, bytes):
                    meta_xml = raw.decode("utf-8", errors="replace")
                elif hasattr(raw, "dtype") and raw.dtype.kind in ("S", "U", "O"):
                    if raw.dtype.kind == "S":
                        meta_xml = b"".join(raw.flat).decode("utf-8", errors="replace")
                    else:
                        meta_xml = "".join(str(c) for c in raw.flat)
                else:
                    meta_xml = str(raw)

            is_vr = "varres_refinements" in bag and "varres_metadata" in bag
            if is_vr:
                points = parse_vr_bag(bag, meta_xml, MAX_POINTS)
            else:
                points = parse_standard_bag(bag, meta_xml, MAX_POINTS)

        if not points:
            _send_err("BAG file produced no valid depth points.")
            return

        sys.stdout.write("\n")
        for lon, lat, depth in points:
            sys.stdout.write(f"{lon:.8f},{lat:.8f},{depth:.4f}\n")
        sys.stdout.write("__OK__\n")
        sys.stdout.flush()

    except Exception as exc:
        tb = traceback.format_exc()
        _send_err(f"{exc}\n{tb}")


def main() -> None:
    sys.stderr.write("bag_worker: ready\n")
    sys.stderr.flush()

    for line in sys.stdin:
        path = line.rstrip("\n\r")
        if not path:
            continue
        if path == "__WARMUP__":
            handle_warmup()
        else:
            handle_one(path)


if __name__ == "__main__":
    main()
