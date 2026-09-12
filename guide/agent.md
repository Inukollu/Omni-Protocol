# `@xema/omni-protocol`: The agent's work

What an agent does on any channel: the assignment from offer to wrap, the task and its record, the controls a task offers, the commands the desk sends. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Task assignment lifecycle

The task-assignment lifecycle has five ordered stages:

**1. The agent signs in.** Nothing on the wire says ready or not-ready: the agent is not ready
until the agent application has stated a capacity, and ready once it has. A provider assigns nothing before a
capacity is stated, and needs no other word for it.

**2. The agent becomes ready.** The agent application states the capacity when its local policy says: at once,
or when the agent presses Ready. A successful connection, a healthy provider, or the absence of a
break does not imply readiness. After that, an agent stops taking work on this provider only by a
break under `capabilities.breaks`, or by the agent application restating `count: 0` -- which is how
a forced break on another provider reaches this one; a login that declares no breaks has no
not-ready of its own, and `count: 0` is the agent application's division of capacity, not the
agent's choice.

**3. Omni states their concurrent capacity.** Only now does Omni ask providers for work, saying how
much the agent can take at once. It is a standing declaration rather than a poll: Omni restates the
capacity every time it changes, in either direction, and does not ask again while that value holds.
Silence keeps the last one in force, so a provider that waits to be asked a second time will never
deliver again once it has gone quiet. Hold the capacity and deliver when work arrives.

**4. A provider offers a task.** The provider emits `task-offered` within the stated capacity, and
the task is `pending`: an offer introduces work nobody has accepted, so it is the only phase an
offer introduces (`event.taskOffered.phase`). `confirmed`, `preview` and the rest are reached from
it, or carried on a snapshot.

**5. Omni decides how the task is accepted.** When `autoAcceptTasks` is `false`, every task requires
agent acceptance. When it is `true`, the pending task's `acceptance` states the provider's
intent.

### Acceptance modes

During login, Omni sends the agent's `autoAcceptTasks` value to the provider. When it is `true`, the
provider states `acceptance` on each pending task — on the task rather than the offer, so a
reconnect snapshot says it too and an offer the agent application never received is not accepted on the
person's behalf for want of a word:

| Directive | Contract |
| --- | --- |
| `no-preference` | The provider leaves acceptance to Omni; with `autoAcceptTasks: true`, Omni accepts automatically. |
| `consent` | The provider requires the person's explicit consent: Omni presents **Accept** and waits, whatever its own policy would have done. An agent application that declares `guarantees.personConsent` promises exactly this; a provider checks it before offering work only a person may take. |
| `automatic` | Omni accepts immediately without agent interaction. |

When Omni sent `autoAcceptTasks: false`, the provider omits `acceptance` and every task the
queue routes requires agent acceptance. The two are never confused on the wire: `consent` is always the
provider's requirement, stated on a wire where Omni was willing to accept for the agent; Omni's own
no-auto-accept policy puts no word on the wire at all — the field is absent, and the **Accept**
press is Omni's doing, not the provider's.

**The value is stated, never assumed.** `autoAcceptTasks` is required of every connection: a
agent application says which policy the deployment provisioned, and a validator that is not told checks
neither rule rather than guess the permissive one (`task.acceptance.required` and
`.unexpected` fire only against a stated value). `acceptance` is the provider's own control and
outranks the policy: `consent` puts the decision back in the agent's hands for any task where it
belongs, whatever the agent application was configured with.

An automatically accepted task still arrives through `task-offered`.

**Work the agent originated is accepted by the command that created it.** A task born of the
agent's own act — a dialpad call or a connect-back, recognisable by the agent application's `dialId` on
`onCall`; a call a lead took over, carrying `takenOver` — arrives
through `task-offered` with `acceptance: "automatic"` whatever `autoAcceptTasks` says, and the
validator holds it there under either local policy and under none (`task.acceptance.originated`):
the desk shows no **Accept** for a call the agent placed. The local policy governs work the queue
routes to the agent, and nothing else.

### Pending

A task in the `pending` phase has been **offered to the agent and not yet accepted**. Omni applies
`autoAcceptTasks` and the task's `acceptance` to decide whether acceptance is
automatic or requires the agent. A provider that requires automatic acceptance still emits
`task-offered`; it does not introduce new work as `in-progress`.

```ts
declare const task: Task;

const assignment = {
  type: "task-offered",
  task: { ...task, phase: "pending", acceptance: "consent", expiresInSeconds: 30 },
} satisfies Extract<ProviderEvent, { type: "task-offered" }>;
```

The rule the phase exists to express: **nothing is acquired on the agent's behalf while a task
is pending.** An agent application that carries audio must not open the microphone until the task is
accepted. Omni does not open the task's browsers either — a task that rings out costs nothing.

When consent is required, Omni offers the agent an **Accept** control. The call is the
medium the task arrives on, not a separate decision.

**Once a task is accepted, the call that comes with it is answered.** Omni has no discretion
there and the provider is not consulted twice: one decision about the work, and the medium
follows it. Where the audio lands was settled at sign-in — in Omni on a softphone, on the handset
on a desk phone — and is not in question per call. See **How the agent hears the call** in `guide/phone.md`.

Automatic acceptance still begins with `task-offered`.

`expiresInSeconds` is how long the offer has left, in whole seconds from the publication that
carries it. It rides on the pending task, as `acceptance` does, so a reconnect snapshot restates
it from what is actually left; it belongs to `pending` alone and is gone once the task is accepted
(`task.pending.expiresInSeconds`, `.unexpected`). Where present, Omni counts down from receipt and
stops offering **Accept** once it runs out; the provider ends the lapsed offer with `task-ended`
and an `expired` outcome naming `pending`, since nobody cancelled it. **Omit it unless the provider can observe it.** A provider that reports only elapsed
ring time after the fact cannot say how long an offer has left, and a computed value would have
Omni withdraw **Accept** from a task still pending.

**A deadline is seconds left, never an instant.** The agent application and the provider keep
different clocks, and a countdown that compares one against the other is a countdown that runs
fast or slow by their skew. Seconds from the publication that carries them are the provider's own
arithmetic, counted down on the desk from the moment they arrive, and the transport delay is the
only error. Restated on every publication that carries them, so a snapshot after a reconnect
starts the countdown afresh from what is actually left (`task.pending.expiresInSeconds`,
`task.preview.previewEndsInSeconds`: a whole number, zero or more).

A preview's deadline is not on the offer. It travels on the task, as `previewEndsInSeconds` with
`atDeadline`, so a snapshot carries it too -- see **Preview: the agent presses Call** in `guide/voice.md`.

A provider may withdraw a pending task by emitting `task-ended` with a `cancelled` outcome, `by:
"provider"`. **`cancelled` says who called the work off**, as `completed` says who completed it:
`agent` for a decline, `provider` for a withdrawal or a re-route, `party` for a caller who abandoned
the ring. One word for the three left a supervisor's record unable to tell them apart, so `by` is
required and closed (`event.taskEnded.outcome.cancelled.by`). An offer nobody acted on while
`expiresInSeconds` ran is not cancelled by anyone: it lapses, and ends `expired` naming `pending`.

### Tasks already in progress

The provider does not introduce new work as already `in-progress`.

A task appears already `in-progress` only in a snapshot taken after a reconnect or a resync,
reporting work that began earlier in this login and never stopped. A fresh login has none to
report: nothing has been assigned yet, and work the agent was working elsewhere is not carried
into a new session.

## Tasks

### `Task`

`Task` is the provider-owned description of one task presented to Omni.

`task-offered` introduces a new task and does not imply acceptance.

`Task<C>` is channel-discriminated. For example, `Task<"email">` accepts
`browsers` and `outcomes`, but rejects voice-only controls such as `hold` and `endCall` at compile
time. Runtime conformance checks also require the task channel to match its provider manifest.

