# `@xema/omni-protocol`: Breaks

The three kinds of time away -- a break, a ban, tools not ready -- a lead asking the agent to take a break, capacity, and one break across several providers. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

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
| `retryRequestInSeconds` | Whole seconds until the agent may ask for a break again, as of this publication and restated on each, when the provider can say. |
| `reasons` | Not-ready codes this provider offers. Omitted when it defines none; an empty list is refused, being a second spelling of the same fact. |
| `activeReasonId` | The `BreakReason.id` the current break is on. Omitted when there is no break. Required on a break `on-break` or `starting-after-task` where the provider publishes `reasons`, tools not ready included and a ban excepted (`break.activeReasonId.required`): a break with a kind the provider cannot name is a break whose rules nobody can apply. |
| `type` | Which kind of time away a break in effect is: `break`, `ban` or `tools-not-ready`. See **Three kinds of time away**. |
| `ban` | A ban's terms, with `type: "ban"` alone. See **Bans**. |
| `ask` | A lead's ask that the agent take a break, while it stands. See **A lead asks for a break**. |

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

**The provider's own reasons are offered to nobody.** Tools not ready -- a phone that will not
register, a station being set up -- still needs a reason, since `activeReasonId` names it where
reasons are published, and so does the one break the platform places itself, after an offer rang
out unanswered. Mark it `providerOnly`: the flag says the platform chose it. Omni
leaves it out of the agent's choices and out of a lead's `ask-break`, and a request or an ask
naming it is refused
(`break.request.reasonId.providerOnly`, `team.command.reasonId.providerOnly`). It is never `alwaysAvailable`
(`break.reason.providerOnly.alwaysAvailable`).

### A lead asks for a break

A break is the agent's own: their time away from work, which counts as break time and reaches
every provider they work. Nobody else puts them on one, with one exception: after an offer rang out
unanswered, the platform puts the agent on a break on its own reason, and the agent ends it when
they are back. A lead who wants the agent somewhere else --
training, a meeting, a coaching session -- asks, and the agent answers. The agent has a say because
the hours are theirs.

The ask arrives on the agent's own break state as `BreakState.ask`, and travels with `break-state`
like the rest of it.

| Field | Contract |
| --- | --- |
| `id` | Names this ask (`break.ask.id`). The answer names it. |
| `by` | The lead who asked, by user id (`break.ask.by`). `getUserDetails()` is owed for them. |
| `reasonId` | The break it asks for: one of the published reasons, required where reasons are published, and never a `providerOnly` one (`break.ask.reasonId`, `.providerOnly`). |
| `reason` | Optional. The lead's words, shown to the agent (`break.ask.reason`). |
| `durationSeconds` | Optional. How long the lead expects it to take, for the agent to decide by (`break.ask.durationSeconds`). It ends nothing: the agent ends their break. |
| `since` | When the lead asked (`break.ask.since`). |

For example:

```ts
ask: {
  id: "ask-77",
  by: "manager-1042",
  reasonId: "training",
  reason: "New billing flow, room 4",
  durationSeconds: 1800,
  since: "2026-11-25T14:00:00Z"
}
```

**The agent answers it.** The agent application shows the ask with Accept and Decline, and sends
the answer as `answerBreakAsk({ askId, answer })`. An answer that names an ask the break state does
not carry is refused before it is sent (`break.command.answer.ask`), and a provider that receives
one answers `failed` with `omni.break-ask-gone`.

- **Accepted**, it is the agent's break, already approved. The provider clears the ask and moves
  the break to `granted`, on the ask's reason. From there it is any grant: the agent application
  commits it on every provider the agent works, as **One break across several providers** below
  sets out, and the break starts at once, or as `starting-after-task` while a task is in hand.
  The agent ends it when they are back, as they end any break.
- **Declined**, the provider clears the ask, and the break state says nothing more.

