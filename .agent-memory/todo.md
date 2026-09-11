# Provider time/record authority and room scope — 2026-09-11

PR https://github.com/Inukollu/Omni-Protocol/pull/108; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering. Time/authority implementation 3396be4bd83d3d0ce64ed2c6952a84701e47e1c6; final room diagnostic correction c56a67aeddd140abd8d0cc682d1af607dad95198.
- Optional Manifest.timeCheck + Connection.checkTime; host-local explicit interval, timeout, max RTT and sample age; optional Host.estimateProviderTime scoped by provider/login. Estimates are advisory, never HostGuarantees. Protocol defines/validates the surface; host scheduling and provider reads are integration work.
- Manifest.timestampAuthority:provider can declare provider-owned final record time. Providers may accept host instants or use own receipt/observation time. Host never retimes provider history. Required recorded result now carries canonical at; repeated host report key remains correlation only. Providers retain the key-to-history binding across retained-task reload. This is a candidate API change: adopters must update recordStep results; no fallback assumes host at.
- Provider-confirmed mute end is decisive for the matching local mute. Late host reports cannot reopen or overwrite final record. Caller departure may leave agent/added channels connected; empty onCall refers to this ended handling, not the whole bridge or caller journey.
- Full pnpm check passed 420 tests/build/types/package including provider-retimestamping regression. Final prose/diagnostic adjustment additionally passed build and 190 targeted validation/guide/hygiene tests. No live test, merge, package/wire version change or release.
- Risks: actual provider timestamp provenance, stable source correlation, physical host unmute and clock quality must be implemented/tested by integrations. Current helpers check shape/correlation, not real source time or device behavior. Await CI/review. Keep the worktree/branch while open; observer monitor below remains responsible.

# Review corrections — 2026-09-11

PR https://github.com/Inukollu/Omni-Protocol/pull/108; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering; implementation 575c0f8486014300b88862816b4b6c8654ec81a9 pushed to origin.
- Built-in commands reject unsupported payload fields (including executor/channels on end-call); custom payload remains extensible. End-call is a command on the task executed by the provider.
- Completing describes the agent handling, not caller/bridge termination; corrected guide, validator comments and diagnostic wording. No phase/media condition changed. Conference behavior unchanged; no caller-presence gate added.
- ISO/RFC3339 event timestamps remain standard. Clock estimation is an explicit listed exception with reasons; source instants are not invented or replaced with receipt times. No clock exchange API introduced.
- Full pnpm check passed: 415 tests, build/types, guide examples, package verification; diff check passed. No package/wire change, release or live operation. Source ownership/freshness and clock guarantees remain provider responsibilities.
- Next: CI/review on latest head. Existing observer-only monitor below remains alive; keep worktree and branch while open.

# Provider end-call and handling checks — 2026-09-11

- PR https://github.com/Inukollu/Omni-Protocol/pull/108 amended on branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering. Implementation: 2b60a55c2ad74f645deea67ebdecb53d14d36976, pushed to origin.
- End-call remains provider-executed under endCall:true; host sends only the ordinary exact task/allocation command. Provider ends caller plus owned/inherited agent-added channels and transfers ownership on confirmed handover. No host end-call API, executor selector, channel payload or implicit hangup on disposal.
- Added validateTaskCommandRequest and six handling regressions; guide covers repeated same-agent assignments, concurrent old wrap/new handling, provider-published IVR/queue/agent destinations, and stale outgoing commands.
- Full pnpm check passed: 414 tests, build/types, guide examples and package checks. Source freshness, authenticated provider/login selection and atomic ownership enforcement remain adapter/source responsibilities; these tests do not prove switch behavior.
- Package 0.1.82 and wire 1 unchanged. No release, merge, deployment or live test. Await current-head CI/review. Existing named observer-only monitor below remains responsible; retain worktree/local branch while open.

# Current preview correction and voice scope — 2026-09-11

PR108 https://github.com/Inukollu/Omni-Protocol/pull/108; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering. Preview implementation 5273995dbcde3a2068be2f6c901929d1e09b47cc; scope documentation 8286e8400c3f98d1162e7161764f9b354bbedc47.

