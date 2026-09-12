# `@xema/omni-protocol`: Team leads

The lead's own surface: the team member list, the lead's commands, lead assist, listening to a call. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Team leads

The team feature is the lead's own surface, beside the agent's and never mixed with it. The
login's `lead` flag turns it on in the agent application; the lead retrieves their members and
sees, for each, their assignments as they stand and the full history of each, and acts on them
with the authority the flag carries. Nothing the lead does here is a task on their desk. A lead
who also takes calls is an agent like any other on the agent side, and a lead who does not want
the agent role for now places themself on a break of a working kind and keeps the team feature on.

The team reaches the lead whole once, on `team-updated` after the lead switches the feature on
and on every snapshot while it is on, and from then on one member at a time: when a member is
offered a call, answers, holds, mutes or is taken over, the provider publishes that member whole
on `team-member-updated`, so the lead's screen moves when the member's does and a team of two
hundred is never resent because one of them held. The agent application asks for nothing and
computes nothing. See **`team-updated`** in `guide.md` and its companions.

| Field | Contract |
| --- | --- |
| `members` | Every member of this lead's team, whatever their state, each with their open tasks. `[]` says the lead has a team with nobody in it; omitting the team member list says something else entirely — see **The login is the permission** below. |
| `policies` | The team's policy per capability as it stands — the setting, who set it, and `lockedBy` where a level above the team made it theirs to keep. Present where the provider offers policy control; absent where it does not. See **Who decides what an agent may do** in `guide.md`. |

| `TeamMember` field | Contract |
| --- | --- |
| `id` | Required `UserId`. A task carries no names and neither does a team member list: Omni resolves what to display with `getUserDetails()`. |
| `availability` | Required. What the member is doing now. |
| `since` | Optional. When the current `availability` began — not when they signed in, and not when the team member list was read. |
| `break` | Present only while the member has an outstanding break request. See **A member waiting for a break**. |
| `tasks` | The member's open tasks as `MemberTask`s: the same task the member's desk holds, less the workspace. The assignment, title, task type, phase, party, room, audio and completion terms -- `completionMode`, `wrapAllowance`, `wrapEndsInSeconds` -- are what the lead reads, and the task's record -- `history`, steps and totals -- travels whole, exactly as the member's desk holds it, so the lead's screen and the member's show the same record. The workspace -- `capabilities`, `capabilitySource`, `browsers` and their URLs -- is the member's desk's alone and never travels (`team.member.task.workspace`). The party's number and email are shown to leads or locked as the provider decides for leads, apart from what it decides for the member -- see **What the queue locks is locked on the whole task**. `[]` when the member holds none; omitted only where the provider cannot see them. |
| `listening` | Every lead on this member's call — listening, coaching or joined — published to every lead alike: each entry names the lead by `leadId`, which of the member's calls by `assignmentId`, the `mode` they are heard in, and since when. The entry naming the signed-in lead is what their own audio opens on. Absent while nobody is on the call, never `[]` (`team.member.listening.*`); a lead is on one member's call at a time (`team.listening.single`), and a lead who is heard is also in the task's `onCall` (`team.member.listening.heard`). |
| `request` | Present while the member is asking a lead to join one of their calls: which assignment, the note they wrote, since when. The call named is one their `tasks` carry (`team.member.request.assignment`). Absent when they are not asking. See **Lead assist**. |
| `phone` | The member's phone as the platform sees it: the same `PhoneState` the member's own snapshot carries, so a lead sees a desk phone that is down, or a call on it that is no task, as the member does. Present where the provider declares `phoneStatus`. See **The phone's own view** in `guide/phone.md`. |
| `shift` | The member's own history for the day, about the person rather than any one call: `signedInAt`, `signedOutAt` once it has happened, today's totals as the provider counts them — `talkSeconds`, `holdSeconds`, `breakSeconds`, `tasksHandled`, each present only when the provider knows it — and the day's sign-in, sign-out and break `events`, oldest first. The same `Shift` the member's own snapshot carries, the same numbers from the same count. Omitted where the provider cannot say. |

Each availability value means one thing:

| Value | Meaning |
| --- | --- |
| `ready` | Signed in, able to take work, none assigned. |
| `on-task` | Working on at least one task. It says nothing about how many, and nothing about whether more will fit. |
| `on-break` | Stopped and not taking work, whether they asked or somebody stopped them. The reason lives on their own `BreakState`, not here. |
| `elsewhere` | Signed in here, and the agent application holds this agent's capacity for another provider (`count: 0`, agent application-stopped): not receiving this provider's work, and not on a break. See **Capacity**. |
| `signed-out` | Known to this team but not signed in to this provider. |

