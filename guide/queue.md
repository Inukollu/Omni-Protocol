# `@xema/omni-protocol`: The agent's own queue

The next call, lined up for this agent while they finish the one they are on: the ask, the lined-up call, and the release. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## The agent's own queue

The phone takes one call at a time, so "I am ready for the next one" cannot mean a second
assignment now. It means: line the next queued call up for me, to start the moment my wrap ends,
unless somebody else takes it first. That is a queue of the agent's own, one deep, beside the
platform's queue and never instead of it, and the contract carries it in three parts: the ask,
the lined-up call, and the release.

```ts
// the user's capabilities include it, as they include breaks
{ status: "authenticated", identity: {...}, capabilities: { breaks: true, nextCall: true } }

// 1. The ask. The agent presses Next call during the call or the wrap; the agent computer offers the button
//    when it sees fit -- past the midpoint of the handling time is one way.
await connection.requestNextCall()
// -> { status: "requested" }: the provider holds the ask; nothing is promised
{ type: "next-call", nextCall: { since: "2026-09-12T10:41:00Z" } }

// 2. The lined-up call. The provider fills the ask from its queue: a caller waiting for this agent,
//    still in the queue, not a task, ringing nothing.
{ type: "next-call" }   // the ask is met
{ type: "lined-up", linedUp: { party: { name: "Priya S", number: { lockedBy: "org" } }, queue: "Billing", queuedSince: "2026-09-12T10:39:20Z", since: "2026-09-12T10:41:30Z", release: true } }

// The agent's wrap ends and the call is theirs: the entry goes and the task arrives, as any assignment does.
{ type: "task-ended", assignmentId: "asg-42", outcome: { type: "completed", by: "agent" } }
{ type: "lined-up" }
{ type: "task-offered", task: { assignmentId: "asg-57", phase: "pending", acceptance: "automatic", party: {...}, history: { steps: [{ step: "queued", at: "2026-09-12T10:39:20Z", seconds: 131 }] }, ... } }

// Or somebody else answered first, or the caller gave up: the entry goes and no task ever was.
{ type: "lined-up" }

// 3. The release. Where the entry grants it, the agent lets the call go back to the queue for anyone.
await connection.releaseLinedUp()
// -> { status: "released" }, then { type: "lined-up" } with nothing
```

**The ask lives only as long as its purpose.** It needs an assignment at work to be next after,
so an idle agent has nothing to press (`snapshot.nextCall.idle`), and the provider clears it on
its own when that assignment ends, when a call is lined up to meet it, and when the agent
withdraws it with `cancelNextCall()`. The agent computer never keeps it past any of those. `requested` says
the provider holds the ask, not that a call will come: a queue may be empty.

**The queue lives within capacity, and never beside a break.** The ask and the lined-up call are
promises to assign, and a promise the provider can no longer keep goes:

- **Told `count: 0`**, host-stopped, the provider assigns nothing, so it clears the ask and lets the
  lined-up call go back to the queue for anyone; an entry published after that is refused
  (`stream.nextCall.stopped`, `stream.linedUp.stopped`). The queue is per provider, as the ask
  was made on that provider's call, and the agent computer's division of capacity is what it was.
- **A break wins.** An agent who has asked for a break, been granted one starting after this
  task, or been put on one has said the opposite of "line up my next call", and the two never
  stand together: while a break is in flight or in effect -- any status but `not-requested` --
  `requestNextCall()` is refused with `omni.unavailable`, and a break arriving after a
  call was lined up drops the call, the caller going back to the queue for anyone
  (`snapshot.nextCall.break`, `snapshot.linedUp.break`). The agent computer shows Next call or the break
  controls, never both.
- **A lined-up call needs an agent at work** as the ask does: a call lined up for an agent with
  nothing at work is an offer that has not been made, and travels as `task-offered`
  (`snapshot.linedUp.idle`). The repeat caller for an idle agent is an ordinary offer.

**The lined-up call is not a task, and rides no task event.** Until the offer there is no
assignment and nothing to accept, so it has no phase, no capabilities and no history, and it
rings nothing: the caller is still in the platform's queue, the phone has no channel for it, and
the agent computer shows "next for you" and nothing to act on but the release. It becomes a task by the
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
go; absent, the platform means them to take the call and the agent computer offers nothing
(`linedUp.release`). `releaseLinedUp()` against an entry without it is refused with
`omni.capability-not-enabled`, as any control the provider did not grant. `cancelNextCall()`
withdraws the ask alone: once a call is lined up the ask is met, and what happens to that call is
the release.

**The lead sees the member's queue as the member does.** The member on the team member list
carries `nextCall` and `linedUp` as the member's own snapshot does, republished with the member.