PreviewDeadline is calls|host-calls|waits. waits leaves the task in preview after its preparation target, keeps Call available, and neither dials nor expires/disposes. Unlimited mode omits both deadline fields. Former expires deadline rejected by types/runtime; earlier candidate artifact1d75f293 and guidance are superseded for this field. No new packed adoption artifact generated this turn.

Voice task scope explicitly documents the agent's workspace/tools/permissions/media participation/wrap within a wider caller journey. Disposing the agent handling does not imply caller-channel/journey termination. No new journey fields or command lifecycle redesign performed.

Full pnpm check passed408 tests/build/types/guide/package for preview correction. Subsequent scope-only prose passed both guide tests and diff check. No protocol/package version changes, manual release, live test or merge. Await latest CI. Existing monitor below remains active; retain worktree/branch while open. Default handover preserved.

# Preview trigger ownership — 2026-09-11

- PR108 https://github.com/Inukollu/Omni-Protocol/pull/108 amended; implementation 1d75f2937f9ba20838e53a2e76835193cecb3487; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering.
- Per-task unlimited preparation omits deadline fields. Fixed provider dialing retains atDeadline:calls; new host-calls requires host ordinary Call with host dialId. Existing expires withdrawal remains. Exactly one owner, early manual action, race arbitration, clock uncertainty, timer invalidation and reconnect/unknown reconciliation documented.
- Fixed deadline means preparation end/initiation, not ringing/answer at that instant. Source eligibility that may never trigger is insufficient. Actual host timers/source intent correlation/outcome completeness are integration work, not implemented by Protocol.
- Provider-triggered preview ringing permits evidenced pre-answer media without a fabricated host ID; task and stream checks updated, including preview media end before non-answer completion. Deadline alone never permits media. Existing break checks retained.
- Full pnpm check passed:407 tests, build/types, guide examples and package validation; diff check passed. No protocol/package version change, release, live test or merge. Await CI/review. PR monitor remains the named observation-only process below; keep worktree/local branch until verified terminal state/clean/retained remote refs. Old review guidance about automatic-preview media limitations is superseded only by this unreleased candidate.

# Expanded break lifecycle checks — 2026-09-10

- PR108 https://github.com/Inukollu/Omni-Protocol/pull/108; implementation 5a983341839926e9fe45795dad6cea4dc203047e; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering.
- Added validateBreakCommand for all four agent methods: live login, explicit capability, active transport, current reason selection/alwaysAvailable exception, request phase, granted/idempotent commit, precommit cancel and committed/non-imposed end.
- Added validateTeamBreakCommand for decide/place/release/policy: live lead capability, target membership, awaiting decision, target reason codes and imposed release. Provider must bind memberBreak to memberId and recheck authorization atomically; full roster validation remains separate.
- Added validateBreakStatus against complete retained tasks; snapshot validation shares it. Existing monitoring exception preserved; full task validation remains separate.
- validateBreakTransition remains the shared ordering check. Source order/snapshot freshness and stale callback fencing cannot be inferred from these fields. No result acknowledgment writes state; existing validateResult checks result vocabulary. Host multi-provider durable decision/recovery is not implemented by these per-provider helpers.
- Full pnpm check passed: 402 tests, build/types, guide, package; diff check clean. No live tests, wire/package version change, merge or release. Await latest CI and review; observation-only monitor below remains active. Keep worktree/branch until terminal verification and remote-safe cleanup.

# Current work: break ordering checks — PR108

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-ordering; branch fix/break-ordering-checks; implementation 4e8a02ab9549fa7e9e3da777b20917787785a92c; PR https://github.com/Inukollu/Omni-Protocol/pull/108.

Added runtime validateBreakTransition and shared conformance checks. Covers all approval pairs, invalid inputs, imposed transitions, later attempts and snapshot recovery. No automatic stale-event suppression: full envelope/login and task consistency validation remain caller obligations; snapshot freshness needs source ordering and callback/read fencing. Raw Jema path is not assumed to use Protocol two-phase coordination. No wire/version changes, release or live tests.