**Publish the whole team once, then each member whole.** Team presence typically reaches an
adapter over a best-effort channel with no ordering and no delivery guarantee, so the adapter
reconciles against its own authoritative read before it publishes anything. What it publishes is
the whole team on `team-updated` -- after the switch, and on every snapshot -- and after that one
member at a time on `team-member-updated`, carrying the member whole: their availability, their
tasks, their listening, their shift, their request, as they now stand. Applying the same member
twice changes nothing, so a redelivery is harmless, and a member the team never carried is added
by it, as a colleague signing in is. `team-member-removed` takes one off. Never a field of a
member, never a task of theirs on its own: a hold on a member's desk is that member republished
whole on the lead's, and nothing else on the lead's screen moves.

**Whatever the member's desk hears of a task, every lead hears of the member.** The trigger is
not a list of changes but the publication itself: each `task-offered`, `task-updated`,
`task-audio-started`, `task-audio-ended` and `task-ended` the provider sends to the member is
matched by a `team-member-updated` to every lead with the feature on, carrying the member whole
with the task as it now stands, or without it once it has ended. A held leg closing with its
`seconds`, a room restated, a phase moving, the wrap left ticking on a restatement: each reaches
the lead's copy in the same round it reaches the member's, and the two copies of the record never
part for longer than the delay between them.

**The agent's day is on the wire.** The lead sees `shift` totals as the provider counts them, and
the agent sees the same: `Snapshot.shift` and `shift-updated` carry the agent's own day in the same
shape, from the same count, so "calls today: 12" is one number on both screens. The desk computes
nothing of the day; `tasksHandled` moves when a task ends and `talkSeconds` when a leg closes, and
the active call's running time is the screen's own until then, as **Every screen counts from the
provider's clock** sets out.

**Omit `since` rather than inventing one.** Omni renders it as a duration, so a timestamp
synthesised from the adapter's own clock at seed time reads as "on task for 0 seconds" for
everybody — worse than showing nothing, because it looks like data. Send it only when the provider
knows when the state actually began. It times the current `availability`, so it moves every time
that value does. And it is counted from the provider's clock, never the screen's, so a provider
that publishes it declares `timeCheck` -- see **Every screen counts from the provider's clock** in `guide.md`.

**The login is the permission.** A team member list goes to a login that declares
`capabilities.lead`, once the team feature is on, and to nobody else. Omni never decides who
leads a team: the provider said so at sign-in, and the team member list agrees with it — owed,
`members: []` included, once a lead has switched the feature on; absent for everybody else, which
is the correct rendering for an agent who leads nobody (`team.required`, `team.unentitled`). What
the lead may do with it comes with the flag: there is no per-action permission on the login or on
the list.

**The lead switches the feature on and off, and the provider is told.** A lead may work as an
agent alone, as agent and lead, or as lead alone, and moves between them on the fly. The
agent application says which with `{ type: "lead-features", enabled }`: while it is on, the
provider sends team events scoped to the lead's team and the lead may act; while it is off, the
lead is an ordinary agent, nothing of the team is owed or expected (`team.unexpected`,
`event.team.features`), and no lead act is possible, since the lead learns their members'
assignments only from the list.

**The provider assumes nothing.** The switch is not remembered across connections: the agent
application sends `lead-features` on every connect, after it has stated capacity, and until it has
the provider treats the feature as off. The connect snapshot therefore carries no team, whatever
the login declares; the whole team arrives on `team-updated` once the switch is on, and every
snapshot after that carries it. A conformance run switches the feature on for a lead and holds the
provider to that first `team-updated` (`team.required`); a team on the connect snapshot is the
provider assuming (`team.unexpected`).

**The team member list never carries the agent it is published to.** A lead does not report to
themself: their own break request and their own ask for a lead go up to whoever leads them and
appear on *that* person's team member list, as a member with a `request`, while the requester sees
only their own `BreakState` and their task's `leadAssist` move. An adapter whose platform lists the lead
among their own members filters the signed-in identity out before publishing. **Being a lead is a
role the provider knows, never inferred from who is listed:** it is declared at sign-in, a lead
with nobody in their team publishes `members: []`, an agent with no such role publishes nothing, and no
member count can tell those two apart.

### Lead commands

One method, `executeTeam`, taking a discriminated command exactly as `execute` takes a
`TaskCommand`. Every act on a member's call names the member, `memberId`, and may name the
assignment, `assignmentId`, where the lead has it; the provider resolves the member's current
assignment from the member alone.

