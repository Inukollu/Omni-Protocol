# `@xema/omni-protocol`: The phone

How the agent hears the call: softphone and desk phone, the station and its headset, opening the audio, the microphone and the record. Part of the contract in `guide.md`, which holds the terms, the shapes and the rules every file here relies on; a reference in bold names the file it points into where that is not this one.

## Real-time audio

Every voice provider has audio: `channel: "voice"` says audio exists. Where the agent hears it
depends on the `phone` the agent application selected at authentication and connect from the manifest's
`phones`. On a softphone, audio lands in Omni; on a desk phone, it lands on the handset and Omni
opens no audio. See **How the agent hears the call**. Audio transitions are voice-only;
chat and email publish none (`event.audio.channel`, `stream.taskAudio.channel`).

The provider owns signalling and the platform's endpoint configuration. The agent application selects the
declared phone mode; it does not enumerate or reconfigure the platform's devices. The selected
mode stays with the login rather than being inferred from a snapshot or a device failure.

Nor does the audio ever stand in for the task: a task's presence and
phase follow the provider's reports about the work, and the audio — attaching, moving through a
hold, a conference, a lead joining or a take-over, and ending — is transient beside it. See **A task is
never its audio** under **Task assignment lifecycle**.

### The agent application reports, the adapter decides

The adapter runs inside Omni and sees nothing of the station for itself: the devices, the
permissions, the audio element and the network are the agent application's, and only the agent application can tell. So
the agent application reports, and the adapter asks. **An adapter consults `ConnectContext.host` before it
declares the agent ready to its platform, and again whenever the report changes**, and it decides
what any of it means and what to relay upstream — go not-ready, refuse calls, carry on because the
platform's audio lands elsewhere. Omni facilitates and does not take responsibility: it captures
the microphone once as the voice connection opens, so the permission prompt lands while the agent
is signing in rather than over a contact, prompts, retries on the agent's request, tells the agent
what failed, and reports. It never decides for the adapter what a missing microphone means.

