## Guide terminology update — PR121

Published guide commit: 0436c61c01e33cc8bc3b4977622c40a17ce528e3. Branch `refactor/user-details-api`, worktree `/private/tmp/omni-user-details-api`, PR https://github.com/Inukollu/Omni-Protocol/pull/121.
“Host” is “Agent application” and “Provisioning” is “Local policy” in guide prose/comments. Existing API identifiers/literals and versions unchanged; glossary explicitly maps Host/host to agent application. Validation: all 4 guide tests passed, compiled examples/declaration matching passed, git diff --check passed. Log /private/tmp/agent-application-guide-check.log. No runtime change. Next: CI/review; existing PR121 monitor remains responsible (details below).

# Current delivery: User details API

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-user-details-api; branch refactor/user-details-api.
Implementation dc84751203a52234317c3ba00c82fdec2d6a572c.
PR https://github.com/Inukollu/Omni-Protocol/pull/121.
Connection.describeUsers renamed to getUserDetails; validateDescribedUsers renamed to validateUserDetails. Diagnostics/harness/guide aligned; old exports have no aliases. Arguments, results and directory obligations preserved. Hosts/providers update together; no version changes.
All 443 tests, build/type checks, guide examples, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/user-details-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. No merge/release/cleanup performed. PR120 independently verified merged.

# Current PR120 revision: Awaiting approval

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-status-field; branch refactor/break-status-field.
Implementation 2cb98e83dfcac4f1120dae754a9524d267193160.
PR https://github.com/Inukollu/Omni-Protocol/pull/120.
Pending break status awaiting-decision renamed to awaiting-approval, including team member state, ordering and conformance checks. Former value rejected without alias. Grant/denial/cancellation rules unchanged; hosts/providers update together. No version changes.
All 443 tests, build/typecheck, compiled guide examples, package verification and diff check passed. Log /private/tmp/awaiting-approval-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. No merge/release performed.

# Current PR120 revision: Optional reason text

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-status-field; branch refactor/break-status-field.
Implementation 8f94558d87a7c08f9ce837e7a8b3ecc058f11f19.
PR https://github.com/Inukollu/Omni-Protocol/pull/120.
Clarified existing optional reason text for agent BreakRequest and lead force-break. Added no-text checks with/without published choices. reasonId remains separate and required when choices are published; supplied text must be nonempty. No runtime behavior or version changes in this revision.
Build/typecheck, 37 focused break/guide/hygiene tests and package verification passed; prior manual-resume implementation passed all 440 tests. Log /private/tmp/optional-break-reason-check.log.
Next: monitor CI/reviews, respond to failures; retain branch/worktree while open. No merge/release performed.

# Current PR120 revision: Manual resumption and advisory duration

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-status-field; branch refactor/break-status-field.
Implementation d35ad8425d9adc9f673af73f986408e49d088c1b.
PR https://github.com/Inukollu/Omni-Protocol/pull/120.
ForcedBreak now contains by and optional positive finite expectedDurationMs; force-break may carry the duration. Removed endsAutomatically/endsAt; old fields rejected. Duration is from actual on-break start, excludes task finishing, and never resumes work. Agents may explicitly end forced breaks. Lead end-forced-break only clears forced metadata, preserving committed status and activeReasonId; authenticated agent resumption is required for readiness. User resolved the lead question: lift restriction only. Provider must establish action causality; state-only helpers cannot. No version changes.
Build/type checks, all 440 tests, guide examples, package verification and diff check passed. Log /private/tmp/manual-break-resume-final-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. No merge or release performed. Previous unpublished-draft note below is superseded by this tested publication.

# Superseded draft: manual-resume decision now resolved and published

Worktree /private/tmp/omni-break-status-field, branch refactor/break-status-field, PR https://github.com/Inukollu/Omni-Protocol/pull/120.
Uncommitted changes remove ForcedBreak.endsAutomatically/endsAt, permit agent endBreak for forced breaks and add optional advisory expectedDurationMs to ForcedBreak and force-break command. Expected duration excludes starting-after-task wait and never restores readiness. Old timer fields rejected. 439 tests, build/type checks, guide examples and package checks passed; log /private/tmp/manual-break-resume-check.log.
Pending user decision: remove lead end-forced-break entirely, or retain only as lifting restriction while agent remains on break until explicit resume. Existing lead-command semantics are not reconciled yet, so this draft must not be published as complete. Existing PR monitor remains for already-published work.