| Command | Effect |
| --- | --- |
| `{ type: "lead-features", enabled }` | The team feature on or off. See **The lead switches the feature on and off** above. |
| `{ type: "decide-break-request", memberId, decision, reason? }` | Settles one pending request. `decision` is `granted` or `denied`. A grant moves the member to `granted`; a denial ends the request and moves it directly to `not-requested`. |
| `{ type: "set-break-policy", policy }` | `approval-required`, `automatically-approved`, or `requests-suspended`. |
| `{ type: "force-break", memberId, reasonId?, reason?, expectedDurationMs? }` | Puts a member on a break they did not ask for. `reasonId` names a published `BreakReason.id` and is required whenever the provider publishes `reasons`; the member's forced break carries it as `activeReasonId`, so its kind is known. Optional `expectedDurationMs` is advisory; the resulting forced break publishes what is left of it as `expectedEndsInSeconds`, restated on every publication. |
| `{ type: "end-forced-break", memberId }` | Asks the provider to lift a forced-break restriction a lead asked for, by clearing `BreakState.forced`; one the platform imposed is its own to lift (`team.command.endForcedBreak.provider`, `omni.break-forced-by-provider`). The committed break continues; only the agent resumes work. |
| `{ type: "join", memberId, assignmentId? }` | Answers the member's request: the provider bridges the lead's channel into the call. See **Lead assist**. |
| `{ type: "decline", memberId, assignmentId?, reason? }` | Refuses the member's request. |
| `{ type: "listen", memberId, assignmentId? }` | The lead's channel joins the member's call unasked, in silence. See **Listening to a call**. |
| `{ type: "coach", memberId, assignmentId? }` | The lead is heard by the member alone. Needs the lead on that member's call. |
| `{ type: "join-call", memberId, assignmentId? }` | The lead is heard by everyone on the call. Needs the lead on that member's call. |
| `{ type: "leave", memberId, assignmentId? }` | The lead's channel leaves the member's call, however it got there. The member's call goes on. |
| `{ type: "take-over-call", memberId, assignmentId? }` | The provider moves the call to the lead as its new agent, from a joined call or a listened one alike. See **Lead assist**. |
| `{ type: "set-policy", capability, setting }` | Sets the team's policy for one capability: `on`, `off`, or `person`. See **Who decides what an agent may do** in `guide.md`. |

`memberId` is this provider's own identifier for the member, as published on its team member list. It is
never an identifier from another provider, and Omni does not translate between them; names come
from `getUserDetails()`. `validateTeamCommand` holds each command to the team member list as it
stands -- see **Runtime break prerequisite checks** in `guide/breaks.md`.

`requests-suspended` means requests are **rejected outright** rather than left pending — nobody is coming to
approve them. A provider that suspends break requests must also publish `canRequestBreak: false` to the team's
agents so they see it before asking. A `force-break` must likewise reach that member as a `forced` break
on their own `BreakState`, or they are stopped from working with no way to see why.

What happens when no lead is online — auto-approving, for instance — is the provider's decision and is
never expressed here.

### Lead assist

An agent on a call may ask a lead to join it -- a dispute that needs approval, a customer who
asks for a manager, a moment the agent wants a second pair of ears. A call centre calls this
assistance or escalation, and the name says who assists: the capability is `leadAssist` on the
task; the lead's side is the team member list, which is already the lead's view of the team. The
flow, in order:

```ts
// 1. The agent asks, with a small note. Their task carries `leadAssist` from here on.
execute({ assignmentId: "alloc-42", command: { type: "lead-assist", action: "request", note: "Refund dispute, needs approval" } })
//    task.leadAssist = { stage: "requested", note: "Refund dispute, needs approval", since }

// 2. Every lead with the team feature on sees the request on the member.
//    team-member-updated: member: { id: "A-1", ..., request: { assignmentId: "alloc-42", note, since } }

// 3. A lead joins, or declines.
executeTeam({ command: { type: "join", memberId: "A-1", assignmentId: "alloc-42" } })
executeTeam({ command: { type: "decline", memberId: "A-1", reason: "In a call" } })
```

**On `join` the provider bridges the lead's channel into the call.** The member's task moves to
`leadAssist: { stage: "joined", leadId }` and its `onCall` gains the lead as an `agent`, since a
lead who is heard is in the room; the member on the team member list carries
`listening: [{ leadId, assignmentId, mode: "join-call", since }]`, and the lead's audio opens on
it as **Listening to a call** describes. Nothing is a task on the lead's desk: a join is the lead's act on the team surface, not
work assigned to them.