**The agent application also guarantees, and a promise the provider cannot see is not one it can rely on.**
Two of this contract's obligations fall on the agent application rather than the provider — honouring a task
browser's `urlVisibility`, and taking a `consent` offer only on the person's own press — and more
than one desk speaks this contract: a browser and a native application differ in what they can
reach, and a provider never branches on which it is talking to, only on what it has declared —
here, and in `host.mute` (see **The station is the agent application's**). So `ConnectContext.host.guarantees` says which promises the
connected agent application makes, declared once per connection, presence being the guarantee exactly as it is
the permission everywhere else:

| Guarantee | Contract |
| --- | --- |
| `browserUrlVisibility` | Every task browser's `urlVisibility` is honoured in this agent application's chrome, tab by tab. A provider that would send a caller's number in a URL checks this first and tokenises where the promise is absent. |
| `personConsent` | A `consent` offer is accepted only by the person's own explicit act, never on their behalf. A provider whose work may only be taken by a human checks this first and does not offer it where the promise is absent. |

A guarantee the agent application does not make is an absent key, never `false` — `validateHostGuarantees`
refuses a false one, as it refuses a name this contract does not list.

| Field | Contract |
| --- | --- |
| `online` | Whether the agent application has a network interface up. Not a claim that anything is reachable — the adapter knows whether it can reach its own platform far better than the agent application does — so `false` is a reason not to go ready and `true` is not a reason to. |
| `audio` | Present on a voice connection, absent where there is no audio. |
| `audio.input` | `available` with `localAudio` — the microphone as captured, the same stream `openAudio` receives — and `flowing`, false while no audio moves through it, when `mutedBy` says who stopped it: `host`, the agent application's own Mute on an agent application that mutes the station, or `station`, a slider on the headset or the operating system, which the agent application observed and did not do. An adapter treats `host` as the agent's act on a call and `station` as a condition of the station. `unavailable` with `reason`, since each wants a different fix from the agent: `no-device`; `denied`; `not-asked`, which an agent application that asks at connect never publishes; `in-use`, a device present and permitted that another application holds — on an agent desktop the commonest of all; `lost`, a capture that ended. An agent application decides the reason from the devices before the error name: a browser can report a permission error on a machine with no microphone at all, and "grant permission" is the wrong instruction for an agent who needs to plug one in. `failure` carries the words Omni showed them. |
| `audio.output` | `available`, with `flowing` where the agent application can know whether audio reaches the speaker — a browser mostly cannot, and omits it; a native agent application reads the endpoint — false while it is silenced, when `mutedBy` says who did it, as on input. Or `unavailable` with `reason` — `no-device`, or `lost` for one removed — and `failure`: an agent who cannot hear is as unable to take a call as one who cannot speak. |

Omni republishes the report whenever it changes — a permission granted late, a headset unplugged,
a network gone — and it publishes a state, not a flicker: a change that resolves within moments is
not reported, so an adapter may act on what it reads without debouncing it again. Nothing in the
report is a task fact or a capacity fact; it is what the station can do, and the adapter's platform
is the one that knows whether an agent without a microphone, or without a speaker, can work.

The agent application's own obligations here — asking at connect, never publishing `not-asked` when it does,
publishing a state and not a flicker — are Omni's tests' to hold. `exerciseAdapter` holds the
other side: it validates the shape of whatever agent application a test hands the adapter, requires `audio` on
a softphone login and none elsewhere -- not on a desk phone, not off voice
(`context.host.audio.required` / `.unexpected`), holds `host.mute` to the same line (`host.mute.required`
/ `.unexpected`, `host.mute` for a third word) -- and refuses a voice adapter that never asked the
agent application anything (`connection.host.consulted`), and one that subscribed to nothing will never hear of a
change (`connection.host.subscribed`): the obligation has two halves, and each is held.

### Capacity around setup

Connecting is not the same as being able to take a call. A provider that treats a live connection
as reachability opens a window where it believes the agent is available and the agent is not yet
set up — the adapter's own registration incomplete, its credentials not yet renewed.

Nothing closes that window, because nothing opens it: **Omni states no capacity until the
connection is established**, and **Work is pulled, never pushed** makes an assignment with none
stated a violation. Capacity does not wait on the microphone: whether an agent without agent application audio
can take calls is the platform's question, answered by the adapter from the agent application's report, not by
Omni withholding capacity for every platform alike.

Capacity follows **automatically** once the connection is established; the agent does not press
anything to become available.

| Situation | What Omni sends |
| --- | --- |
| Connecting | Nothing. No capacity has been stated, so nothing may be assigned. |
| Connected and idle | `setCapacity({ count: n })`, with the agent application's report already available to consult. |
| A task starts or ends | Nothing. The provider counts its own against the ceiling. |
| The agent's provisioned capacity changes | `setCapacity({ count: n })` |
| Agent asks for a break | `requestBreak`. Capacity is unchanged and work continues. |
| Omni commits a break | `commitBreak`. The break stops assignment, not the ceiling. |
| Agent returns from break | `endBreak` |

**A break is not a capacity of zero, and neither is the reverse.** Capacity says how much of this
agent this provider may carry; a break says they are not working at all. A provider told
`count: 0` shows an agent whose capacity is elsewhere, `elsewhere`; a provider told a break shows
`on-break`. Collapsing the two would leave a provider unable to tell an agent working on another
provider from an agent who has gone to lunch, and only one of those needs a reason, a decision and
a return.

### How the agent hears the call

A voice platform can put an agent on a **softphone**, where the call's audio lands in the agent application
and Omni owns the microphone and the playback, or on a **desk phone**, a handset on the platform's
switch that the platform rings, where the agent application owns no audio and only shows the call. Which of
these a platform can do is a fact about the platform, and which one a login is on is a choice the
agent application makes for that agent -- so the manifest declares and the agent application chooses.

```ts
// Manifest: what the platform can do
phones: ["softphone", "deskPhone"]
// The agent application, at authentication and again at connect: which one this login is on
{ phone: "softphone" }
```

A voice manifest lists its `phones` and any other channel lists none (`manifest.phones.required`,
`manifest.phones.channel`). The agent application's `phone` is required on a voice login, absent on any other,
and one the manifest listed (`context.phone.required`, `.unexpected`, `.unsupported`). Everything
about audio then follows the phone rather than the channel: on a softphone the agent application reports its
audio, the adapter implements `openAudio`, and `task-audio-started` is the word to open it; on a
desk phone the agent application reports no audio, opens nothing, and `task-audio-started` still marks the
moment the call is live so the desk shows it, with the sound on the handset. A platform that lists
`deskPhone` alone never implements `openAudio`; one that lists `softphone` always does.

**The mode comes from the agent application; the status comes from the provider.** The agent application knows which kind
of station the agent signed in at, because the person chose it, and nothing else can know that.
The provider knows whether that station can carry a call right now -- whether a handset is
registered -- which an agent application in a browser cannot see. So the agent application's `phone` selects the branch, and
the provider's own knowledge of the device decides readiness within it. A provider never overrides
the agent application's declaration from its device record: treating a desk-phone login as a softphone because
the handset is momentarily unregistered, and demanding a microphone of it, is the reading this
sentence exists to refuse. What the provider does when the handset is not registered is what it
does for any station that cannot take a call -- hold the agent not-ready and say why.

**On a desk-phone login the agent application never calls `openAudio`.** There is no stream to hand over and
no audio to attach; an agent application that calls it anyway is in error, and an adapter that receives the call
answers `unavailable` with a non-retryable failure, since waiting changes nothing about a station
that is a telephone. The harness requires no `openAudio` of such an adapter and never calls it.

**Which handset a desk-phone login rings is the platform's configuration for that agent**, and
this wire never asks the agent for it: an agent application declares `phone` and nothing more. What a platform
asks on surfaces of its own is its own decision.

**A declared phone the platform does not permit for this agent is a login that cannot be
established.** The manifest says what the platform can do; the agent's record, kept by an
administrator, says what this agent is configured for, and the two can disagree with the agent application's
declaration -- a softphone declared for an agent whose record says desk phone. Honouring that
declaration on a switch that allows one registration per endpoint would evict the handset: the
agent's phone stops ringing and their calls land in a tab, and nobody is told. So the provider
refuses the login at authentication, with `omni.phone-not-permitted` and a message the agent application shows
-- "this agent is configured for a desk phone" -- and refusing is correct, not an override of the
agent application. It is a refusal, never a negotiation afterwards and never a quiet substitution, and it is
never retryable: trying again does not reconfigure the agent, and an agent application validating the answer
(`validateAuthenticationResult`) refuses a phone refusal marked otherwise
(`authentication.failure.phone.retryable`). And **a
provider never makes a declared phone true by changing the platform's configuration**: the record
is the administrator's, and a login is not a request to reconfigure an agent.

### Opening the audio

`openAudio` hands Omni the remote audio for one task. Every adapter whose manifest lists
`softphone` implements it, because on a softphone the call's audio lands in Omni:

```ts
openAudio({ assignmentId, localAudio }): Promise<OpenAudioResult>
// { status: "opened", session } | { status: "unavailable", failure }
```

The adapter speaks whatever its platform speaks — SIP over WebSocket, a vendor SDK, plain
WebRTC — and **none of that appears in this contract**. Registration, signalling, credential
renewal and reconnect are the adapter's, exactly as its authentication and transport already
are. Omni owns what belongs to the agent application: the microphone, the output element, mute, and when a
session ends — owning the microphone meaning capturing it, prompting, retrying and reporting how
it stands, never deciding for the adapter what a missing one means (see **The agent application reports, the
adapter decides**).

| Member | Contract |
| --- | --- |
| `remoteAudio` | `MediaStream` Omni plays. |
| `setMuted(muted)` | Mutes the agent's microphone on this session. |
| `close()` | Releases the session. Omni calls it when the task ends. |

`localAudio` is the agent's microphone as Omni captured it, the same stream the agent application's report
carries as `audio.input.localAudio`, and absent while that input is `unavailable`. A provider that
bridges audio without an application-side input may ignore it; one that needs it and finds it absent
answers `unavailable` with a failure Omni shows the agent.

**When to ask is the provider's word, not Omni's guess.** On a softphone login, Omni opens audio on `task-audio-started`,
and on a task arriving with `audio: "started"` on a snapshot; it closes on `task-audio-ended` and
when the task ends. Between those words, nothing Omni's own senses report — a stream that drops, a
track that ends — moves the task or its audio.

**A task-scoped session does not oblige one call per task.** A platform holding a nailed-up
leg for a whole shift may return the same session for every task and release the underlying
path only when the connection closes. A platform placing a call per contact returns a new one
each time. Omni asks when it needs audio and closes when it is done; how that maps to the
platform is the adapter's business.

### The station is the agent application's

The microphone, the speaker, the headset and its buttons are the station's, and the station is the
agent application's. So mute is not a capability a provider declares, not a control a queue allows or a team
locks, not a preference the person keeps with the provider, and not a command: nothing about the
station crosses to the provider except two things -- the station's condition, in the agent application report,
and the record of when the agent could not be heard, through `recordStep`. An agent application offers Mute on
every voice task with audio open, under its own local policy, in `in-progress` and `paused`
alone, and performs it through `CallAudio.setMuted()`. A task carrying
`capabilities.mute` is refused (`task.capability.unknown`), and so is a `mute` command
(`command.type`), a `mute` preference (`preference.id`) and a `mute` policy (`team.policy.key`).

**Two mutes, and the agent application states which its Mute performs.** A *stream* mute stops the audio the
agent application sends: the microphone keeps capturing, the party hears silence, nothing else on the machine
changes, and every softphone agent application can do it. A *station* mute silences the microphone itself at
the operating system: every application on the machine goes quiet, the system shows it, and a
headset that follows the system follows it. Only a native agent application can do it. `Host.mute` says which
this agent application does -- `stream` or `station` -- stated on a softphone login, where the agent application holds the
microphone, and absent on a desk phone and off voice (`host.mute.required` / `.unexpected`). A
browser says `stream`. A native agent application says whichever it does. Nothing on the wire says what kind of
application the agent application is; a provider reads only what the agent application declared.

**A silenced device says who silenced it.** `audio.input.flowing: false` and
`audio.output.flowing: false` carry `mutedBy`: `host` when the agent application's own Mute did it -- which is
only ever true of an agent application whose mute is `station`, since a stream mute leaves the microphone
flowing -- and `station` when a slider on the headset or the operating system did, which the agent application
observed and did not do. Without the word, a station-muting agent application's own Mute would read as a fault
and an adapter would take the agent out of ready in the middle of a call. A browser reads a station
mute through the capture track's muted state, read-only, and cannot lift it; a native agent application reads
the endpoint and can clear an operating-system mute. A hardware slider is nobody's to clear.

**The record carries the same word.** A `muted` interaction leg is a period the agent could not be
heard, and the record exists so that period is not a hole. The agent application reports every such period
through `recordStep` -- its own Mute, and a station mute it observed during a call -- with
`mutedBy` saying whose the silence was, and the provider writes the word into the entry
(`task.history.mutedBy`). The report names no agent because the agent application has exactly one, and
the provider knows who that is: it attributes the leg to the login's agent in `by`, a fact it
holds and not an inference, for a station mute as much as for the agent application's own. An unattributed
`muted` entry is refused (`task.history.muted.by`); a shared handset's unattributed hold
is a different claim, and stands. A supervisor reading the record then sees "the agent muted for
forty seconds" and "the agent's headset was muted for forty seconds" as the different things they
are. See **The agent application records what it performs** in `guide/agent.md`.

**Mute has a lifecycle, and none of it is inferred.** A call that starts while the station is
already muted begins a `muted` leg the moment its audio starts, `mutedBy: "station"`. Audio that
ends while any leg is open ends the leg at that instant, as every agent application-performed leg ends. And the
agent application's own Mute starts off on every call, which is every `task-audio-started` -- a connect-back
opens a second call on the same task with no offer -- so an agent is never muted by the call before.

**Every press on a headset is the agent's own press**, performed the agent application's way, and the lights
follow the agent application's state. The `personConsent` guarantee is honoured by a hook-switch press exactly
as by a click. What a call-control headset sends, and what becomes of it:

| Input | Where it comes from | What the agent application does | What crosses to the provider |
| --- | --- | --- | --- |
| Mute button | The headset, on the HID Telephony usage page: a Phone Mute report on the press, a Mute LED the agent application writes back | A press of the agent application's Mute, performed the agent application's way; the LED follows the agent application's state, so button, light and control are one state with one owner | The `muted` leg, `mutedBy: "host"` |
| Hook switch | The headset, HID Telephony | A press of the agent application's Answer or End call, only where the task is in a phase that has one; the off-hook and ring lights follow the task | The existing `answer` and `end-call` commands |
| Flash, redial, speed dial | Older headsets and desk-phone style devices | Flash is Hold and Resume where the task offers `hold`; redial and speed dial map to nothing on a desk that never redials, and are ignored | Nothing new |
| Volume up and down | The headset's own amplifier, or the operating system through the consumer-control keys | Nothing: the device and the system handle it | Nothing, except that a speaker at nought is `audio.output.flowing: false` where the agent application can know it |
| Microphone gain and level | The operating system, the headset's own boost | A level meter, so the agent can see they are heard | Nothing: a level is a flicker, not a state |
| Hardware or operating-system mute | A slider on the headset, the system's input mute | Observes it, publishes `flowing: false, mutedBy: "station"`, records the leg during a call, and tells the agent which it is where it knows -- headset or system -- and what to do; an agent application whose mute is `station` clears a system mute itself, a browser can only say so | The report and the leg |
| Device changed, unplugged, permission revoked | The operating system | Re-capture, prompt, report | Already `audio.input` and `audio.output` with `lost`, `denied`, `no-device` |

**What the agent application shows.** Beside Mute, a standing line while the station is muted, saying which and
what to do, with a button that clears a system mute only on an agent application whose mute is `station`. The
Mute control does not pretend: while the station is muted it shows the agent cannot be heard and
that pressing it will not change that, and a press still toggles the agent application's own mute, so the two
states stay separate and the agent is not unmuted by surprise when the slider moves back. Before a
call, the same line in the ready state, so an agent does not learn of it from a silent customer;
whether work is held back is the adapter's decision from the report, as it is for every station
fact. Where a provider's own platform holds a mute of its own -- a bridge that silences a leg --
that is a fact about the switch, reported as the provider sees fit, and never the agent application's Mute.

### The phone's own view

There are two views of a call, and the contract carries both. The task side says which calls are
the agent's work and where each stands: the phase, the audio, the room. The phone side is the
device: whether it can take a call at all, its own mute, and the calls on it, which exist whether
or not a task is behind them -- an internal call on the extension, a lead's listening leg, a call
the platform put on the phone that the desk never saw as a task. The host's report covers neither:
it says what the station has, a microphone and a speaker, and cannot say whether the phone is
registered. The platform sees the phone, so this is the provider's to publish, as `Snapshot.phone`
and `phone-updated`, from a manifest that declares `phoneStatus` (`snapshot.phone.required`,
`snapshot.phone.unexpected`, `event.phone.capability`).

```ts
// a conference in progress on alloc-42 -- one channel, since the bridge mixes -- with alloc-43 parked
const busy: PhoneState = { phone: "deskPhone", status: "ready", muted: true, channels: [
  { state: "active", since: "2026-09-12T10:30:04Z", assignmentId: "alloc-42" },
  { state: "held", since: "2026-09-12T10:35:20Z", assignmentId: "alloc-43" },
] };
// an internal call on the extension the desk never saw as a task
const internal: PhoneState = { phone: "deskPhone", status: "ready", channels: [{ state: "active", since: "2026-09-12T11:02:00Z" }] };
// a desk phone the platform lost
const down: PhoneState = { phone: "deskPhone", status: "unregistered", since: "2026-09-12T10:41:00Z", channels: [] };
```

**The device.** `status` is the phone itself: `ready` is registered and usable, idle or busy, and
the other three are the states in which nothing can land, each wanting a different fix.

| `status` | Meaning |
| --- | --- |
| `ready` | Registered and usable, idle or busy. |
| `unregistered` | The platform has lost the phone: no registration from the extension, no route to the handset. Nothing can land, and no channel is on it (`phone.status.channels`). |
| `do-not-disturb` | The agent pressed it on the device. Nothing lands until they clear it; it is not a break, and the provider assigns or not as its platform does. |
| `off-hook` | The handset is up with no call on it, and no channel is on it. |

`phone` is the agent's device for this provider: the one the host chose for the login at
connect, from the manifest's phones, as the way the agent hears this provider's calls. A state
naming the other is the wrong phone (`phone.phone.mismatch`). The phone is the agent's; the login
is the agent's session with the provider, and what belongs to the login is that choice. `since` is when the status began, counted from the
provider's clock like every duration off the active call, and omitted rather than invented.

**The channels.** The phone has one active audio channel and any number held
(`phone.channel.active.single`), and a bridge is one channel: a conference is one entry, and its
members are on the task's `onCall`, never repeated here. Each channel is `ringing`, `active` or
`held`, since when, and names the task its call is where it is one. **Where a channel is a task's,
the two views agree** (`phone.channel.task`): `active` with the task at work and its audio
started, `held` with the task `paused`, `ringing` with the task `pending` or its party ringing on
`onCall`; and a task with its audio started has a channel (`phone.channel.missing`), since the
phone carries every call the desk is on. A channel naming no task is the phone's alone, and the
desk shows it as a call it cannot act on.

**The mute is the phone's, and it silences whatever is active.** It is one flag on the phone, not
a property of a channel: whichever channel is active is silent while it is set, and the held
channels are unaffected. Who owns it follows the phone. On a desk phone the mute button is the
handset's, and the platform observes it or does not: `muted: true` where it does, absent where it
does not, never invented. On a softphone the microphone is the host's, its mute is the host's
report as **The station is the agent application's** sets out, and nothing the provider publishes
moves it: `muted` on a softphone's state is the platform echoing the host, and is refused
(`phone.muted.softphone`). The `muted` step in the record stays what it is, the account of a leg,
never the live flag.

**The lead sees the member's phone as the member does.** The member on the team member list
carries the same `PhoneState`, republished with the member on every change, so a desk phone that
is down, or a call on it that is no task, shows the same on both screens, and neither derives it
from anything else.