| Field | Contract |
| --- | --- |
| `assignmentId` | Required `AssignmentId`: the assignment this task is the record of, and its one identity. Issued by the provider, unique within the provider, never reused. Every event, command and report that names a task names it by this, so a late dial outcome or a late history report for one customer never lands on the next. The stream refuses an assignment introduced twice (`stream.taskOffered.duplicate`) and an audio or ending event naming one that has ended or that nobody has seen (`stream.assignment.ended`, `.unknown`); a `dial-outcome` may name an ended assignment, since a dial placed late routinely outlives its call, and the agent application routes it there. See **A task's life on the wire**. |
| `title` | Agent-facing task title. |
| `channel` | Channel used for this task. It must equal the source provider's manifest channel. |
| `taskType` | Required provider-defined source or category of work, such as a voice `Queue Name`, `Mailbox Folder`, `Chat Source`, `Support`, `Billing`, or `Returns`. |
| `capabilities` | Controls and workspace features available for this specific task. |
| `capabilitySource` | Required. Who chose the capabilities: `queue` when somebody configured these terms, `nobody` when nothing handed the work over -- an agent's own outbound -- and `not-yet-read` when a queue was named and its terms could not be read, in which case `capabilities` is what the provider will honour, not what the platform permits. An agent application shows `not-yet-read` where the agent works. See **Task capabilities**. |
| `browsers` | Named browser definitions for the task workspace: at least one when the task declares the `browsers` capability, empty when it does not. |
| `party` | The person or entity on the other end of this task, as a `Contact`: often a name and one address; a withheld caller ID may leave nothing to send at all. Optional. The party is who the task is *with*; `contacts` is the directory. |
| `phase` | Current canonical task phase: `pending`, `confirmed`, `preview`, `in-progress`, `paused`, or `completing`. `preview` is voice only. |
| `audio` | Voice only. The task's real-time audio as the provider holds it: `started` while audio is attached, `ended` once it ended, omitted while none is. The provider's word — see **`task-audio-started`** in `guide.md`. Audio names a task whose work has begun, or whose party the agent application is dialling: on a `pending`, `confirmed` or `preview` task with nobody ringing it is refused (`task.audio.beforeWork`), on a snapshot as on the event, since an agent application opens the microphone on it; with the party ringing by an agent application dial or provider-triggered preview dial, actual ring-back audio may precede answer. |
| `acceptance` | How this offer is accepted — `no-preference`, `consent`, or `automatic` — stated on the pending task so a reconnect snapshot says it too. Required while `pending` when `autoAcceptTasks` was `true`, forbidden when it was `false`, and absent past `pending`. See **Acceptance modes**. |
| `expiresInSeconds` | In `pending` only: how long the offer has left, in whole seconds from this publication, restated on every publication that carries it. Absent, the offer stands until the provider says otherwise. See **Pending**. |
| `previewEndsInSeconds` | Voice only, in `preview`: how long the preparation has left, in whole seconds from this publication, restated on every publication that carries it. Absent, the agent has as long as they need without a preparation countdown. Always with `atDeadline`. See **Preview: the agent presses Call** in `guide/voice.md`. |
| `atDeadline` | Voice only, in `preview`, with `previewEndsInSeconds`: what the system does when it runs out -- `provider-dials` makes the provider initiate dialing, `host-dials` makes the agent application issue Call, `waits` keeps the task in preview awaiting the agent. |
| `reference` | Optional agent-facing reference such as a case, call, conversation, ticket, or message number. It is distinct from the protocol `id`. |
| `completionMode` | `agent-command` waits for the channel's `complete` command; `provider-automatic` completes without one, and takes the agent's `complete` as finishing early. A required outcome is the agent's to give, so it needs `agent-command` (`task.outcomes.required.mode`). |
| `wrapAllowance` | Fixed time allowed to complete the task after primary interaction ends. For real-time audio, it begins after `task-audio-ended`. Required under `provider-automatic`, where the provider acts on it. Optional under `agent-command`: omitted says the provider imposes no deadline, and Omni counts nothing down; stated, it is the expected wrap, shown and never acted on. `0` under `provider-automatic` is no wrap at all, so such a task publishes no `outcomes` (`task.outcomes.wrapAllowance`). |
| `wrapEndsInSeconds` | In `completing`, wherever `wrapAllowance` is stated: how much of the wrap is left, in whole seconds from this publication, restated on every publication that carries it (`task.completing.wrapEndsInSeconds`, `.required`, `.unexpected`). A reloaded desk and a lead's screen count down the same number. See **Completion timing**. |
| `attributes` | Optional ordered, typed `TaskAttribute` entries with keys unique within the task. Each contact or timestamp is a separate array item; new attribute shapes require new union members. |
| `history` | The call record: `steps` — the ordered interaction history of this open task, one entry per occurrence, oldest first — and what they add up to before this agent, `interactionSeconds`, `holdSeconds`, `queueSeconds`, `transfers`, each present when the provider knows it. Live task data restated with the task, not a permanent archive. See **Interaction history**. |
| `onCall` | Voice only. Who is on the call, or being brought onto it, as the provider states it, replaced whole with the task: `party` is the customer -- carrying a `stage` while being dialled again on the same task, a connect-back with the agent application's `dialId` or a platform's callback without, ringing from the moment the dial is placed and joined on its answered outcome --, `agent` a person by user id, `conferenced` somebody a dial is bringing in, listed from the moment the dial is placed -- with the `destinationId` dialled, the `dialId` where an agent application placed it, the `stage` reached (`ringing` until answered, `joined` after), and `held: true` on anyone joined and parked. `label` names a destination -- a person, a queue -- not a phrase; the agent application supplies the verb. Present when the provider knows the room, absent when it does not. See **Every dial has an outcome** in `guide/voice.md`. |
| `leadAssist` | Voice only. Present from the agent's request for a lead until the lead leaves or the request ends: `requested` while nobody has joined, `joined` with the lead's `leadId` once somebody has. See **Lead assist** in `guide/lead.md`. |
| `takenOver` | Voice only, on a task that reached this agent by a lead's take-over: which member the call was taken from, and when. It is an ordinary assignment with the call's history, offered whatever break the lead is on and counted against their capacity like any other call. See **Lead assist** in `guide/lead.md`. |

`TaskAttribute` entries carry typed detail alongside the task:

```ts
const attributes: TaskAttribute[] = [
  {
    key: "related-contact",
    label: "Related contact",
    type: "contact",
    party: { name: "Asha Rao", number: "+919876543210" },
  },
  {
    key: "answered",
    label: "Answered",
    type: "timestamp",
    at: "2026-08-27T09:30:00.000Z",
  },
];
```

`key` is the stable machine identifier and must be unique within the task's `attributes` array.
`label` is the optional agent-facing name.

The canonical task transitions are:

| From | Decision or event | To |
| --- | --- | --- |
| No task | Provider assigns a task | `pending` |
| `pending` | Task is accepted | `confirmed` |
| `confirmed` | The customer's record is put in front of the agent before any call goes out (voice) | `preview` |
| `confirmed` | Work begins | `in-progress` |
| `preview` | Agent presses Call (`dial`) and the customer answers, or the deadline `provider-dials` and they answer | `in-progress` |
| `preview` | The call goes out and nobody answers | `completing` |
| `preview` | The preparation target passes with `atDeadline: "waits"` | Remains `preview`, waiting for the agent to press Call |
| `pending` | Provider withdraws the assignment, the agent declines, or the party abandons the ring | Removed by `task-ended` with `cancelled` outcome, `by` saying which |
| `pending` | The offer's `expiresInSeconds` runs out | Removed by `task-ended` with `expired` outcome naming `pending` |
| No task | Snapshot reports work already underway | `in-progress` |
| `in-progress` | Provider or agent pauses the task | `paused` |
| `paused` | Provider or agent resumes the task | `in-progress` |
| `in-progress` or `paused` | Contact interaction ends and follow-up work remains | `completing` |
| `completing` | Agent connects back to the party (`connect-back`) | `in-progress` |
| Any phase | Provider emits `task-ended` | Removed |

#### A task's life on the wire

A task has one name, the assignment it is the record of, and the provider issues it. Platforms
reuse their own handles: a closed one is retired minutes later, a requeue takes seconds, and on
one platform a call was offered twice, thirteen seconds apart, under one handle, through a close
and a re-offer. Everything that names a task after the fact -- a dial outcome, an audio event, an
ending, a history report, a command -- would land on whichever assignment is open when it arrives.
So the assignment id is unique within the provider and never reused: where the platform's handle
never comes back, the adapter passes it through; where it does, the adapter mints the assignment id
and keeps the mapping, and the desk never learns which. A late event finds the assignment it
belongs to or is refused, and a task-scoped browser session (`PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME`)
lives one assignment, never the next customer's cookies. A dial the agent application placed was
already safe, since its outcome is placed by the agent application's own `dialId`; where the
assignment earns its place is everything the agent application does not mint --
`task-audio-started`, `task-audio-ended`, `task-ended`, a `recordStep` naming a task -- any of which
would otherwise find the next customer under a reused handle and act on them. A minted id is part
of the task the adapter keeps, not a field held in memory beside it: it lives in the login's
`store` with the task, or is derived from a platform handle that itself never reuses, so a rebuilt
adapter comes back with the same assignment on the same task, or every late event it was minted to
catch mismatches and the second adapter's snapshot no longer carries the task (`drive.reload.snapshot`).

Assignment, acceptance, and progress are distinct. Acceptance follows `autoAcceptTasks` and the
task's `acceptance`, moving the task from `pending` to `confirmed`. The provider reports
subsequent transitions to `preview` or `in-progress`; Omni does not infer them from the acceptance
command.

#### Completion timing

`completionMode` determines how completion is triggered. With `agent-command`, the provider keeps
the task open until Omni sends the channel's `complete` command. With `provider-automatic`, the
provider may complete the task without receiving that command.

**The agent may finish early under either mode.** `complete` is issuable wherever there is a wrap
to cut short: under `agent-command` it is the end, and under `provider-automatic` it says the agent
is done before the allowance ran out, and the provider is free to end the task at once. Only a task
with no wrap at all -- `provider-automatic` with `wrapAllowance: 0` -- has nothing to complete, and
the command is refused there (`command.complete.wrapAllowance`). An ending the agent asked for says
so, `completed` with `by: "agent"`, whichever mode the task was under.