**A lead is on one member's call at a time.** A `join` from a lead already on a call -- their own
or a member's -- is answered `failed`; the request stands for another lead, or until it is
withdrawn or declined. A join is work, so Omni offers Join only to a lead whose voice channel is
free, and a provider answers a `join` from one whose channel is not `failed`.

**On `decline`, or a request the agent withdraws with `{ type: "lead-assist", action: "cancel" }`, the
provider clears `leadAssist` from the agent's task** and drops the request from every team member list. Nothing
else changes; the agent is still on the call.

**On `leave`, the lead's channel drops and the call goes on**: the member's task loses its
`leadAssist`, the member loses this lead's entry in `listening`, and the lead is free. Nothing ended for the member.

**On `take-over-call`, the provider moves the call from the member to the lead**, and the lead is
its new agent. There are two paths to it -- the agent asked and the lead joined, or the lead was
listening unasked -- and one act at the end of either. What follows is the same on both:

| | The member's task | The lead's desk |
| --- | --- | --- |
| Take-over | `task-audio-ended`, then `completing`: the member's interaction is over and their wrap runs, exactly as after `end-call`. The audio ends first, as before every voice ending (`stream.taskEnded.audioOpen`). The member loses this lead's `listening` entry on the team member list no later than the offer, and the lead's listening audio closes. | An ordinary assignment arrives: `task-offered` with `acceptance: "automatic"`, carrying the call's history and `takenOver: { memberId, since }`, within the lead's capacity. |
| The member completes | `task-ended` with `{ type: "taken-over", leadId }`, at the member's own completion. The lead is named by user id, since a lead is not a directory item. | The lead works the call as any agent would, and ends it as any call ends. |

**The taken-over call is offered whatever break the lead is on, and counted like any other.** A
lead working as lead alone is on a break of a working kind, and the provider assigns the call
regardless: it is the one task a break in effect may hold (`break.on-break.tasks` allows it, and
nothing else). It is a call landing on the lead's desk, so it counts against their capacity as
every call does, with no exemption: a lead at capacity cannot take over, and the provider answers
`failed`. The other conditions are that the lead is not already on another call and their voice
channel is free. A lead with the team feature off cannot take over, since they have no member's
assignment to name.

```ts
const leadAssistCapable = {
  channel: "voice",
  capabilities: { hold: true, leadAssist: true, outcomes: true },
  phase: "in-progress",
  leadAssist: { stage: "joined", leadId: "L-9", note: "Refund dispute, needs approval", since: "2026-08-21T09:04:00Z" },
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "leadAssist">;

const takenOver = {
  channel: "voice",
  capabilities: { hold: true, endCall: true, outcomes: true },
  phase: "in-progress",
  takenOver: { memberId: "A-1", since: "2026-08-21T09:06:00Z" },
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "takenOver">;
```

Lead and member alike are `UserId`s of this provider, so an adapter publishing them implements
`getUserDetails()`; names never travel on a task or a team member list.

### Listening to a call

A lead may listen to a member's call without being asked -- to coach, to check quality, to step in
when it goes wrong. It is a team act naming the member, and no task on the lead's desk carries it:
the lead's view of the call is the member's task on the team member list, with its room and its
history. The three modes determine who hears the lead:

| Mode | Who hears the lead |
| --- | --- |
| `listen` | Nobody. The lead hears both sides in silence. |
| `coach` | The agent alone. The customer hears nothing. |
| `join-call` | Everyone on the call. |

All three come with the `lead` flag; a centre reserves none of them per lead.

**There is no team audio.** Audio is the agent's or the lead's, and the lead's audio while
listening follows the provider's published state exactly as a task's does: the entry naming this
lead in `listening` on the member is the provider's word that the lead's channel is in the call.
When it appears, the application opens `openAudio({ assignmentId })` on the lead's connection for
the call it names, and plays the `CallAudio` returned; when it goes, the application closes it.
Another lead's entry opens nothing: it is shown, and that is all. Nothing else says
when the lead's audio is up, and a reload reopens it from the snapshot's team member list as a task
carried with `audio: "started"` is reopened.

The flow, end to end:

