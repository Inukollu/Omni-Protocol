# `@xema/omni-protocol`: Voice

What is true of a call and of nothing else: preview, connecting back, ending a call, conference, every dial and its outcome, recording. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Preview: the agent presses Call

An outbound campaign that lets the agent see who they are about to call is a **preview**: the
record arrives as a task and sits in `preview` with the party on it before a call goes
out. The agent prepares; manual or declared automatic initiation may then begin dialing. It
remains preview while ringing until an evidenced answer or non-answer outcome. The agent may press Call. That is the whole phase, and it exists on voice alone --
chat and email have no call to place, and their reading is ordinary work in `in-progress`.

```ts
const previewed = {
  channel: "voice",
  capabilities: {},
  phase: "preview",
  party: { name: "Maya Rao", number: "+919876543210" },
  previewEndsInSeconds: 120,
  atDeadline: "provider-dials",
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "party" | "previewEndsInSeconds" | "atDeadline">;

// The agent presses Call. It is a dial like any other.
const pressed: TaskCommand<"voice"> = { type: "dial", dialId: "dial-7f2" };
```

**Call is a dial.** It carries the agent application's `dialId`, is answered `dialling`, and ends in exactly one
`dial-outcome`; the phase is its gate and there is no capability, since a record put in front of an
agent is there to be called. Its audio starts on `dialling`, as every agent application-placed dial's does --
ring-back is audio the agent hears -- so `task-audio-started` arrives on the `preview` task with
its party ringing. On `answered` the task is `in-progress`; on any other outcome the audio ends,
`task-audio-ended` starts the wrap clock as on every voice task, and the task goes to
`completing`, so the agent records the
no-answer as the outcome it is -- in a campaign that is the commonest outcome there is, and it
is work, not a cancellation. A `preview` task therefore needs a manifest that says how a dial ends
(`task.preview.dialOutcomes.required`).

**Preparation and trigger ownership are per task.** Unlimited preparation omits both
`previewEndsInSeconds` and `atDeadline`: only an agent pressing Call starts dialing. Fixed
preparation carries the seconds the provider says are left, counted down on the desk from the
publication that carried them and restated on every later one, and exactly one trigger owner:

| Declaration | At preparation end |
| --- | --- |
| `atDeadline: "provider-dials"` | The provider initiates dialing. The agent application never sends a timer-triggered Call. |
| `atDeadline: "host-dials"` | The agent application sends the ordinary `dial` command with a fresh agent application `dialId`. The provider does not independently auto-dial this task. |
| `atDeadline: "waits"` | Neither side auto-dials. The task remains in preview until the agent presses Call. |

The agent may press Call early in either fixed-preparation dialing mode, or at any time in
`waits` mode. With `waits`, the countdown is a preparation target, not an expiry: when it reaches
zero the UI says "Waiting for agent" and keeps Call available. There is no automatic task-ended,
completion, dialing or phase change. No repeating timer action occurs on later snapshots. This differs
from unlimited preparation only by displaying a preparation target. The former `expires` deadline
value is not supported; elapsed preparation must not withdraw the task. For `provider-dials` and `host-dials`, the deadline ends
preparation and triggers initiation; it does not promise ringing, playable audio or customer
answer at that exact instant. Scheduling/dispatch delay must remain visible, and a failed or
prevented initiation must be reported rather than leaving a silently expired countdown.
A source eligibility threshold that may never trigger an attempt is not this promise.

The two deadline fields travel together and only in preview. The countdown is the seconds the
publication carried, counted from its receipt: the agent application infers no deadline where none
was stated and reads no clock against another. Neither elapsed time nor submission changes the
task phase: subsequent authoritative events state ringing, answer, audio and completion.

An agent application must serialize manual clicks and its timer under the exact provider/login/task/assignment
scope, allowing at most one unresolved submission. Recheck the current phase, deadline owner,
assignment and whether an attempt already exists before dispatch. A new snapshot or policy update
cancels an obsolete timer; login loss, disconnect, task end and assignment replacement fence its
callback. Reconnect past a deadline first reconciles current task and attempt state; it must not
blindly submit again. An uncertain prior submission remains unresolved, without automatic retry.
The provider atomically arbitrates any residual manual/timer race and does not accept a second
command as ownership of an already-running independent attempt.