Validation: full build/typecheck plus 392 tests passed; guide-format check failed, wording corrected, both guide tests rerun passed; package checks and diff check passed. Six new tests. Await CI/review; respond visibly to failures. Keep worktree and local branch while open. Cleanup only after independently verified terminal state, clean tree, remotely retained commits and recorded outcome; remote deletion needs explicit instruction.

# Current recording refinements (2026-09-10)

- PR107: https://github.com/Inukollu/Omni-Protocol/pull/107; branch fix/retain-protocol-version.
- Implementation SHA: e08b0fabc519af3cec8450a6928d6e1919425321 (includes the prior cancel/context refinements).
- Approved semantics: Stop retains audio; Cancel discards it. Policy uses cancel: true. RecordingCancelEffect, command.cancelEffect and host.cancelEffects removed; legacy variants rejected. No recording history changes.
- Validation fixes: explicit false is not permission; malformed standalone inputs rejected; provider task context preserved in dispatch/static checks and conformance; shared action/state transition table.
- Full pnpm check passed: 387 tests, types, build, guide examples and package verification. Reproduced three failing permission/context regressions before fixing them. After the test-only compiler timeout adjustment, typecheck and all guide tests passed again.
- Wire protocol remains/restores 1. Package version unchanged. No manual merge/release. Existing upstream merge workflow auto-publishes.
- Approved and implemented: HostRecording.announcesToCaller?: true, nested only in host recording support. Remote party receives audible host recording status messages. Provider owns provider recording announcements. False/misplaced declarations rejected. Actual outgoing audio delivery remains a host implementation obligation.
- CI response: Node 20 repeated the guide compiler test's 5000ms timeout on run 34426054291. Corrected with a 30s test budget and 10s per compiler process; assertions preserved. Await latest CI. Monitor remains PR107's existing named observation-only process below; keep worktree/branch while open.

## Earlier handover and rollback evidence

# Current work: restore the pre-release protocol number

- User direction: undo the protocol-number bump; retain recording changes and do not introduce version migration work.
- Worktree: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version
- Branch: fix/retain-protocol-version; fork: origin.
- Implementation SHA: 3ab7d4c5e8fbe541bb78bcabc442496a3040da25
- PR: https://github.com/Inukollu/Omni-Protocol/pull/107
- Restores OMNI_PROTOCOL_VERSION to 1; updates fixtures and guide. Recording types, controls and validators unchanged. Package version unchanged at 0.1.81.
- Validation: full pnpm check passed on 2026-09-10: 380 tests, types, build, guide examples and package integrity/layout checks.
- Not merged or released by this worker. Existing upstream merge workflow automatically publishes; do not invoke it manually.
- Adoption correction: 0.1.81 still contains wire protocol 2; this candidate restores 1. Hosts/adapters must align current pre-release recording shapes; no legacy compatibility shim.
- Keep worktree and branch until independently verified merge/intentional close, clean tree and remote reachability. Monitor evidence follows below.

## Previous delivery (historical; current direction above supersedes its protocol-2 guidance)

# Recording implementation handover

- Repository/default checkout: /Users/vasu/Dev/Personal/Omni-Protocol
- Dedicated worktree: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/task-recording
- Branch: feat/task-recording (fork origin)
- Implementation commit: 36aa34d1cce3d1126860164d86c2deaea106d2d1
- PR: https://github.com/Inukollu/Omni-Protocol/pull/106
- Completed: per-task independent provider/host recording permissions and current evidence; start/pause/resume/stop/cancel commands; explicit cancel disposition; source routing, allocation/recording/observation guards, expiry and outcome validation; host declaration/report and conformance harness support; guide/migration.
- Validation: full pnpm check passed on 2026-09-09: build, typecheck, 380 tests, guide examples, package verification (10 artifacts). No live tests.
- Compatibility: protocol 2; version-1-only peers refused explicitly. Package version unchanged at 0.1.80; no package release performed.
- Remaining integration: host/provider recorder implementations, actual storage/capture, trusted observation clocks and atomic executor/idempotency guarantees. This repository defines and validates the contract, not those implementations. Historical recording ledger remains separate.
- Outcome: PR106 MERGED at 2026-09-09T18:14:33Z, merge commit 92fca9f9bca9809677839ea6179a9d12384dae7a.
- Cleanup gate: independently verified merged/intentionally closed, clean worktree, needed commits retained remotely and terminal outcome recorded. Remote branch deletion requires separate instruction.
- Runtime files live under the dedicated worktree's .agent-memory/runtime. Default checkout receives the same monitor handover; monitor writes are intentional notes, not source changes.