```ts
// 1. The lead, with the feature on, sees a member on-task with their tasks, and picks a call.
// 2. The lead's channel joins it in silence. Conditions: the lead's voice channel is free --
//    not on a call, not listening elsewhere. Capacity is not involved: nothing is assigned.
executeTeam({ command: { type: "listen", memberId: "A-1", assignmentId: "alloc-42" } })
// 3. The provider publishes the member whole on team-member-updated, to every lead; the member carries
//    listening: [{ leadId: "L-9", assignmentId: "alloc-42", mode: "listen", since }]
//    -- L-9's application opens openAudio({ assignmentId: "alloc-42" }) on its own connection; every
//    other lead's shows L-9 on the call and opens nothing.
// 4. The lead changes how they are heard; the member is published again with the entry's new mode. The audio stays open.
//    join-call is heard by everyone, so the member's task is also republished with L-9 on onCall as an agent.
executeTeam({ command: { type: "coach", memberId: "A-1" } })
executeTeam({ command: { type: "join-call", memberId: "A-1" } })
// 5. The lead leaves: the provider publishes the member without L-9's entry, and the task without L-9 in the room; the application closes the audio.
executeTeam({ command: { type: "leave", memberId: "A-1" } })
// 6. The member's call ends: the same as leave, from the provider's side.
// 7. The lead takes the call: the member loses this lead's listening entry no later than the offer, the application
//    closes the listening audio, and the lead's own call arrives as an ordinary assignment marked
//    takenOver, counted against capacity, with its audio following task-audio-started as any call's does.
//    At capacity the take-over is refused and the lead stays listening.
executeTeam({ command: { type: "take-over-call", memberId: "A-1" } })
// 8. A join on the member's request is the same flow entered at step 3 with mode: "join-call",
//    and the member's task shows leadAssist: joined.
// 9. A reload of the lead's application: the switch is sent again, the team-updated that follows
//    still carries this lead's entry in listening on the member, so the audio is reopened.
```

**`listening` on the member is the state**, one entry per lead on the call, restated on every
change of mode, naming the lead (`team.member.listening.leadId`, once per member,
`team.member.listening.unique`) and the call, so the application knows which audio is its own to
open (`team.member.listening.assignmentId`, and one the member's tasks carry,
`team.member.listening.assignment`). Every lead sees every entry: a silent lead is hidden from
the agent, never from the other leads and managers watching the same member on other screens.
A lead is on one member's call at a time (`team.listening.single`).

**A lead listens while holding no call of their own.** Omni offers Listen to a lead whose voice
channel is free, and a provider answers a `listen` from one whose channel is not `failed`. That
includes a lead on a break: a lead working as lead alone is on a break of a working kind, and
listens through it.

**A silent lead reaches nobody but the leads.** In `listen` and `coach` the member's task carries
no trace of the lead: not on `onCall`, not in the record. Whether coaching is announced to the
agent is the platform's business and travels on the audio, not on this wire. In `join-call`, and
on a `join` answering a request, the lead is heard by everyone and is in the room: the task's
`onCall` carries them as an `agent` by user id, on the member's desk and on every lead's copy of
the task alike, and `leave` takes the entry off as it takes the channel off
(`team.member.listening.heard`).

### A member waiting for a break

A member who has asked for a break **keeps working** until Omni commits it, so asking is not an
availability of its own — it rides alongside one on `break`. That a request exists says nothing
about whether anybody has to act on it, and the difference is a lead's entire action list:

| `break` | Means |
| --- | --- |
| `awaiting-approval` | Somebody has to decide. This is the lead's queue. |
| `granted` | Decided yes, but Omni has not told the provider to stop yet. Work continues and nobody needs to decide. |
| `starting-after-task` | Already granted; it begins when their current task ends. Nobody needs to act. |

Those three are the only values that appear here. `not-requested` is absence — omit `break`
instead. `on-break` is `availability: "on-break"`, and a denial transitions to `not-requested`,
so neither survives to be reported. It is otherwise the same `BreakStatus` the member's own
break state uses, rather than a parallel vocabulary for the lead's view, so the two cannot drift
apart.

Omni offers Approve and Deny only while a member is `awaiting-approval`, shows `granted` as agreed
but not started, and shows `starting-after-task` as settled.

**Live status, not a record.** The provider derives it from what is true now — not stored, not
historical, carrying no decision made earlier. Like the team member list it belongs to, it is published
whole and replaced whole, and a provider that cannot say omits it.

**An agent is not waiting on one person.** Authority is held by several, everyone who holds it
sees the request on their own console, and **any one of them settles it**. Omni offers the
decision to every login that declares `lead` and has the team feature on — which is how the provider already
says who may decide — and does not try to work out whose turn it is.

A request needing *more than one* approval is not something this contract describes. There is
no partial state to report and no progress to display: a request is either still owed a
decision or it is not.