Agent application-triggered automatic dialing is an ordinary agent application dial: its result is `dialling` with the same
agent application `dialId`, followed by exactly one correlated terminal `dial-outcome`. A provider-triggered
dial has no invented agent application ID or agent application dial outcome. It reports source-evidenced party ringing,
actual audio and customer answer separately. In preview with `atDeadline: "provider-dials"`, a ringing
party without an agent application ID may carry actual pre-answer audio; the deadline alone permits no audio.
Audio is still introduced/ended by the corresponding events and must not imply customer answer.
Submission acceptance is never an answered outcome or permission to publish `in-progress` early.
Unsupported source correlation/outcome/audio evidence remains an integration blocker.

**Drop both fields when the phase moves.** A provider that builds the `in-progress` task by
spreading the `preview` one carries `previewEndsInSeconds` and `atDeadline` with it, and the agent application refuses
the update (`task.preview.deadline.unexpected`): the desk keeps the task as it last stood, and the
provider is told through `refused` exactly which rule, so the state that looked right on its side
is named on its side. The task past preview has no deadline to wait for, so it carries neither
field.

**Provider execution and agent application controls are distinct.** Answer, hold/resume, conference,
lead assist and interaction completion are executed by the provider
through the adapter. The task's applicable capability, phase, completion mode and command-specific
prerequisites decide which controls are offered. Caller disconnect also executes at the provider. Microphone mute is agent application-owned, never a provider
TaskCommand or task capability. The separately declared agent application recording facility keeps its existing
recording contract; this distinction does not remove it or move provider call operations to the agent application.

A caller journey may revisit the same agent while an earlier interaction still wraps. Each is its
own assignment, and two open at once carry two assignment ids. Restore them unchanged on
reconnect. Commands, audio, endings and history reports name the exact assignment; never retarget
an old command to the newest interaction of a journey. `validateTaskCommandRequest` checks the
request's assignment against the supplied published task and then its command prerequisites. The
caller must select that task within the correct provider/login and recheck at the provider; the
validator cannot prove source freshness or authorization.
`task-ended` retires only that interaction's resources. Another interaction, caller channel or IVR/queue
portion must not be cleared because this task ended. Snapshot counts include all still-owned wrap
and active interactions; task completion is not caller hangup.

**Voice describes the agent's interaction within the wider call.** The task defines that agent's
workspace, tools, permissions, audio participation and completion work. The caller's channel may
continue through IVR, queues, other agents, holds or conferences while this interaction ends or wraps.
Completing this task ends this interaction responsibility; it is not evidence that the caller's channel
or journey ended. Task audio describes this agent's attachment, not the lifetime of every party's
connection. Commands retain their explicit targets and effects; task completion must not silently
become a caller-disconnect operation.

**A task is never its audio.** A voice task represents the agent’s interaction: the call is offered when it is
routed to the agent and accepted as its `acceptance` dictates, and its presence and phase follow
the provider's reports about the work — never the audio. Wherever audio moves — an offer, a hold, a
conference leg joining or leaving, a lead joining, a take-over, a connect-back — the audio follows
separately, arriving on `task-audio-started`, attaching through `openAudio` and ending with
`task-audio-ended`. Omni does not ring,
bridge, or hold a line. How the phone rings, whether it rings at all, and where legs join and leave
are the adapter's and the platform's, transient, and decide neither when a task exists nor what
phase it is in.

The line runs between the provider's word and Omni's own senses. `task-audio-ended` is the
provider's report that primary interaction ended — a fact about the work, which is why the completion
allowance starts on it and the Connect back control appears on it — and Omni follows that report as it
follows any other. What Omni never does is derive a task's state from its own audio session: a
stream that drops, a track that ends, a transport that disconnects, a microphone that fails, an
endpoint re-registering change nothing about the task until the provider says so. Structurally:
`task-audio-started` and `task-audio-ended` alternate on a task whose work has begun, audio ends
only where it arrived, what follows the audio ending is `completing` or `task-ended`, and every
task is introduced once — `testAdapter` holds the stream to that from the connect snapshot on,
and `assertAudioFollowsTheTask` holds any sequence.

## Connecting back during completion

A task that declares `connectBack` lets the agent connect back to the party while the task is
`completing` -- to finish what the call left unfinished, on the same task rather than a new one,
whoever placed the call in the first place. Most such calls came in, so this is not a redial: the
agent rings a party who rang them. Omni issues `{ type: "connect-back", dialId }`; it is issuable
only in `completing`, and only where the capability is declared. The provider knows who the party
is; the command carries no destination, and it is a dial like any other, so it carries the agent application's
`dialId`, is answered `dialling`, and ends in one `dial-outcome`.

