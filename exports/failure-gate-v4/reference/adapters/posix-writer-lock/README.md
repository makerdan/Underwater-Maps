# Optional POSIX file-writer coordination adapter

This **project-neutral reference implementation** is bundled with Failure
Gate v4. It is not automatically installed or enabled, and is not a gate
runner, approval route, completion checker, or Replit platform integration.
It uses Python 3 standard-library `fcntl.flock` on a supported local POSIX
filesystem. Hosts on other runtimes/operating systems can implement equivalent
writer coordination or isolated immutable final snapshots; this adapter is
not a universal dependency of the skill.

## Host implementation checklist

1. **Discover and authorize.** Inventory the host's canonical writer entry
   points, background workers, generators, formatters, project checkout/plan
   projections, and local completion checker. Identify which inputs the final
   manifest covers. Record the proposed adapter in the capability manifest and
   obtain any required separate bootstrap/policy approval before changing the
   active gate. Keep existing tier commands, resource locks, and tests.
2. **Choose a shared lock.** Configure one absolute lockfile path in a trusted,
   persistent local directory; its parent must not be renamed or writable by
   untrusted actors. All participating processes must use the **same inode** on
   a filesystem with verified `flock` behavior. Do not assume a lock in one
   clone, container, device, or unverified network mount coordinates another.
   The lock file is runtime state, not a skill source or task deliverable.
   Never unlink, rotate, replace, or clean up the lock file while any
   participant may be running or waiting, including across restarts. A holder
   keeps a lock on the old inode even if its pathname is removed; a later
   participant could create a new file at the same path and acquire a
   different lock concurrently. Exclude the lock file and its parent from
   temp-file cleanup and deployment replacement. If stable inode lifetime
   cannot be guaranteed, do not use this adapter for completion coordination.
3. **Integrate every participating writer.** Route each relevant writing
   command through this wrapper, or put its complete synchronous write inside
   `with writer_lock(absolute_path, timeout=30):` in Python. Preserve the
   command's original validation scope and existing resource locks. Do not
   leave a direct checked route that bypasses the shared lock. Detached
   workers, agents writing directly with shell/file tools, and writers that
   close the inherited descriptor are **not** covered; if they can change
   relevant inputs, either bring them under coordination or use proven
   isolation. Do not claim this adapter covers arbitrary shell writes.
4. **Wire validated terminal completion as one operation.** Take the writer lock first,
   then the coordinator's authorization lock/transaction (same lock order in
   every code path needing both). In **one foreground invocation**, check the
   actual final input manifest against the tested snapshot, assess all required
   run evidence under the current authorization, and commit the terminal
   project-local task status *before* releasing either protection. Keep final
   validation/rejection fail-closed. Two separately locked calls for "check"
   and "complete" leave a race. Do not invoke or import platform-managed
   completion.
5. **Prove the host wiring.** First run the bundled primitive tests. Then
   verify the actual host coordinator with concurrent writers while final
   checking and committing, edits between validation and completion, lock
   contention/timeouts, failures/signals, and recovery. Test that each checked
   writer route uses the same lock and no asynchronous writer outlives the
   protected operation. Confirm cleanup/redeploy/restart routines do not
   remove or replace the lock path, and that no uncoordinated file writer or
   lock order inversion remains. The acquisition-time inode check in the
   wrapper cannot prevent a later out-of-band replacement. Fixture tests
   alone do not prove the live local-ID checked route or cutover. If a required
   capability is absent, leave ordinary-task activation/completion blocked
   and name the gap.

Examples (replace paths and commands with verified host mappings):

```sh
python3 writer_lock.py --lock /absolute/trusted/path/writers.lock --timeout 30 -- your-foreground-writer arg1
python3 writer_lock.py --lock /absolute/trusted/path/writers.lock --timeout 30 -- your-single-step-local-completion-command
```

The wrapper passes the child's exit status through; timeout exits 75 and
unavailable/invalid locking exits 69. On interruption it forwards the signal
and waits for its foreground child (killing after five seconds if necessary).
The foreground child inherits the descriptor, so a killed wrapper does not
release the lock while that child still holds it. The kernel releases the lock
on the final descriptor close. A daemonized or detached writer is outside the
contract. A caller with shell/write access can bypass or alter the adapter:
these checks are cooperative, not tamper-proof or reviewer authentication.

Run the bundled adapter tests from this directory:

```sh
python3 -m unittest discover -s tests -v
```

They check serialization, timeout, failure release, symlink rejection, a
cooperating final-check/write race, and wrapper-kill lock retention. Passing
them verifies only this adapter in the test environment; **it does not prove
any project's final-write coordination**.