# Current PR120 revision: BreakStatus type

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-status-field; branch refactor/break-status-field.
Implementation 34a2c662283f53667c4870f0533bd0738ed0b92a.
PR https://github.com/Inukollu/Omni-Protocol/pull/120.
BreakApproval renamed to BreakStatus, matching BreakState.status. Former export has no alias. Values, reasons, activeReasonId and lifecycle rules unchanged. BreakOnTaskStep.approval field remains, now typed BreakStatus. Hosts/providers must update together; no version changes.
Build/type checks, all 438 tests, guide examples, package verification and diff check passed. Log /private/tmp/break-status-type-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible. No merge or release performed.

# Current delivery: BreakState status field

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-break-status-field; branch refactor/break-status-field.
Implementation 02cacfd16d3432fce329dcb4240819e1a84d2649.
PR https://github.com/Inukollu/Omni-Protocol/pull/120.
BreakState.status replaces approval; old/mixed fields rejected. Diagnostic names/paths updated. BreakApproval union, reasons, activeReasonId, values and prerequisites unchanged; separate BreakOnTaskStep.approval helper retained. Hosts/providers must update together; no aliases or version changes.
Build/test typecheck, all 438 tests, guide examples, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/break-status-field-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. No merge/release/cleanup performed. PR119 independently verified merged.

# Current PR119 revision: Break request retry delay

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 8d356b8a1d981155934d4f62f7e1fb9d30fc26d7.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
BreakState.retryRequestAfterMs replaces retryAfterMs; diagnostic break.retryRequestAfterMs. Old/mixed break fields rejected; optional finite non-negative milliseconds preserved. Authentication/general failure retryAfterMs unchanged. Hosts/providers update together; no aliases/version changes.
Build/type checks, all 437 tests, guide examples, package verification and diff check passed. Log /private/tmp/retry-request-after-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: On-break state

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 76a1e38dfb7870b63d669f923a3b7086d7f4a184.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
BreakApproval on-break replaces in-effect; diagnostic break.on-break.tasks and ordering/conformance checks updated. Old value rejected without alias. granted, decisionReason, starting-after-task and existing task/listening prerequisites preserved. Team member availability unchanged. Hosts/providers must update together; no version changes.
Build/type checks, all 436 tests, guide examples, package verification and diff check passed. Log /private/tmp/on-break-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: Request unavailable reason

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 3cda86c0ed6b4ecf9130554a4add4d73271b885f.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
BreakState.requestUnavailableReason replaces refusedReason; related diagnostics renamed. Old/mixed fields rejected. Nonempty reason is allowed only when canRequestBreak is false; decisionReason remains distinct. Hosts/providers must update together; no aliases or version changes.
Build/type checks, all 435 tests, guide examples, package verification and diff check passed. Log /private/tmp/request-unavailable-reason-check.log.
Next: monitor CI/reviews and respond to failures; keep worktree/branch while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: Explicit break request eligibility

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation f10a663805d1da1ca2fa154271615ff67c0e20f7.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
BreakState.canRequestBreak replaces mayAsk; related validation diagnostics renamed. Old/mixed fields rejected without alias. Eligibility remains distinct from approval, with alwaysAvailable exceptions preserved. Final policy values remain approval-required, automatically-approved, requests-suspended. Hosts/providers update together; no version changes.
Build/type checks, all 434 tests, guide examples, package verification and diff check passed. Log /private/tmp/can-request-break-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: Automatically-approved policy

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 0c7e81faddbb9a02b7f366240e281cfd97178b97.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
Final set-break-policy values: approval-required, automatically-approved, requests-suspended. Old auto-approve rejected without alias; commitment, break-start prerequisites and permissions unchanged. Hosts/providers update together; no version changes.
Build/type checks, all 433 tests, guide examples, package verification and diff check passed. Log /private/tmp/automatically-approved-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: Requests-suspended policy

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 3973b2848c977aade85f15cf7ccde6c4f4b356d4.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
Final set-break-policy values: approval-required, auto-approve, requests-suspended. Old suspended and unadopted requests-blocked rejected. New requests are rejected, not queued; existing breaks unaffected. Permissions unchanged. Hosts/providers update together; no aliases/version changes.
Build/type checks, all 433 tests, guide examples, package verification and diff check passed. Log /private/tmp/requests-suspended-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible. No merge or release performed.

# Current PR119 revision: Approval-required break policy

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation d1a7adaa6c9eaa6f0184cb38f010aec08763da38.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
set-break-policy now accepts approval-required (formerly ask), auto-approve or suspended. Old ask value rejected without alias; behavior and permissions unchanged. Hosts/providers update together. No version changes.
Build/type checks, all 433 tests, guide examples, package verification and diff check passed. Log /private/tmp/approval-required-check.log.
Next: monitor CI/reviews and respond to failures; keep worktree/branch while open. Existing named monitor remains responsible; no merge or release performed.