On `dialling` the provider is placing the call and the task returns to `in-progress`: the agent is
working again, and the wrap allowance is **discarded, not paused**. From there the call is
reported as any call is -- `paused`, `in-progress`, and when its audio ends, `task-audio-ended`
again, which starts a fresh allowance from that instant. A party who does not answer is a dial
whose outcome says so and a call whose audio ended: the task returns to `completing` through the
same event and the clock starts again from there. At no point is an agent dialling against a
deadline.

**The room shows the party being dialled.** From the moment any agent application dial places the party -- a
dialpad call, a preview Call, a connect-back -- the `party` entry carries `stage: "ringing"` and
the agent application's `dialId`, exactly as a conferenced entry does from its dial; `joined` on
the publication that follows the answered `dial-outcome` and never before it
(`stream.taskUpdated.stage`); and no stage from the next publication on, so `joined` is transient
and a later copy still carrying it is stale (`stream.taskUpdated.stage.lingering`). An agent application shows a
call being placed, not a party it asserts is on a call that is still ringing. A callback the platform places itself on the same task -- the first
call over, the platform dialling the party again without a command -- shows the same thing with no
agent application `dialId`, as any platform-placed dial does. A party with no stage is on the call, and a dial
with no stage is half a claim (`task.onCall.party.dial`). The stage is also what lets the stream
tell a task coming back from one going backwards (`stream.taskUpdated.phase`).

**The control exists only while there is a window to use it in.** Under `agent-command` the task
stays `completing` until the agent completes it, so the window is open for as long as they need.
Under `provider-automatic` the window is the allowance -- and with `wrapAllowance: 0` there
is none: the provider completes the task at provider end, and Omni does not offer Connect back,
whatever the task declares. A capability names a control that can be used; on a task with no `completing`
window it cannot, and declaring it there changes nothing.

```ts
const connectBackCapable = {
  channel: "voice",
  capabilities: { hold: true, connectBack: true, outcomes: true },
  phase: "completing",
  completionMode: "provider-automatic",
  wrapAllowance: 30,
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "completionMode" | "wrapAllowance">;
```

With ten seconds of the thirty left, the agent presses Connect back: `execute({ command: { type:
"connect-back", dialId } })` returns `dialling`, the task is `in-progress`, and the thirty seconds
are gone.
The second call ends: `task-audio-ended`, the task is `completing`, and a new thirty seconds runs
from that instant.

```ts
const immediateProviderCompletion = {
  completionMode: "provider-automatic",
  wrapAllowance: 0,
} satisfies Pick<Task, "completionMode" | "wrapAllowance">;
```

## Voice capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending voice offer. Omni shows it only when local policy also permits declining. |
| `hold` | Primary toggle: Hold | Omni may issue voice-task `hold` and `resume` commands. |
| `endCall` | Primary button: End call | The provider ends the agent's channel and every channel the agent added; the caller continues on the provider's path. The task goes to its wrap. See **Ending a call, and removing one person from it**. |
| `terminateCall` | Primary button: Terminate call | The provider ends the whole call: every channel on it, the agent's, the caller's, any colleague's and anyone else's. The task goes to its wrap. See **Ending a call, and removing one person from it**. |
| `connectBack` | Completing-task button: Connect back | Omni may have the provider connect the agent back to the task's party while the task is `completing`, returning it to `in-progress` on the same task. Not offered where there is no `completing` window: `provider-automatic` with a zero allowance completes the task at provider end. See **Connecting back during completion**. |
| `schedule` | Secondary menu item: Schedule | Omni may put a follow-up for this party on the calendar, from the call or from its wrap: a time, and a note. See **Scheduling a follow-up** in `guide/agent.md`. |
| `leadAssist` | Secondary menu item: Lead assist | Omni may ask a lead to join this call, with a note. The lead's decision reaches the agent on `Task.leadAssist`. See **Lead assist** in `guide/lead.md`. |
| `conference` | Secondary button: Conference | Omni may dial a destination into the active call, and remove one person from it -- a conferenced entry, one still ringing included, which calls the dial off, or the party, leaving the agent with the colleague. See **Ending a call, and removing one person from it**. |
| `recording` | Overflow menu item: Recording | Per-task provider and agent application policies expose only their permitted recording actions; each has independent state and routing. |
| `outcomes` | Primary button: Complete | Omni may request task completion with a provider outcome and notes. |

## `conference`

```ts
capabilities: {
  conference: {
    destinations: [
      { id: "tier2", label: "Tier 2 support" },
      { id: "main-menu", label: "Back to the main menu" },
    ],
  },
}
```