**A required outcome is the agent's to give.** A task whose `outcomes` says `required: true` waits
for a code the agent chooses, so it completes on the agent's command: `provider-automatic` cannot
wait for it, and the pair is refused (`task.outcomes.required.mode`). Optional outcomes may ride on
a task the provider completes itself; the agent gives one if in time. And a code is given in wrap,
so a `provider-automatic` task with `wrapAllowance: 0` publishes no `outcomes` at all
(`task.outcomes.wrapAllowance`).

**The allowance means one thing per mode.** Under `provider-automatic` it is what the provider
acts on: the task ends when it runs out. Under `agent-command` it is the expected wrap, stated so
the agent can see it: the desk counts it down and, past zero, shows how far over they are, and
nothing acts on it -- the task waits for `complete` however long that takes, with its outcomes
collected whenever the agent gives them. A provider that would end the task at a time is
`provider-automatic`.

**What is left travels with the task.** The allowance is the length; `wrapEndsInSeconds` is how
much of it remains, stated on the `completing` task and restated on every publication that
carries it, as `previewEndsInSeconds` is on a preview. A desk that reloads mid-wrap finds the
number on the snapshot; a lead's screen finds it on the member; neither starts a clock of its own,
and both count down from receipt. Under `provider-automatic` the provider ends the task when it
reaches zero; under `agent-command` it is the expected wrap left, `0` once overrun, and nothing
acts on it. Off voice, where `completing` is the provider's word that interaction ended, the field
arrives with that word, so the clock starts nowhere else.

`wrapAllowance` is fixed, and when it starts depends on whether the channel carries real-time
audio:

| Channel | Wrap allowance starts at |
| --- | --- |
| Voice and any channel with real-time audio | The `task-audio-ended` event |
| Chat | The `task-updated` that moves the task to `completing`: the provider's word that the conversation is closed on its side; what is left arrives on that publication as `wrapEndsInSeconds` and is counted down from receipt |
| Email | The `task-updated` that moves the task to `completing`: the provider's word that the platform has accepted the outgoing message; what is left arrives on that publication as `wrapEndsInSeconds` and is counted down from receipt |
| Other non-audio channels | The `task-updated` that moves the task to `completing` |

**Off voice, `completing` is the provider's word that interaction ended.** There is no audio event to
carry it, so the phase does; an agent application starts the wrap clock at that publication and nowhere else. It
is optional: a conversation with nothing to wrap moves from `in-progress` to `task-ended` and
`completing` is never published. Under `provider-automatic` with a non-zero `wrapAllowance` it is
required, because the clock has to start somewhere: a chat or email task the provider completes
from `in-progress` with an allowance to run gave the agent none of it, and the stream refuses the
ending (`stream.taskEnded.unwrapped`); an ending the agent's own `complete` brought forward says
`by: "agent"` and is not that. Under `agent-command` the agent's `complete` is the end, from
`in-progress` or from `completing` alike.

```ts
const emailCompletion = {
  completionMode: "agent-command",
  wrapAllowance: 120,
} satisfies Pick<Task<"email">, "completionMode" | "wrapAllowance">;
```

In this example, the agent has two minutes after sending the email to add notes, select a
outcome, and complete the task.

`0` means no wrap under `provider-automatic`: the provider completes the task at the end of the
interaction, and `complete` has nothing to cut short. Under `agent-command` it is an expected wrap
of nothing -- the desk shows the overrun from the start -- and the task still waits for `complete`.

There is no value meaning "unlimited", because a number that is not a duration would be read as
one. A provider that imposes no deadline says so by **omitting** `wrapAllowance`, which
only `agent-command` permits: the provider will not complete the task itself, so there is nothing
for a deadline to trigger, and Omni counts nothing down. **Omitted and empty are different
claims** applies -- omitted says there is no deadline to see, where `0` says the deadline is now.
Under `provider-automatic` the field is required, because the provider is going to act on it.

```ts
const untimedWrap = {
  completionMode: "agent-command",
} satisfies Pick<Task<"voice">, "completionMode" | "wrapAllowance">;
```

Here the customer has hung up, `task-audio-ended` has been sent on time, the task is `completing`,
and the agent takes as long as the work needs. Moving the task to `completing` late to avoid a
deadline is not an alternative on an audio channel: the clock starts at a real event, and delaying
that event would falsify the phase and everything timed from it.

### History

The record is the call's, not the task's: most of what it holds happened before this agent, and
`queued` and `offered` are not interactions at all, so the field is `history` and its types are
`TaskHistory`, `TaskHistoryStep`, `HistoryStep`, `HistoryReport` and `HistoryReportResult`.
*Interaction* keeps the one meaning **Terms** in `guide.md` gives it, the agent's time on the call, which is why
the total of earlier agents' time is `interactionSeconds` and the phase rules are
`command.phase.interaction`. Hosts and providers adopt these names together; no legacy aliases
are provided. The manifest's `settleMs` bounds final task completion, not entry into
the `completing` wrap-up phase, and bounds an applied `schedule` the same way. The `recordStep` method and `complete` command keep their names.

Migration from the earlier spellings:

| Former API | Current API |
| --- | --- |
| Task.handlingHistory, Task.interactionHistory | `Task.history` |
| TaskHandlingHistory, TaskInteractionHistory | `TaskHistory` |
| TaskHandlingStep, HandlingStep, TaskInteractionStep, InteractionStep | `TaskHistoryStep`, `HistoryStep` |
| HandlingReport, HandlingReportResult, validateHandlingReport, and their Interaction spellings | `HistoryReport`, `HistoryReportResult`, `validateHistoryReport` |
| HANDLING_STEPS_WITH_A_PERSON, HANDLING_STEPS_THAT_DIAL, and their INTERACTION spellings | `HISTORY_STEPS_WITH_A_PERSON`, `HISTORY_STEPS_THAT_DIAL` |
| handlingStepExpectsAPerson, handlingStepDials, and their interaction spellings | `historyStepExpectsAPerson`, `historyStepDials` |
| handleSeconds | `interactionSeconds` |
| Task.allocationId, AllocationId, allocationExpiresAt | `Task.assignmentId`, `AssignmentId`, `expiresInSeconds` |
| Task.id, TaskId, and `taskId` on every event, command, report and lead request | gone: a task is named by `assignmentId` alone, and `assignmentKey(providerId, assignmentId)` scopes it |
| taskKey, omni.task-not-found, PROVIDER_NAME__TASK_ID__TAB_NAME (ProviderName.TaskId.TabName) | `assignmentKey`, `omni.assignment-not-found`, `PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME` (`ProviderName.AssignmentId.TabName`) |
| Manifest.disposalSettleMs, Manifest.completionSettleMs | `Manifest.settleMs` (`manifest.settleMs`, `manifest.settleMs.renamed`): the bound after `applied` for `complete` and `schedule` alike |
| the call command, atDeadline calls and host-calls | `dial`, `"provider-dials"`, `"host-dials"` |
| media: task-media-started/-ended, team-media-*, Task.media, TaskMediaState, openMedia, OpenMediaRequest/Result, VoiceMediaSession and its session field | audio: `task-audio-started`, `task-audio-ended`, `audio` on the task, `TaskAudioState`, `openAudio`, `OpenAudioRequest`, `OpenAudioResult`, `CallAudio` on the result's `audio`; there is no team audio, the lead's follows `listening` on the member |
| capabilitySource values ungoverned and undetermined | `nobody`, `not-yet-read` (`capabilitySource.notYetRead`) |
| Snapshot.scheduledActivities, and scheduledActivities on calendar-updated | `calendar` in both |
| availability reserved | `elsewhere` |
| recording destinationId, HostRecording.destinationIds | `storageId`, `storageIds` (`recording.storage`, `recording.host.storage`) |
| coldTransfer, warmTransfer, the transfer command and its four actions, the consulted role, the transferred outcome | gone: help arrives by **Lead assist** in `guide/lead.md`; the `transferred` history step and the `transfers` total stay, since the platform's own routing still changes hands |
| assignmentExpiresAt on task-offered, previewEndsAt on the task | `expiresInSeconds`, `previewEndsInSeconds`: seconds left from the publication, never an instant (`event.taskOffered.expiresInSeconds`, `task.preview.previewEndsInSeconds`) |
| TeamMembers.requests, LeadRequest | `TeamMember.request` (`MemberRequest`): the ask rides on the member (`team.member.request.*`) |
| team-updated on every change | `team-updated` whole once after the switch and on snapshots; `team-member-updated`, `team-member-removed`, `team-policies-updated` after (`stream.team.baseline`, `stream.teamMember.unknown`) |
| RecordingCommand.requestId | gone: no request identity; a partial effect is a settled `failed` under `omni.recording-unsettled` |
| command.complete.mode | `command.complete.wrapAllowance`: `complete` under either mode, refused only on `provider-automatic` with no wrap |
| expiresInSeconds on task-offered | `Task.expiresInSeconds`, in `pending` (`task.pending.expiresInSeconds`, `.unexpected`; `event.taskOffered.expiresInSeconds.unexpected`) |
| the expired outcome naming preview | gone: nothing expires a preview; withdrawn, it is `cancelled` by the provider |
| schedule on voice alone | `schedule` on every channel, under a manifest that declares `calendar` (`task.capability.calendar.required`), bounded by `settleMs` (`drive.schedule.unsettled`) |
| a forced break requesting breaks on the other providers | `setCapacity({ count: 0 })` on every other usable provider (`assertForcedBreakStopsTheRest`) |
| end-forced-break on a break the platform imposed | refused: `team.command.endForcedBreak.provider`, `omni.break-forced-by-provider` |
| ForcedBreak.expectedDurationMs | `expectedEndsInSeconds`: seconds left, restated (`break.forced.expectedEndsInSeconds`, `.expectedDurationMs.renamed`); the command keeps `expectedDurationMs` |
| MemberShift; the day on the lead's list alone | `Shift`, on `Snapshot.shift` and `shift-updated` for the agent, on `TeamMember.shift` for the lead |
| TeamMember.listening as this lead's one entry | `MemberListening[]`, every lead's, each with `leadId` (`team.member.listening.leadId`, `.unique`, `.empty`, `.entry`, `.heard`) |
| a member's history trimmed on the lead's list | the record whole, as the member's desk holds it |
| durations counted from the screen's clock | the provider's: `timeCheck` required of a provider publishing a running instant (`manifest.timeCheck.required`), `Snapshot.providerTime` with it (`snapshot.providerTime`, `.unexpected`) |
| a wrap the desk timed from an event's receipt | `Task.wrapEndsInSeconds` in `completing`, restated (`task.completing.wrapEndsInSeconds`, `.required`, `.unexpected`) |
| MemberTask.capabilities, capabilitySource, browsers | gone: the workspace never travels to a lead (`team.member.task.workspace`); the record and the completion terms do |
| a member republished on a hold, a mute, a take-over | on every publication of the member's task to the member |
| two clients on one login | the later wins; the first is ended with `recovery: "displaced"` |
| the phone unspoken | `PhoneState` -- the device, its mute, its channels -- on `Snapshot.phone`, `phone-updated` and `TeamMember.phone`, from a manifest declaring `phoneStatus` (`snapshot.phone.required`, `.unexpected`, `phone.*`, `phone.channel.*`, `event.phone.capability`) |
| the agent's readiness for the next call read into setCapacity | the agent's own queue: `capabilities.nextCall`, `requestNextCall`/`cancelNextCall`/`releaseLinedUp`, `Snapshot.nextCall` and `linedUp`, the `next-call` and `lined-up` events (`snapshot.nextCall.idle`, `nextCall.*`, `linedUp.*`) |