# Current delivery: Set break policy command

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-set-break-policy; branch refactor/set-break-policy.
Implementation 60565aaa5c5520e4dbf85c2f2ffc7a2bdf30ceeb.
PR https://github.com/Inukollu/Omni-Protocol/pull/119.
TeamBreakCommand policy renamed to set-break-policy. Old command rejected without alias; policy field and ask/auto-approve/suspended values, permissions and behavior unchanged. Hosts/providers must update together. No package or wire version changes.
Checks: build/test typecheck, all 433 tests, guide examples, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/set-break-policy-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. No merge/release/cleanup performed. PR118 independently verified merged.

# Current PR118 revision: Explicit break request decision

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-end-forced-break; branch refactor/end-forced-break.
Implementation fe4f1054ac1464a9b2a810b0b4b036ef93f66fe6.
PR https://github.com/Inukollu/Omni-Protocol/pull/118.
Commands: decide-break-request, force-break, end-forced-break. Old decide rejected; granted/denied choices, permissions and awaiting-decision prerequisite unchanged. Hosts/providers must update together; no aliases or version changes.
Build/type checks, all 432 tests, guide examples, package verification and diff check passed. Log /private/tmp/decide-break-request-check.log.
Next: monitor CI/reviews, respond to failures; retain worktree/branch while open. Existing named monitor remains responsible. No release or merge performed.

# Current PR118 revision: Descriptive team break commands

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-end-forced-break; branch refactor/end-forced-break.
Implementation 962b55780e41ad0f16896cc9910c7db02d444930.
PR https://github.com/Inukollu/Omni-Protocol/pull/118.
Final commands: force-break and end-forced-break. Supersedes interim force/end descriptions below. Old place/release and interim force/end rejected; permissions, target state/reasons and ordering unchanged. Hosts/providers update together; no version changes.
Build/type checks, all 432 tests, guide examples, package verification and diff check passed. Log /private/tmp/force-break-specific-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. Existing named monitor remains responsible; no merge or release performed.

# Current PR118 revision: Descriptive end-forced-break command

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-end-forced-break; branch refactor/end-forced-break.
Implementation b5ae16712ea1fbb6c22e673962efd09ade45f0f5.
PR https://github.com/Inukollu/Omni-Protocol/pull/118.
Team command is now end-forced-break, diagnostic team.break.command.endForcedBreak. Supersedes the earlier end name below. Retired release/end/end-break rejected; agent endBreak and existing permissions/state rules unchanged. Hosts/providers must update together; no aliases or version changes.
Build/typechecks, all 432 tests, guide examples, package verification and diff check passed. Log /private/tmp/end-forced-break-specific-check.log.
Existing observer monitor remains responsible for CI/reviews; retain worktree/branch while open. Next action: respond to CI/review failures; no release or merge performed.

# Current delivery: End forced break command

Repository: /Users/vasu/Dev/Personal/Omni-Protocol
Worktree: /private/tmp/omni-end-forced-break
Branch: refactor/end-forced-break
Implementation: 54425321b28907193823861a44f0093e14dffe80
PR: https://github.com/Inukollu/Omni-Protocol/pull/118

TeamBreakCommand release renamed to end; guide, validator and team.break.command.end diagnostic aligned. Old literal rejected; no alias. Agent endBreak still cannot end forced breaks. Permissions, target state and ordering unchanged. Hosts/providers must adopt together. No package/wire version changes.
Checks: build/test typecheck, 432 tests, compiled guide examples, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/end-forced-break-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. No release/merge/cleanup performed. PR117 independently verified merged.

# Current delivery: Force break command

Repository: /Users/vasu/Dev/Personal/Omni-Protocol
Worktree: /private/tmp/omni-force-break-command
Branch: refactor/force-break-command
Implementation: c090bd9607b483d9b549cb8fa940d10b4cd8e69c
PR: https://github.com/Inukollu/Omni-Protocol/pull/117

TeamBreakCommand place renamed to force, including validator and guide. Old literal rejected without alias; hosts/providers must update together. Permissions, current target state/reasons, release and ordering preserved. No package or wire version changes.
Validation: build/test typecheck, 431 tests, compiled guide examples, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/force-break-command-check.log.
Next: monitor CI/reviews and respond to failures; retain branch/worktree while open. No release/merge/cleanup performed. PR116 independently verified merged.

# Current delivery: Forced break API

Repository: /Users/vasu/Dev/Personal/Omni-Protocol
Worktree: /private/tmp/omni-forced-break-api
Branch: refactor/forced-break-api
Implementation: 7d1c9c744a342c0df15aa99d68451b099fbb1f23
PR: https://github.com/Inukollu/Omni-Protocol/pull/116

