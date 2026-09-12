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

### Runtime break prerequisite checks

Use `validateBreakCommand(method, request, state, context)` from the validation entry point
before any agent break dispatch. The context supplies current authentication and transport;
all four methods require the live login's break capability and active transport. Pass the
request object only to the request method, and undefined to the other three.

| Method | Required current state |
| --- | --- |
| `requestBreak` | `not-requested`; selected current reason code when codes exist; `canRequestBreak` or the selected reason's `alwaysAvailable` exception. Free text does not replace a code. |
| `commitBreak` | `granted`, or already committed for an idempotent repeat. A later change to `canRequestBreak` does not revoke the grant. |
| `cancelBreak` | `awaiting-approval` or `granted`. A concurrent commit winning still answers `omni.break-already-committed` and requires recovery. |
| `endBreak` | `on-break` or `starting-after-task` during reconciliation; the agent may explicitly end a requested or forced break. |

Use `validateTeamCommand(request, context)` before every lead act: the team feature switch, break
decisions, forcing and ending a forced break, policy, and every act on a member's call. It requires
the live `lead` flag and active transport, a current team member list for any command naming a
member, and the target's complete break state for forcing/ending a break. Approve/deny requires an
awaiting decision; forcing a break uses the target's reason codes; ending a forced break requires a
forced committed break; join and decline need the member's request on the list; coach, join-call
and leave need the lead already on that member's call; an assignment named must be one the list
shows the member holding. The context's target state must belong to the named member; that
association and backend authorization are provider responsibilities.

Use `validateBreakStatus(state, tasks)` on the complete retained task view after each transaction,
as well as `validateBreakTransition` for event ordering. Snapshot validation shares the status
checks. Pending and completing tasks still count as work. Only a call a lead took over
(`takenOver`) sits beside a break in effect. Validate full task shapes and the envelope separately.

These validators report violations without dispatching, rewriting state or proving freshness.
Recheck prerequisites atomically at the provider; client validation cannot prevent a race.
Continue to use `validateResult` for each method's response vocabulary. A request acknowledgment
is not a grant, and no method response overwrites a newer state emission. Rejected promises
remain unknown and recover by snapshot, not automatic retry. The agent application's frozen provider set,
durable mutually exclusive commit/cancel decision and reconciliation obligations under
**Coordinating a multi-provider break** remain
required; per-provider validation does not implement the multi-provider coordinator.

### `requestBreak(request)`

**Explanatory text is optional.** An agent may omit `BreakRequest.reason` for any break type.
A lead may likewise omit reason text from `force-break`. Do not require a text explanation
just because a break is agent-requested or forced. If supplied, text must be nonempty; omit
it rather than sending an empty string. A selected `reasonId` identifies a published break
choice and is separate from this optional text.

With published choices, `{ reasonId: "lunch" }` is a valid request without explanation;
without published choices, `{}` is valid. A lead can similarly send a `force-break` command
with its member ID and, where required, the selected reason ID, without reason text.

Requests permission to stop the agent later; it does not itself stop work. The provider continues
offering work and reports `awaiting-approval` or `granted` through `break-state` events. If the request is denied, the
provider reports `not-requested` directly, with `decisionReason` when one was supplied.

**An agent asks from anywhere — idle or on a task** — and Omni offers the request in the task
workspace as it does on the idle dashboard. Asked on a task, the break is decided and committed like
any other and begins when the work ends: that is `starting-after-task`, and
`assertBreakBeginsAfterTask` is the scenario that holds a provider to it.

#### Break reasons

A provider that defines not-ready reason codes publishes them on `Snapshot.break.reasons`,
and Omni returns the agent's choice as `BreakRequest.reasonId`:

```ts
break: {
  reasons: [
    { id: "lunch", label: "Lunch" },
    { id: "training", label: "Training", group: "Scheduled" },
  ]
}
```

Reason ids are non-empty and unique within the provider. They live on the snapshot rather than the
manifest because a provider may change the codes it offers during a shift; a `snapshot` event
replaces the list. `BreakRequest.reason` remains available for free text and is never a substitute
for `reasonId` when the provider publishes codes. A provider that defines no codes omits the
field.

#### One break across several providers

An agent connected to several providers takes **one** break, not one per platform. Omni gathers
what every connected provider offers, shows the distinct breaks, and on a choice sends one request
per provider: the same `reason`, and each provider's own `reasonId`.

To do that, Omni has to know when two providers mean the same break. Say so with `kind`:

```ts
break: {
  reasons: [
    { id: "lunch", label: "Lunch", kind: "meal" },
    { id: "rest",  label: "Mandatory rest period", kind: "rest", alwaysAvailable: true },
  ]
}
```

A provider decides which breaks it offers and what it calls them. `BREAK_KINDS` is the list Omni
supports mapping them onto, and every member means something specific:

| Kind | What it means |
| --- | --- |
| `short-break` | A brief rest between contacts — the comfort break a shift plan allows for. |
| `meal` | A meal: lunch, dinner, whatever the shift calls it. |
| `rest` | A rest period the agent is entitled to and a busy hour cannot cancel. Usually the reason also marked `alwaysAvailable`, though the two are separate: this says what the break *is*, that says whether policy can withdraw it. |
| `training` | Learning something the agent is expected to know afterwards: a course, e-learning, a product walkthrough. However it is delivered, and whoever attends. |
| `coaching` | Reviewing this agent's own work with somebody accountable for it: a call listened back, quality feedback, a one-to-one about their interactions. Even where the outcome is that they learn something. |
| `meeting` | A scheduled gathering that is neither — a team huddle, a project call, a town hall. The agent attends and contributes; nobody is assessing their work and there is nothing they must know by the end. |
| `administrative` | Paperwork and follow-up not attached to a particular contact. |
| `technical` | Equipment or system trouble stopping the agent taking work: a dead headset, a phone that never registered, a tool that will not load. The one member that is not an activity — it says why the agent *cannot* work rather than what they are doing, which makes it the right home for a not-ready state raised about the agent's equipment. |
| `personal` | Personal time the deployment does not classify further. |
| `other` | None of the above. Matches nothing, including another provider's `other`. |

**The definitions are the point, not decoration.** Ten undefined strings would be the label
problem one level up: two providers could both declare `technical`, one meaning a dead headset
and the other scheduled maintenance, match on it, and nothing could tell the difference.

`training`, `coaching` and `meeting` can all fit one session, so take them in that order of
specificity: about this agent's own work is `coaching`, else something they must know afterwards is
`training`, else `meeting`.

**A break somebody forced on the agent is not automatically one of these.** Where the agent was
stopped rather than choosing to stop — see **Forced breaks** — set `BreakState.forced` and prefer
omitting `kind` to reaching for `other`. None of the ten describes "something was done to this
agent", and `other` claims a classification that was never made.

Omni matches in this order:

1. **`kind`**, where both providers declare one. This wins over the label, so `{ id: "MEAL",
   label: "Meal", kind: "meal" }` lines up with `{ id: "lunch", label: "Lunch", kind: "meal" }`
   and nobody has to word their codes the same way.
2. **The label**, folded for case and surrounding spacing, where a kind is missing. `"other"`
   counts as missing: two providers saying `"other"` have only said their break is not on the
   list, which is no evidence they mean the same thing.

Nothing else is matched. A break Omni cannot pair stays on its own, the agent is told how many
platforms their break will actually reach, and they can pair the odd one by hand — Omni remembers
that for next time.

Three rules for a provider:

- **Declare `kind` where you can, and leave it out where you cannot.** Leaving it out costs a
  little precision. Getting it wrong sends an agent to lunch on one platform and to training on
  another, and nothing can detect that.
- **You may publish several reasons of one kind** — two meal slots, say. Omni will not choose
  between them for the agent; saying they are the same kind is not saying they are interchangeable.
- **Do not read `reason` as your own label.** It is the agent's single choice, in whichever
  provider's wording they picked it from, sent unchanged to every provider in the break.

A provider that publishes no reason codes still receives the request, with `reason` set and
`reasonId` omitted.

#### Coordinating a multi-provider break

Sending the requests is a two-phase operation, not independent best effort. A provider first grants
permission for the agent to stop, then Omni either commits or cancels that permission.

`granted` is provider-visible state. It means only that this provider has granted the active
request and is ready to stop the agent when Omni asks. It does not reveal that other providers exist
or why Omni has not committed yet. While reporting `granted`, the provider remains available,
continues to honour Omni's current capacity, and continues offering work normally.

Omni separately tracks the aggregate agent application states `working`, `requesting-break`, `committing-break`,
`cancelling-break`, and `on-break`. While `requesting-break`, Omni shows which providers remain
outstanding and offers **Cancel break request**, but does not tell the agent that their break has
begun.

Omni offers the aggregate Break control only when every provider currently holding capacity
declares `capabilities.breaks` at login. If one cannot be stopped, offering a global break would
knowingly permit partial availability.

Omni coordinates one break attempt as follows:

1. Freeze the providers the attempt asks: every connected provider from which the agent can
   currently receive work. A provider joining during the attempt is given no capacity until it
   finishes. A provider whose authentication is `expired` is not one the agent can receive work
   from and is not asked: nothing is asked of it, the break proceeds without it, and when the
   login is restored it is reconciled from its snapshot as a set-aside provider is, with no
   capacity until then. `refreshing` keeps a provider in — its identity and capabilities remain
   available and work continues. `assertBreakAttemptProviders` holds an agent application to this set.
2. Enter `requesting-break`. Keep the agent's normal capacity in place throughout this phase.
3. Send one `requestBreak` to every asked provider. A provider reports `awaiting-approval` or
   `granted`; neither state stops work. A denial transitions directly to `not-requested` and
   causes Omni to take the cancel path.