| Field | Contract |
| --- | --- |
| `destinations` | The items the control offers, at least one, with unique `id` values. Each is a button or a menu item on the desk. |
| `id` | What Omni sends as `destinationId` on a `conference` command, and what the provider executes. |
| `label` | What the agent reads. |

**The protocol does not say what an item does.** A queue, an IVR menu, an outside line, a
skill group -- that is the queue's configuration and the provider's business. The agent sees a
list of labels, picks one, and Omni sends its `id`; the provider executes whatever the item is. No
kind travels, nothing is typed, and a control with an empty directory has nothing to offer and is
refused (`task.destinations.offer`). A control declared as bare `true` is refused for the same
reason (`task.destinations.shape`): once nothing is typed, the directory is the control.

**The provider chooses the supported destinations.** A published item may route to an IVR,
queue, named agent or another configured destination. No destination kind is inferred from its
label. The agent application offers only the directory attached to this task's `conference` capability,
and sends the exact destination ID; it does not invent an agent picker or arbitrary dial target.
The provider rechecks eligibility and executes the routing. Returning to an IVR or queue does not
end the caller journey; a later assignment to the same agent is a new interaction.

## Ending a call, and removing one person from it

A call has everyone on `Task.onCall`, and three commands take people off it, all performed by the
provider. Two of them end the agent's part; they differ in what happens to the caller.

```ts
{ type: "end-call" }                                             // the agent's channel and the channels the agent added end; the caller continues
{ type: "terminate-call" }                                       // every channel on the call ends
{ type: "conference", action: "remove", party: true }            // the customer leaves; the agent stays with the colleague
{ type: "conference", action: "remove", destinationId: "tier2" } // the conferenced person leaves; ringing, this calls the dial off
```

**`end-call` ends my part.** The agent's channel and every channel the agent added -- a
conferenced colleague, a lead who joined -- end, and the caller continues on the path the
provider decides: another IVR, a queue, a survey, or the end of the call. Gated by `endCall`.

**`terminate-call` ends the whole call.** Every channel on it ends at the provider: the agent's,
the caller's, any colleague the agent added, and anyone else on the call. Nobody is left on the
line. Gated by `terminateCall`, a separate permission, since ending a customer's call is a
different thing from putting my own side down.

Both are commands to the provider through `execute`, and nothing happens on the desk until the
provider reports it: the agent's audio ends on `task-audio-ended`, the task moves to `completing`,
any wrap allowance runs, and the agent completes. Neither is `task-ended`, and `complete` is
neither of them. Both capabilities are the queue's to grant and a level's to lock, and both may
change while the task is open: the provider republishes the task at the moment a permission
changes, and a command that arrives after its capability was withdrawn is refused, as **Task
capabilities** sets out. The provider knows which channels are the agent's and which were added;
the agent application sends the command and no channel list, and the provider rechecks ownership
when it acts.

`conference` `remove` takes one person off, named as the room names them, and the call goes on
for the rest; it is gated by `conference`, since it only means something with a third person on
the line. Removing the party leaves the agent with the colleague, a warm hand-over in reverse. A
remove that would leave the agent alone is not a remove but an `end-call`, and a provider answers
it `failed`.

**There is no transfer.** The agent hands the call to nobody, cold or warm: help arrives by
**Lead assist** in `guide/lead.md`, where a lead joins the call or takes it over, and a call that changes hands does
so on the platform's own routing -- an IVR return, a queue, a lead's take-over -- with the record
saying so in a `transferred` step and the `transfers` total. Nothing the agent commands moves the
caller to somebody else.

## Idle actions

### `dial(request)`

Starts one outbound call from the idle dialpad. It is present only when the voice provider
declares `dial`.

- `dialId` is the agent application's identity for this dial, minted before the request leaves.
- `destination` is the original number selected or entered by the agent.
- The provider holds `destination` to its declared `destinations`: under `contacts-only`, a
  number that is not one of its contacts answers `failed` with `omni.destination-not-permitted`.
- `dialling` says the request was accepted and the call is being placed, and restates the
  `dialId`. It says nothing about whether anyone will answer.
- `failed` contains a `ProtocolFailure` and confirms no call was placed.

The resulting call is offered through the normal `task-offered` event, and how the dial ended
arrives on `dial-outcome` under the same `dialId`. A `dialling` result does not manufacture a task
inside Omni.

## Every dial has an outcome