ForcedBreak / BreakState.forced replace ImposedBreak / imposed; diagnostics and conformance coverage renamed. Retired field rejected even beside forced; no type alias. Actor/timing/status/order, agent-end prohibition and lead release unchanged. Hosts/providers must update together. No package or wire version changes.
Checks: build, test typecheck, 430 tests including guide examples and migration rejection, package verification (10 files/3 entrypoints), diff check passed. Log /private/tmp/forced-break-check.log.
Next: monitor CI/reviews and respond to failures; retain worktree/branch while open. No release, merge or cleanup performed. PR115 independently verified merged.

# Current delivery: Take over call API

Repository: /Users/vasu/Dev/Personal/Omni-Protocol
Worktree: /private/tmp/omni-take-over-call-api
Branch: refactor/take-over-call-api
Implementation: 10303cc72e7e1e4321e6143b715955b563906e0b
PR: https://github.com/Inukollu/Omni-Protocol/pull/115

Renamed lead-assist take-over to take-over-call in API, validator and guide. Retired literal rejected. Assisting prerequisite, taken-over outcome and no-completing-window behavior preserved. Hosts/providers must update together; no alias. No package/wire version changes.
Validation: build, test typecheck, all 429 tests, compiled guide examples, package verification (10 files/3 entrypoints), git diff --check passed. Log: /private/tmp/take-over-call-check.log.
Next action: observe CI/review; respond to failures. Keep branch/worktree while PR is open. No release/merge/cleanup performed. PR114 independently verified merged.

# Listen API rename — PR114 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-listen-api; branch refactor/listen-api; implementation 84d02829a2616428959d35cea156622a7406577d; PR https://github.com/Inukollu/Omni-Protocol/pull/114.

Renamed monitor action/mode to listen; ListeningMode/LISTENING_MODES, TeamListenCommand/Request, executeTeamListen, listeningControl, TaskListening/task.listening, LISTENING_BREAK_KINDS/breakKindAllowsListening and diagnostics now align. Existing listen/coach/join-call audio effects, permissions, break restrictions and single-call limits unchanged. Old/mixed task and permission fields and retired modes rejected; retired exports/methods refused by type checks. No compatibility aliases, package/wire bump, release or client adoption.

Validation: build/test typecheck, all 429 tests, compiled guide examples, packed package verification (10 files, all three runtime/type entry points), diff check passed. Risk: producers/consumers must migrate imports, connection method, command mode, permissions, saved task snapshots and diagnostics together. No new runtime team-command validator introduced. Next: CI/review; user merges. Keep dedicated worktree/branch while open.

PR113 independently verified MERGED at 7ee52eada404d236f571d9f6d00a5b7860755ce1. New branch starts at merged main 44ec0d3. Old worktrees retained; no cleanup requested. Following sections are historical delivery records.

# Coach API rename — PR113 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-coach-api; branch refactor/coach-api; implementation 329ee41578d7ac276454775bf8ead28c4a5e53ed; PR https://github.com/Inukollu/Omni-Protocol/pull/113.

Renamed whisper to coach in MonitorMode, MONITOR_MODES, TeamMonitorCommand, monitorControl permissions and monitoring.mode. Guide, examples and tests updated. Agent-only lead audio and monitor prerequisites preserved; caller cannot hear the lead. Existing break kind coaching remains unchanged. Old/mixed mode permissions and old published state rejected; retired command/mode refused by type checks. No compatibility alias, package/wire bump, release or client adoption.

Validation: build/test typecheck, all 428 tests, compiled guide examples, packed package verification (10 files; all three runtime/type entry points) and diff check passed. Risk: commands, permissions and retained monitoring snapshots must migrate together. No new monitor-command runtime validator introduced. Next: CI/review; user merges. Retain dedicated worktree/branch while open.

PR112 independently verified MERGED at ac65710b08375dcbaafc71336aec9c71281465fd. New branch starts at merged main 3e836dd. Previous worktrees retained; no cleanup requested. Following sections are historical handovers.

# Join call API rename — PR112 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-join-call-api; branch refactor/join-call-api; implementation 5d0a7d34be0368b205f210c0aae80e61177fb969; PR https://github.com/Inukollu/Omni-Protocol/pull/112.

Renamed barge to join-call in MonitorMode, MONITOR_MODES, TeamMonitorCommand, permission declarations and published monitoring state. Guide labels it Join call and distinguishes monitoring from assistance/takeover. Existing prerequisites/permissions unchanged. Regression checks reject former/mixed mode declarations and former state; compile-time checks reject retired command/mode. No compatibility alias, package/wire version change, release or client adoption.

Validation: build/test typecheck passed. Full 427-test run: 426 passed, one guide inline reference failed; corrected the reference, then all six guide/example/hygiene checks passed. Package verification passed (10 files; all three runtime/type entry points); diff check passed. No outstanding failed checks. Risk: producers/consumers must migrate action, permissions and retained monitoring state together. Runtime mode validators enforce the rename; no new monitor-command runtime validator was introduced. Next: CI/review; user merges; retain worktree/branch while open.