**One ask at a time, and only while there is no break.** An ask stands beside `not-requested` and
nothing else (`break.ask.status`). It goes when the agent answers it, when the lead withdraws it,
when the agent takes a break of their own anyway, and when they sign out: an ask is for the session
it was made in.

**The lead sees the answer.** The member's entry on the lead's team list carries the ask as
`breakAsk`, standing while the member has not answered. A declined ask stays there with
`declinedAt` until the lead withdraws it or asks again, so a lead can tell "no" from "not yet". An
accepted ask is gone from the list, and the member's break shows instead. The lead sends
`ask-break` and `withdraw-break-ask`; see **Lead commands** in `guide/lead.md`. A lead asking the
whole team asks each member: one ask, and one answer, per person.

### Three kinds of time away

A break in effect -- `on-break`, or `starting-after-task` while a task in hand finishes -- is one of
three kinds, and says which as `type` (`break.type`, `break.type.required`). They never overlap: the
agent is on one, or on none.

| `type` | What it is | Who starts it | Who ends it | Reaches | Counts as | Signing out |
| --- | --- | --- | --- | --- | --- | --- |
| `break` | Time off work | The agent, asking or accepting a lead's ask; or the platform, after an offer rang out unanswered | The agent | Every provider they work; the platform's own, this provider | `breakSeconds` | Ends it |
| `ban` | A lead's judgement, or the platform's, that the agent may not take this provider's work | A lead, or the platform | Whoever placed it, or its time running out | This provider alone | `banSeconds` | Does not end it |
| `tools-not-ready` | The agent's tools cannot carry this provider's work | The platform | The platform, when the tools are ready | This provider alone | `toolsNotReadySeconds` | Ends it |

A break follows a grant, but for the one the platform places on a `providerOnly` reason; a ban and
tools not ready arrive unasked (`stream.breakState.commitBeforeGrant`). None of the three counts while the agent is signed out.
A task in hand runs to its end first, as `starting-after-task`, whatever the kind.

### Tools not ready

The platform cannot give the agent work because their tools are not ready: a phone that will not
register, a microphone it cannot reach, a station still being set up, an agent application that is
not ready. Nobody chose it, so it is not a break, and nobody judged the agent, so it is not a ban.
It is on one of the platform's own reasons, marked `providerOnly`
(`break.activeReasonId.toolsNotReady`), which the agent application shows by its label.

It ends when the tools are ready: the phone registers, the station is set up, and the platform
clears it. A provider that holds every agent in a setup hold after sign-in, until the agent
application is ready, publishes that window as tools not ready and counts it in
`toolsNotReadySeconds`; only a provider that places no hold of its own shows the window before the
first capacity as `elsewhere`. The agent cannot end it, so the agent application offers no Resume, and `endBreak()` is
refused before it is sent (`break.command.end.type`). A dial or an offer that raced it answers
`failed` with `omni.tools-not-ready`.

### Bans

A ban keeps the agent from this provider's work. A lead places it when they judge the agent not fit
to take it, and the platform may place its own, on a rule of its own. The agent stays signed in,
takes no work here, and works on everywhere else. It travels on the break state as `type: "ban"`,
with its terms as `ban` (`break.ban.required`, `break.ban.type`).

| Field | Contract |
| --- | --- |
| `by` | The lead who placed it, by user id, or `provider` where the platform did (`ban.by`). `getUserDetails()` is owed for a person. |
| `reason` | Optional words saying why, shown to the agent and their leads (`ban.reason`). A ban names no break reason (`break.activeReasonId.ban`). |
| `endsInSeconds` | How long it has left, in whole seconds from this publication, restated on each (`ban.endsInSeconds`). Its clock runs while the agent is signed out. When it runs out, the provider lifts the ban. Absent, it stands until it is lifted. |

For example:

```ts
break: {
  status: "on-break",
  canRequestBreak: false,
  type: "ban",
  ban: { by: "manager-1042", reason: "Compliance review", endsInSeconds: 3600 }
}
```

