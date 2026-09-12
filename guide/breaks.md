# `@xema/omni-protocol`: Breaks

Asking for a break, a break forced on the agent, capacity, and one break across several providers. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Breaks

Everything about an agent's breaks on one provider arrives as one object, `Snapshot.break`,
replaced whole by a single `break-state` event. These facts are only meaningful together — an
approval says nothing without knowing whether the agent chose the break, and a list of reasons says
nothing while none are being accepted — so they are not published separately.

| Field | Contract |
| --- | --- |
| `status` | Where the agent’s break lifecycle stands. See the states below. |
| `canRequestBreak` | Whether the agent may ask at all. Distinct from `status`. |
| `requestUnavailableReason` | Display-ready reason shown when `canRequestBreak` is false — a standing gate that applies to everyone. |
| `decisionReason` | The words whoever decided attached, from `decide.reason`. About one request and one decision, not a standing gate. |
| `retryRequestAfterMs` | Milliseconds until the agent may retry a break request, when the provider can say. |
| `reasons` | Not-ready codes this provider offers. Omitted when it defines none; an empty list is refused, being a second spelling of the same fact. |
| `activeReasonId` | The `BreakReason.id` the current break is on. Omitted when there is no break. Required on a break `on-break` or `starting-after-task` where the provider publishes `reasons`, a forced break included (`break.activeReasonId.required`): a break with a kind the provider cannot name is a break whose rules nobody can apply. |
| `forced` | Set when the break was forced on the agent rather than requested. |

A request can be waiting for two unrelated things, and they are separate values because
rendering one as the other tells an agent to wait for somebody who is never coming:

| `status` | Meaning |
| --- | --- |
| `not-requested` | No request outstanding. |
| `awaiting-approval` | A person has to decide. The agent is waiting on somebody. |
| `granted` | The request was granted, by a person or by an `automatically-approved` policy. Omni may now tell this provider to stop the agent; until it does, work continues normally, and this says nothing about why Omni has not. |
| `starting-after-task` | Omni has told the provider to stop; the break begins when the current task ends. No new work arrives meanwhile, and nobody needs to act. It waits on a task, so beside no task it is refused (`break.starting-after-task.tasks`): a committed break with nothing outstanding is `on-break`. |
| `on-break` | The agent is on the break now. It holds no task: a break begins when the work ends, so a snapshot reporting `on-break` beside a task is refused as `break.on-break.tasks`. The one exception is a call a lead took over, which the provider assigns whatever break the lead is on -- see **Lead assist** in `guide/lead.md`. |

A denial is a decision, not a standing approval state. The provider transitions the request directly
to `not-requested`; Omni returns the agent to idle and never asks again on their behalf. They saw the
answer and ask again when they want to. `decisionReason` may carry the words attached to that
decision, but `status` does not remain denied.

A provider reports `starting-after-task` only after Omni commits a `granted` request while
work is still active. Omni does not send the request again, because asking again would not move
it; it sends the commit again only from a reconnect snapshot that shows the grant still standing.

`canRequestBreak: false` is what lets Omni withdraw the control rather than let an agent ask and be
refused. A `BreakReason` marked `alwaysAvailable` survives it: a mandatory rest period is not
something a busy hour can cancel, and Omni keeps offering those while the rest are withdrawn.

### Forced breaks

Migration: the former awaiting-decision value is now `awaiting-approval` in break status
and the team member’s pending break state. The old value is rejected without an alias;
the request can still be granted or denied, and ordering rules are unchanged.

Migration: the former BreakApproval type is now `BreakStatus`, matching `BreakState.status`.
The former type is not exported as an alias; its values and behavior are unchanged.

Migration: `BreakState.status` replaces the former approval field. It covers the full break
lifecycle. The old field is rejected even alongside status; related diagnostics now use status.
The `BreakStatus` union and its values, `reasons`, `activeReasonId`, and the separate testing
helper BreakOnTaskStep.approval are unchanged. Hosts and providers must update together.

Migration: the break-state field formerly named retryAfterMs is now `BreakState.retryRequestAfterMs`,
with diagnostic `break.retryRequestAfterMs`. It remains an optional non-negative finite number
of milliseconds; the former break field is rejected even alongside the new field.
The separate authentication and general failure retryAfterMs fields are unchanged.

Migration: the former in-effect break approval value is now `on-break`. It means the
agent is on the break, not merely granted permission. The old value is rejected without an
alias. The task prerequisite, the take-over exception and ordering rules are unchanged;
the task-conflict diagnostic is `break.on-break.tasks`. Team member availability already uses
`on-break` and is unchanged.

Migration: the former refusedReason field is now `BreakState.requestUnavailableReason`.
It explains why requests are unavailable when `canRequestBreak` is false; `decisionReason`
continues to explain a particular approval or denial. The old field is rejected even alongside
the new one, and related diagnostics use requestUnavailableReason.