PR111 independently verified MERGED at bb1935f311427f422545875b8f97745dd5a21408. New branch starts at merged main 1d36322; no version edit. Old worktrees retained; no cleanup requested. Following sections are historical records.

# Team members API rename — PR111 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-team-members-api; branch refactor/team-members-api; implementation ea0b90a1d73464fb9ff9980e1bbdfddc9241ad2f; PR https://github.com/Inukollu/Omni-Protocol/pull/111.

TeamMembers and validateTeamMembers replace TeamRoster and validateTeamRoster without aliases. Guide, README, harness, examples and callers updated. Snapshot.team, team-updated and team payload/members/requests/policies retain their names and semantics; empty team is an object with members: []. Compile-time refusal checks cover retired exports. No wire/package version changes, release or client adoption.

Validation: build and test typecheck, all 426 tests, guide examples, packed-package verification (10 files, all three runtime/type entry points) and diff check passed. Risk: consumers must migrate imports and validator calls; wire payload shape is unchanged. Next: monitor CI/review; user merges. Retain dedicated worktree/branch while open.

PR110 independently verified MERGED at 777bc51d587b2a54a6d1088588bc2b985816283a. New branch starts at upstream main 2c93a2a, with its existing package version 0.1.85 unchanged. Earlier worktrees retained; no cleanup requested. Following sections are historical handover records.

# Outcome API rename — PR110 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-outcome-api; branch refactor/outcome-api; implementation 6ca86af87c9bfc6e1f7000d80d95f58590cc7527; PR https://github.com/Inukollu/Omni-Protocol/pull/110.

Renamed DispositionCode/Rules/Payload to OutcomeCode/Rules/Payload, capabilities.dispositions to outcomes, and complete.disposition to outcome. Updated guide, diagnostics, harness and examples; migration table lists exact changes. Existing required-code, code-membership and notes checks preserved. New runtime regressions reject former/mixed fields on voice/chat/email; type checks reject retired export/fields. No compatibility aliases, package/wire bump, release or client adoption.

Validation: build/test typecheck, all 426 tests and packed package verification (10 files; three runtime/type entry points) passed. git diff --check passed. Risk: breaking field/export renames require coordinated host/provider and retained-snapshot migration. Next: monitor CI/review; user merges. Retain worktree and local branch while open.

PR109 independently verified MERGED at bd98490c7d5db1f65a00edf090e56d6c3bdc78f1; its monitor recorded MERGED and terminated. Old worktree retained; no cleanup requested or performed. Following sections are historical delivery records.

# Interaction API terminology — PR109 — 2026-09-11

Repository /Users/vasu/Dev/Personal/Omni-Protocol; worktree /private/tmp/omni-interaction-guide; branch docs/interaction-terminology; implementation 637abdf25cfef4294b55d56dba1729bd772f5368; PR https://github.com/Inukollu/Omni-Protocol/pull/109.

API and guide now use interactionHistory, TaskInteractionHistory/Step, InteractionStep/Report/ReportResult, validateInteractionReport, interaction step helpers/constants, and interactionSeconds. Manifest completionSettleMs replaces the old disposal bound. Runtime rejects retired fields, including mixed old/new payloads; type checks reject former exports/fields. Outcome disposition names and recordStep/complete behavior unchanged. Migration table includes diagnostic rule renames. No compatibility aliases, package/wire bump, release or live action.

Validation: build and test typecheck passed; full 425-test run had 424 passes plus one guide identifier assertion on retired names in the migration table. Corrected the table and reran all six guide/example/hygiene checks successfully. Package verification passed (10 files, all three runtime/type entry points). Diff check passed. No remaining failed checks. Risk: breaking API/wire spelling change requires coordinated producer/consumer and retained-snapshot migration before adoption; no client adoption performed. Await PR CI/review; keep worktree/branch while open.

PR108 was independently verified merged, with all three Node CI checks successful; its monitor terminated MERGED. Its worktree is retained pending clean-tree/terminal-record cleanup gates. PR109 now awaits CI/review; retain its dedicated worktree and branch. Named observer-only monitor runtime is under /private/tmp/omni-interaction-guide/.agent-memory/runtime; detailed identity and real poll follow below.

# Consolidated PR108 delivery — 2026-09-11

All intended source, tests and guide changes are in PR https://github.com/Inukollu/Omni-Protocol/pull/108 on fix/break-ordering-checks, worktree /private/tmp/omni-break-ordering. Verified implementation baseline 923bca9e6ca7992ac02351ff1a2cc4b3f910bc9d is on origin and the PR; no source/test/guide diff remains. Full local check:423 tests. CI Node20/22/24 passed (run34566254726); PR open/mergeable, no review decision. Pending change in this handover is notes only.