Update producers, consumers, saved task snapshots, and validation-rule assertions together.
History and report rule names use `history` and `historyReport`; assignment rules use
`assignment` (`task.assignmentId`, `stream.taskOffered.duplicate`, `stream.assignment.ended`);
phase and conformance rules use `interaction` and final-task rules use `completion`. The former
fields are refused even when the new field is also supplied (`task.history.renamed`,
`task.assignmentId.renamed` for a task's `id` or `allocationId`, `event.assignmentId.renamed`,
`command.request.assignmentId.renamed` and `historyReport.assignmentId.renamed` for a `taskId`).


`Task.history` is the call record: the steps that brought the task to the agent, oldest
first, and what they add up to before this agent:

```ts
history: {
  steps: [
    { step: "queued",      at: "2026-08-21T00:59:00Z", seconds: 41 },
    { step: "answered",    at: "2026-08-21T00:59:41Z", seconds: 312, by: "a-17" },
    { step: "held",        at: "2026-08-21T01:02:10Z", seconds: 35, by: "a-17" },
    { step: "transferred", at: "2026-08-21T01:04:53Z", by: "a-17" },
    { step: "answered",    at: "2026-08-21T01:05:02Z", by: "a-23" },
  ],
  interactionSeconds: 312,   // handled by others before this agent
  holdSeconds: 35,      // holds others put the caller on
  queueSeconds: 41,     // waiting before anyone answered
  transfers: 1,         // hands the call has changed
}
```

**This is not an archive.** It is live data about a task that is still open: it travels with the task
to whoever holds it next and ends when the task does. Nothing stores it, nothing queries it, and
there is no archive behind it. A provider that keeps a record of *completed* contacts is describing
something else, which will arrive under its own name and must not be folded in here.

It rides in the snapshot and is replaced whole like everything else there.

Steps are `queued`, `offered`, `answered`, `held`, `muted`, `transferred`, `conferenced`,
`unanswered`, and each is defined on `TaskHistoryStep`.

**The record is one entry per occurrence, oldest first.** Each hold is its own `held` entry — `at`
when it began, `seconds` once it ended and omitted while it runs — and a second hold is a second
entry after the first, never a revision of it. A leg that has ended states its duration, and the
task says whether a leg can still be running: a hold runs only while the task is `paused`, a mute
only while its audio is up, so a `held` entry without `seconds` on a task that is not paused, or a
`muted` one on a call that is over, is a leg nobody closed and reads exactly like a leg running now
(`task.history.held.open`, `.muted.open`). Whoever performs the leg closes it — the
provider whose platform parks the caller, the agent application whose microphone it is — by restating the entry
with its duration, and **an entry that cannot be closed is not written**: open for ever is a
plausible nought one level down from a total. **A leg still open when the audio ends is closed by
the provider**, at that instant, in the same publication that says the audio ended: the provider
is the one that knows the instant, and the agent application can only learn of it afterwards. Agents end calls
muted, so the agent application's leg is routinely open at audio end; the provider closes it with the duration
from the leg's `at` to the audio's end, and the agent application's own closing report for that leg, which
follows what it hears, is answered `recorded` and changes nothing, the entry standing as the
provider closed it. One publisher of the closed leg, and no order between them to get right. There is no resumed step; a resume is the end of a
hold, at the entry's `at` plus its `seconds`, and nothing is lost by not naming it twice. The same goes for every step: two mutes are two
`muted` entries, and a call that joined two queues -- a menu's, then this one -- has two `queued`
entries, one per join. Order is enforced: an entry earlier than the one before it is refused
(`task.history.order`). **Intervals between steps are the agent application's to subtract**, never a
total the provider adds: *time to offer*, from the call's arrival to the agent's screen lighting
up, is the `offered` entry's `at` minus the last `queued` entry's, and the ring is outside it.
`queueSeconds` keeps the industry's meaning -- the whole wait until somebody answered -- and is not
that interval. **The second is the record's grain.** A duration is a positive whole number of
seconds, and nought is refused because it claims no time; a leg that happened is stated at the
grain: rounded to the nearest second, and a leg that rounds to nought is stated as `1`, the error
being under the contract's resolution, where dropping the entry would say the leg never happened.

**A record once read is not unread.** Every restatement of a task's record -- on `task-updated`,
on a resync snapshot -- carries every entry the agent application has already read, by step and instant, and
may add to them; it never has fewer, and never drops the record while the task is open. A fact
stated to the agent application and then withdrawn without an event is a record contradicting itself, exactly
as a task that lost the terms it had read would be, and the stream refuses it the same way
(`stream.taskUpdated.history`, `stream.snapshot.history`). A provider whose
platform cannot hold a leg the agent application reported keeps it in the login's `store` for the life of the
task, so a reload of the agent application restates the same record; the entry is keyed by `step` and `at`, so
a running hold restated with its final `seconds` is the same entry.

**The provider owns the timestamps in its record.** Agent application timestamps are advisory. The provider
may retain an agent application instant it accepts or assign its own observation/receipt instant; it need not
copy the agent application clock. A provider declaring `timestampAuthority: "provider"` uses its own timestamps
for final records. Receipt time is an observation boundary, not a claim about when the physical
agent application action happened. Records are ordered by their published provider-selected instants, with no
rewriting of an already-published entry when a later agent application report arrives.

The incoming agent application `step` and `at`, scoped to the task and its current life, identify one reported
leg for correlation only. The provider retains a binding from that key to its chosen history
`at`. Every successful `recordStep` returns `{ status: "recorded", at }` with that same canonical
history instant, even for subsequent duration/end reports. The agent application keeps sending the original
report key, never the returned history timestamp. A changed agent application timestamp is not a correction
to the same report: it names a different leg. Bindings survive reconnect/reload for the retained
task lifetime. The agent application renders provider-published history unchanged. It never compares the
provider instant back to its own clock, substitutes its own timestamp, or adjusts later messages
to match an earlier agent application estimate. The acknowledgment identifies the provider record for
correlation/conformance only; it is not an application-side timestamp reconciliation instruction. Conflicting reuse is refused visibly, not paired by arrival time or nearest instant.
If two distinct entries would collide under the history's `(step, at)` key, do not invent a time
or combine them: report the representation conflict. No ambiguous event is silently accepted.

