"""Process-level contract tests for the cooperative POSIX lock adapter."""

from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "writer_lock.py"


def locked(lock: Path, program: str, *args: str, timeout: float = 3) -> list[str]:
    return [
        sys.executable, str(SCRIPT), "--lock", str(lock), "--timeout",
        str(timeout), "--", sys.executable, "-c", program, *args,
    ]


def wait_for(path: Path, timeout: float = 3) -> None:
    deadline = time.monotonic() + timeout
    while not path.exists():
        if time.monotonic() >= deadline:
            raise AssertionError(f"timed out waiting for {path}")
        time.sleep(0.01)


class WriterLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.lock = self.root / "writers.lock"

    def launch(self, code: str, *args: str) -> subprocess.Popen[bytes]:
        proc = subprocess.Popen(locked(self.lock, code, *args))
        self.addCleanup(lambda: self._stop(proc))
        return proc

    @staticmethod
    def _stop(proc: subprocess.Popen[bytes]) -> None:
        if proc.poll() is None:
            proc.kill()
            proc.wait()

    def test_competing_writers_are_serialized(self) -> None:
        events = self.root / "events"
        started = self.root / "started"
        first = self.launch(
            "import pathlib,sys,time; p=pathlib.Path(sys.argv[1]);"
            "p.write_text('first-start\\n');"
            "pathlib.Path(sys.argv[2]).touch();time.sleep(.35);"
            "p.open('a').write('first-end\\n')",
            str(events), str(started),
        )
        wait_for(started)
        second = self.launch(
            "import pathlib,sys;p=pathlib.Path(sys.argv[1]);"
            "p.open('a').write('second\\n')",
            str(events),
        )
        self.assertEqual(first.wait(timeout=3), 0)
        self.assertEqual(second.wait(timeout=3), 0)
        self.assertEqual(events.read_text().splitlines(),
                         ["first-start", "first-end", "second"])

    def test_timeout_does_not_launch_command(self) -> None:
        started = self.root / "started"
        marker = self.root / "must-not-run"
        holder = self.launch(
            "import pathlib,sys,time;pathlib.Path(sys.argv[1]).touch();time.sleep(.5)",
            str(started),
        )
        wait_for(started)
        denied = subprocess.run(
            locked(self.lock, "import pathlib,sys;pathlib.Path(sys.argv[1]).touch()",
                   str(marker), timeout=0.1), capture_output=True, timeout=3,
        )
        self.assertEqual(denied.returncode, 75)
        self.assertFalse(marker.exists())
        self.assertEqual(holder.wait(timeout=3), 0)

    def test_child_failure_releases_lock_and_preserves_status(self) -> None:
        failure = subprocess.run(locked(self.lock, "import sys;sys.exit(17)"),
                                 capture_output=True, timeout=3)
        self.assertEqual(failure.returncode, 17)
        marker = self.root / "next"
        success = subprocess.run(
            locked(self.lock, "import pathlib,sys;pathlib.Path(sys.argv[1]).touch()",
                   str(marker)), capture_output=True, timeout=3,
        )
        self.assertEqual(success.returncode, 0)
        self.assertTrue(marker.exists())

    def test_symlink_lock_is_rejected(self) -> None:
        target = self.root / "target"
        target.touch()
        self.lock.symlink_to(target)
        marker = self.root / "must-not-run"
        denied = subprocess.run(
            locked(self.lock, "import pathlib,sys;pathlib.Path(sys.argv[1]).touch()",
                   str(marker)), capture_output=True, timeout=3,
        )
        self.assertEqual(denied.returncode, 69)
        self.assertFalse(marker.exists())

    def test_final_check_and_terminal_write_exclude_cooperating_writer(self) -> None:
        inputs = self.root / "inputs"
        terminal = self.root / "terminal"
        checked = self.root / "checked"
        changed = self.root / "changed"
        inputs.write_text("original")
        final = self.launch(
            "import pathlib,sys,time; inp,term,ready=map(pathlib.Path,sys.argv[1:]);"
            "seen=inp.read_text();ready.touch();time.sleep(.35);"
            "term.write_text(seen)",
            str(inputs), str(terminal), str(checked),
        )
        wait_for(checked)
        writer = self.launch(
            "import pathlib,sys; inp,done=map(pathlib.Path,sys.argv[1:]);"
            "inp.write_text('changed');done.touch()",
            str(inputs), str(changed),
        )
        self.assertEqual(final.wait(timeout=3), 0)
        self.assertEqual(terminal.read_text(), "original")
        self.assertEqual(writer.wait(timeout=3), 0)
        self.assertTrue(changed.exists())
        self.assertEqual(inputs.read_text(), "changed")

    def test_killed_wrapper_does_not_release_child_lock_early(self) -> None:
        started = self.root / "started"
        finished = self.root / "finished"
        marker = self.root / "must-not-run"
        wrapper = self.launch(
            "import pathlib,sys,time;pathlib.Path(sys.argv[1]).touch();"
            "time.sleep(.6);pathlib.Path(sys.argv[2]).touch()",
            str(started), str(finished),
        )
        wait_for(started)
        os.kill(wrapper.pid, signal.SIGKILL)
        self.assertEqual(wrapper.wait(timeout=3), -signal.SIGKILL)
        denied = subprocess.run(
            locked(self.lock, "import pathlib,sys;pathlib.Path(sys.argv[1]).touch()",
                   str(marker), timeout=0.1), capture_output=True, timeout=3,
        )
        self.assertEqual(denied.returncode, 75)
        self.assertFalse(marker.exists())
        wait_for(finished)
        # Child exit releases its inherited descriptor without manual cleanup.
        after = subprocess.run(
            locked(self.lock, "import pathlib,sys;pathlib.Path(sys.argv[1]).touch()",
                   str(marker)), capture_output=True, timeout=3,
        )
        self.assertEqual(after.returncode, 0)
        self.assertTrue(marker.exists())


if __name__ == "__main__":
    unittest.main()