Fresh candidate from that exact baseline: /private/tmp/omni-pr108-923bca9/xema-omni-protocol-0.1.82.tgz; integrity sha512-iaO2AKPExIIvSyuEPn5NekgBFj6qnubydS90og3o4aMFmYtSJB3DQXqBBclxvUBGVbbShDmEUzg/EqE5vBgqXQ==. Packed files and SHA512 independently verified. Exact adoption reference: /private/tmp/omni-pr108-923bca9/adoption-reference.md. Unreleased local candidate, not registry0.1.82; no client install. Lost acknowledgment binding lookup has no new public API; source recovery must not guess or invent timestamps. Remaining implementation risks are documented below.

Next: review/merge by user; observer-only monitor remains active. Preserve worktree/local branch while open. No package/wire version changes or release.

# Strict break ordering — 2026-09-11

PR https://github.com/Inukollu/Omni-Protocol/pull/108; branch fix/break-ordering-checks; worktree /private/tmp/omni-break-ordering; implementation 84135e2cee67dd126b98f8c29cbf187060aa788c pushed to origin.
- BreakStream requires a validated snapshot baseline, keeps accepted state after rejected/malformed transitions and blocks deltas until snapshot recovery. Transport loss invalidates the baseline; active alone does not restore it. seed now returns violations; needsRecovery exposes the gate. No first-event implicit baseline.
- Guide requires host pre-dispatch checks, provider atomic prerequisite checks and serialized validated publications, then host pre-replacement checks. Explicit normal order and auto-grant/no-work/imposed/cancel/end exceptions retained. A later attempt can start after not-requested.
- Full pnpm check passed: 423 tests, build/types, guide examples and package verification. No package/wire bump, release, merge or live test. Source attempt fencing, login scope and actual snapshot freshness still require integration evidence; no timestamps or ranks pretend to establish them.
- Await CI/review. Existing observer-only monitor remains alive; retain worktree/local branch while PR open. Adoption must check seed violations and recover rather than use the first delta as a baseline.

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
Monitor omni-protocol-pr108-break-ordering: MERGED at 2026-09-11T06:11:21.655181+00:00. Await CI/review; monitor never merges. Independently verify terminal state and cleanup gates.
PID 66088; command python3 /private/tmp/omni-break-ordering/.agent-memory/runtime/break-monitor.py; state /private/tmp/omni-break-ordering/.agent-memory/runtime/break.state.json; log /private/tmp/omni-break-ordering/.agent-memory/runtime/break.log; PID file /private/tmp/omni-break-ordering/.agent-memory/runtime/break.pid; process log /private/tmp/omni-break-ordering/.agent-memory/runtime/break.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-break-ordering, branch fix/break-ordering-checks, PR https://github.com/Inukollu/Omni-Protocol/pull/108.
<!-- break-monitor:end -->

<!-- interaction-monitor:begin -->
Monitor omni-protocol-pr109-interaction-guide: OPEN at 2026-09-11T06:21:20.505280+00:00. Await CI/review; monitor never merges.
PID 10809; command python3 /private/tmp/omni-interaction-guide/.agent-memory/runtime/interaction-monitor.py; state /private/tmp/omni-interaction-guide/.agent-memory/runtime/interaction.state.json; log /private/tmp/omni-interaction-guide/.agent-memory/runtime/interaction.log; PID file /private/tmp/omni-interaction-guide/.agent-memory/runtime/interaction.pid; process log /private/tmp/omni-interaction-guide/.agent-memory/runtime/interaction.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-interaction-guide, branch docs/interaction-terminology, PR https://github.com/Inukollu/Omni-Protocol/pull/109.
<!-- interaction-monitor:end -->

<!-- outcome-monitor:begin -->
Monitor omni-protocol-pr110-outcome-api: OPEN at 2026-09-11T06:57:16.097980+00:00. Await CI/review; monitor never merges.
PID 77110; command python3 /private/tmp/omni-outcome-api/.agent-memory/runtime/outcome-monitor.py; state /private/tmp/omni-outcome-api/.agent-memory/runtime/outcome.state.json; log /private/tmp/omni-outcome-api/.agent-memory/runtime/outcome.log; PID file /private/tmp/omni-outcome-api/.agent-memory/runtime/outcome.pid; process log /private/tmp/omni-outcome-api/.agent-memory/runtime/outcome.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-outcome-api, branch refactor/outcome-api, PR https://github.com/Inukollu/Omni-Protocol/pull/110.
<!-- outcome-monitor:end -->