Migration: the former mayAsk field is now `BreakState.canRequestBreak`. The old field is
rejected even beside the new field. Validation diagnostics use canRequestBreak in place of
mayAsk. Request eligibility remains distinct from approval; existing alwaysAvailable reason
exceptions are unchanged. Hosts and providers must update together.

Migration: ImposedBreak is now `ForcedBreak`, and the former imposed field is now
`BreakState.forced`. Diagnostic and harness coverage names use `break.forced`. The former agent-end prohibition
has been removed: forced breaks also permit explicit agent resumption. Update hosts and providers together. The old field
is rejected, including when both spellings are sent; no compatibility alias is provided.
The break policy value formerly named auto-approve is now `automatically-approved`.
Requests are approved automatically; approval does not skip commitment or the prerequisites
for starting a break. The former value is rejected without an alias.
The break policy value formerly named suspended is now `requests-suspended`. The former
value is rejected without an alias. It suspends new requests, not breaks already underway.
The break policy value formerly named ask is now `approval-required`: requests require
approval. The former value is rejected without an alias; automatically-approved and requests-suspended retain
their existing behavior.
The team break command formerly named policy is now `set-break-policy`. The former
command is rejected without an alias; its policy field is unchanged. Hosts and providers must adopt the new name together.
The team break command formerly named decide is now `decide-break-request`. The former
spelling is rejected without an alias; the granted/denied decisions and pending-request
prerequisite are unchanged.
The team break command formerly named place is now `force-break`. Hosts and providers must
adopt the new command together; place and the interim force spelling are rejected without aliases.
The team break command formerly named release is now `end-forced-break`, and its diagnostic is
`team.command.endForcedBreak`. The former release command and the interim end spelling are rejected without aliases.
The agent’s `endBreak` now applies to forced breaks as well as requested breaks.

`ForcedBreak` names who forced the break and may say how long it is expected to run yet, as
`expectedEndsInSeconds`: whole seconds from the publication that carries it, restated on every
publication, so every screen -- the agent's, reloaded or not, and every lead's -- counts down the
same number from receipt (`break.forced.expectedEndsInSeconds`). The duration the lead asked for
travels on the `force-break` command alone; the state says what is left, and drops the field once
it has run out. The agent must explicitly resume when ready. The retired endsAutomatically and
endsAt fields are rejected, including when an expectation is also provided. Who forced it is
`by`, as **A forced break is the provider's act** below sets out.

Omni resolves the name to show with `getUserDetails()`, so a provider sends the identifier and never
a display name.

**A forced break travels with `on-break` or `starting-after-task`, and nothing else.** It is a
break in progress or about to be; beside `granted` or `awaiting-approval` the agent application would read a
request the agent never made and commit it (`break.forced.status`). Where the provider publishes
`reasons`, the lead's `force-break` named one, and the member's state carries it as `activeReasonId`.

For example:

```ts
forced: {
  by: "manager-1042",
  expectedEndsInSeconds: 600
}
```

The agent application keeps **Resume** available for an agent on a forced break. The agent explicitly chooses
Resume; the agent application sends `endBreak()` and follows the provider-confirmed state before resuming
work. The expectation is whole seconds still to run, restated on every publication; omission
means none was stated, or it has run out. Neither its reaching zero nor an overdue indication
authorizes the agent application or provider to end the break, restore availability, or route
work to the agent.

**A forced break is the provider's act.** A lead's `force-break` is a command to the provider,
which forces the break on the member; `by` names the lead who asked it to. A break the platform
imposed on its own -- a schedule, a compliance hold -- says `by: "provider"`, and is the platform's
to lift: a lead's `end-forced-break` on it is refused before it is sent
(`team.command.endForcedBreak.provider`), and a provider that receives one answers `failed` with
`omni.break-forced-by-provider`. The desk offers End forced break on a member only where
`forced.by` names a lead.

**A lead lifting the restriction does not resume the agent.** On an applied
`end-forced-break`, the provider clears `BreakState.forced` while preserving the current
`on-break` or `starting-after-task` status and `activeReasonId`. This command cannot publish
`not-requested`, restore readiness, or start routing work. Ordinary progress from
`starting-after-task` to `on-break` still happens when work finishes. The agent application follows the
published state and waits for the agent's explicit Resume, even after reconnect. Historical
attribution is not rewritten by clearing the current forced marker.

The agent may explicitly resume either before or after the lead lifts the restriction. A lead
command, timer, late snapshot or reconnect is never a substitute for that choice. Providers
must correlate resumption to the authenticated agent's action; a state-only ordering validator
cannot establish the cause of a transition. The usual multi-provider end/reconciliation flow
still applies, and work resumes only on confirmed provider state.

An agent application counts `expectedEndsInSeconds` down from receipt, on every publication that
carries it, and shows nothing of it where the provider sends none. It invents no start and no
return time, and nothing acts on the number reaching zero.