Four commands place a call: `dial()` from the idle dialpad, the `dial` command from preview, a
`conference` `add`, and `connect-back`. Each is accepted or refused at once, and each then ends later
and apart from its answer -- the destination picks up, is busy, or never does -- and a dial placed
late in a call routinely outlives the call. Nothing in between is reported: the wire says
`dialling`, then says how it ended, once.

**The agent application mints the identity.** Every command that dials carries a `dialId` the agent application made, unique
across the installation, and it travels four ways so no leg is a lookup:

```ts
declare const connection: Connection<"voice">;
declare const assignmentId: AssignmentId;

// 1. Out, minted by the agent application.
const result = await connection.execute({ assignmentId, command: { type: "conference", action: "add", dialId: "dial-7f2", destinationId: "tier2" } });

// 2. Back on the result, restated, so the agent application compares and confirms.
expect(result).toEqual({ status: "dialling", dialId: "dial-7f2" });

// 3. On the outcome, however late, against the task it belonged to.
const outcome: ProviderEvent<"voice"> = { type: "dial-outcome", dialId: "dial-7f2", assignmentId, destinationId: "tier2", outcome: "no-answer", reason: "No route to destination" };

// 4. In the record, so a dial made before a take-over is placeable by whoever holds the task now.
const step: TaskHistoryStep = { step: "unanswered", at: "2026-08-21T09:15:30Z", by: "A-12", dialId: "dial-7f2", destinationId: "tier2" };
```

The identity is a correlation handle between agent application and provider and **is never shown to the
agent**. An agent application holding several tasks places an outcome by the `dialId` it minted; one it did not
mint -- a dial made by the previous agent before a take-over -- it finds on the task's `onCall` or in
its `history`, which is why the steps that dial carry it. The `dialId` is not a retry key:
Omni never repeats a dial, and a command still carries no key for that purpose.

**`dialling` is the answer to a dial, and `applied` is not.** A command that dials answers
`{ status: "dialling", dialId }`, restating the agent application's identity (`result.dialId`,
`result.dialId.mismatch`); `applied` from such a command, or `dialling` from one that dialled
nothing, is refused (`result.status`). `validateResult(result, method, path, dialId)` takes the
`dialId` the agent application sent for that reason.

**The outcome is stated, once, either way.** A `dial-outcome` names the `dialId`, the task where
there was one, the directory item it went to where there was one, and how the dial ended -- from a closed
set: `answered`, `busy`, `no-answer`, `unreachable`, `rejected`, `cancelled`, `unexplained`.
`answered` is stated rather than read off somebody appearing on the call, because an agent application that infers
success cannot tell "reached" from "still ringing". `cancelled` is the dialler calling the dial off
before anyone answered -- the agent hanging up while a conferenced colleague still rings -- which is not a
`no-answer` the destination never gave. `unexplained` is the switch dropping the call with no cause among
those named here: a statement about the switch, sent instead of the nearest cause it did not give.
`reason` is the switch's own words, optional, and shown to the agent attributed to the switch rather
than to Omni. The two are different things and may travel together: a switch can say "could not
create dialog" in words and still name no cause a code would carry, so `unexplained` with a
`reason` is a dial the switch described but did not classify, and a desk renders the words without
inventing the class.

**`assignmentId` is the task the dial was placed on**, resolved from the dial's own identity and never from
whatever task the agent is looking at when the outcome arrives. That task may already have ended,
and the harness places the outcome all the same (`TaskStream`, `stream.dialOutcome.unknown`,
`stream.dialOutcome.duplicate`); an agent who moved on still learns nobody was reached, against the
call it belonged to and never against the next one.

The stream knows a dial from three places: `TaskStream.dialled(dialId)`, which an agent application calls when it
places one; an entry on a task's `onCall`; and a step in its `history`. Since a dialled entry
is listed from placement, `dialled()` is load-bearing only for a dial that never has an entry -- an
idle dialpad call, which has no task yet -- or whose entry has already left the room; an
outcome for a dial nobody placed and no task mentions is what `stream.dialOutcome.unknown` refuses.

**`answered` says what happened to the dial; `onCall` says who is in the room.** They are two
claims, and both are true at once when a leg answers and never joins. A desk shows `answered` as the
dial's conclusion and says "on the call" only when the person appears on `Task.onCall`; the obvious
reading of `answered` -- that they are on the line -- is the one it does not make.