<!-- team-members-monitor:begin -->
Monitor omni-protocol-pr111-team-members-api: OPEN at 2026-09-11T07:30:37.948493+00:00. Await CI/review; monitor never merges.
PID 18952; command python3 /private/tmp/omni-team-members-api/.agent-memory/runtime/team-members-monitor.py; state /private/tmp/omni-team-members-api/.agent-memory/runtime/team-members.state.json; log /private/tmp/omni-team-members-api/.agent-memory/runtime/team-members.log; PID file /private/tmp/omni-team-members-api/.agent-memory/runtime/team-members.pid; process log /private/tmp/omni-team-members-api/.agent-memory/runtime/team-members.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-team-members-api, branch refactor/team-members-api, PR https://github.com/Inukollu/Omni-Protocol/pull/111.
<!-- team-members-monitor:end -->

<!-- join-call-monitor:begin -->
Monitor omni-protocol-pr112-join-call-api: OPEN at 2026-09-11T07:39:29.213000+00:00. Await CI/review; monitor never merges.
PID 58048; command python3 /private/tmp/omni-join-call-api/.agent-memory/runtime/join-call-monitor.py; state /private/tmp/omni-join-call-api/.agent-memory/runtime/join-call.state.json; log /private/tmp/omni-join-call-api/.agent-memory/runtime/join-call.log; PID file /private/tmp/omni-join-call-api/.agent-memory/runtime/join-call.pid; process log /private/tmp/omni-join-call-api/.agent-memory/runtime/join-call.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-join-call-api, branch refactor/join-call-api, PR https://github.com/Inukollu/Omni-Protocol/pull/112.
<!-- join-call-monitor:end -->

<!-- coach-monitor:begin -->
Monitor omni-protocol-pr113-coach-api: OPEN at 2026-09-11T07:43:42.517682+00:00. Await CI/review; monitor never merges.
PID 78236; command python3 /private/tmp/omni-coach-api/.agent-memory/runtime/coach-monitor.py; state /private/tmp/omni-coach-api/.agent-memory/runtime/coach.state.json; log /private/tmp/omni-coach-api/.agent-memory/runtime/coach.log; PID file /private/tmp/omni-coach-api/.agent-memory/runtime/coach.pid; process log /private/tmp/omni-coach-api/.agent-memory/runtime/coach.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-coach-api, branch refactor/coach-api, PR https://github.com/Inukollu/Omni-Protocol/pull/113.
<!-- coach-monitor:end -->

<!-- listen-monitor:begin -->
Monitor omni-protocol-pr114-listen-api: OPEN at 2026-09-11T07:50:19.279786+00:00. Await CI/review; monitor never merges.
PID 10407; command python3 /private/tmp/omni-listen-api/.agent-memory/runtime/listen-monitor.py; state /private/tmp/omni-listen-api/.agent-memory/runtime/listen.state.json; log /private/tmp/omni-listen-api/.agent-memory/runtime/listen.log; PID file /private/tmp/omni-listen-api/.agent-memory/runtime/listen.pid; process log /private/tmp/omni-listen-api/.agent-memory/runtime/listen.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-listen-api, branch refactor/listen-api, PR https://github.com/Inukollu/Omni-Protocol/pull/114.
<!-- listen-monitor:end -->

<!-- take-over-call-monitor:begin -->
Monitor omni-protocol-pr115-take-over-call-api: OPEN at 2026-09-11T08:12:17.120212+00:00. Await CI/review; monitor never merges.
PID 6842; command python3 /private/tmp/omni-take-over-call-api/.agent-memory/runtime/take-over-call-monitor.py; state /private/tmp/omni-take-over-call-api/.agent-memory/runtime/take-over-call.state.json; log /private/tmp/omni-take-over-call-api/.agent-memory/runtime/take-over-call.log; PID file /private/tmp/omni-take-over-call-api/.agent-memory/runtime/take-over-call.pid; process log /private/tmp/omni-take-over-call-api/.agent-memory/runtime/take-over-call.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-take-over-call-api, branch refactor/take-over-call-api, PR https://github.com/Inukollu/Omni-Protocol/pull/115.
<!-- take-over-call-monitor:end -->

<!-- forced-break-monitor:begin -->
Monitor omni-protocol-pr116-forced-break-api: OPEN at 2026-09-11T08:31:33.396884+00:00. Await CI/review; monitor never merges.
PID 89428; command python3 /private/tmp/omni-forced-break-api/.agent-memory/runtime/forced-break-monitor.py; state /private/tmp/omni-forced-break-api/.agent-memory/runtime/forced-break.state.json; log /private/tmp/omni-forced-break-api/.agent-memory/runtime/forced-break.log; PID file /private/tmp/omni-forced-break-api/.agent-memory/runtime/forced-break.pid; process log /private/tmp/omni-forced-break-api/.agent-memory/runtime/forced-break.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-forced-break-api, branch refactor/forced-break-api, PR https://github.com/Inukollu/Omni-Protocol/pull/116.
<!-- forced-break-monitor:end -->