**Interaction time is anchored, not restarted.** It runs from the
`answered` step's `at` — from the task's first `in-progress` where the provider reports no
history — until the task's audio ends, and a hold neither pauses nor resets it: the hold's own
duration is the `held` entry's `seconds`, and a desk that restarts its counter on resume is
counting the wrong thing.

`muted` is there because the mute is the agent application's and never the provider's — see **The station is
the agent application's** — so without a step the provider, which alone keeps the task's record, would have no
account of a period the agent could not be heard. Each `muted` entry carries `mutedBy`, as the agent application
reported it: `host` for the agent's own Mute, `station` for a headset or system mute the agent application
observed. No other step has it (`task.history.mutedBy`, `.mutedBy.unexpected`).

**A step that dialled says which dial and where.** `conferenced` and `unanswered` each end a dial,
and `transferred` a hand-over on the platform's own routing, so the entry carries the `destinationId`
it went to and, where an agent application placed the dial, the `dialId` the agent application minted; no other step dialled, and either field on one is refused
(`task.history.dialId.unexpected`). This is how a dial made before a take-over is placeable
by whoever holds the task now: a `dial-outcome` naming a `dialId` the agent application never minted is looked
up in the record, not discarded.

Four rules a provider has to keep:

- **Report `seconds`; never expect Omni to derive it.** Omni does not subtract one timestamp from
  the next. An entry can be written while its leg is still running, so the arithmetic has no second
  operand, and a provider holding the authoritative number should not have it recomputed from
  instants that may be rounded or clock-skewed. And once stated, `seconds` is what every screen
  shows for that leg: a count a screen kept while the leg ran is replaced by it, never kept beside it.
- **Omit `seconds` while it is unknown. Never send `0`.** A leg still talking is not a zero-second
  conversation, and on live data that is the ordinary case rather than an edge. A zero is rejected.
- **`by` is a bare `UserId`, and not necessarily an agent.** A lead or a manager takes part
  during an interaction too — a call taken over, a call conferenced in — so the field names whoever it was,
  from the same directory `ForcedBreak.by` names a lead from. It comes from this provider's own directory, the same
  namespace as `AuthenticationState.identity.id` and the team member list, so entries pair
  within a provider and never across one.
- **A task carries no names.** Omni resolves what to display with `getUserDetails()`. Two people
  called Arun on one site is ordinary, and anything pairing entries on a display name pairs them
  wrongly; carrying the name here would also copy it into every task and leave it to go stale.

**An absent `by` means different things on different steps, and both are legitimate.** On
`queued` nobody takes part, so there is nothing to name. On every other step somebody did — see
`HISTORY_STEPS_WITH_A_PERSON` and `historyStepExpectsAPerson()` — so an absent `by` there says
*this was handled and the provider cannot say by whom*. The one step that is never unattributed is
`muted`: the agent application has exactly one agent and the provider knows who, so `by` is required there
(`task.history.muted.by`).

That case is ordinary rather than theoretical: a leg answered on a shared phone, a manager's
handset, or a device the provider cannot resolve to a person. **Report the step without `by`
rather than dropping it.** A list missing a real handler looks complete and is wrong, which is
worse than one saying plainly it could not attribute a leg — and far better than publishing
nothing because a single leg could not be named.

An agent application must render the two differently. Showing an unattributed `answered` the same way as
`queued` tells the agent nobody was involved, which is not what was said. Omni renders it as
*"not recorded"* in the place the name would go.

Omit `history` entirely when the provider cannot observe the steps. Empty `steps` is a
different claim — it says the task has had none.

**What the record adds up to is stated, not summed.** A call that has changed hands arrives
carrying what others already used of it, and the agent reads that before they say hello: the
totals are the provider's own — never a desk summing instants that may be rounded or skewed, for
the same reason `seconds` is reported and not derived — and each is present when the provider
knows it and absent when it does not, never a plausible nought. A fresh call from the queue has
`steps` with no prior `answered` and no totals to state, and a desk shows nothing rather than
zeros. The record is restated with the task on every `task-updated` and snapshot, so an entry
that arrives late corrects the sums. These four are what every platform reports; more will be
added here as a need is shown, not invented ahead of one.

#### The agent application records what it performs

`muted` is the one leg the agent application performs rather than the provider, and a record kept by the
provider would have a hole exactly there. So the agent application reports it, through `recordStep`, and the provider
writes it into its record as it writes every other leg:

```ts
declare const connection: Connection<"voice">;
declare const assignmentId: AssignmentId;
declare const at: IsoTimestamp;

void connection.recordStep?.({ assignmentId, step: "muted", at, mutedBy: "host" });                          // the moment the agent mutes
void connection.recordStep?.({ assignmentId, step: "muted", at, mutedBy: "host", seconds: 15 });             // still running, if the agent application chooses to say
void connection.recordStep?.({ assignmentId, step: "muted", at, mutedBy: "host", seconds: 42, ended: true }); // the moment they unmute
```

Every report about one leg repeats its original `step` and agent application `at` as a correlation key;
the published history uses the provider-selected `at` returned by `recordStep`. The agent application reports
the action it performed and its measured duration, not an authoritative provider timestamp. It may say how long so far — `seconds` is
elapsed while the leg runs and final once it has ended — and **the end is stated, never
inferred**: `ended: true` marks the last report, and it carries the final duration. **What a
provider never asked for never crosses.** The running report is sent only to a provider whose
manifest declares `runningStepReports`; every other provider receives exactly two reports per
leg, when it began and when it ended, and `validateHistoryReport(report, path, manifest)` refuses
a running one it was never asked for (`historyReport.running.unexpected`). What a provider that
did ask for them forwards upstream, and how often, is its own business. The step appears in
`history` when the *provider* publishes it: Omni never writes the record itself.
`recordStep` is required of every softphone login's connection, since every call on a softphone
can be muted by the agent application, and answers `recorded` with the canonical history `at`. A `muted` report says whose the silence was,
`mutedBy: "host"` or `"station"`, and no other report has the word (`historyReport.mutedBy`,
`.mutedBy.unexpected`). On a desk phone the microphone is the phone's:
the agent application mutes nothing and records nothing.

**The record is a record.** The microphone is the agent application's, and nothing in the
history moves it: a `muted` entry the provider publishes, or closes with a final `seconds`, is the
provider's account of a leg the agent application reported, and the mute itself ends only when the
agent, or the station, ends it. The agent application keeps its own mute state, reports each leg
as it begins and ends, and takes the provider's published entry as the closed account of that leg:
it does not reopen the leg, replace the provider's timestamp, or overwrite the provider's final
duration with a later report. A later agent mute is a new leg, never a reopening of the ended one.

**The provider assigns the instant.** `HistoryReportResult.at` is the provider's own instant for the
leg, on its own clock, written when the provider takes the leg into its record, never an echo of
the `at` the host reported: the host keeps the answer as the leg's identity from then on and names
it on the closing report, and a provider that echoes the host's instant has assigned nothing
(`drive.recordStep.identity`). Correlate the provider-published `muted` entry using that
provider-selected `at` acknowledged for the current report key; a final `seconds` closes that leg
under the history contract.
This is identity matching, not reconciliation between clocks. An old closed entry, an unrelated
task, or a stale connection cannot end a newer local mute. If publication precedes the acknowledgment,
retain the current provider view and apply the matching closure once correlation is available;
never guess a match from arrival order or nearest timestamp. Failure to release an agent application-controlled
mute is reported visibly; local device reports still describe the actual device state.

At a provider-confirmed task/audio end, the agent application also stops the associated local mute and reports
its observed ending where the report is still accepted. An agent application closing report repeats its original
key and may include its measured duration, but cannot reverse an already confirmed provider end.
The provider acknowledges a known closed leg without rewriting its final record; after the task
has been completed, it may refuse the report as assignment-not-found. The agent application reads that response rather
than retrying or recreating the task. An observed agent application end before a provider closure is still
reported normally; the provider decides the final timestamp and publishes the record.

### Browser capability

`browsers` is available to voice, chat, and email tasks. When declared, Omni renders the task's
`TaskBrowser` entries as named browsers in the task workspace. A task that supplies one or more
browser definitions must declare:

```ts
capabilities: { browsers: true }
```

Tasks without browser definitions omit the capability and provide an empty `browsers` array.

**A browser is one tab, and each workspace keeps its own.** `Browser` is what a tab is — an id, a
name, a URL. The task workspace shows the task's `TaskBrowser` entries, one tab each, fixed at the
task's definition: their count and their details, `urlVisibility` included, arrive with the task,
and nothing adds a tab to a task later. The personal workspace is the agent's: as many
`PersonalBrowser` tabs as they open, never on the wire, and no provider says anything about what
they may see there.

#### `TaskBrowser` and isolation

Each `TaskBrowser` defines one named browser in the task workspace.