**A ban ends a break.** An agent on a break of their own when the ban comes is on the ban instead,
and the break time stops there. A lead's ask standing is withdrawn. While banned the agent cannot
ask for a break, accept an ask, or end the ban: the agent application offers none of those, and the
provider answers any that arrives `failed` with `omni.banned`. A lead cannot ask a banned member
(`team.command.askBreak.member`). A ban replaces tools not ready too; when it lifts and the tools are
still not ready, tools not ready follows.

**While a ban stands, nothing new starts here.** The provider offers nothing, and clears any next
call asked for or lined up, as for any break in effect. A dial or an offer that raced the ban answers
`failed` with `omni.banned`, and the agent application offers no dial on this provider. A task in
hand runs to its end first: the ban stops new work, not the call under way.

**A ban is this provider's alone.** The lead's judgement is about this provider's work. The agent's
other providers, and the leads there, are untouched, and the agent application leaves the capacity
it states on them as it was.

**Signing out does not end a ban.** The provider keeps it, and the first snapshot of the agent's next
session carries it again while it stands. Without that, signing out and straight back in would undo
any ban. Its time while the agent is away counts toward no figure, `banSeconds` and
`signedInSeconds` included, though its clock runs on. `testAdapter` holds a provider to this when
given `signInAgain`: a run that ends with the agent banned signs out, signs in again, and expects the
same ban, placed by the same one, its time left having run on and never grown (`test.signIn.ban`). A
run without `signInAgain`, or with no ban to carry, lists `ban.signIn` under `notTested`.

**Whoever placed it lifts it.** A lead holding the `ban` capability sends `ban` and `lift-ban`; see
**Lead commands** in `guide/lead.md`. A ban the platform placed is the platform's to lift: a lead's
`lift-ban` on it is refused before it is sent (`team.command.liftBan.provider`), and a provider that
receives one answers `failed` with `omni.banned`. When it lifts, the agent takes this provider's work
again, or is on tools not ready if those still are not.

### Migration

Forced breaks are retired. The break state's forced field and its type, the lead commands
force-break, force-team-break, end-forced-break and end-team-break, the forceBreak and
endForcedBreak lead capabilities, the two forced-break failure codes, and the harness check that a
forced break stops the other providers are all gone. A break state carrying forced is refused
(`break.forced.retired`), and the old commands are unknown types. What each did
now has its own place:

| Was | Now |
| --- | --- |
| A lead taking the agent away, such as for training | `ask-break`: the agent accepts or declines |
| A lead stopping the agent from working | `ban`, on this provider only |
| The platform holding the agent until its tools are ready | `type: "tools-not-ready"`, which the platform ends |
| The platform's short break after an offer rang out, which the agent clears with Resume | `type: "break"`, on a `providerOnly` reason |
| A team break | One ask per member, from the lead's desk |

Every break in effect now says its `type` (`break.type.required`). A platform hold that becomes tools
not ready, or a ban, stops counting as break time and counts in its own figure, `toolsNotReadySeconds`
or `banSeconds`, so the day's figures change for it. Hosts and providers update together.

Earlier renames, still in force:

Migration: the former awaiting-decision value is now `awaiting-approval` in break status
and the team member’s pending break state. The old value is rejected without an alias;
the request can still be granted or denied, and ordering rules are unchanged.

Migration: the former BreakApproval type is now `BreakStatus`, matching `BreakState.status`.
The former type is not exported as an alias; its values and behavior are unchanged.

Migration: `BreakState.status` replaces the former approval field. It covers the full break
lifecycle. The old field is rejected even alongside status; related diagnostics now use status.
The `BreakStatus` union and its values, `reasons`, `activeReasonId`, and the separate testing
helper BreakOnTaskStep.approval are unchanged. Hosts and providers must update together.

Migration: the break-state field formerly named retryAfterMs, then retryRequestAfterMs, is now
`BreakState.retryRequestInSeconds`, with diagnostic `break.retryRequestInSeconds`. It is an optional
whole number of seconds, as every countdown on this wire; either former field is rejected even
alongside the new one (`break.retryRequestInSeconds.renamed`).
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
provider that has none of it for now is told **`count: 0`, stopped by the agent application**: assign nothing, show
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
both ways after the test, two then one then nought, and an offer after a lower count is caught
against it (`stream.taskOffered.overCapacity`).