**A provider says which outcomes it can tell apart.** No switch distinguishes all five, and a
provider that cannot tell busy from unreachable must not pick one. The manifest declares
`dialOutcomes`, and a `dial-outcome` carries only a declared member
(`event.dialOutcome.undeclared`). The list includes `answered`, or the provider could never state a
success (`manifest.dialOutcomes.answered`), and at least one other member, or it could never state
a failure (`manifest.dialOutcomes.failure`). `unexplained` is declarable only beside a cause the
provider does report -- `busy`, `no-answer`, `unreachable`, `rejected` or `cancelled`
(`manifest.dialOutcomes.unexplained.alone`): a provider that reports causes may honestly say the
switch gave none, while one that reports none would be sending the generic failure this set exists
to refuse. A provider that dials at all declares it: an idle
dialpad requires it (`manifest.dialOutcomes.required`), and a task that declares `connectBack`
or `conference` under a manifest without it is refused
(`task.capability.dialOutcomes.required`). Off voice nothing dials, and the field is a compile
error there.

**Who is on the call is stated on the task.** `Task.onCall` lists everyone the task's audio joins
right now, replaced whole with the task like every other field, and present when the provider
knows the room:

```ts
const onCall: OnCall[] = [
  { role: "party", since: "2026-08-21T09:12:00Z" },
  { role: "agent", userId: "A-12", since: "2026-08-21T09:12:04Z" },
  { role: "conferenced", destinationId: "tier2", dialId: "dial-7f2", stage: "joined", held: true, since: "2026-08-21T09:15:30Z" },
  { role: "conferenced", destinationId: "main-menu", dialId: "dial-3c9", stage: "ringing", since: "2026-08-21T09:16:02Z" },
];
```

`party` is the customer and `agent` a person by user id; neither was dialled from anywhere, so
neither carries a destination. A `conferenced` colleague was, so the entry carries the
`destinationId` of the directory item and, where an agent application's dial brought them, its `dialId`; a person
the platform added itself carries none. `held: true` is presence as claim. A snapshot establishes state, so an agent application that attaches
after a take-over reads the room from here rather than inferring it from a sequence of outcomes it
never saw.

**`onCall` describes this agent's current interaction.** When the caller disconnects but the agent
and added channels remain connected, the remaining room is still valid. When this interaction's
audio ends or the task enters `completing`, clear its `onCall` view; absence is used only by a
provider that never publishes the room. This does not assert that the caller, bridge or other
agents' channels ended. A published room receives a final empty view for this interaction, and the
task may remain open for wrap. Completion is a separate task action, not the caller's disconnect.

**A field that describes the present is cleared by the transition that ends it.** `onCall`,
`previewEndsInSeconds` and `atDeadline` are three instances of one shape, and there will be more: each
describes a state that is true now, and each is carried past the moment it stops being true by the
most natural implementation there is, building the next task by spreading the last one. The
provider's own state looks right, the claim on the wire is stale, and only the agent application sees it. An
adapter that builds each transition from what is true after it, rather than from what was true
before, needs none of these rules named. Two agents were
once shown on calls for the better part of an hour while callers queued, because the last message
describing the room live was never followed by one saying it had emptied, and every consumer that
derived anything from it was wrong in a way that looked like its own bug.

**A dialled entry is listed from the moment the dial is placed, not from the answer.** The entry is
what `conference` `remove` names, and a destination the agent cannot call off while it rings is a
customer kept waiting with no way back -- which is the very case `cancelled` exists for. The
`conferenced` entry appears with its `dialId` when the dial is placed, and a `conference` `remove`
naming a still-ringing `destinationId` calls that dial off, with `cancelled` as its outcome.

**The entry says where it stands.** A dialled entry carries `stage`: `ringing` until its dial is
answered, `joined` after. The `dial-outcome` is the transition and the stage is the state, the same
pairing as `task-audio-started` and `audio`: an `answered` outcome and the task restated with the
entry `joined` say one thing twice, and any other outcome removes the entry. The outcome comes
first: a `task-updated` that itself moves an entry from `ringing` to `joined` before an `answered`
outcome for its dial is refused (`stream.taskUpdated.stage`), as an update that moves `audio` is.
The rule keys on the entry's `dialId`, so an entry the platform added itself, with none, is one
whose move the stream cannot hold to an outcome: a clean stream proves nothing about ordering there. It is stated rather
than left to whoever placed the dial because that knowledge lives in one process: after a reload,
on a second session, or on a supervisor's screen the snapshot is the only source, and a room that
cannot tell ringing from joined says it contains someone who may never arrive. Nobody ringing is
held (`task.onCall.held.ringing`). A colleague who never answers is a dial that ended: the
provider restates the room without the entry, and the agent is back with the customer.