| Field | Contract |
| --- | --- |
| `id` | Stable internal selection and update identity within the task. |
| `name` | Agent-facing tab label, unique within the task, and an input to schemes containing `TAB_NAME`. |
| `purpose` | Human-readable explanation of the browser's role. |
| `url` | Initial URL. Must use `http:` or `https:`; see below. Later navigation comes from Chromium. |
| `sharedSession` | Required. `false` creates a task-specific browser session. |
| `isolationScheme` | **Required when `sharedSession` is `true`**, and rejected when it is `false`. There is no default: see below. |
| `urlVisibility` | What the agent sees of this tab's URL in Omni's chrome: `hidden`, `domain`, or `full`. Omitted, the URL shows as any browser's does; a provider says `hidden` where the URL carries what the agent may not read — a caller's number, a CRM token. Per browser, on the provider's word; an agent application that declares `guarantees.browserUrlVisibility` honours it tab by tab, and a provider checks that guarantee before it sends such a URL at all. |

##### Choosing an isolation scheme

Every scheme is supported and the provider picks the one its deployment needs. There is no
default, and a `sharedSession: true` browser that declares none is invalid — the type will not compile
it and `validateSnapshot` reports `task.browser.isolationScheme.required`.

That is deliberate. Sharing a signed-in session decides **who else may see those credentials**,
and it is not a decision to inherit from whichever value happened to be the default. `TAB_NAME`
keys on the tab label alone, so two providers that each publish a browser named "CRM" share one
signed-in session — legitimate where a deployment wants exactly that, and a silent credential
leak where it does not. It remains available; it has to be asked for.

`browserSessionKey` fails closed: given a reusing browser with no scheme it returns `undefined`
and the browser is isolated. The safe reading of an invalid declaration is "do not share", never
"share with everyone named the same".

##### Permitted URL schemes

`TaskBrowser.url` is provider-supplied and is loaded inside Omni's managed browser, so it is
restricted to the schemes in `ALLOWED_BROWSER_URL_SCHEMES` — currently `http:` and `https:`.
`file:`, `chrome:`, `javascript:`, and every other scheme are rejected. Omni substitutes a blank
page rather than following a disallowed URL, and `isAllowedBrowserUrl()` is the shared predicate.

##### Reuse and isolation

With `sharedSession: true`, definitions producing the same isolation key share one **storage profile**:
cookies, local storage, session storage, permissions, and cached credentials. Different keys are
isolated from one another.

Sharing a profile is not sharing a window. Two browsers in the same task keep their own tab, their
own visible label, and their own navigation state and history even when their keys match — a
scheme that omits `TAB_NAME`, such as `PROVIDER_NAME__TASK_TYPE_NAME`, deliberately places every
named browser of that task type in one signed-in profile without merging them into one page.

`browserSessionKey()` derives the key. Every part is escaped before the `.` separator is applied,
because `encodeURIComponent` leaves `.` untouched and a raw join would let one value forge
another key: provider `Acme.Voice` with task type `Support` would otherwise produce the same key
as provider `Acme` with task type `Voice.Support`, silently placing two providers in one cookie
jar. Hosts that must flatten the key further — for a native window label or a partition name with
a restricted charset — must keep the mapping injective, for example by appending a fingerprint of
the exact key, since lowercasing or replacing punctuation reintroduces exactly this collision.

```ts
browsers: [
  {
    id: "crm",
    name: "CRM",
    purpose: "Contact record",
    url: "https://crm.example.com/contact/42",
    sharedSession: true,
    isolationScheme: BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
  }
]
```

The supported `BrowserIsolationScheme` values, declared under **Shapes** in `guide.md`, key as follows:

| Enum member | Example session key |
| --- | --- |
| `PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME` | `mailflow.EMAIL-829102%2Ea1.CRM` -- the task's assignment id, so one assignment, never the next customer's cookies |
| `TAB_NAME` | `CRM` |
| `PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME` | `mailflow.Support.CRM` |
| `PROVIDER_NAME__TAB_NAME` | `mailflow.CRM` |
| `PROVIDER_NAME__TASK_TYPE_NAME` | `mailflow.Support` |
| `TASK_TYPE_NAME__TAB_NAME` | `Support.CRM` |

`TASK_TYPE_NAME` refers to the mandatory `Task.taskType`. The isolation scheme never changes
the browser tab label. Serialized values are stable protocol values and must not be renamed or
reused.

**`PROVIDER_NAME` is `manifest.id`, never `manifest.displayName`.** Only the id is required unique
across an installation; two providers may legitimately share a display label, and keying a cookie
jar on one would put them in the same signed-in session. The id is also stable across launches,
where a display name may be re-worded — and a changed key silently signs the agent out of every
browser that used it.

### Task capabilities

Task capabilities belong to each `Task`. If `hold` is omitted on one task, Omni
must not show or issue hold for that task even if another task from the same provider supports it.

**A capability is a property of the task, and of nothing the task names.** A provider derives it
from no other source -- not the queue the task came from, not the login, not its own configuration
-- because each of those answers a question about this task from somewhere that does not know
about this task, and a client with two sources and a rule for choosing between them is the shape
that produces two consumers disagreeing about one fact. The task is the one source, and the
provider puts on the task what the platform permits for it -- and says, in `capabilitySource`, who
chose those terms. `queue` says somebody configured them. `nobody` says nothing handed the work
over: an agent's own outbound call has no queue behind it, and the provider states what it permits
for such a call. Neither changes where an agent application reads the capabilities from, which is the task; the
source is one more published fact about them, and the one that lets an agent application tell a fact from a fault
(see below).

**Completing the task is not a capability, and no capability set withholds it.** `complete` is
governed by `completionMode` alone: under `agent-command` it is always available, whatever the set
says, and the `outcomes` capability decides only whether a code travels with it. Likewise
Answer on a pending task and Call on a preview are the phase's controls, not the set's. The
capability set governs what the agent may do *with* the task; completing it is never on the
list.

**A permission that changes while the task is open is republished on the task at the moment it
changes.** An agent on a billing dispute may refund up to their own limit and no further. The
customer wants more, the agent asks for a lead, and the moment the lead joins the call the task is
republished with the Refund control the agent could not have a minute ago; when the lead leaves, it
is republished without it. Nothing about the agent changed -- who is on the call did -- and the
task said so both times, at the moment it became true. A call moves queues the same way: a caller
identified as a priority customer is transferred to the priority queue, and the task arrives under
that queue's terms -- a longer wrap allowance, a discount control the general queue never offered --
restated on the task at the hand-over, not inferred from the queue it left. A capability stated
once at offer or answer and never corrected is a fact with a shelf life and no expiry, and an agent application
draws a control the provider will now refuse -- or withholds one the agent now has. So the provider republishes
the task, with its capabilities as they now stand, and an agent application treats the last statement as current
rather than re-deriving anything. This is the same shape as a room left full after the call ends
-- a field describing the present, carried past the moment it stopped being true -- carried past
this time not by a spread but by nobody sending the correction. A provider whose platform can
change a permission mid-task and does not republish is in breach, however conformant its offer was.
A capability set can shrink as well as grow, and an agent application that has only ever seen it grow meets a
control that was there a moment ago and is gone; a command that arrives after its capability was
withdrawn is refused with a reason, never acted on. The asymmetry decides which direction a
provider gets right first: a control gained late is a nicety, a control withdrawn and not
republished is a button that fails when pressed. `assertTaskCapabilityWithdrawal` is the test for that
direction: the task as offered and as republished, and one command that was issuable under the
first and is refused under the last for want of the capability withdrawn -- and nothing else.