**Capacity gates what the provider assigns, not what the agent starts.** A call placed from the
idle dialpad arrives through `task-offered` like any other task, and a full agent does not forbid
it: the ceiling binds assignment, not the agent's own hand.

**Capacity is not the agent's readiness.** It is the agent computer's division of one person across
providers, a ceiling on assignments at once, and it says nothing about the moment. An agent who
is about to finish a call and wants the next one lined up has a different thing to say, and says
it as **The agent's own queue** in `guide/queue.md` sets out; the ceiling stands unchanged while they do,
and the queue lives within it: `count: 0` clears the ask and lets a lined-up call go, and a break
in flight or in effect does the same, since the break wins.

### Runtime break prerequisite checks

Use `validateBreakCommand(method, request, state, context)` from the validation entry point
before any agent break dispatch. The context supplies current authentication and transport, and
the manifest's `levels` the session is validated against;
all five methods require the live session's break capability and active transport. Pass the
request object to the request method and the answer to `answerBreakAsk`, and undefined to the other three.

| Method | Required current state |
| --- | --- |
| `requestBreak` | `not-requested`; selected current reason code when codes exist, never a `providerOnly` one; `canRequestBreak` or the selected reason's `alwaysAvailable` exception. Free text does not replace a code. |
| `commitBreak` | `granted`, or already committed for an idempotent repeat. A later change to `canRequestBreak` does not revoke the grant. |
| `cancelBreak` | `awaiting-approval` or `granted`. A concurrent commit winning still answers `omni.break-already-committed` and requires recovery. |
| `endBreak` | `on-break` or `starting-after-task` during reconciliation, on a `break`; never a ban or tools not ready (`break.command.end.type`). |
| `answerBreakAsk` | A standing `ask` with the id the answer names (`break.command.answer.ask`), and an answer of `accepted` or `declined` (`break.answer.answer`). |

Use `validateTeamCommand(request, context)` before every lead act, its context carrying the manifest's `levels` as the break check's does: the team feature switch, break
decisions, asking a member for a break and withdrawing the ask, banning and unblocking, policy, and every act on a member's call. It requires
the live `lead` capability the command needs and active transport, a current team member list for any command naming a
member, and the target's complete break state for an ask. Approve/deny requires an
awaiting decision; an ask uses the target's reason codes and needs a member signed in with no break of their own and no ask
standing (`team.command.askBreak.member`, `.standing`); a withdrawal needs the ask on the list; a ban needs none standing, and
an lift-ban a lead's ban on the list; join and decline need the member's request on the list; coach, join-call
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
A lead may likewise omit reason text from `ask-break`. Do not require a text explanation
just because a break is agent-requested or asked for by a lead. If supplied, text must be nonempty; omit
it rather than sending an empty string. A selected `reasonId` identifies a published break
choice and is separate from this optional text.

With published choices, `{ reasonId: "lunch" }` is a valid request without explanation;
without published choices, `{}` is valid. A lead can similarly send an `ask-break` command
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
    { id: "no-phone", label: "No phone", kind: "technical", providerOnly: true },
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
declares `capabilities.breaks` at sign-in. If one cannot be stopped, offering a global break would
knowingly permit partial availability.

Omni coordinates one break attempt as follows:

1. Freeze the providers the attempt asks: every connected provider from which the agent can
   currently receive work. A provider joining during the attempt is given no capacity until it
   finishes. A provider whose authentication is `expired` is not one the agent can receive work
   from and is not asked: nothing is asked of it, the break proceeds without it, and when the
   session is restored it is reconciled from its snapshot as a set-aside provider is, with no
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
  against an agent who is already on break elsewhere. **A new session is this case too**: the grant
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