4. If every asked provider reports `granted`, durably choose commit, enter `committing-break`,
   and send `commitBreak()` to each of them. A provider then stops offering new work
   and reports `starting-after-task` or `on-break`. The **commit bound** — ten seconds from the
   decision, tunable per deployment — decides who is kept: a provider that has not applied the
   commit by then, still `granted` or unreachable, is set aside as unreconciled and the break
   begins without it. `on-break` decides `on-break`: Omni enters it once every kept provider
   reports `on-break`. A kept provider reporting `starting-after-task` has applied the commit
   and is finishing a task; the bound is on delivery, not on that task. Omni shows the break as
   settled and beginning when the task ends, and offers no cancel, because the commit is durable.
5. If any asked provider fails or denies the request, cannot be reconciled within the bounded
   decision timeout, or the agent cancels before commit, durably choose cancel and enter
   `cancelling-break`. Send `cancelBreak()` to every provider still reporting
   `awaiting-approval` or `granted`. Work continues during cancellation because no stop was
   committed. Return to `working` only after no provider retains either state.

Commit and cancel are mutually exclusive decisions for one break attempt. Once Omni chooses commit
it never rolls that attempt back: it is reconciled by snapshot until every asked provider is stopped.
A provider that reports `granted` must therefore preserve the request across reconnects and must
honour a later commit or cancel. This
durable promise prevents a provider from failing the commit after another provider has already
stopped the agent.

#### Why the commit phase is bounded and the decision is not

Waiting for unanimity forever is the one way this algorithm can strand an agent. The commit is
durable and cannot be rolled back, so a provider that crashes, has its authentication revoked,
or is uninstalled between granting and committing would hold Omni in `committing-break` with no
exit: the providers that did commit have already stopped the agent, and the agent is neither
working nor on a break.

Unanimity is required for a reason that survives the bound. It exists so the agent is not stopped
on one platform while another keeps routing work to them — and **a provider Omni cannot reach is
routing nothing.** Setting it aside therefore costs none of the property it was protecting. Waiting
for it costs the agent their break.

Setting a provider aside is not a rollback and not a cancel. The commit stands and the
obligation stands: until that provider is stopped it has not stopped. When it returns it emits a
snapshot before anything else, and the snapshot decides:

- `on-break` or `starting-after-task` — the commit arrived after all. Nothing to send.
- still `granted` — the commit was lost. Omni sends `commitBreak()` now. If the original turns up
  late behind it, the provider stops an agent who is already stopped; nothing happens, because a
  commit is a state to be in, not an act to be done.
- `not-requested` — the grant did not survive. Omni makes a new request for that provider alone,
  against an agent who is already on break elsewhere. **A new login is this case too**: the grant
  belonged to the old session.

The provider must not offer work in the meantime, and the commit is what stops it; Omni gives it
no capacity until it is reconciled.

**If the agent has already ended the break elsewhere, the break attempt is over** and the returning
provider is reconciled to that instead: still `granted` gets `cancelBreak()`, because committing
would stop an agent who is working again; `starting-after-task` or `on-break` gets `endBreak()`.
Never rolling back is about a break that is still on, not one the agent has finished.

Omni may tell the agent which platforms the break has not yet reached, as it already does when a
break cannot be paired across every provider.

The decision phase needs no such bound, because nothing has stopped. Work continues throughout
`requesting-break`, so a provider that never answers costs the agent a wait rather than their
availability, and the existing decision timeout resolves it by cancelling — which is safe precisely
because no stop was ever committed.

If cancel races with a late approval, the provider remains on the cancel path. If commit has already
won, cancel returns `omni.break-already-committed`, and Omni resumes commit recovery rather than
returning the agent to `working`.

A forced break is not rolled back by this algorithm. If one appears during either the request or
cancellation, the attempt is abandoned: Omni cancels every grant still outstanding and states
`setCapacity({ count: 0 })` on every other usable provider, as **Forced breaks** sets out; no grant
is committed, because the agent has already stopped everywhere.

This is two-phase coordination across vendor systems: the approval phase keeps the agent working;
the durable commit decision and snapshot reconciliation provide convergence after partial delivery.

#### Reporting the break the agent is on

`BreakState.activeReasonId` is the `BreakReason.id` the current break is on. Omni remembers what it
asked for, but only until the session ends — after a reload or reconnect, or where the provider put
the agent on the break itself, the provider is the only one who knows.

Omit it when you cannot say, and when there is no break: reporting a reason alongside
`status: "not-requested"` describes a break that is not happening, and is rejected.

### `cancelBreak()`

Cancels the active pre-commit request while its status is `awaiting-approval` or `granted`.
Cancellation releases the request but does not restore work because work never stopped. If
commit already won, the provider returns `omni.break-already-committed`. The resulting state is
reported through `break-state`.

### `commitBreak()`

Commits the `granted` request. Once the provider has reported `granted`, it cannot fail for a
business reason. On commit the provider stops offering new work and reports
`starting-after-task` while existing work finishes, or `on-break` when the break is in effect.
Committing a break that is already in effect changes nothing and answers `committed`.

### `endBreak()`

Tells a provider that an agent already on a break wants to become available again. The provider
reports the resulting state through `break-state` and provider status events.

It ends the break, which is the thing that started. Nothing about the connection was ever paused,
so there is nothing on it to resume.