The desk shows a dial as placed on `dialling`, never as reached; shows the person in the room when
they appear on `onCall`; and shows the outcome, with the switch's reason, against the call it
belonged to -- with no retry, since a wrong number is not worth redialling and the decision is the
agent's.

## Independent task recording

Recording is voice-only. A task can arrive already recording, including while pending, and offer
no recording controls. The provider publishes only its own current state on
the provider field of the task’s `recording` state. The agent application publishes its own full scoped view in `HostReport.recordings`.
A provider task update cannot replace agent application state. Neither a capability nor an accepted command
establishes recording. Missing state, lost recorder observation, transport loss and expired
observation mean unknown; they never mean stopped. Paused means a recording remains open without
capturing. Task hold, task pause and recording pause are independent.

The per-task policy is `Task.capabilities.recording`, with independently optional provider and agent application
action sets. The outer capability may be locked. Absence grants no permission, and a state may
exist without any permission. A provider may offer only stop for a recording started automatically,
or withdraw a control on a later task update. There is no global recording mode and no automatic
start from a capability declaration. Agent application support is declared on `ConnectContext.host.recording`,
not the provider-owned manifest. The task names one of the storage places the agent application provisioned, by `storageId`;
an unknown storage place or an unsupported action is refused visibly, never redirected to provider
recording or a default upload location. Initial agent application support requires voice softphone audio and
capture of both local and remote audio; an agent application unable to capture either must refuse start/resume.
This package declares that contract; it supplies no recorder, audio mixing, storage or upload.

| Action | Required current recording state | Confirmed outcome |
| --- | --- | --- |
| start | inactive | active with a new recording identity |
| pause | active | paused, preserving recording identity and captured audio |
| resume | paused | active with the same recording identity |
| stop | active or paused | inactive; finish and retain captured audio |
| cancel | active or paused | inactive; abandon and discard captured audio |

Stop finishes the recording and retains captured audio. Cancel abandons the recording and discards
its captured audio; the task policy offers it with `cancel: true`. There is no configurable cancel
effect. A recorder that cannot confirm completion must not offer Cancel; it can offer Stop instead.
Cancel never means cancelling an in-flight start request or deleting arbitrary past recordings.
Stop can be applied only after finalization/retention succeeds; Cancel only after both cessation
and completion of this recording's audio succeed under the recorder's storage contract.
Partial success -- capture stopped but the storage outcome unknown, a start the recorder cannot
vouch for either way -- is a settled `failed`, under the code `omni.recording-unsettled`: the
command did not do what it promised, and the state the provider publishes with it is whatever
capture state is actually known. It is never `applied`, and never an unsettled promise the agent
application would be left to resync, since the provider knows exactly what it could not settle.
There is no request identity on a recording command: the outcome is the state, and what the
agent sees is the state. Retention is not a promise of sample-perfect audio.

Provider commands go exclusively to `Connection.execute`; agent application commands go exclusively to
`HostRecording.execute`. Both include the assignment and observation identities; all
non-start commands identify the particular recording. IDs are opaque and scoped by provider login,
task and recorder owner. They are never inferred from filenames or current agent identity. A
recording ID survives pause/resume and reassignment only where the same recorder confirms continuity;
commands always name the current assignment. A later start gets a different ID. Reconnect does not
create a new recording or fresh evidence. After lost continuity, use unknown until reconciled.
There is no automatic restart, hand-over to another recorder, or stop on task hold/disconnect.
Task removal does not prove recording stopped: outstanding agent application recorders remain tracked by the
agent application until its executor reconciles/finishes them, with visible unresolved cleanup failures.

Only start/resume require an in-progress or paused task with started audio. Pause/stop/cancel may
also finish an independently observed recorder while the task is completing. A pending task may
show active recording, but agent controls wait until interaction begins. The two recording paths may
both be active. A command to either path has no implied effect on the other.

Each confirmed observation has a fresh opaque observation identity, a canonical UTC millisecond
observation instant and an exclusive expiry. These times describe current evidence, never historical
capture boundaries. A trusted observer-domain current time must satisfy observedAt <= now < validUntil.
Use `effectiveRecordingState` with that explicitly trusted time; an unavailable clock yields unknown.
Receipt, replay and task publication never extend freshness. Clock discontinuity invalidates evidence;
consumers using the explicit recording-expiry clock-estimation exception must invalidate that
estimate and use monotonic aging so clock rollback cannot
revive expired evidence. The executor compares observation identity and recording identity against
its latest state atomically before I/O. An intervening observation or assignment change refuses the
stale command; it never acts on a replacement recorder. Providers lacking trustworthy current-state
identity or observation time publish unknown and offer no issuable controls.