A break applies to the **agent**, not to one provider. When a provider forces one, Omni stops the
agent everywhere else at once, and not by asking: it states `setCapacity({ count: 0 })` on every
other usable provider holding capacity, which is taken and never refused, and which their team
lists show as `elsewhere`. Nobody on those providers can deny it, and the agent cannot cancel it,
because there is nothing to cancel: a break request on them would be the agent's own to withdraw
and a lead's to refuse, and a forced break is neither. When the forcing provider ends the forced
break and the agent resumes there, the agent application restates its capacity on the rest. A
provider whose login is not usable is left alone, as a break attempt leaves it;
`assertForcedBreakStopsTheRest` holds an agent application to this set. **The provider keeps its
shift totals true.** A member held elsewhere is one the provider sees -- `elsewhere` is a state it
publishes -- and the day's `shift` is its own account of the day, so the time the agent was
stopped for a break forced on another provider is the provider's to count, as a break of a kind
its platform has, or introduces, for exactly this. A `breakSeconds` that leaves it out is a total
the provider knew to be short, and **Never report a value you cannot observe** cuts the other way
here: the provider observed it.

`ForcedBreak.by` says who forced it: a lead, by user id, or `provider` where the platform itself
did -- on its own rule, a schedule, a compliance hold. The agent sees who, and `getUserDetails()`
is owed for a person, never for `provider` (`break.forced.by`).

## Capacity and break actions

**Each method answers in its own words.** A result is read by a person far more often than it is
branched on by code — in a log, a support ticket, a conformance failure — so it says what happened
rather than that something happened. `failed` is shared, because failing is the same act
everywhere; success is not.

| Method | Succeeded |
| --- | --- |
| `setCapacity` | `applied` |
| `recordStep` | `recorded` |
| `requestBreak` | `requested` |
| `commitBreak` | `committed` |
| `cancelBreak` | `cancelled` |
| `endBreak` | `ended` |

`failed` carries a typed `ProtocolFailure` and means the provider did not take the action, whether
it would not or could not.

**Succeeding is not the outcome.** `requested` says the provider holds the request, not that a
break was granted; `ended` says the provider has the instruction, not that the agent is working
again.
Every break method reports its real result through `break-state`; `setCapacity` reports none at
all, because capacity is a statement rather than a request.

`execute` keeps `applied` rather than a verb per command, because the command
is in the request: `execute({ command: { type: "hold" } })` returning `applied` already says the
hold applied. A `held` result would repeat the discriminant that travelled with it.

### `setCapacity(capacity)`

States how many tasks this provider may have assigned to the agent **at once**.

`count` is an absolute ceiling, not an increment, a whole number of zero or more
(`capacity.count`). An agent's capacity is a property of the agent, not of the moment: it is
stated when the agent is set up and restated only when it genuinely changes, which is a
local policy change rather than a task starting or ending -- with one exception below.

**The provider counts its own outstanding tasks against it.** Assign while you hold fewer than
`count` tasks for this agent, and stop when you hold that many; when one of yours ends you have
room again and need no new signal to know it. Omni does not re-state capacity as tasks come and
go, and a provider that waits for it will stall.

Your own tasks are the only ones you count. What the agent holds at other providers is not your
concern — Omni set `count` knowing it, and this is how: the agent is one person on several
providers, and the agent application divides their capacity among them rather than telling each the whole. A
provider that has none of it for now is told **`count: 0`, agent application-stopped**: assign nothing, show
the member as `elsewhere` on the team member list -- signed in here, capacity held by the agent application for elsewhere,
a fact this provider holds, where `on-task` would assert work it cannot see -- and take the next
count as any other when the agent application has capacity for this provider again. Zero is the one restatement
that follows work rather than local policy.

**A capacity is taken, never refused.** `setCapacity` answers `applied` and nothing else: a
statement has no failure to report, and a `failed` arm gave four agent application-provider pairings four
readings of which ceiling stood after it. A provider that cannot carry the count assigns within
what it can and says so on a `diagnostic`, so the gap is visible and nothing is inferred from a
refusal.

Capacity supersedes rather than accumulates: the latest value is the ceiling, and a decrease is as
ordinary as an increase. A provider whose ceiling can only rise -- one that keeps the highest count
it was ever told, or returns early on a small one -- cannot be told to take less work, and an agent application
taking capacity away is answered `applied` while the work keeps coming. The harness moves the axis
both ways after the drive, two then one then nought, and an offer after a lower count is caught
against it (`stream.taskOffered.overCapacity`).

**Capacity gates what the provider assigns, not what the agent starts.** A call placed from the
idle dialpad arrives through `task-offered` like any other task, and a full agent does not forbid
it: the ceiling binds assignment, not the agent's own hand.

**Capacity is not the agent's readiness.** It is the desk's division of one person across
providers, a ceiling on assignments at once, and it says nothing about the moment. An agent who
is about to finish a call and wants the next one lined up has a different thing to say, and says
it as **The agent's own queue** in `guide/queue.md` sets out; the ceiling stands unchanged while they do,
and the queue lives within it: `count: 0` clears the ask and lets a lined-up call go, and a break
in flight or in effect does the same, since the break wins.