<!-- force-break-command-monitor:begin -->
Monitor omni-protocol-pr117-force-break-command: OPEN at 2026-09-11T08:44:24.441504+00:00. Await CI/review; monitor never merges.
PID 44983; command python3 /private/tmp/omni-force-break-command/.agent-memory/runtime/force-break-command-monitor.py; state /private/tmp/omni-force-break-command/.agent-memory/runtime/force-break-command.state.json; log /private/tmp/omni-force-break-command/.agent-memory/runtime/force-break-command.log; PID file /private/tmp/omni-force-break-command/.agent-memory/runtime/force-break-command.pid; process log /private/tmp/omni-force-break-command/.agent-memory/runtime/force-break-command.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-force-break-command, branch refactor/force-break-command, PR https://github.com/Inukollu/Omni-Protocol/pull/117.
<!-- force-break-command-monitor:end -->

<!-- end-forced-break-monitor:begin -->
Monitor omni-protocol-pr118-end-forced-break: OPEN at 2026-09-11T09:01:33.042458+00:00. Await CI/review; monitor never merges.
PID 66818; command python3 /private/tmp/omni-end-forced-break/.agent-memory/runtime/end-forced-break-monitor.py; state /private/tmp/omni-end-forced-break/.agent-memory/runtime/end-forced-break.state.json; log /private/tmp/omni-end-forced-break/.agent-memory/runtime/end-forced-break.log; PID file /private/tmp/omni-end-forced-break/.agent-memory/runtime/end-forced-break.pid; process log /private/tmp/omni-end-forced-break/.agent-memory/runtime/end-forced-break.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-end-forced-break, branch refactor/end-forced-break, PR https://github.com/Inukollu/Omni-Protocol/pull/118.
<!-- end-forced-break-monitor:end -->

<!-- set-break-policy-monitor:begin -->
Monitor omni-protocol-pr119-set-break-policy: OPEN at 2026-09-11T09:40:42.810800+00:00. Await CI/review; monitor never merges.
PID 61280; command python3 /private/tmp/omni-set-break-policy/.agent-memory/runtime/set-break-policy-monitor.py; state /private/tmp/omni-set-break-policy/.agent-memory/runtime/set-break-policy.state.json; log /private/tmp/omni-set-break-policy/.agent-memory/runtime/set-break-policy.log; PID file /private/tmp/omni-set-break-policy/.agent-memory/runtime/set-break-policy.pid; process log /private/tmp/omni-set-break-policy/.agent-memory/runtime/set-break-policy.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-set-break-policy, branch refactor/set-break-policy, PR https://github.com/Inukollu/Omni-Protocol/pull/119.
<!-- set-break-policy-monitor:end -->

<!-- break-status-field-monitor:begin -->
Monitor omni-protocol-pr120-break-status-field: OPEN at 2026-09-11T10:31:38.910377+00:00. Await CI/review; monitor never merges.
PID 77759; command python3 /private/tmp/omni-break-status-field/.agent-memory/runtime/break-status-field-monitor.py; state /private/tmp/omni-break-status-field/.agent-memory/runtime/break-status-field.state.json; log /private/tmp/omni-break-status-field/.agent-memory/runtime/break-status-field.log; PID file /private/tmp/omni-break-status-field/.agent-memory/runtime/break-status-field.pid; process log /private/tmp/omni-break-status-field/.agent-memory/runtime/break-status-field.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-break-status-field, branch refactor/break-status-field, PR https://github.com/Inukollu/Omni-Protocol/pull/120.
<!-- break-status-field-monitor:end -->

<!-- user-details-api-monitor:begin -->
Monitor omni-protocol-pr121-user-details-api: OPEN at 2026-09-11T10:42:08.296140+00:00. Await CI/review; monitor never merges.
PID 59675; command python3 /private/tmp/omni-user-details-api/.agent-memory/runtime/user-details-api-monitor.py; state /private/tmp/omni-user-details-api/.agent-memory/runtime/user-details-api.state.json; log /private/tmp/omni-user-details-api/.agent-memory/runtime/user-details-api.log; PID file /private/tmp/omni-user-details-api/.agent-memory/runtime/user-details-api.pid; process log /private/tmp/omni-user-details-api/.agent-memory/runtime/user-details-api.process.log. Interval 60s, timeout 24h. Terminal: MERGED/CLOSED/AUTH_FAILED/POLL_FAILED (3 consecutive)/TIMEOUT. Observation only. Worktree /private/tmp/omni-user-details-api, branch refactor/user-details-api, PR https://github.com/Inukollu/Omni-Protocol/pull/121.
<!-- user-details-api-monitor:end -->