**An empty capability set is a statement, not a shrug.** `capabilities: {}` under `queue` or
`nobody` says the platform permits nothing capability-gated on this task, and an agent application draws
nothing beyond what the phase and `completionMode` require. A provider that has not yet learned
what the platform permits -- a queue's configuration that has not reached it -- knows nothing of
the kind, and must not publish the task as if it did, neither as `{}` nor as every control it has.
It publishes the task under `capabilitySource: "not-yet-read"`, with the capabilities it will
honour until it knows, and an agent application shows that where the agent works, beside the controls it draws
from them: "no queue governs this call" is a fact, "the configuration has not arrived" is a fault,
and the set alone cannot tell them apart, so the provider says which. What a provider honours
under not-yet-read terms is its own call -- a floor that would rather an agent briefly hold a
control the platform might not have granted than lose hold or hang-up mid-call over a slow
configuration read publishes those -- and the protocol chooses no default set for it. The fault is
also reported as a `diagnostic` naming the task, one per occurrence, so an operator counts it. When
the terms arrive, the task is republished under `queue` with the set as it now stands: the same
republish as any other permission that changed while the task was open. The move goes one way.
Terms once read stay read: a re-read that fails mid-task is not a new fact about the task, so the
last statement stands and the failure is a `diagnostic`, and a task that was published under
`queue` or `nobody` never returns to `not-yet-read`, on an update (`stream.taskUpdated.capabilitySource`)
or on a resync snapshot (`stream.snapshot.capabilitySource`); a record once read never loses an
entry the same two ways (`stream.taskUpdated.history`, `stream.snapshot.history`);
a snapshot carrying a task still at work does not forget the audio the stream held up, since audio
ends on `task-audio-ended` and the call moves on (`stream.snapshot.audio`); a voice task ends after
its audio ends, never around it, whatever the outcome (`stream.taskEnded.audioOpen`); and a task does not go
backwards, on an update or on a resync (`stream.taskUpdated.phase`, `stream.snapshot.phase`): the
stream sees publications, not
transitions, and a task may pass through a phase between two, so `pending` to `in-progress` stands
with `confirmed` between them, and what is refused is a phase unreachable from the last one read by
the transition table -- back to `pending`, back to `confirmed` or `preview` once work began, out of
`completing` except by the party being dialled again, a connect-back or a platform's callback,
which the update itself shows: the party ringing, or joined by a dial whose answered outcome the
stream saw in this life. A completing task republished as `in-progress` from a stale copy carries
no such stage, and that is the ending the agent never saw. Audio arrives only on a task at work: `task-audio-started` on a `completing` task
is refused as it is on a pending one (`stream.taskAudioStarted.beforeWork`), since a connect-back
returns the task to `in-progress` before any audio. And a task completes after its audio ends,
never around it: an update moving a task to `completing` while the stream holds its audio as
started is refused (`stream.taskUpdated.audioOpen`), whoever caused the ending, and a task stating
`completing` with `audio: "started"` contradicts itself on any snapshot or update
(`task.audio.completing`). The consequence the rule exists for is concrete: the customer's audio
keeps playing through the agent's wrap-up.

What the agent is told differs by source, and only one source tells them anything. Under `queue`
and `nobody` the agent sees controls and nothing about where they came from: both are facts,
and an agent working a call has no use for the name of the rule behind its buttons. Under
`not-yet-read` the agent is told, beside the controls, that these are what the provider will honour
until the queue's terms arrive, and that the controls may change when they do -- a statement about
the buttons in front of them now, not about the provider, because that is what changes when the
republish lands. It stays for as long as the set is provisional, beside the controls it qualifies;
a message that shows and clears has said nothing about the buttons still on the screen. The two
words are close in English and far apart on the desk: `nobody` is silence, `not-yet-read` is a
standing notice.

One consequence for whoever builds the agent application: because a conformance run fails on `not-yet-read`, a
conformant adapter never shows an agent application `not-yet-read` under test, and a clean `exerciseAdapter`
result says nothing about how the agent application renders it. That rendering is tested against a fixture --
a task published under `not-yet-read` shows the notice, the same task under `queue` shows none --
and never against an adapter, even in principle. `exerciseAdapter` treats a
task published under `not-yet-read` as a violation (`capabilitySource.notYetRead`), as it treats
a diagnostic: a conformance run against a platform that cannot say what it permits fails loudly
rather than passing with a note.

```ts
const taskCapabilities = {
  channel: "voice",
  capabilities: {
    hold: true,
    outcomes: true,
  },
  browsers: [],
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "browsers">;
```

A capability says the control may be offered; the task's phase says whether there is anything to use
it on. Every control below that acts on the call or the conversation -- everything but `decline`,
`connectBack`, `schedule` and `outcomes` -- is offered only while the task is `in-progress` or `paused`.
See **Which commands need a capability**.

### Publishing codes and destinations

Two capabilities accept an object when the provider wants Omni to render real choices. For
`outcomes`, `true` remains valid and means "offer the control with nothing published"; the one
directory control, `conference`, carries its directory or is refused, since once nothing is typed
the directory is the control.

#### `outcomes`

An outcome describes what happened; completion finishes the task. Outcome codes are selected
from the task's own published list. They are distinct from `DialOutcome`, which reports the
result of a dial attempt.

Migration requires providers and hosts to adopt the renamed types and fields together:

| Former API | Current API |
| --- | --- |
| DispositionCode | `OutcomeCode` |
| DispositionRules | `OutcomeRules` |
| DispositionPayload | `OutcomePayload` |
| Task.capabilities.dispositions | `Task.capabilities.outcomes` |
| complete.disposition | `complete.outcome` |

Validation and conformance diagnostics use `task.outcomes`, `task.outcome`, and
`command.complete.outcome` in place of the former names. Update retained task snapshots and
command producers as well as imports. Old capability and command fields are rejected, including
payloads containing both names; there are no compatibility aliases. Code IDs, notes, required
selection rules, and completion behavior are unchanged.

```ts
capabilities: {
  outcomes: {
    required: true,
    notes: "optional",
    codes: [
      { id: "resolved", label: "Resolved" },
      { id: "callback", label: "Callback needed", group: "Follow-up" },
    ],
  },
}
```

| Field | Contract |
| --- | --- |
| `required` | When `true`, Omni must collect a code before issuing `complete`. A required policy must publish at least one code. |
| `notes` | `required`, `optional`, or `none`; controls the free-text field beside the code. |
| `codes` | Codes Omni offers. `id` values are non-empty and unique; Omni sends the chosen `id` as `TaskCommand.complete.outcome`. |

With `outcomes: true` Omni shows a Complete control and sends `complete` with no code, because
the provider published none.

#### Scheduling a follow-up

An agent on a call promises to call back on Thursday, or in wrap writes up that the customer wants
a callback once the refund lands. The follow-up goes on the calendar, and the platform owns the
calendar: `schedule` asks the provider to put it there. A chat or an email agent promises a
callback as often, so the control is on every channel.

```ts
// From the call or the conversation, or from its wrap: the time, and a note where the agent wrote one.
{ type: "schedule", at: "2026-08-28T10:00:00Z", note: "Call back about the refund" }
```

`schedule` is gated by the `schedule` capability and issuable in `in-progress`, `paused` or
`completing` (`command.phase.interaction`): a follow-up is promised on the call and written up in
wrap alike, and the task names the party it is for. It lands on the calendar, so a task may offer
it only under a manifest that declares the `calendar` idle capability
(`task.capability.calendar.required`), as a control that dials needs `dialOutcomes`; a locked
`schedule` is still a declared one. The command carries a time and a note and nothing else
(`command.schedule.at`, `command.schedule.note`, `command.field`): what the platform makes of a
follow-up -- a campaign record, a reminder, a scheduled dial -- is its own, and the agent sees it
on the calendar.

**`applied` says the follow-up is on the calendar**, and the `calendar-updated` that shows it
follows within the manifest's `settleMs`, as a `task-ended` follows an applied `complete`. Past
the bound the agent application calls `snapshot()`: a calendar carrying an activity at that instant
clears the wait; one without it shows the follow-up as unsettled -- "Scheduled... the provider has
not confirmed" -- naming the command. The drive schedules one follow-up where the task offers it,
at a time it takes from the provider's own publication, and holds the provider to the same bound
(`drive.schedule.unsettled`).

### Custom capabilities

Every task may publish additional provider-specific controls in `capabilities.custom`:

```ts
capabilities: {
  hold: true,
  custom: [
    { id: "request-supervisor", ui: { control: "button", label: "Request supervisor", placement: "secondary" } },
    { id: "mark-vip", ui: { control: "toggle", label: "Mark as VIP", placement: "overflow" } },
  ],
}
```

Custom capability IDs must be non-empty and unique within the task. `ui.control` is `button`, `toggle`,
or `menu-item`; `ui.placement` is `primary`, `secondary`, or `overflow`. `ui.render` says where the
control's work appears: `inline`, in the workspace beside the task, or `page`, as a page of its own
— a tab in the same work area as the task's browsers, beside them, and alone on a task that has
none; stated on every control, never defaulted (`task.custom.ui.render`). `prompt.fields` are what the agent supplies before the action runs — a
destination number, a reference — as `CredentialField`s Omni renders as a form; the values travel
on the custom command under the fields' names, as strings, and Omni sends the command only once
every `required` field has a value. The provider validates what arrives as it validates any
command; a form is a declaration, not a contract for what the agent typed. Omni renders the
control and invokes it with the shared custom task command:

```ts
{
  type: "custom",
  name: "request-supervisor",
}
```

`name` is the `id` of the custom capability the agent used. There is no `assignmentId` here: like every
other command it travels on the `TaskCommandRequest` around it. A `toggle` carries the state it
wants — `{ type: "custom", name: "mark-vip", on: true }` — never a flip, for the reason under
**Task commands**.

Custom capabilities must not redefine the meaning of a standard channel capability.

## Task commands

Command names follow the channel's operational vocabulary, and each channel's command is a union
discriminated by `type` — the same discriminant `executeTeam` and `custom` already use. The
unions are declared under **Shapes** in `guide.md`.

`assignmentId` is not repeated on the command. It travels on the `TaskCommandRequest` around it.

**A toggle carries the state it wants, not a flip.** Inverting whatever is found cannot converge
with a stale view: a flip against a state the provider has already changed turns something on and
then off again. A custom `toggle` control therefore carries its own boolean. `hold` and `resume`,
`pause` and `resume` need no flag, being pairs rather than toggles.

