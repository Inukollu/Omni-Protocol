# `@xema/omni-protocol`: The agent's own queue

The next call, lined up for this agent while they finish the one they are on: the ask, the lined-up call, and the release. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## The agent's own queue

The phone takes one call at a time, so "I am ready for the next one" cannot mean a second
assignment now. It means: line the next queued call up for me, to start the moment my wrap ends,
unless somebody else takes it first. That is a queue of the agent's own, one deep, beside the
platform's queue and never instead of it, and the contract carries it in three parts: the ask,
the lined-up call, and the release.

```ts
// the login declares it, as it declares breaks
{ status: "authenticated", identity: {...}, capabilities: { breaks: true, nextCall: true } }

// 1. The ask. The agent presses Next call during the call or the wrap; the desk offers the button
//    when it sees fit -- past the midpoint of the handling time is one way.
await connection.requestNextCall()
// -> { status: "requested" }: the provider holds the ask; nothing is promised
{ type: "next-call", nextCall: { since: "2026-09-12T10:41:00Z" } }

// 2. The lined-up call. The provider fills the ask from its queue: a caller waiting for this agent,
//    still in the queue, not a task, ringing nothing.
{ type: "next-call" }   // the ask is met
{ type: "lined-up", linedUp: { party: { name: "Priya S", number: { lockedBy: "org" } }, queue: "Billing", queuedSince: "2026-09-12T10:39:20Z", since: "2026-09-12T10:41:30Z", release: true } }

// The agent's wrap ends and the call is theirs: the entry goes and the task arrives, as any assignment does.
{ type: "task-ended", assignmentId: "alloc-42", outcome: { type: "completed", by: "agent" } }
{ type: "lined-up" }
{ type: "task-offered", task: { assignmentId: "alloc-57", phase: "pending", acceptance: "automatic", party: {...}, history: { steps: [{ step: "queued", at: "2026-09-12T10:39:20Z", seconds: 131 }] }, ... } }

// Or somebody else answered first, or the caller gave up: the entry goes and no task ever was.
{ type: "lined-up" }

// 3. The release. Where the entry grants it, the agent lets the call go back to the queue for anyone.
await connection.releaseLinedUp()
// -> { status: "released" }, then { type: "lined-up" } with nothing
```

**The ask lives only as long as its purpose.** It needs an assignment at work to be next after,
so an idle agent has nothing to press (`snapshot.nextCall.idle`), and the provider clears it on
its own when that assignment ends, when a call is lined up to meet it, and when the agent
withdraws it with `cancelNextCall()`. The desk never keeps it past any of those. `requested` says
the provider holds the ask, not that a call will come: a queue may be empty.

**The lined-up call is not a task, and rides no task event.** Until the offer there is no
assignment and nothing to accept, so it has no phase, no capabilities and no history, and it
rings nothing: the caller is still in the platform's queue, the phone has no channel for it, and
the desk shows "next for you" and nothing to act on but the release. It becomes a task by the
ordinary `task-offered`, with `acceptance: "automatic"` since the agent asked, and counts against
capacity from that moment as any assignment does; the `queued` step in its history carries the
caller's whole wait. One at a time: the phone only ever takes the next one, so `linedUp` is an
object, not a list. Nothing is guaranteed: the queue may give the call to whoever is free first,
and then the entry goes and no task ever was.

**A repeat caller is the same shape, unasked.** A provider whose routing prefers the agent a
caller spoke to last lines the call up for that agent without a press, so they see it in their own
queue and can take it before another agent does. The ask is only what the agent adds on top of
the platform's routing: releasing one call, or withdrawing the ask, ends nothing of that routing,
and the provider may line a repeat caller up again.

**Letting go is the provider's say.** `release: true` on the lined-up call grants the agent Let
go; absent, the platform means them to take the call and the desk offers nothing
(`linedUp.release`). `releaseLinedUp()` against an entry without it is refused with
`omni.capability-not-enabled`, as any control the provider did not grant. `cancelNextCall()`
withdraws the ask alone: once a call is lined up the ask is met, and what happens to that call is
the release.

**The lead sees the member's queue as the member does.** The member on the team member list
carries `nextCall` and `linedUp` as the member's own snapshot does, republished with the member.

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
