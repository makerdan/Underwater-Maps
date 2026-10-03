#!/usr/bin/env python3
"""Cooperative POSIX file-writer lock; not a task authorization or completion gate."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import math
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time
from collections.abc import Iterator, Sequence


class LockError(Exception):
    """The lock could not be acquired safely."""


class LockTimeout(LockError):
    """A different participating process still holds the lock."""


@contextmanager
def writer_lock(lock_path: str | Path, timeout: float = 30.0) -> Iterator[int]:
    """Hold an advisory exclusive lock until the protected operation has finished.

    Every cooperating writer and the complete final-check/terminal transaction
    must use the same absolute lock path on a local filesystem. The lock path's
    parent must be trusted; neither parent nor lock file may be renamed,
    removed, rotated, or replaced while participants may hold or await it.
    The acquisition-time inode check cannot detect replacement after yielding.
    """
    path = Path(lock_path)
    if not path.is_absolute() or not math.isfinite(timeout) or timeout < 0:
        raise ValueError("absolute lock path and finite nonnegative timeout required")

    flags = os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        current = os.fstat(fd)
        if not stat.S_ISREG(current.st_mode):
            raise LockError("lock path is not a regular file")
        deadline = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise LockTimeout("writer lock timed out")
                time.sleep(min(0.05, remaining))

        # A replaced lockfile would let another process lock a different inode.
        visible = os.stat(path, follow_symlinks=False)
        if (visible.st_dev, visible.st_ino) != (current.st_dev, current.st_ino):
            raise LockError("lock path was replaced during acquisition")
        yield fd
    finally:
        # Do not explicitly unlock: the foreground child may still hold this
        # open file description if the wrapper is killed or a child lingers.
        # The kernel releases it when the last holder closes the descriptor.
        os.close(fd)


def run_locked(argv: Sequence[str], lock_path: str | Path, timeout: float) -> int:
    """Run one foreground command under the lock; propagate its exit status."""
    if not argv:
        raise ValueError("foreground command is required")
    with writer_lock(lock_path, timeout) as fd:
        child: subprocess.Popen[bytes] | None = None
        interrupted: list[int | None] = [None]
        first_signal_at: list[float | None] = [None]

        def forward(signum: int, _frame: object) -> None:
            interrupted[0] = signum
            if first_signal_at[0] is None:
                first_signal_at[0] = time.monotonic()
            if child is not None and child.poll() is None:
                try:
                    os.killpg(child.pid, signum)
                except ProcessLookupError:
                    pass

        previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
        try:
            for sig in previous:
                signal.signal(sig, forward)
            if interrupted[0] is not None:
                return 128 + interrupted[0]
            # A new session keeps terminal signals from reaching the child twice.
            # Keep the same open-file-description lock alive if the wrapper
            # crashes or is killed while its foreground child still writes.
            child = subprocess.Popen(
                list(argv), start_new_session=True, pass_fds=(fd,),
            )
            if interrupted[0] is not None:
                forward(interrupted[0], None)
            while True:
                try:
                    status = child.wait(timeout=0.1)
                    if interrupted[0]:
                        return 128 + interrupted[0]
                    return 128 - status if status < 0 else status
                except subprocess.TimeoutExpired:
                    if first_signal_at[0] and time.monotonic() - first_signal_at[0] >= 5:
                        try:
                            os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
        finally:
            # Never release the lock while the foreground process remains alive.
            if child is not None and child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            for sig, handler in previous.items():
                signal.signal(sig, handler)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", required=True, help="absolute path in a trusted local directory")
    parser.add_argument("--timeout", type=float, default=30, help="seconds to wait (default: 30)")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- foreground command [args ...]")
    args = parser.parse_args()
    command = args.command
    if not command or command[0] != "--" or len(command) < 2:
        parser.error("provide -- followed by one foreground command")
    try:
        return run_locked(command[1:], args.lock, args.timeout)
    except LockTimeout as exc:
        print(f"coordination blocked: {exc}", file=sys.stderr)
        return 75
    except (LockError, OSError, ValueError) as exc:
        print(f"coordination unavailable: {exc}", file=sys.stderr)
        return 69


if __name__ == "__main__":
    sys.exit(main())