## Terminal verification and cleanup

- Independent forge verification: MERGED; PR head 66a3f36f22f7f3669aa83665de0b2edf5ec6493c.
- Pre-merge Node 20 guide compiler test exceeded its 5000ms timeout; Node 22/24 passed. Attempt to rerun required repository admin rights.
- Post-merge CI succeeded: https://github.com/Inukollu/Omni-Protocol/actions/runs/34387809469 (including Node 20). This supersedes the transient pre-merge timeout for merged-code validation.
- Publish workflow succeeded: https://github.com/Inukollu/Omni-Protocol/actions/runs/34387809610. Upstream package bump commit 62cff5f records version 0.1.81; no manual release by this worker.
- Monitor omni-protocol-pr106-recording recorded MERGED at 2026-09-09T18:14:39.766202+00:00 and exited; PID 72707 independently verified absent.
- Both implementation/PR-head commits are retained in upstream/main and origin/feat/task-recording. This terminal notes commit must also be pushed to that fork ref before local deletion.
- Cleanup authorized only after notes commit is remote-reachable and tracked tree is clean: remove the stopped monitor's explicit runtime directory, dedicated task-recording worktree and corresponding local feat/task-recording branch. Retain remote branch. Default checkout retains this terminal handover.
- Remaining product integration: host/provider recorder implementations; no recording-history ledger implementation implied.

- Cleanup completed: dedicated worktree/local branch and monitor runtime files removed. Remote origin/feat/task-recording retained at cac417cc3419b1f6122f13065ada542b342e9a96.

<!-- pr107-monitor:begin -->
## Current rollback PR monitor

- Status: **OPEN_PENDING** at 2026-09-10T01:40:58.772172+00:00; action: Await review/CI; no automatic merge.
- PR: https://github.com/Inukollu/Omni-Protocol/pull/107
- Command: python3 /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version/.agent-memory/runtime/pr107-monitor.py
- Name: omni-protocol-pr107-rollback; PID: 2325; PID file: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version/.agent-memory/runtime/pr107.pid
- State: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version/.agent-memory/runtime/pr107.state.json; timestamped log: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version/.agent-memory/runtime/pr107.log; startup/error output: /Users/vasu/Dev/Personal/Omni-Protocol/.worktrees/retain-protocol-version/.agent-memory/runtime/pr107.process.log
- Poll interval: 60 seconds; timeout: 24 hours from startup. Next action: respond to CI/review failures, otherwise observe.
- Terminal conditions: MERGED, CLOSED, AUTH_FAILED, POLL_FAILED after 3 consecutive errors, TIMEOUT or CRASHED.
- Observe only: never merge, approve, push, delete or remove worktrees. Keep branch/worktree while open; independently verify terminal state, clean tree and retained remote commits before cleanup. Remote deletion requires separate instruction.
<!-- pr107-monitor:end -->

<!-- break-monitor:begin -->
Monitor omni-protocol-pr108-break-ordering: OPEN at 2026-09-11T05:25:45.047215+00:00. Await CI/review; monitor never merges.
PID 66088; command python3 /private/tmp/omni-break-ordering/.agent-memory/runtime/break-monitor.py; state /private/tmp/omni-break-ordering/.agent-memory/runtime/break.state.json; log /private/tmp/omni-break-ordering/.agent-memory/runtime/break.log; PID file /private/tmp/omni-break-ordering/.agent-memory/runtime/break.pid; process log /private/tmp/omni-break-ordering/.agent-memory/runtime/break.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-break-ordering, branch fix/break-ordering-checks, PR https://github.com/Inukollu/Omni-Protocol/pull/108.
<!-- break-monitor:end -->