Use `validateTask` and `validateTaskCommand` for published shape and static permissions.
Immediately before dispatch, additionally use `validateRecordingRequest` against the full current
task and explicit observer-domain time. For agent application commands also supply the current agent application declaration,
full agent application report and softphone context. The same checks must run at the executing boundary;
client validation alone is not authorization. The executor serializes operations on each recorder
and compares `observationId` and `recordingId` against its latest evidence before acting: a
command against superseded evidence is refused, and nothing is retried on the executor's own
account.

Keep command progress in agent application UI separately from authoritative state. Applied means the requested
recording transition and any retain/discard effect actually completed; publish the confirming task or agent application report before
resolving applied. Failed means confirmed no effect. Rejected promise means outcome unknown:
show the failure, reconcile that path and do not automatically retry or pretend inactive. Authoritative
updates remain full current task/agent application views, not replayed provider events. These current-state fields
create no interaction-history entries and infer no actors, durations or historical capture boundaries.

Migration is explicit: replace the old true recording capability with per-path action policies,
replace untargeted commands with scoped commands, and retain protocol version 1. During pre-release
development, hosts and adapters must align their recording contracts; negotiation does not detect
differences between package revisions that share that protocol number. No legacy-shape fallback is provided.
This change does not publish a package or enable recording in any existing agent application/provider by itself.

`validateRecordingOutcome` checks confirming observations against recording-specific applied/failed
semantics, including pause/resume identity and rejection of a dialling result. It cannot prove audio
retention/completion or source truth from a status flag; those remain executor obligations.

The storage place named on the task is bound when start actually creates a recording. Existing recordings
keep that binding through pause/resume/stop/cancel; a later policy cannot redirect their stored audio.
The executor rejects a mismatched storage place rather than moving or discarding another binding.
Action permission does not authorize unattended invocation: agent application controls require the agent's explicit
act, and provider authorization remains enforced at its authenticated command boundary.


Recording dispatch must receive the same known task-validation context as the published task.
Pass organisation levels and other known restrictions through the optional fourth argument of
`validateTaskCommand`, and through `taskContext` in `validateRecordingRequest`. This keeps a valid
custom organisation lock from being rejected against the default ladder, and prevents known
capability restrictions from disappearing at dispatch. The standalone `validateRecordingCommandState`
requires an affirmative permission; false, malformed permission declarations and unknown actions grant nothing.


### Agent application recording announcements to the caller

`HostRecording.announcesToCaller`, when true, is a guarantee that the agent application delivers audible recording
status messages to the remote party over the call's outgoing audio. It belongs inside the optional
agent application recording capability: without that capability there is no such guarantee. Omission makes no
promise; false is invalid. It does not belong in the provider manifest, the task's recording policy
or the general `HostGuarantees` object. A provider can inspect this agent application guarantee when deciding
whether to permit agent application recording on a task.

The guarantee applies only to agent application-owned recordings. Providers implement announcements for their
own recordings at their end; provider state updates must not cause the agent application to announce those
recordings. Both recorders can operate independently on the same call.

On a confirmed agent application start, the remote party hears that recording started. On a confirmed stop or
cancel, they hear that recording stopped. If pause/resume is supported, say paused/resumed so a
pause is not presented as a finished recording. Announcements follow actual capture transitions,
not button clicks, accepted requests or task-policy changes. When attaching to an already-active
agent application recording, announce that recording is active, without inventing its original start time.
Repeated observations of the same state do not repeat announcements. Unknown or expired evidence
must never produce a stopped announcement.

A local sound, UI indicator, screen-reader message to the agent, or sound leaking through the
microphone does not fulfil this guarantee. The agent application must deliver the message directly in the audio
sent to the remote party, even when the agent microphone is muted. It may also notify the agent.
Only declare the guarantee when the agent application can provide that outgoing audio path. An announcement
that cannot be delivered, including after the remote party has disconnected, is a visible failure;
never claim delivery or replay the notice into a different call.

For a command under this guarantee, applied requires both the recording action and its announcement
to succeed. If capture changes but announcement delivery fails, publish the actual recording state,
report the announcement failure visibly and answer `failed` under `omni.recording-unsettled`. Do not claim no
effect, automatically repeat the recording action or silently switch to an agent-only notice.

`validateHostRecording` checks the declaration, including its true-or-absent guarantee. Actual audio
delivery remains the agent application implementation's responsibility and must be exercised in its own tests.