**`complete` sends an outcome only where one was published.** `outcome` is a
`OutcomeCode.id` from the task's own `outcomes` capability, and `notes` obeys that
capability's `notes` setting. A task publishing no codes still receives `complete`, with neither.

### Where a command executes

Every command reaches the provider through `execute`, with no branch at the call site, and every
command asks the provider to **perform** something: `hold`, `conference`, `schedule`, `end-call`,
Provider-targeted `recording` commands and the rest act on the platform's own call leg, its bridge, or its record of the
task. Nothing has happened until the provider applies them, and `failed` means nothing happened.

**The provider performs every action; the agent application only offers it.** A control drawn on the agent application is
an affordance, never the enforcement: the agent application asks, and the provider does or declines. A provider
answers `failed` for a command whose capability it did not publish, and that is the provider
honouring its own declaration, not the agent application deciding policy -- an agent application that refuses a command on
its own reading of a queue's flag has decided something that was never its to decide. What a
command means on the platform is the provider's to work out: `end-call` disconnects the caller channel, and
which legs on which bridge that touches is a fact about the switch, never a choice the agent application makes.
The one thing the agent application performs physically is the microphone, and that is not a command at all.

### Which commands need a capability

**Presence is the permission** gates the controls a provider chooses to offer. Four commands are
not among them, because every task has them; each is authorized by a different field the provider
declared:

| Command | What makes it available |
| --- | --- |
| `answer`, `accept` | Nothing. A task that was offered can be accepted, or offering it meant nothing. |
| `end-call` | The `endCall` capability: ends my part, the caller continues. |
| `terminate-call` | The `terminateCall` capability: ends the whole call, every channel on it. |
| `conference` with `action: "remove"` | The `conference` capability, and somebody else on the call: a remove that would leave the agent alone is `end-call`, and a provider answers it `failed`. |
| `decline` | The `decline` capability on any channel, **and** Omni local policy permitting it. One word for refusing an offer, whatever the channel. |
| `dial` | The `preview` phase. A record put in front of an agent is there to be called, so the phase is the gate and there is no capability. It is a dial, with a `dialId` and a `dial-outcome`. |
| `complete` | A wrap to cut short: any task but a `provider-automatic` one with `wrapAllowance: 0`, under either completion mode (`command.complete.wrapAllowance`). The `outcomes` capability decides whether a code travels with the command, never whether the command exists — a task Omni cannot complete never ends. What travels is what the capability published: a code from its list where it has one (`command.complete.outcome.unknown`), a code at all where it requires one (`.outcome.required`), notes as it said (`.notes.required`, `.notes.unexpected`), and neither where the task declares no outcomes (`.outcome.unexpected`). |
| `connect-back` | The `connectBack` capability **and** the `completing` phase. It exists to reach the party again after the call, so it has no meaning while the call is up. |
| `schedule` | The `schedule` capability, on any channel, in `in-progress`, `paused` or `completing`: a follow-up is promised on the call and written up in wrap alike. The manifest declares `calendar` for it to land on. |
| `lead-assist` with `action: "request"` or `"cancel"` | The `leadAssist` capability. `cancel` needs a request standing -- `Task.leadAssist` with `stage: "requested"`. |
| `conference` with `action: "add"` | Its capability, and a `destinationId` the directory offered: the id Omni sends is the id the provider published (`command.destination.unknown`). |
| `custom` | A control the task published under `capabilities.custom`, by its `id` (`command.capability.custom`), carrying a non-empty string for each `required` prompt field and strings for any optional fields supplied (`command.custom.prompt`). A toggle carries its target `on` boolean (`command.custom.on`). |
| Everything else | Its own named capability. |

**A control on the contact belongs to the interaction phases**, `in-progress` and `paused`:
`hold`, `resume` and `pause`, `end-call` and `terminate-call`, every `conference` action, and
every `lead-assist` action; `schedule` alone reaches into `completing`. These controls act within this agent's current interaction.
In `completing`, that interaction has ended and its wrap work remains. The caller may still be in
an IVR, queue or another agent's interaction, and other channels may remain connected. Completion
of this interaction does not establish that the caller or bridge ended. The capability stays
declared while the task remains open; the phase prevents this task from controlling an interaction
it no longer owns. Omni shows these controls only in the two interaction phases, and
`validateTaskCommand` refuses them outside those phases (`command.phase.interaction`).
The commands with a phase of their own -- `answer`, `accept` and `decline` in `pending`,
`dial` in `preview`, `connect-back` in `completing`, `complete` in any -- are not among them.

`validateTaskCommand(command, task)` holds a command to this table at runtime, both ways: the
capability it needs, the phase it belongs to, and the state that has to stand. The task it wants
is the one the provider published, not an agent application's own mapping of it: an agent application that keeps only its
mapped shape has nothing honest to pass, and then checks shape alone, which is still worth doing
-- it names a command the wire never had -- but is not the table. Keeping the published task
beside the mapped one is what the full check costs an agent application; an adapter has it for free. The
validator holds a command only to a task that stands: a task handed in that is not one the wire
published is named (`command.task`) rather than checked against.

Declining a pending offer ends it without accepting or completing it. The provider confirms the
end with `task-ended` and a `cancelled` outcome, `by: "agent"`.

### `execute(request)`

Applies a `TaskCommandRequest` to one provider-local task.

- Omni serializes commands per task and sends the next only after the previous settled or was
  given up as unknown; it stops sending when `task-ended` arrives.
- `applied` confirms the side effect completed. `failed` confirms it did **not**, with a typed
  `ProtocolFailure`; a provider that will not and one that cannot report the same shape, and `code`
  says which.
- A command sent while `transport-status` is not `active` answers `failed` with `omni.unavailable`.
  Neither Omni nor the adapter queues it.
- **A command that asks for a state answers `applied` when that state holds, whoever brought it
  about; a command that acts answers `failed` when it cannot act.** Declining a lead request
  already gone is `applied`; joining one already gone is `failed`, since nobody joined. A lead
  deciding a member's break that another lead has already decided is `applied` when the decisions
  agree and `failed`, saying so in `message`, when they differ. `commitBreak()` on a break already
  in effect is `committed` for the same reason.
- **A result is untrusted for the same reason a snapshot is.** It comes from an adapter that may be
  compiled against another version, and Omni shows the agent what it says. Omni validates it at
  the boundary with `validateResult(result, "execute")` — a status the method does not answer, a
  `failed` without its failure, a success carrying one, or an `omni.` code this contract lacks is
  refused, and the command is treated as unsettled.
- **A settled result is a fact; an unsettled promise is not.** Transport uncertainty may reject the
  promise with no result at all, and that means *unknown*, not *failed*, and a snapshot follows —
  see **An unsettled result is unknown**. `failed` must never be returned for something the
  provider is unsure of, because Omni will show the agent it did not happen.

### `ProtocolFailure`

| Field | Contract |
| --- | --- |
| `code` | Required stable machine-readable value. See the reserved codes below. |
| `message` | Required, and safe for logs or agent display. |
| `retryable` | Whether repeating the action can succeed at all. |
| `retryAfterMs` | Optional minimum suggested delay before a retry. A suggestion, not a guarantee. |

The `omni.` prefix is **reserved**. Adapters must not invent codes under it; every other value is
provider-private and Omni treats it as opaque. Using a reserved code where it applies lets Omni
react rather than only display the message:

| Code | Meaning |
| --- | --- |
| `omni.not-authenticated` | The provider session is no longer usable. The adapter has published `expired` at or before this answer — the state is what Omni surfaces reauthentication from; the code says why this action failed, and is never the only signal. |
| `omni.capability-not-enabled` | The action targets a capability this task, manifest, or login did not declare — including a lead command from a login whose `capabilities` no longer carry it. |
| `omni.assignment-not-found` | The assignment named is not one the provider holds, typically after the task already ended. |
| `omni.phone-not-permitted` | The agent application declared a `phone` the platform does not permit for this agent -- a softphone for an agent configured for a desk phone, or the reverse. The login is refused at authentication, and the provider never reconfigures the agent to make the declaration true. See **How the agent hears the call** in `guide/phone.md`. |
| `omni.destination-not-permitted` | The dialled number, or the `destinationId` named, is not one the provider offers this agent. |
| `omni.rate-limited` | The action was throttled. Pair with `retryAfterMs`. |
| `omni.unavailable` | The provider is temporarily unable to serve the action, including any command sent while `transport-status` is not `active`. |
| `omni.break-already-committed` | Cancellation lost the commit/cancel race; Omni must finish commit recovery. |
| `omni.recording-unsettled` | A recording command the provider could not settle either way: a settled `failed`, never a promise left unresolved. See **Independent task recording** in `guide/voice.md`. |
| `omni.break-forced-by-provider` | A lead asked to lift a break the platform imposed; the platform lifts its own. See **Forced breaks** in `guide/breaks.md`. |

They are published as `OMNI_FAILURE_CODES`.
