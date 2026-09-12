# `@xema/omni-protocol` API contract

This document is the normative contract between Omni Agent and a provider adapter. It describes
observable behavior in addition to TypeScript shapes. When an example and a type declaration
appear to disagree, the exported TypeScript declaration is authoritative over the example; when a
declaration's comment and this document's prose disagree, the prose is authoritative and the
comment is a defect.

All protocol definitions and code examples are written as valid TypeScript. Samples should name
their contract type or use `satisfies` so the relationship between the example and the contract is
visible and compiler-checkable. Use another language only when the artifact itself is not
TypeScript.

## The guide in files

This file holds what every reader needs and what the others rely on: the terms, the shapes, the
contract rules, how an adapter is declared, signed in, connected and heard from, and how a
conformance run holds it to all of that. The rest is by role and by channel, one file each, and
every cross-reference names the file it points into.

| File | |
| --- | --- |
| `guide/agent.md` | **The agent's work.** What an agent does on any channel: the assignment from offer to wrap, the task and its record, the controls a task offers, the commands the desk sends. |
| `guide/voice.md` | **Voice.** What is true of a call and of nothing else: preview, connecting back, ending a call, conference, every dial and its outcome, recording. |
| `guide/phone.md` | **The phone.** How the agent hears the call: softphone and desk phone, the station and its headset, opening the audio, the microphone and the record. |
| `guide/chat.md` | **Chat.** What is true of a chat and of nothing else. |
| `guide/email.md` | **Email.** What is true of an email and of nothing else. |
| `guide/queue.md` | **The agent's own queue.** The next call, lined up for this agent while they finish the one they are on: the ask, the lined-up call, and the release. |
| `guide/breaks.md` | **Breaks.** Asking for a break, a break forced on the agent, capacity, and one break across several providers. |
| `guide/lead.md` | **Team leads.** The lead's own surface: the team member list, the lead's commands, lead assist, listening to a call. |

## Terms

**Define a vocabulary; do not merely list it** applies to this document's own prose. These words
are used precisely throughout and mean nothing looser here.

| Word | What it means |
| --- | --- |
| **Omni** | The desktop application an agent works in. It composes several providers into one agent-facing experience and owns everything outside a provider's own system. |
| **Agent application** | The software the agent uses, such as Omni, whether web or desktop. It presents provider tasks and controls and manages local audio where supported. Existing API names use `Host` and `host` for this role. |
| **Provider** | One independently connected external system: a voice platform, a chat platform, a mail platform. |
| **Adapter** | The package implementing this contract for one provider. One adapter is one provider, so the words are often interchangeable; *provider* names the system, *adapter* the code speaking for it. |
| **Agent** | The person signed in and taking work. On `onCall`, `agent` is a person on the call by user id; a conference directory may include an agent when the provider publishes that directory item. |
| **Lead** | An agent whose login declares `capabilities.lead`. The flag lets the agent application offer the team feature; the application switches it on with `lead-features` on every connect, and only then does the provider publish the team -- whole on `team-updated`, then one member at a time -- to that login and to nobody else: **the login is the permission**. The lead sees their members with their tasks and stats, and acts on them with the authority the flag carries. |
| **Local policy** | Rules configured by the agent application about this agent, outside the provider protocol and never sent to a provider. It gates whether an offer may be rejected, whether the agent goes ready on login, and whether tasks are auto-accepted. Where a capability and local policy disagree, the stricter wins. |
| **Call** | The caller’s complete phone call, which may continue through IVRs, queues and several agents. The protocol never describes the IVR or the queue; it carries the call's history and details to whichever agent holds it now. |
| **Assignment** | The call routed to this agent, from the offer until the task ends. It is the one thing that crosses: the provider assigns, names the assignment with `assignmentId`, and that is the only name the desk ever uses back. A call that comes back is a new assignment on the same call, and a declined or lapsed offer is an assignment that became nothing more. What the platform calls its own record, and whether it reuses that name, is the adapter's business and unknown to the desk. |
| **Interaction** | The agent's time on the call, from answer until their audio ends: the `in-progress` and `paused` phases. An assignment produces at most one interaction, and a call that returns produces a new assignment and so a new interaction. |
| **Task** in `guide/agent.md` | The desk's record of one assignment, from offer through wrap: the workspace, controls and completion work the agent has for it, described by the provider and held by the desk. A task is identified by the assignment it is the record of. `pending`, `confirmed` and `preview` are assigned and not yet interacting; `in-progress` and `paused` are the interaction; `completing` is the assignment outliving its interaction. A voice task is one assignment, never the caller's whole call. |
| **Channel** | The kind of work a provider carries: `voice`, `chat`, or `email`. Fixed per provider by its manifest. |
| **Task type** | The provider's own name for a category of work — a queue, a mailbox folder, a chat source. Free-form, and finer-grained than a channel. |
| **Capability** | A provider's declaration that a control exists for a task or a session. It says *offer this*; the provider performs it, and the agent application only offers it — see **Where a command executes** in `guide/agent.md`. |
| **Login** | One authenticated sign-in to one provider, identified by `loginId`. A transport reconnect keeps it; signing in again replaces it, and nothing tied to the old `loginId` survives. |
| **Transport** | The adapter's connection to its platform: a WebSocket or SignalR connection, required to be persistent and ordered. Which one and how it reconnects are the adapter's business; losing it does not end a login. |
| **Connection** | The `Connection` object Omni holds for one login: the methods it can call and the events it receives. |
| **Concurrent capacity** | How many tasks this provider may have assigned to the agent at once — an absolute ceiling, stated as `AgentCapacity.count` and standing until Omni restates it. The provider counts its own outstanding tasks against it. |
| **Snapshot** | The provider's complete state at one moment. It replaces what Omni holds; it is never a patch. |
| **Event** | One completed transaction reported after a snapshot established the baseline. |
| **Break** | A reported, supervised state in which the agent is not working — one with a reason, a decision behind it and a return. It covers what a platform may call *not-ready*, including equipment trouble. An agent who is merely at capacity is not on a break. |
| **Workspace** | What Omni shows the agent. The **task workspace** holds the selected task, its controls and its browsers; the **idle workspace** holds what a provider contributes when no task is selected — dialpad, contacts, calendar, team member list. |
| **Dial** | One outbound call the agent application asks a provider to place — from the idle dialpad, a preview's Call, a conference add, or a connect-back. Identified by the agent application's `dialId`, accepted as `dialling`, and ended by exactly one `dial-outcome`. See **Every dial has an outcome** in `guide/voice.md`. |
| **Listen** | A lead's channel in a member's call, unasked, from the team member list: `listen` in silence, `coach` heard by the agent alone, `join-call` heard by everyone. It is a team act naming the member, never a task on the lead's desk; `listen` and `coach` leave no trace on the member's task, while a lead heard by everyone is on its `onCall` as an `agent`. Every lead sees every lead on the call. A lead who wants the call takes it over. See **Listening to a call** in `guide/lead.md`. |
| **On the call** | Who a voice task's audio joins, or is bringing in, as the provider states it on `Task.onCall`: the party, the agents, and anyone conferenced in from the moment their dial is placed. |

These fields describe state within their containing objects. Both authentication and break
state use `status`; name the object when discussing them to avoid ambiguity.

| Word | Belongs to | Values |
| --- | --- | --- |
| `phase` | A task | `pending`, `confirmed`, `preview`, `in-progress`, `paused`, `completing` |
| `audio` | A task's audio | `started`, `ended` |
| `transport` | A connection | `connecting`, `active`, `error` |
| `status` | An authentication session | `signed-out`, `authenticating`, `authenticated`, `refreshing`, `expired` |
| `status` | The agent’s break lifecycle | `not-requested`, `awaiting-approval`, `granted`, `starting-after-task`, `on-break` |
| `availability` | A team member | `ready`, `on-task`, `on-break`, `elsewhere`, `signed-out` |

Migration: describeUsers is now `getUserDetails`, and validateDescribedUsers is now
`validateUserDetails`. Related diagnostics use getUserDetails. Hosts and providers must
update together; the old method and validator have no compatibility aliases. The requested
user IDs, returned user details and directory requirements are unchanged.

## Versioning

### `OMNI_PROTOCOL_VERSION`

The exact protocol version implemented by this package. The current value remains `1` during pre-release development. Recording contract changes do not introduce a new protocol version. Hosts and adapters adopt the current declarations together; this does not provide compatibility mapping for older recording shapes.

### `Manifest.supportedProtocolVersions`

An adapter declares **every** version it can speak, not just the one it was compiled against:

```ts
supportedProtocolVersions: [1]        // v1 only
supportedProtocolVersions: [1, 2]     // can serve either agent application
```

A single pinned version would make migration impossible: recompiling against a newer package
would silently move an adapter to the new version with no window in which both sides
interoperate. Declaring a set lets an adapter support the old and new agent application at once, so the two
can be deployed independently.

### `negotiateProtocolVersion(adapterVersions, hostVersions?)`

Returns the highest version both sides support, or `undefined` when they share none. Omni must
refuse to connect on `undefined`; silently attempting partial compatibility is not permitted.

```ts
negotiateProtocolVersion([1, 2], [2, 3]);   // 2
negotiateProtocolVersion([1], [2]);         // undefined — refuse to connect
```

Omni negotiates the version before it creates an authentication session. The selected
`protocolVersion` is included in both `AuthenticationContext` and `ConnectContext` and remains
fixed for that login, including transport reconnects. An adapter that advertises several versions
must use this value to select the corresponding contract behavior.

## Semantic types

This section is the registry for protocol-wide semantic aliases. Add an alias here when two values
share a primitive wire representation but have different domain meaning or validation rules. Use
the semantic name in every contract field rather than repeating the primitive type.

```ts
type IsoTimestamp = string;
type UserId = string;
type AssignmentId = string;
type DialId = string;
type DurationSeconds = number;
```

| Semantic type | Wire type | Meaning and constraints |
| --- | --- | --- |
| `IsoTimestamp` | `string` | An RFC-3339 timestamp with `Z` or an explicit numeric offset. Timezone-less values are invalid. It must pass the shared runtime validator. A JavaScript `Date` never crosses the protocol boundary. |
| `UserId` | `string` | A non-empty, opaque, stable identifier for a person, **issued by the provider** and drawn from the same directory as `AuthenticationState.identity.id`. It names agents and managers alike; the role is established by where the value appears, not by its type. Compare it exactly and only within one provider; do not parse it or infer meaning from its format. |
| `AssignmentId` | `string` | A non-empty, opaque identifier for one assignment, **issued by the provider**: unique within the provider and never reused while the provider is still speaking about it. Whether it is the platform's own handle passed through or one the adapter minted is the adapter's business. Omni scopes it with the provider ID -- see `assignmentKey()`. |
| `DurationSeconds` | `number` | A non-negative integer duration measured in seconds. |

### There is no Omni-wide user identity

Every person named in this protocol is named by the provider that reported them. Omni holds no
identifier of its own for an agent or a manager, and none crosses this boundary — not the
operating-system account, not a directory identity, not a licence.

So a `UserId` means nothing outside the provider that issued it. Provider A's
`history[].by` and provider B's team member `id` are unrelated strings that will
eventually collide, and one person on several providers has several identities that nothing here
pairs. Scope every user identifier with its provider ID before storing or comparing it, exactly as
`assignmentKey()` already does for tasks — see `userKey()` under **Utilities**.

## Shapes

Every data shape and published constant this contract names, declared once. The sections that
follow explain what each field means and when to send it; this is where a reader checks a name an
example uses.

Three method surfaces are not here — `Adapter`, `Connection` and `AuthenticationSession`. They are
defined by what they do rather than what they hold, and each has its own table: **Declaring an
adapter**, **Live connection**, and **Authenticating with a provider**.

### Channel and identity

```ts
type Channel = "voice" | "chat" | "email";

type TimeZone = string;

type User = {
  id: UserId;
  displayName: string;
  timeZone: TimeZone;
};

type Attribute = { key: string; value: string };
```

`Attribute` is the same key/value detail on a `Contact` and a `ScheduledActivity`. A task's
`attributes` are a different, typed shape — see `TaskAttribute`.

### Manifest

```ts
type AuthenticationMethod = "browser-sso" | "credentials";

type BrowserAccess = {
  mode: "allow-all" | "block-all";
  allowList?: string[];
  blockList?: string[];
};

type PersonalBrowserCapability = {
  access: BrowserAccess;
  accessAppliesTo: "initial-url" | "all-navigation";
};

type DialDestinations = "contacts-only" | "any-number";

type DialCapability = { destinations: DialDestinations };

type DialOutcome = "answered" | "busy" | "no-answer" | "unreachable" | "rejected" | "cancelled" | "unexplained";

type Phone = "softphone" | "deskPhone";

type PhoneStatus = "ready" | "unregistered" | "do-not-disturb" | "off-hook";

type PhoneChannelState = "ringing" | "active" | "held";

type PhoneChannel = {
  state: PhoneChannelState;
  since: IsoTimestamp;
  assignmentId?: AssignmentId;
};

type PhoneState = {
  phone: Phone;
  status: PhoneStatus;
  muted?: true;
  since?: IsoTimestamp;
  channels: PhoneChannel[];
};

type IdleCapabilities<C extends Channel = Channel> = {
  personalBrowser?: PersonalBrowserCapability;
  calendar?: true;
  contacts?: true;
} & (C extends "voice" ? { dial?: DialCapability } : { dial?: never });

type Manifest<C extends Channel = Channel> = {
  id: string;
  displayName: string;
  channel: C;
  supportedProtocolVersions: number[];
  authenticationMethods: AuthenticationMethod[];
  idleCapabilities?: IdleCapabilities<C>;
  timeCheck?: true;
  timestampAuthority?: "provider";
  phaseLabels?: TaskPhaseLabels;
  taskTypePresentation?: Record<string, TaskTypePresentation>;
  orgLevels?: LevelDeclaration[];
  dialOutcomes?: C extends "voice" ? DialOutcome[] : never;
  phones?: C extends "voice" ? Phone[] : never;
  phoneStatus?: C extends "voice" ? true : never;
  runningStepReports?: true;
  settleMs: number;
};
```

**Closed sets are string-literal unions, never `enum`.** An `enum` is the one TypeScript construct
that is not type-only — it emits runtime code, which no other declaration here does — and it does
not narrow inside a union as cleanly. Where a wire value is also the name you would want to type,
as `"contacts-only"` is, the union alone is enough.

A named constant is added only where the wire value is *not* something to type at a call site.
`BROWSER_ISOLATION_SCHEMES` is the one case: its values are structured strings, easy to mistype and
unreadable as an argument, so the symbolic name earns its keep — and the constant-plus-derived-union
pattern is the same one `TASK_COMMAND_NAMES` and `TaskCommandName` already use.

These serialized strings are stable protocol values and must not be renamed or reused.

### Presentation

```ts
type TaskPhaseLabels = Readonly<Partial<Record<TaskPhase, string>>>;

type TaskTypePresentation = {
  singular: string;
  plural: string;
  referenceLabel?: string;
};
```

### Authentication and connection

```ts
type SecretStore = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type AuthenticationContext = {
  protocolVersion: number;
  loginId: string;
  timeZone: TimeZone;
  phone?: Phone;
  secrets: SecretStore;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
};

type ListeningMode = "listen" | "coach" | "join-call";

type UserCapabilities = {
  breaks?: true;
  preferences?: AgentPreference[];
  lead?: true;
  nextCall?: true;
};

type AuthenticationState =
  | { status: "signed-out" }
  | { status: "authenticating" }
  | { status: "authenticated"; identity: User; capabilities: UserCapabilities; expiresAt?: IsoTimestamp }
  | { status: "refreshing"; identity: User; capabilities: UserCapabilities }
  | { status: "expired"; identity?: User; failure?: AuthenticationFailure };

type AuthenticationFailure = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  field?: string;
};

type HostAudioUnavailableReason = "no-device" | "denied" | "not-asked" | "in-use" | "lost";
type HostOutputUnavailableReason = "no-device" | "lost";

type MutedBy = "host" | "station";

type HostMute = "stream" | "station";

type HostAudioInput =
  | ({ status: "available"; localAudio: MediaStream } & ({ flowing: true; mutedBy?: never } | { flowing: false; mutedBy: MutedBy }))
  | { status: "unavailable"; reason: HostAudioUnavailableReason; failure: ProtocolFailure };

type HostAudioOutput =
  | ({ status: "available" } & ({ flowing?: true; mutedBy?: never } | { flowing: false; mutedBy: MutedBy }))
  | { status: "unavailable"; reason: HostOutputUnavailableReason; failure: ProtocolFailure };

type UrlVisibility = "full" | "domain" | "hidden";

type RecordingSource = "provider" | "host";
type RecordingAction = "start" | "pause" | "resume" | "stop" | "cancel";
const RECORDING_ACTIONS = ["start", "pause", "resume", "stop", "cancel"] as const satisfies readonly RecordingAction[];
interface RecordingActions {
  start?: true;
  pause?: true;
  resume?: true;
  stop?: true;
  cancel?: true;
}
interface TaskRecordingPolicy {
  provider?: RecordingActions;
  host?: RecordingActions & { storageId: string };
}
type RecordingState =
  | { status: "unknown"; observationId?: never; observedAt?: never; validUntil?: never; recordingId?: never }
  | ({ observationId: string; observedAt: IsoTimestamp; validUntil: IsoTimestamp } & (
      | { status: "inactive"; recordingId?: never }
      | { status: "active" | "paused"; recordingId: string }
    ));
type RecordingCommand = {
  type: "recording";
  source: RecordingSource;
  observationId: string;
} & (
  | { action: "start"; recordingId?: never }
  | { action: "pause" | "resume" | "stop" | "cancel"; recordingId: string }
);
interface HostRecordingReport {
  assignmentId: AssignmentId;
  state: RecordingState;
}
interface HostRecording {
  announcesToCaller?: true;
  actions: RecordingAction[];
  storageIds: string[];
  execute(request: HostRecordingRequest): Promise<RecordingCommandResult>;
}
type RecordingCommandResult = Exclude<TaskCommandResult, { status: "dialling" }>;
interface HostRecordingRequest {
  assignmentId: AssignmentId;
  command: RecordingCommand & { source: "host" };
}

type HostReport = {
  recordings?: HostRecordingReport[];
  online: boolean;
  audio?: {
    input: HostAudioInput;
    output: HostAudioOutput;
  };
};

type HostGuarantees = {
  browserUrlVisibility?: true;
  personConsent?: true;
};

type ProviderTimeScope = { providerId: string; loginId: string };
type ProviderTimeEstimate = ProviderTimeScope & {
  at: IsoTimestamp;
  clockId: string;
  uncertaintyMs?: number;
};

type Host = {
  estimateProviderTime?(scope: ProviderTimeScope): ProviderTimeEstimate | undefined;
  recording?: HostRecording;
  guarantees: HostGuarantees;
  mute?: HostMute;
  report(): HostReport;
  subscribe(listener: (report: HostReport) => void): Unsubscribe;
};

type LoginStore = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

type ConnectContext = {
  protocolVersion: number;
  loginId: string;
  autoAcceptTasks: boolean;
  timeZone: TimeZone;
  store: LoginStore;
  phone?: Phone;
  host: Host;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
} & (
  | { phone: "softphone"; host: { mute: HostMute } }
  | { phone?: "deskPhone"; host: { mute?: never; recording?: never } }
);

type TransportStatus = "connecting" | "active" | "error";

type CredentialField = {
  name: string;
  label: string;
  type: "text" | "password";
  required?: boolean;
  autocomplete?: string;
};

type AuthenticationChallenge =
  | { flowId: string; method: "browser-sso"; authorizationUrl: string; browser: "system" | "omni" }
  | { flowId: string; method: "credentials"; fields: CredentialField[] };

type StartAuthenticationRequest =
  | { requestId: string; method: "browser-sso"; callbackUrl: string }
  | { requestId: string; method: "credentials" };

type StartAuthenticationResult =
  | { status: "interaction-required"; challenge: AuthenticationChallenge }
  | { status: "rejected"; failure: AuthenticationFailure };

type CompleteAuthenticationRequest =
  | { flowId: string; method: "browser-sso"; callbackUrl: string }
  | { flowId: string; method: "credentials"; values: Readonly<Record<string, string>> };

type CompleteAuthenticationResult =
  | { status: "authenticated"; identity: User; capabilities: UserCapabilities; expiresAt?: IsoTimestamp }
  | { status: "rejected"; failure: AuthenticationFailure };

type AuthenticationActionResult =
  | { status: "applied" }
  | { status: "failed"; failure: AuthenticationFailure };

type Unsubscribe = () => void;

type AuthenticationSession = {
  state(): AuthenticationState | Promise<AuthenticationState>;
  subscribe(listener: (state: AuthenticationState) => void): Unsubscribe;
  start(request: StartAuthenticationRequest): Promise<StartAuthenticationResult>;
  complete(request: CompleteAuthenticationRequest): Promise<CompleteAuthenticationResult>;
  cancelAuthentication(flowId: string): Promise<AuthenticationActionResult>;
  signOut(): Promise<AuthenticationActionResult>;
  close(): Promise<void>;
};
```

### Provider state

```ts
type PreferenceId = "hold" | `skill:${string}`;

type SetBy = Level | "provider";

type Resolved = {
  setBy: SetBy;
  lockedBy?: Level;
  reason?: string;
};

type AgentPreference = Resolved & {
  id: PreferenceId;
  label: string;
  enabled: boolean;
};

type SetPreferenceRequest =
  | { id: PreferenceId; enabled: boolean }
  | { id: PreferenceId; inherit: true };

type HistoryReport = { assignmentId: AssignmentId; at: IsoTimestamp } & (
  | { step: "muted"; mutedBy: MutedBy }
  | { step: Exclude<HistoryStep, "muted">; mutedBy?: never }
) & (
  | { ended: true; seconds: DurationSeconds }
  | { ended?: never; seconds?: DurationSeconds }
);

type HistoryReportResult =
  | { status: "recorded"; at: IsoTimestamp }
  | { status: "failed"; failure: ProtocolFailure };

type PreferenceResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };

type Snapshot = {
  transport: TransportStatus;
  loginId: string;
  providerTime?: IsoTimestamp;
  break: BreakState;
  tasks: Task[];
  taskCount: number;
  contacts?: Contact[];
  calendar?: ScheduledActivity[];
  shift?: Shift;
  phone?: PhoneState;
  nextCall?: NextCallRequest;
  linedUp?: LinedUpCall;
  team?: TeamMembers;
};

type AgentCapacity = {
  count: number; // absolute ceiling, zero or more; zero is agent application-stopped
};

type CapacityResult = { status: "applied" };
```

### Idle contributions

```ts
type Contact = {
  name?: string;
  number?: Lockable<string>;
  email?: Lockable<string>;
  attributes?: Attribute[];
};

type ScheduledActivity = {
  id: string;
  title: string;
  startsAt: IsoTimestamp;
  endsAt?: IsoTimestamp;
  party?: Contact;
  attributes?: Attribute[];
};

type DialRequest = {
  dialId: DialId;
  destination: string;
};

type DialResult =
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };
```

### Task capabilities

```ts
type OutcomeCode = { id: string; label: string; group?: string };

type OutcomeRules = {
  required?: boolean;
  notes?: "required" | "optional" | "none";
  codes?: OutcomeCode[];
};

type Destination = {
  id: string;
  label: string;
};

type DestinationDirectory = {
  destinations: Destination[];
};

type CustomCapability = {
  id: string;
  ui: {
    control: "button" | "toggle" | "menu-item";
    label: string;
    placement: "primary" | "secondary" | "overflow";
    render: "inline" | "page";
  };
  prompt?: { fields: CredentialField[] };
};

type SharedTaskCapabilities = {
  browsers?: true;
  outcomes?: true | OutcomeRules;
  custom?: CustomCapability[];
};

type TaskCapabilities<C extends Channel = Channel> =
  C extends "voice"
    ? SharedTaskCapabilities & {
        decline?: Lockable<true>;
        hold?: Lockable<true>;
        endCall?: Lockable<true>;
        terminateCall?: Lockable<true>;
        connectBack?: Lockable<true>;
        schedule?: Lockable<true>;
        leadAssist?: Lockable<true>;
        conference?: Lockable<DestinationDirectory>;
        recording?: Lockable<TaskRecordingPolicy>;
      }
    : C extends "chat"
      ? SharedTaskCapabilities & { decline?: Lockable<true>; hold?: Lockable<true>; schedule?: Lockable<true> }
      : SharedTaskCapabilities & { decline?: Lockable<true>; schedule?: Lockable<true> };
```

The channel arms are why `Task<"email">` rejects `hold` at compile time rather than at runtime.

### Task workspace

```ts
const BROWSER_ISOLATION_SCHEMES = {
  PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME: "ProviderName.AssignmentId.TabName",
  TAB_NAME: "TabName",
  PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME: "ProviderName.TaskTypeName.TabName",
  PROVIDER_NAME__TAB_NAME: "ProviderName.TabName",
  PROVIDER_NAME__TASK_TYPE_NAME: "ProviderName.TaskTypeName",
  TASK_TYPE_NAME__TAB_NAME: "TaskTypeName.TabName",
} as const;

type BrowserIsolationScheme =
  (typeof BROWSER_ISOLATION_SCHEMES)[keyof typeof BROWSER_ISOLATION_SCHEMES];

type Browser = {
  id: string;
  name: string;
  url: string;
};

type TaskBrowser = Browser & {
  purpose: string;
  urlVisibility?: UrlVisibility;
} & (
  | { sharedSession: false; isolationScheme?: never }
  | { sharedSession: true; isolationScheme: BrowserIsolationScheme }
);

type PersonalBrowser = Browser;

type BrowserSessionKeyInput = {
  providerId: string;
  assignmentId: AssignmentId;
  taskType: string;
  browser: TaskBrowser;
};
```

That union is what makes a reusing browser with no scheme fail to compile rather than inherit a
default — see **Choosing an isolation scheme**.

### Task

```ts
type TaskPhase =
  | "pending"
  | "confirmed"
  | "preview"
  | "in-progress"
  | "paused"
  | "completing";

type CompletionMode = "agent-command" | "provider-automatic";

type TaskAttributeBase = {
  key: string;
  label?: string;
};

type TaskAttribute = TaskAttributeBase & (
  | { type: "text"; value: string }
  | { type: "contact"; party: Contact }
  | { type: "timestamp"; at: IsoTimestamp }
);

type HistoryStep =
  | "queued"
  | "offered"
  | "answered"
  | "held"
  | "muted"
  | "transferred"
  | "conferenced"
  | "unanswered";

type TaskHistory = {
  steps: TaskHistoryStep[];
  interactionSeconds?: DurationSeconds;
  holdSeconds?: DurationSeconds;
  queueSeconds?: DurationSeconds;
  transfers?: number;
};

type TaskHistoryStep = {
  step: HistoryStep;
  at: IsoTimestamp;
  dialId?: DialId;
  destinationId?: string;
  seconds?: DurationSeconds;
  by?: UserId;
  mutedBy?: MutedBy;
};

type TaskCompletion =
  | { completionMode: "agent-command"; wrapAllowance?: DurationSeconds }
  | { completionMode: "provider-automatic"; wrapAllowance: DurationSeconds };

type OnCallRole = "party" | "agent" | "conferenced";

type OnCallStage = "ringing" | "joined";

type OnCall = { since: IsoTimestamp; held?: true } & (
  | { role: "party"; dialId?: never; stage?: never }
  | { role: "party"; stage: OnCallStage; dialId?: DialId }
  | { role: "agent"; userId: UserId }
  | { role: "conferenced"; destinationId: string; stage: OnCallStage; dialId?: DialId; label?: string }
);

type TaskLeadAssist = { note?: string; since: IsoTimestamp } & (
  | { stage: "requested"; leadId?: never }
  | { stage: "joined"; leadId: UserId }
);

type TaskTakenOver = {
  memberId: UserId;
  since: IsoTimestamp;
};

type Level = string;

type LevelDeclaration = {
  id: Level;
  label: string;
};

type Locked = {
  lockedBy: Level;
  reason?: string;
};

type Lockable<T> = T | Locked;

type TaskAudioState = "started" | "ended";

type CapabilitySource = "queue" | "nobody" | "not-yet-read";

type Task<C extends Channel = Channel> = {
  assignmentId: AssignmentId;
  title: string;
  channel: C;
  taskType: string;
  capabilities: TaskCapabilities<C>;
  capabilitySource: CapabilitySource;
  browsers: TaskBrowser[];
  party?: Contact;
  phase: TaskPhase;
  acceptance?: AcceptanceMode;
  expiresInSeconds?: DurationSeconds;
  previewEndsInSeconds?: DurationSeconds;
  atDeadline?: PreviewDeadline;
  wrapEndsInSeconds?: DurationSeconds;
  reference?: string;
  attributes?: TaskAttribute[];
  history?: TaskHistory;
} & TaskCompletion & (
  C extends "voice"
    ? { recording?: { provider?: RecordingState }; onCall?: OnCall[]; leadAssist?: TaskLeadAssist; takenOver?: TaskTakenOver; audio?: TaskAudioState }
    : { recording?: never; onCall?: never; leadAssist?: never; takenOver?: never; audio?: never }
);

type PreviewDeadline = "provider-dials" | "host-dials" | "waits";

type AcceptanceMode =
  | "no-preference"
  | "consent"
  | "automatic";

type TaskOutcome =
  | { type: "completed"; by: "agent" | "provider" }
  | { type: "taken-over"; leadId: UserId }
  | { type: "cancelled"; by: "agent" | "provider" | "party"; reason?: string }
  | { type: "expired"; phase: "pending" | "confirmed" }
  | { type: "failed"; failure: ProtocolFailure };
```

### Task commands

```ts
const TASK_COMMAND_NAMES = {
  voice: [
    "answer",
    "decline",
    "dial",
    "hold",
    "resume",
    "end-call",
    "terminate-call",
    "connect-back",
    "lead-assist",
    "conference",
    "recording",
    "schedule",
    "complete",
  ],
  chat: ["accept", "decline", "pause", "resume", "schedule", "complete"],
  email: ["accept", "decline", "schedule", "complete"],
} as const;

type TaskCommandName<C extends keyof typeof TASK_COMMAND_NAMES> =
  (typeof TASK_COMMAND_NAMES)[C][number];

type OutcomePayload = { outcome?: string; notes?: string };

type VoiceTaskCommand =
  | { type: "answer" }
  | { type: "decline" }
  | { type: "dial"; dialId: DialId }
  | { type: "hold" }
  | { type: "resume" }
  | { type: "end-call" }
  | { type: "terminate-call" }
  | { type: "connect-back"; dialId: DialId }
  | ScheduleCommand
  | { type: "lead-assist"; action: "request"; note?: string }
  | { type: "lead-assist"; action: "cancel" }
  | { type: "conference"; action: "add"; dialId: DialId; destinationId: string }
  | { type: "conference"; action: "remove"; destinationId: string; party?: never }
  | { type: "conference"; action: "remove"; party: true; destinationId?: never }
  | (RecordingCommand & { source: "provider" })
  | ({ type: "complete" } & OutcomePayload);

type ScheduleCommand = { type: "schedule"; at: IsoTimestamp; note?: string };

type ChatTaskCommand =
  | { type: "accept" }
  | { type: "decline" }
  | { type: "pause" }
  | { type: "resume" }
  | ScheduleCommand
  | ({ type: "complete" } & OutcomePayload);

type EmailTaskCommand =
  | { type: "accept" }
  | { type: "decline" }
  | ScheduleCommand
  | ({ type: "complete" } & OutcomePayload);

type CustomTaskCommand = { type: "custom"; name: string; [key: string]: unknown };

type TaskCommand<C extends Channel = Channel> =
  | (C extends "voice" ? VoiceTaskCommand : C extends "chat" ? ChatTaskCommand : EmailTaskCommand)
  | CustomTaskCommand;

type TaskCommandRequest<C extends Channel = Channel> = {
  assignmentId: AssignmentId;
  command: TaskCommand<C>;
};

type TaskCommandResult =
  | { status: "applied" }
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };
```

### Who decides what an agent may do

An agent desk has two managers, not one. **The queue** — a process, a work type — is owned by a
process manager and **allows** a set of capabilities: hold, connect back, dial, conference,
whether the number is visible, the actions it offers, the skills it needs. **The people** are
managed through the organisation's structure — a team, a location, the organisation itself, in
whatever combination the structure defines for a person — and **decide** per capability within
what the queue allows: on for everyone, off for everyone, or left to the person. What you do to
your team is a **policy**; what you do to yourself is a **preference**. A person belongs to one
team and many queues, so a policy applies across every queue the person works.

**The provider resolves; the protocol carries the result and who decided.** The structure's levels
are the provider's ladder: each level states only what it sets, an enforcing policy at a level above
the person settles the value for everyone below it, and where nothing enforces the most specific
level that says anything wins. The protocol names a level by the id the manifest declares for it and
never describes the chain between them: which levels a person passes through is the structure's to
know. A typical organisation has four, and they are the defaults — `DEFAULT_LEVELS`: `org`, `site`,
`team`, `person`, each with the label a desk shows. A structure that differs states its whole
ladder in `Manifest.orgLevels`, `person` included: what the list carries is in force, and what it
leaves out does not exist — a structure with no site level declares `org`, `team`, `person`, and
`site` is refused on its wire. A declared level is one the provider's own store actually resolves
at: a label with no policy behind it decides nothing. A manifest that declares none has exactly
the four. `lockedBy` is any level in force except `person`, who never locks their own value;
`setBy` is any level in force, or `provider`, the protocol's word for "no level has said
anything and the provider's own configuration supplied the value". An agent application renders "who decided" from the
declared labels and needs no others, and validates every republished `authenticated` state
against them, not only the sign-in. What the wire carries is the resolution:

- **`lockedBy`** — a level above the person made this value theirs to keep. A person never locks
  their own value, and the queue is not a level: what the queue does not allow at all is absent.
- **`setBy`** — who stated the value as it stands: a level, the `person` themself, or
  `provider` where no level has said anything. Provenance, not a lock: a value that came from a
  broad level as a default is still the person's to change.

**On a task, a control the queue could allow may stand locked in its place.** `Task.capabilities`
is the effective set. What the queue does not allow is absent and nothing is shown. What the queue
allows and a level above the person locked is present as `{ lockedBy, reason? }` where the control's
value would be — `recording: { lockedBy: "team", reason: "Nobody on this team records" }` — and Omni
renders that control disabled, saying who decided, so an agent who cannot press Record knows whether
to ask their lead or their site. `lockedBy` is the discriminant: a value that carries it is the
lock, so nothing that can be locked — a directory, a number — may carry that key itself. A
contact's number and email are the same, since each identifies a person: where the queue says
the agent may not see it, the provider sends `{ lockedBy }` in its place — the last digits or
nothing — and a CRM link carries a token, never the value with a flag the desk is asked to honour.
**What the queue locks is locked on the whole task.** A number the agent may not see appears
nowhere else they read — not in the title, the reference, an attribute, a custom control's label,
or a browser URL the desk shows; a browser whose URL must carry it says `urlVisibility: "hidden"`.
The adapter is the one that knows the value, so it is the one held to it: given the values the
queue locked, the validator refuses any other field carrying one, digits compared as digits so no
formatting hides them (`task.locked.leak`), and a conformance run whose tasks lock a party's number
or email states those values in `lockedValues`, since a run that cannot ask the question is not a
pass. An agent application never has the value and never asks. A name is not locked.

**The lock is per audience.** Who sees the number is the provider's choice for each copy of the
task: the member's, on their desk, and the leads', on the team member list. Hidden from the agent
and shown to the lead, shown to the agent and hidden from the lead, hidden from both, shown to
both -- any of the four, as the platform's policy says, and each copy is the provider's statement
to that audience. Each copy keeps its own lock whole: where the lead's copy locks the number,
nothing else on that copy carries it, exactly as on the member's (`task.locked.leak`, applied to a
member's tasks with the same `lockedValues`). What the queue provides rather than permits — browsers, outcomes, custom
controls — is content, and is never locked.

**A lead sets the team's policy from their team member list.** A login that declares
`capabilities.lead` may `executeTeam({ command: { type: "set-policy", capability, setting } })`, where the provider offers policy control and says so by publishing `policies`,
with `on`, `off`, or `person`, for any task control, `dial`, or a skill — and only `hold`
and skills may be `person`; connect back and dial are the team's, on or off, within what the queue
allows. The team member list carries `policies` for such a login: every policy as it stands, who set it, and
`lockedBy` where a level above the team made it theirs to keep, which the lead sees and cannot
change — `set-policy` on it answers `failed` with `omni.capability-not-enabled`.

**What the team left to the person is the person's, and the provider keeps it.** The login's
`capabilities.preferences` lists every preference the person may hold — `hold`, a skill —
with where it stands and who set it: `setBy: "team"` while they inherit the team's default,
`"person"` once they have set their own, `"provider"` where no level has said anything. Nothing
is hidden for want of a row, and a preference a level above has since locked is listed with
`lockedBy`. `setPreference` is the person's act — `{ id, enabled }` to set their own, `{ id,
inherit: true }` to give it up and inherit again — answered `applied` and republished as a new
`authenticated` state when something changed, a state and not a flicker, as every republish of
`authenticated` is; and it is durable: the person's across sessions. A lead may also set a
person's preference from their own screen, which arrives the same way. A preference is keyed by
the capability's own name because it is the same capability at another level: effective in
`Task.capabilities`, set for the team in `policies`, left to the person in `preferences`. The
command `hold` acts on one call; the preference `hold` says whether the person wants the control
at all, and an agent application renders it in its settings, never as the button on a call. Mute is in none of
these ladders: the microphone is the agent application's, and nobody on the provider's side allows, locks or
keeps a choice about it. See **The station is the agent application's** in `guide/phone.md`.

## Breaks

```ts
type BreakStatus =
  | "not-requested"
  | "awaiting-approval"
  | "granted"
  | "starting-after-task"
  | "on-break";

type BreakReason = {
  id: string;
  label: string;
  group?: string;
  kind?: BreakKind;
  alwaysAvailable?: true;
};

type BreakRequest = {
  reason?: string;
  reasonId?: string;
};

type ForcedBreak = {
  by: UserId | "provider";
  expectedEndsInSeconds?: DurationSeconds;
};

type BreakState = {
  status: BreakStatus;
  canRequestBreak: boolean;
  requestUnavailableReason?: string;
  decisionReason?: string;
  retryRequestAfterMs?: number;
  reasons?: BreakReason[];
  activeReasonId?: string;
  forced?: ForcedBreak;
};

type BreakRequestResult =
  | { status: "requested" }
  | { status: "failed"; failure: ProtocolFailure };

type BreakCommitResult =
  | { status: "committed" }
  | { status: "failed"; failure: ProtocolFailure };

type BreakCancelResult =
  | { status: "cancelled" }
  | { status: "failed"; failure: ProtocolFailure };

type BreakEndResult =
  | { status: "ended" }
  | { status: "failed"; failure: ProtocolFailure };

type NextCallRequest = {
  since: IsoTimestamp;
};

type LinedUpCall = {
  party?: Contact;
  queue?: string;
  queuedSince?: IsoTimestamp;
  since: IsoTimestamp;
  release?: true;
};

type NextCallResult =
  | { status: "requested" }
  | { status: "failed"; failure: ProtocolFailure };

type NextCallCancelResult =
  | { status: "cancelled" }
  | { status: "failed"; failure: ProtocolFailure };

type LinedUpReleaseResult =
  | { status: "released" }
  | { status: "failed"; failure: ProtocolFailure };
```

### Team

```ts
type TeamMemberAvailability = "ready" | "on-task" | "on-break" | "elsewhere" | "signed-out";

type TeamMember = {
  id: UserId;
  availability: TeamMemberAvailability;
  since?: IsoTimestamp;
  break?: Extract<BreakStatus, "awaiting-approval" | "granted" | "starting-after-task">;
  tasks?: MemberTask[];
  listening?: MemberListening[];
  shift?: Shift;
  request?: MemberRequest;
  phone?: PhoneState;
  nextCall?: NextCallRequest;
  linedUp?: LinedUpCall;
};

type MemberRequest = {
  assignmentId: AssignmentId;
  note?: string;
  since: IsoTimestamp;
};

type MemberTask<C extends Channel = Channel> = {
  assignmentId: AssignmentId;
  title: string;
  channel: C;
  taskType: string;
  phase: TaskPhase;
  party?: Contact;
  reference?: string;
  attributes?: TaskAttribute[];
  history?: TaskHistory;
  completionMode?: CompletionMode;
  wrapAllowance?: DurationSeconds;
  wrapEndsInSeconds?: DurationSeconds;
} & (C extends "voice"
  ? { onCall?: OnCall[]; leadAssist?: TaskLeadAssist; takenOver?: TaskTakenOver; audio?: TaskAudioState }
  : { onCall?: never; leadAssist?: never; takenOver?: never; audio?: never });

type MemberListening = {
  leadId: UserId;
  assignmentId: AssignmentId;
  mode: ListeningMode;
  since: IsoTimestamp;
};

type ShiftEventKind = "signed-in" | "signed-out" | "break-started" | "break-ended";

type ShiftEvent = {
  at: IsoTimestamp;
  kind: ShiftEventKind;
};

type Shift = {
  signedInAt: IsoTimestamp;
  signedOutAt?: IsoTimestamp;
  talkSeconds?: DurationSeconds;
  holdSeconds?: DurationSeconds;
  breakSeconds?: DurationSeconds;
  tasksHandled?: number;
  events?: ShiftEvent[];
};

type TeamMembers = {
  members: TeamMember[];
  policies?: TeamPolicies;
};

type PolicyKey =
  | Exclude<keyof TaskCapabilities<"voice">, keyof SharedTaskCapabilities>
  | Exclude<keyof TaskCapabilities<"chat">, keyof SharedTaskCapabilities>
  | Exclude<keyof TaskCapabilities<"email">, keyof SharedTaskCapabilities>
  | "dial"
  | `skill:${string}`;

type TeamPolicySetting = "on" | "off" | "person";

type TeamPolicy = Resolved & {
  setting: TeamPolicySetting;
};

type TeamPolicies = Partial<Record<PolicyKey, TeamPolicy>>;

type TeamPolicyCommand = { type: "set-policy"; capability: PolicyKey; setting: TeamPolicySetting };

type TeamFeatureCommand = { type: "lead-features"; enabled: boolean };

type TeamCallCommand =
  | { type: "join"; memberId: UserId; assignmentId?: AssignmentId }
  | { type: "decline"; memberId: UserId; assignmentId?: AssignmentId; reason?: string }
  | { type: "listen"; memberId: UserId; assignmentId?: AssignmentId }
  | { type: "coach"; memberId: UserId; assignmentId?: AssignmentId }
  | { type: "join-call"; memberId: UserId; assignmentId?: AssignmentId }
  | { type: "leave"; memberId: UserId; assignmentId?: AssignmentId }
  | { type: "take-over-call"; memberId: UserId; assignmentId?: AssignmentId };

type TeamBreakCommand =
  | { type: "decide-break-request"; memberId: UserId; decision: "granted" | "denied"; reason?: string }
  | { type: "set-break-policy"; policy: "approval-required" | "automatically-approved" | "requests-suspended" }
  | { type: "force-break"; memberId: UserId; reasonId?: string; reason?: string; expectedDurationMs?: number }
  | { type: "end-forced-break"; memberId: UserId };

type TeamCommand = TeamFeatureCommand | TeamBreakCommand | TeamCallCommand | TeamPolicyCommand;

type TeamCommandRequest = {
  command: TeamCommand;
};

type TeamCommandResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };
```

### Audio

```ts
type CallAudio = {
  remoteAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): void;
};

type OpenAudioResult =
  | { status: "opened"; audio: CallAudio }
  | { status: "unavailable"; failure: ProtocolFailure };

type OpenAudioRequest = {
  assignmentId: AssignmentId;
  localAudio?: MediaStream;
};
```

### Events

```ts
type SummaryMetric = { id: string; label: string; value: string };

type QueueSummary = {
  title: string;
  subtitle?: string;
  waitingCount: number;
  updatedAt: IsoTimestamp;
  metrics?: SummaryMetric[];
};

type TransportRecovery = "reconnect" | "reauthenticate" | "displaced";

type ProviderEvent =
  | { type: "snapshot"; reason: "reconnected" | "provider-requested"; snapshot: Snapshot }
  | { type: "transport-status"; status: "connecting" | "active"; message?: string }
  | { type: "transport-status"; status: "error"; recovery: TransportRecovery; message?: string }
  | { type: "break-state"; break: BreakState }
  | {
      type: "task-offered";
      task: Task;
    }
  | { type: "task-updated"; task: Task }
  | { type: "task-audio-started"; assignmentId: AssignmentId }
  | { type: "task-audio-ended"; assignmentId: AssignmentId }
  | { type: "task-ended"; assignmentId: AssignmentId; outcome: TaskOutcome }
  | { type: "dial-outcome"; dialId: DialId; outcome: DialOutcome; assignmentId?: AssignmentId; destinationId?: string; reason?: string }
  | { type: "announcement"; text: string; html?: string; announcedAt: IsoTimestamp; expiresAt?: IsoTimestamp }
  | { type: "queue-summary"; summary: QueueSummary }
  | { type: "diagnostic"; expected: string; observed: string; assignmentId?: AssignmentId }
  | { type: "team-updated"; team: TeamMembers }
  | { type: "team-member-updated"; member: TeamMember }
  | { type: "team-member-removed"; memberId: UserId }
  | { type: "team-policies-updated"; policies: TeamPolicies }
  | { type: "contacts-updated"; contacts: Contact[] }
  | { type: "calendar-updated"; calendar: ScheduledActivity[] }
  | { type: "shift-updated"; shift: Shift }
  | { type: "phone-updated"; phone: PhoneState }
  | { type: "next-call"; nextCall?: NextCallRequest }
  | { type: "lined-up"; linedUp?: LinedUpCall };

type ProviderEventEnvelope = {
  id: string;
  loginId: string;
  occurredAt: IsoTimestamp;
  event: ProviderEvent;
};
```

`ProviderEvent` and its envelope keep a `Provider` prefix where nothing else does, for a mechanical
reason rather than a naming one: `Event` is a DOM global, and a bare one would shadow it for every
adapter compiled against the browser lib.

### Adapter and connection

```ts
type Refusal = {
  artefact: "snapshot" | "event";
  envelopeId?: string;
  violations: ProtocolViolation[];
};

type ProviderTimeCheckPolicy = {
  intervalMs: number;
  timeoutMs: number;
  maxRoundTripMs: number;
  maxSampleAgeMs: number;
};
type ProviderTimeCheckRequest = { requestId: string };
type ProviderTimeCheckResult = {
  requestId: string;
  loginId: string;
  clockId: string;
  providerTime: IsoTimestamp;
};

type Connection<C extends Channel = Channel> = {
  checkTime?(request: ProviderTimeCheckRequest): Promise<ProviderTimeCheckResult>;
  snapshot(): Snapshot<C> | Promise<Snapshot<C>>;
  subscribe(listener: (envelope: ProviderEventEnvelope<C>) => void): Unsubscribe;
  refused(report: Refusal): void;
  setCapacity(capacity: AgentCapacity): Promise<CapacityResult>;
  execute(request: TaskCommandRequest<C>): Promise<TaskCommandResult>;
  disconnect(): Promise<void>;

  getUserDetails?(ids: UserId[]): Promise<User[]>;
  dial?(request: DialRequest): Promise<DialResult>;

  requestBreak?(request: BreakRequest): Promise<BreakRequestResult>;
  commitBreak?(): Promise<BreakCommitResult>;
  cancelBreak?(): Promise<BreakCancelResult>;
  endBreak?(): Promise<BreakEndResult>;
  requestNextCall?(): Promise<NextCallResult>;
  cancelNextCall?(): Promise<NextCallCancelResult>;
  releaseLinedUp?(): Promise<LinedUpReleaseResult>;

  executeTeam?(request: TeamCommandRequest): Promise<TeamCommandResult>;
  openAudio?(request: OpenAudioRequest): Promise<OpenAudioResult>;
  setPreference?(request: SetPreferenceRequest): Promise<PreferenceResult>;
  recordStep?(report: HistoryReport): Promise<HistoryReportResult>;
};

type Adapter<C extends Channel = Channel> = {
  manifest: Manifest<C>;
  createAuthenticationSession(context: AuthenticationContext): Promise<AuthenticationSession> | AuthenticationSession;
  connect(context: ConnectContext): Promise<Connection<C>>;
};
```

### Published constants

```ts
const ALLOWED_BROWSER_URL_SCHEMES = ["http:", "https:"] as const;

const IDLE_CAPABILITIES = ["dial", "personalBrowser", "calendar", "contacts"] as const;
type IdleCapability = (typeof IDLE_CAPABILITIES)[number];

const DEFAULT_LEVELS = [
  { id: "org", label: "Your organisation" },
  { id: "site", label: "Your site" },
  { id: "team", label: "Your team" },
  { id: "person", label: "You" },
] as const satisfies readonly LevelDeclaration[];

const IDLE_CAPABILITY_UI = {
  dial: "Dialpad",
  personalBrowser: "Browser",
  calendar: "Calendar",
  contacts: "Contacts",
} as const;

const BREAK_KINDS = [
  "short-break",
  "meal",
  "rest",
  "training",
  "coaching",
  "meeting",
  "administrative",
  "technical",
  "personal",
  "other",
] as const;

type BreakKind = (typeof BREAK_KINDS)[number];

const HISTORY_STEPS_WITH_A_PERSON = [
  "offered",
  "answered",
  "held",
  "muted",
  "transferred",
  "conferenced",
  "unanswered",
] as const;

const OMNI_FAILURE_CODES = [
  "omni.not-authenticated",
  "omni.capability-not-enabled",
  "omni.assignment-not-found",
  "omni.destination-not-permitted",
  "omni.phone-not-permitted",
  "omni.rate-limited",
  "omni.unavailable",
  "omni.break-already-committed",
  "omni.recording-unsettled",
  "omni.break-forced-by-provider",
] as const;
type OmniFailureCode = (typeof OMNI_FAILURE_CODES)[number];
```

`HISTORY_STEPS_WITH_A_PERSON` is every `HistoryStep` except `queued`, which is the one nobody
takes part in. `historyStepExpectsAPerson()` tests membership.

### Failure and validation

```ts
type ProtocolFailure = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
};

interface ProtocolViolation {
  rule: string;
  path: string;
  message: string;
}
```

## Presentation labels

Adapters may supply static display labels for canonical protocol values. Labels affect presentation
only and cannot vary by connection, task, snapshot, or event.

### Renaming a phase

`manifest.phaseLabels` renames the canonical `TaskPhase` values for the agent. It never adds a
phase or removes one.

`TaskPhaseLabels` is `Partial` so that renaming one phase keeps the default wording for the rest —
an adapter changing "On Call" does not restate the other five.

**A task is labelled by the provider that owns it**, from that provider's manifest merged over its
channel defaults. Two adapters may word the same phase differently and each is right about its own
tasks: a call reads as the voice platform names it while a chat beside it reads as its own does.
How Omni words a view spanning several providers is its own presentation problem, not a provider's.

### `DEFAULT_TASK_PHASE_LABELS`

What Omni shows when an adapter overrides nothing.

```ts
const DEFAULT_TASK_PHASE_LABELS = {
  voice: {
    pending: "Offered",
    confirmed: "Accepted",
    preview: "Preview",
    "in-progress": "On Call",
    paused: "On Hold",
    completing: "After Call Work",
  },
  chat: {
    pending: "Incoming Chat",
    confirmed: "Accepted",
    preview: "Preview",
    "in-progress": "In Chat",
    paused: "Paused",
    completing: "Wrap-up",
  },
  email: {
    pending: "Assigned",
    confirmed: "Accepted",
    preview: "Preview",
    "in-progress": "Working",
    paused: "Paused",
    completing: "Completing",
  },
} as const satisfies Readonly<
  Record<"voice" | "chat" | "email", Readonly<Record<TaskPhase, string>>>
>;
```

### Naming a kind of work

`TaskTypePresentation` says what one kind of work is called. Unlike `phaseLabels`, an entry
**replaces the channel default outright** rather than merging.
`singular` and `plural` are required together because pluralisation is not mechanical, and a
half-supplied entry would leave Omni pairing one provider's noun with another's plural.

### `DEFAULT_TASK_TYPE_PRESENTATION`

The per-channel fallback, used for any `taskType` the adapter does not name.

```ts
const DEFAULT_TASK_TYPE_PRESENTATION = {
  voice: {
    singular: "Call",
    plural: "Calls",
    referenceLabel: "Call ID",
  },
  chat: {
    singular: "Chat",
    plural: "Chats",
    referenceLabel: "Chat ID",
  },
  email: {
    singular: "Email",
    plural: "Emails",
    referenceLabel: "Email ID",
  },
} as const satisfies Readonly<
  Record<"voice" | "chat" | "email", TaskTypePresentation>
>;
```

### Naming task types

`channel` is too coarse for agent-facing names. A WhatsApp call and a PSTN call are both `voice`,
but the provider may name them differently through static manifest metadata:

```ts
const taskTypePresentation = {
  WhatsApp: {
    singular: "Conversation",
    plural: "Conversations",
    referenceLabel: "Conversation ID",
  },
} satisfies Record<string, TaskTypePresentation>;
```

The map key is the exact `Task.taskType`. When no entry exists, Omni uses the provider
channel's entry in `DEFAULT_TASK_TYPE_PRESENTATION`. A mixed-channel list falls back to the words
"Task" and "Tasks" when its items do not share one label.

`referenceLabel` labels `Task.reference`; it does not label `assignmentId`. Omni shows a
reference only when both values are present.

**So supply it whenever the task type has references.** Because an entry replaces the channel
default outright, naming a task type and omitting `referenceLabel` removes the reference from the
agent's view — the case or call number simply stops appearing, with nothing to indicate it was
dropped. An adapter that wanted only a better noun loses a field it never meant to touch.

## Protocol contract rules

Ten rules govern protocol data and behavior.

### 1. The protocol is authoritative

Adapters conform to the protocol. The protocol does not conform to adapters.

### 2. Never report a value you cannot observe

Report only values the provider can observe. Omit an unknown optional value; if a required value is
unknown, do not publish the structure that requires it. Never substitute a default, placeholder,
or inference.

Omni cannot distinguish an asserted zero from an unknown, and will present it to the agent as
fact.

### 3. Omitted and empty are different claims

Omitting a field says *I cannot see this*. An empty value says *I looked, and there is nothing*.

Send whichever is true. An agent application renders them differently and cannot recover the distinction once
it is lost.

The same distinction applies to nested fields. Omit a nested field only when its value is unknown;
use an explicit empty value when the provider knows it contains nothing.

### 4. Presence is the permission

A capability authorizes a control the provider **chooses** to offer. Omni may offer or issue one
only where the corresponding capability is declared; an absent capability means unavailable, and
there is no separate permission flag.

The commands every task has are authorized by other fields the provider declared — a task that was
offered can be accepted, one in `preview` can be called, any task under `agent-command` and one
with a wrap under `provider-automatic` can be completed.
Nothing is issuable that the provider did not publish; only
which field says so varies. See **Which commands need a capability** in `guide/agent.md`.

### 5. Snapshots establish state; events report transactions

Snapshots establish and replace provider state when an agent signs in, reconnects, or resynchronises.

**A snapshot is the provider's answer, and an adapter that got no answer publishes nothing.** A
state read that answers unknown — a session not yet associated, a backend mid-failover — is not an
empty state: the adapter keeps what it holds, stays `connecting`, and publishes a snapshot only
once the provider has actually answered for this login, exactly as `connect()` may not resolve
before it can provide a meaningful one. And emptiness is stated, never inferred: every snapshot
carries `taskCount`, the provider's own count reconciled against `tasks.length`, so a snapshot
with no work says `taskCount: 0` in so many words and a blank or half-built state — which lacks
the count — can never pass as a confirmed empty. Absence of knowledge is never evidence of
absence, and every place "empty" is allowed to carry both meanings will eventually clear
somebody's live call.

Events report completed transactions after that baseline. Nothing is missed while the connection
holds; when it drops, the reconnect snapshot re-establishes the baseline before any further event
is applied.

### 6. An unsettled result is unknown, and unknown is not retried

A settled result is a fact. A promise that rejects with no result means *unknown*: the provider
may have done it or not, and neither Omni nor an adapter on the agent's PC can find out in time to
make a repeat safe. Omni does not retry; if the agent acts again it is a new command.

On a persistent ordered transport there is only one way a command goes unsettled: the connection
went away underneath it. **An adapter that cannot settle a command has lost its transport, and
says so** — `transport-status` `connecting`, reconnect, snapshot — whichever channel the command
actually travelled on. An unsettled promise is therefore always followed by a snapshot, and that
snapshot is the answer; Omni waits for it rather than calling `snapshot()` itself. While the
transport is up, a result says the provider accepted the command, and the event that follows —
`task-updated`, `break-state` — says what it did.

**Classify on the rejection, never on a connection status published separately from it.** The
status is a report about the wire and races the rejection; the rejection is the event. A rejection
is never the provider's answer: an answer travels only as a resolved `{ status: "failed", failure }`,
and every rejection is transport loss, whatever the last `transport-status` said and whatever the
rejection carries.

A command therefore carries no key. The provider names the assignment, the member's request and the
member, and Omni refers to them by those names; **Omni never asks a provider to remember a name
Omni made up.**

A command whose second execution changes nothing needs no protection: committing a break that is
already committed stops an agent who is already stopped. A command whose second execution has a
cost — a dial places a second call — is not made safe by anyone, which is why it is never repeated
without a person deciding to.

An agent dials. The provider places the call and the `dialling` answer is lost. Omni shows the dial
as unknown, not failed. Within a moment the provider offers the resulting call through
`task-offered` and reports the dial's `dial-outcome` under the `dialId` Omni sent, and the agent is
on it; had nothing been placed, nothing arrives and the agent dials again. What Omni must not do is
dial again on the agent's behalf — the one outcome worse than a lost answer is two phones ringing
at the customer.

An agent presses Hold while the provider is reconnecting. Nothing is queued at either end: the
adapter answers `failed` with `omni.unavailable`, Omni shows the refusal, and the agent presses
again once the provider is `active` — against the state as it is then, rather than a held press
fired into a state that has moved on.

### 7. Work is pulled, never pushed

Assign only within the concurrent capacity Omni has stated for this agent.

An assignment beyond that capacity, or with none currently stated, is invalid and Omni rejects it
as a protocol violation. Work the agent was already working on when the connection came back is
reported in the snapshot; it is not an assignment.

### 8. State is authoritative at the provider

Each provider is authoritative for the state it owns. Omni composes that state with Omni-owned
policy and user actions. When provider-owned state diverges, Omni obtains a fresh snapshot and
replaces its local provider view; it does not overwrite the provider.

### 9. Define a vocabulary; do not merely list it

Every member of a closed set — break kinds, history steps, destination kinds — must have a
normative definition; matching names alone do not establish shared meaning.

### 10. Order on the wire is display order

A list the provider publishes — a destination directory, outcome codes, a task's custom
controls, its browsers — is in the order the provider wants it shown, and an agent application keeps that order.
A reader will find meaning in position unless something says there is none, so the provider
decides: where it has an intention, an administrator's sequence, it lists in that order; where it
has none, it orders by the label, so the order is visibly arbitrary and does not move under the
reader. A directory that reorders itself as colleagues become free is a list lying about what it
means. A record's steps are the exception with a stated order of their own, oldest first.

## Provider adapter requirements

### 1. One adapter is one provider

An adapter represents one independently connected system: one voice platform, one chat platform,
one mail platform. It owns its own authentication, transport, reconnection and internal state.

Omni composes providers into one agent. No adapter needs to know another exists.

### 2. The transport is a persistent ordered connection

An adapter reaches its platform over a WebSocket or a SignalR connection. Which of the two, which
library, which framing and how it reconnects are the adapter's business and reach nothing in this
contract — but that it is **one long-lived, ordered, bidirectional connection** is not optional,
because the rest of this document rests on it.

Two properties are what everything else assumes. Events arrive in the order the provider observed
them, and loss shows up as the connection dropping rather than as a message quietly going missing.
That is why there is no sequence number to reconcile and no event log to replay: while the
connection is up nothing has been lost, and when it comes back the adapter sends a snapshot.

Request/response polling does not have those properties and is not a transport for this contract.

### 3. An adapter's memory is the platform's and the login's, never the connection's

Everything an adapter publishes about a task is derived from what the platform states, or kept in
the login's store where the platform cannot hold it. Per offer, the `assignmentId` comes from what
the offer itself states; per call, the audio follows `task-audio-started` and `task-audio-ended`,
never a flag set when the audio was opened; per session, the phone the agent holds is what the
platform restates on activation, not a mapping read once over HTTP. What the platform cannot hold
-- an agent application's muted leg -- goes in `ConnectContext.store`, keyed by the task and gone with it.

A fact read once over a connection and kept in the adapter object dies with the client. An agent application
reload is the first client dying and a second coming up for the same login, and the second
publishes the same truth about the same task as the first did, or the first was publishing
something it made up: an assignment minted for the connection, audio remembered as a boolean, a
phone the second never read. Three pieces of exactly that state were found in one adapter in an
afternoon, and none of it was visible until the adapter was built twice. The test's `rebuild` is the test of this
principle: given a way to build the adapter again, the run hands the login over and holds the
second to what the first published (`test.reload.snapshot`, `.history`, `.openAudio`, and the
stream's own rules across the resync). An adapter that cannot be built twice against its platform
and publish the same task is not a conformant adapter yet, whatever a single run says.

## Package entry points

| Import | Purpose |
| --- | --- |
| `@xema/omni-protocol` | Provider adapter contract and shared domain types |
| `@xema/omni-protocol/testing` | Adapter conformance helpers |
| `@xema/omni-protocol/validation` | Runtime validators Omni and adapters both use to reject malformed data |

## Declaring an adapter

### `defineAdapter(adapter)`

Compile-time helper that preserves the adapter's inferred concrete type while checking that it
implements `Adapter`. It performs no connection and has no runtime side effects.

```ts
import { defineAdapter, OMNI_PROTOCOL_VERSION } from "@xema/omni-protocol";

export default defineAdapter({
  manifest: {
    id: "acme-voice",
    displayName: "Acme Voice",
    channel: "voice",
    supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
    authenticationMethods: ["browser-sso"],
    settleMs: 5000,
    idleCapabilities: {
      dial: { destinations: "any-number" },
    },
    dialOutcomes: ["answered", "no-answer"],
  },
  createAuthenticationSession: context => createAcmeAuthentication(context),
  connect: context => createConnection(context),
});
```

`dialOutcomes` is a compile error off voice, as `dial` is. An adapter written once over
`C extends Channel` therefore sets it the way it already sets `idleCapabilities`, with
`as Pick<Manifest<C>, "dialOutcomes">`; an adapter written for one channel needs no cast.

### `Adapter.manifest`

Static metadata that Omni can inspect before connecting.
`Manifest<C>` is discriminated by `channel`, so a voice manifest may declare voice idle
capabilities while `Manifest<"chat">` and `Manifest<"email">` reject `dial` at
compile time.

| Field | Contract |
| --- | --- |
| `id` | Required, stable and installation-wide unique. It must not change between launches. Omni refuses to load an adapter whose `id` a loaded adapter already claims — see below. |
| `displayName` | Human-readable provider label. |
| `channel` | Protocol-v1 value `voice`, `chat`, or `email`. New channels require a later protocol version. |
| `supportedProtocolVersions` | Required non-empty list of versions this adapter can speak. Must share at least one with Omni. |
| `authenticationMethods` | Required non-empty list of supported login methods. |
| `idleCapabilities` | Declares actions Omni may offer while the agent has no active task, such as voice dialing. Task controls do not belong here. |
| `phaseLabels` | Optional static adapter-defined display names for canonical `TaskPhase` values. They cannot vary at runtime. |
| `taskTypePresentation` | Optional static adapter-defined presentation keyed by exact `taskType`. It names the item and its optional agent-facing reference. |
| `orgLevels` | The organisation's whole ladder as the provider calls it, each level with the label a desk shows for "who decided". Stated outright, `person` included: what it leaves out does not exist. Omitted for the typical four, `DEFAULT_LEVELS`. See **Who decides what an agent may do**. |
| `phones` | Voice only, and required there: the phones this platform can put an agent on, `softphone` (the call's audio lands in the agent application) and/or `deskPhone` (a handset the platform rings; the agent application shows the call and opens nothing). The agent application picks one per login. See **How the agent hears the call** in `guide/phone.md`. |
| `phoneStatus` | Voice only, declared by presence as `true`: the platform sees the phone itself -- its registration, its do-not-disturb, its hook, its calls -- and publishes it as `Snapshot.phone` and `phone-updated`. A platform that cannot see the phone omits it, and then publishes no phone (`manifest.phoneStatus`). See **The phone's own view** in `guide/phone.md`. |
| `dialOutcomes` | Voice only. How a dial can end on this platform, as it distinguishes them: `answered` and at least one way of not reaching the destination. Required of a provider that dials at all — an idle dialpad, or tasks that conference or call back — and a `dial-outcome` carries only a declared member. See **Every dial has an outcome** in `guide/voice.md`. |
| `timeCheck` | `true`: implements `checkTime` and states `providerTime` on every snapshot. Required of a provider that publishes an instant the desk renders as a running duration -- a member's `since`, a `listening[].since`, an `onCall.since`, a shift's `signedInAt` -- so every screen counts from the provider's clock (`manifest.timeCheck.required`); agent application polling is independently opt-in. See **Every screen counts from the provider's clock**. |
| `timestampAuthority` | Optional `"provider"`: provider timestamps are final; agent application instants are advisory. Omission makes no trust promise. |
| `runningStepReports` | The provider takes running reports of an agent application-performed step — `recordStep` with `seconds` so far and no `ended`. Omitted, the agent application sends exactly two reports per leg, when it began and when it ended, and a running one is refused. See **The agent application records what it performs** in `guide/agent.md`. |
| `settleMs` | Required. How long after `applied` the wire shows what the provider did: the `task-ended` after a `complete`, the `calendar-updated` after a `schedule`. A positive whole number of milliseconds (`manifest.settleMs`). Stated per provider, since platforms settle at different speeds. See **`task-ended`**. |

### Authentication methods

A provider declares one or both protocol-v1 login methods:

| Value | Contract |
| --- | --- |
| `browser-sso` | OAuth or OpenID Connect through the system browser or an Omni-managed browser. |
| `credentials` | Provider-specific username and password collected through an Omni-hosted form. |

```ts
authenticationMethods: [
  "browser-sso",
  "credentials",
]
```

The list must not be empty or contain duplicates. It declares available login methods only;
credentials and tokens never belong in the manifest.

`manifest.id` partitions the `SecretStore`, so an id is first-claimed: an adapter whose id another
loaded adapter already holds fails to load and is reported. It is never renamed to make room —
that would move its secrets to a partition it has never used.

### Idle capabilities

Idle capabilities are contributed by a provider but appear in Omni's idle workspace. They describe
work the agent may initiate when no task is active; they never grant controls over an assigned
task.

| Capability | Channel | Omni UI | Contract |
| --- | --- | --- | --- |
| `dial` | Voice | Dialpad | Contributes an idle-dashboard dialpad and declares whether destinations are restricted to known contacts. |
| `personalBrowser` | Voice, chat, email | Browser | Contributes Omni's managed personal browser and its allowed URL patterns. |
| `calendar` | Voice, chat, email | Calendar | Contributes an idle-dashboard calendar of callbacks and other scheduled activities from this provider. |
| `contacts` | Voice, chat, email | Contacts | Contributes an idle-dashboard contact list populated by this provider. |

They are published through `IDLE_CAPABILITIES`, with UI metadata in
`IDLE_CAPABILITY_UI`. Omni combines capabilities contributed by its active providers and removes a
provider's contribution when that provider becomes inactive.

**There is no `enabled` flag. Presence is the permission**, here as everywhere: a capability the
provider names is offered, and one it omits is not. A boolean on top of an optional field would be
a second way to say what absence already says, and **Omitted and empty are different claims** only
holds while each says something different.

#### Dialpad (`dial`)

`dial` is available to voice providers. It contributes a dialpad to the idle dashboard and requires
a destination policy:

```ts
idleCapabilities: {
  dial: { destinations: "any-number" }
}
```

`destinations` is required and accepts one `DialDestinations`:

| Value | Contract |
| --- | --- |
| `contacts-only` | The destination must be selected from **this provider's own** contributed contacts, and only entries carrying a `number` can be selected. Manual entry cannot bypass the restriction. |
| `any-number` | The agent may enter any destination or select one from the contact list. |

**A contact restriction is scoped to the provider that declared it.** Omni's idle contact list is
aggregated from every provider, but a `contacts-only` dialpad offers only the entries this provider
contributed. Any other reading lets a second provider put destinations into a directory the first
restricted precisely so it could control what was dialled.

A declared dial capability requires `Connection.dial()` and a `dialOutcomes` declaration, since a
dialpad dials. Omni sends the destination as the agent selected or typed it, under a `dialId` of
its own minting, and the provider holds it to the declared `destinations`.

#### Personal Browser (`personalBrowser`)

`personalBrowser` is available to voice, chat, and email providers. It contributes Omni's managed
personal browser to the idle dashboard. Each enabling provider supplies a complete URL access
policy:

```ts
idleCapabilities: {
  personalBrowser: {
    access: {
      mode: "block-all",
      allowList: [
        "https://help.example.com/*",
        "https://*.microsoft.com/*"
      ],
      blockList: ["https://help.example.com/private/*"]
    }
  }
}
```

| Field | Contract |
| --- | --- |
| `access.mode` | `allow-all` permits unmatched URLs; `block-all` denies unmatched URLs. |
| `access.allowList` | URL-pattern exceptions permitted when the mode is `block-all`. |
| `access.blockList` | Explicit denials. A match takes precedence over the same policy's allow list and mode. |
| `accessAppliesTo` | Required. `all-navigation`: every redirect and navigation is checked. `initial-url`: the starting URL alone. Stated, never defaulted (`manifest.personalBrowser.accessAppliesTo`). |

Patterns use the standard `URLPattern` syntax. Omni owns browser navigation, and the browser is
hidden when no active provider contributes one.

`accessAppliesTo: "all-navigation"` has every redirect and subsequent navigation validated
against the current combined policy, not only the starting URL. A provider may set
`initial-url` to check the first hop alone, but that has to be asked for. A `block-all` policy
enforced only on the initial URL stops nothing — one redirect leaves it — so the permissive
reading is not something to inherit from a default.

##### Combining policies

The personal browser is one browser shared by every provider that contributes to it, so their
policies have to be combined. Omni does it in the order that fails closed:

1. **An explicit `blockList` match denies the URL, whoever wrote it.** A block is a deliberate
   statement about one address, and it is honoured across the whole combined policy — not only
   within the policy that declared it.
2. Otherwise a URL is available when **any** contributing provider allows it, by its `allowList`
   or by an `allow-all` mode.
3. Omni's own local policy denies on top of both.

Allow-lists are contributions and blocks are vetoes. Without step 1 a single provider declaring
`mode: "allow-all"` would silently undo every block every other provider had written, and nothing
in the agent's view would show that it had happened.

#### Calendar (`calendar`)

`calendar` is available to voice, chat, and email providers. It contributes a calendar to the idle
dashboard for callbacks and other scheduled activities associated with that provider. Calendar is
the provider's: Omni displays activities and, where a task offers `schedule`, asks the provider to
create one -- see **Scheduling a follow-up** in `guide/agent.md` -- but cannot reschedule, cancel, or complete them.

```ts
idleCapabilities: { calendar: true }
```

Omit `calendar` to make no calendar contribution. Omni combines calendar
contributions from active providers into one agent-facing calendar while retaining the source
provider identity for each activity.

When declared, the provider publishes its authoritative list through
`Snapshot.calendar` and replaces it with a `calendar-updated` event when it
changes.

| Field | Contract |
| --- | --- |
| `id` | Required stable provider-local activity identity. It is what a replacement list is reconciled against. |
| `title` | Required agent-facing activity title. |
| `startsAt` | Required RFC-3339 start time with an explicit timezone. |
| `endsAt` | Optional RFC-3339 end time with an explicit timezone. |
| `party` | The person the activity reaches — a callback's customer — as a `Contact`. Optional. |
| `attributes` | Optional ordered `Attribute` entries. Keys must be non-empty. |

**There is no `type` field**, for the reason there is none on `Contact`: an open category is
matched by nobody and defined by nobody, and calendars merge across providers exactly as contacts
do, so one provider's `Callback` and another's `Call back` fragment a list that looks organised.
Send the category as an attribute and Omni displays it.

Nothing is lost by that here, because there is nothing for a category to drive. Nothing on the
calendar varies by kind -- `schedule` takes no category -- and what an activity *is* already shows
in what it carries: a callback has a `party`, a training does not.

#### Contacts (`contacts`)

`contacts` is available to voice, chat, and email providers. It contributes contacts to the idle
dashboard and can supply destinations to a contact-restricted dialpad.

```ts
idleCapabilities: { contacts: true }
```

Omit `contacts` to make no contact contribution. When declared, the provider
publishes its authoritative list through `Snapshot.contacts` and replaces it with a
`contacts-updated` event when it changes. Every field is optional:

> **Note:** Omni derives normalized number and email keys for indexing and deduplication while
> preserving the original values for display. A number supplied by multiple providers appears only once, with source icons indicating
> every provider that contributed it. Sources come from each `Manifest`; they are not repeated
> on `Contact`. If those providers supply different names, Omni keeps one as the display name
> and adds each distinct alternative to the merged attributes, labelled with its source provider.

| Field | Contract |
| --- | --- |
| `name` | Optional agent-facing display name. |
| `number` | Optional original dialable address, preserved for display. |
| `email` | Optional original email address, preserved for display. |
| `attributes` | Optional ordered `Attribute` entries. Keys must be non-empty. |

**Nothing is required, because every field is genuinely unknown somewhere.** A call from an
unrecognised number has an address and no name. A directory seeded from a mailbox has a name and an
email and no number. A task's party on a withheld caller ID may have none of them. Requiring any
one field would force exactly what **Never report a value you cannot observe** forbids — a
fabricated "Unknown caller" that Omni cannot tell from a real one.

So `Contact` is deliberately broad, and the same shape serves a directory entry the agent reaches
out to and the party already on a task. Send what you can see. Omni shows the `name` where there is
one and falls back to the number or email where there is not.

`normalizeContactNumber()` and `normalizeContactEmail()` produce the internal comparison keys.
Adapters may use these exported helpers when they need identical indexing behavior, but must keep
the original contact values for display.

`normalizeContactNumber()` applies NFKC, strips whitespace, brackets, slashes, periods, and every
Unicode dash, and rewrites a leading `00` to `+`. So `+1 (415) 555-0100`, `+1.415.555.0100`, and
`0014155550100` all merge.

> **Cross-provider merging is reliable only for E.164 input.** A national-format number such as
> `4155550100` carries no country context, and nothing in this protocol supplies one, so it will
> **not** merge with `+14155550100` from another provider. A provider that wants its contacts merged
> with another provider's must publish `+`-prefixed numbers.

**There is no `type` field, and Omni does not group the directory.** A category is an attribute
like any other: send it as one and it is displayed with the rest. A closed set of categories would
have to be defined member by member to mean anything across providers — see **Define a vocabulary;
do not merely list it** — and an open one is worse than none, because two providers publishing
`Lead` and `Prospect` for the same person produce a directory that looks organised and is not.

That is the line `attributes` stays on the right side of. Omni renders keys and values and does not
compute on them, so a provider writing `Dept` where another writes `Department` costs nothing;
grouping on those keys would fragment the directory exactly as a free-form `type` did. Search
across an agent's own contacts does the work a category was reaching for.

Merging follows the rule already stated for names. Where providers disagree on an attribute for the
same contact, Omni keeps one value and adds each distinct alternative to the merged attributes,
labelled with its source provider.

```ts
{
  name: "Asha Rao",
  number: "+919876543210",
  email: "asha@example.com",
  attributes: [
    { key: "Category", value: "Lead" },
    { key: "Priority", value: "High" }
  ]
}
```

## Authenticating with a provider

After negotiating a protocol version, Omni creates an authentication session before it calls
`connect()`. The authentication session is
UI-facing and contains no task or provider transport state.

### `Adapter.createAuthenticationSession(context)`

Creates the provider-scoped authentication session.

| `AuthenticationContext` field | Contract |
| --- | --- |
| `protocolVersion` | The negotiated version, fixed for this login. |
| `loginId` | Omni-generated identity for this login. The same value Omni later passes as `ConnectContext.loginId`, and how an adapter ties a connection back to the session that authenticated it. |
| `timeZone` | The zone the agent's day is reckoned in, as an IANA name from the agent application's clock, stated before any identity exists so the first `authenticated` state already carries it. The same value Omni later passes as `ConnectContext.timeZone`. See **The agent's day**. |
| `phone` | How this login hears its calls, chosen by the agent application from the manifest's `phones`: required for a voice provider, absent for any other. The same value Omni later passes as `ConnectContext.phone`. See **How the agent hears the call** in `guide/phone.md`. |
| `secrets` | Omni-provided `SecretStore`, scoped to this provider's manifest id. |
| `signal` | Optional cancellation signal. |
| `log` | Optional structured logging callback. Never include credentials, tokens, or sensitive contact data. |

It carries no identity: who the agent is on this provider is the outcome of authentication, not an
input to it.

Closing this session releases observers and temporary flow state; it does not sign the agent out.
Omni keeps the session open while the provider connection is active so refresh, expiry, and
capability changes remain observable.

### Authentication state

`AuthenticationSession.state()` returns the current authoritative state. `subscribe()`
reports later changes.

| Status | Contract |
| --- | --- |
| `signed-out` | No usable provider session exists. |
| `authenticating` | An interactive `browser-sso` or `credentials` flow is active. |
| `authenticated` | A usable session exists. Includes the provider identity, the login's `capabilities`, and optional token expiry time. |
| `refreshing` | The adapter is refreshing its session. Existing provider identity and capabilities remain available, unchanged: a change to either is published as `authenticated`. |
| `expired` | The session cannot currently be used. It may include an identity and typed failure. |

Omni calls `connect()` only after authentication reaches `authenticated`. Token refresh remains
adapter-owned; the adapter publishes `refreshing`, followed by `authenticated` or `expired`.
`refreshing` asks nothing of the agent and Omni shows nothing for it. If authentication expires
during active work, Omni preserves the task workspace and shows reauthentication for that
provider: the transport is still up and the tasks still on it, so this is a login problem with a
login fix, rendered apart from a provider Omni cannot reach. Commands meanwhile answer
`omni.not-authenticated`.

**Re-authentication restores the login; it does not replace it.** It runs on the session Omni
kept, under the same `loginId` — the old `flowId` died with the expiry, so the adapter issues a
new challenge — and when the state returns to `authenticated` the connection and everything on it
carry on: Omni does not call `connect()` again, since a second connection would be a second
session for one agent. The exception is a transport that reported `error` with `recovery:
"reauthenticate"`: that connection is finished, and once the login is restored Omni disposes it and
calls `connect()` afresh, as for `reconnect` -- see **`transport-status`**. What "signing in again
replaces the login" describes is a new `AuthenticationSession` under a new `loginId`, after
`signed-out`.

### What the login may do

`capabilities` declares provider actions available to this login rather than to one task: whether
the agent may ask for a break, and whether they lead a team. It is declared by presence, like every
capability in this contract, and it travels with the identity because it is part of who the agent
is on this provider: the provider knows the roles, and says so at sign-in rather than leaving Omni
to infer them from what arrives later.

| Field | Contract |
| --- | --- |
| `breaks` | This login may request a break. Requires the four break methods on the connection. |
| `nextCall` | The platform lines calls up for this agent: pressing Next call while on a call puts the next queued call in the agent's own queue, to start when their wrap ends unless somebody else takes it first. Requires `requestNextCall`, `cancelNextCall` and `releaseLinedUp` on the connection. See **The agent's own queue** in `guide/queue.md`. |
| `lead` | This login leads a team. The flag alone turns on the team feature in the agent application, and every lead act comes with it; there is no per-action permission beside it. While the lead has the feature on, the provider publishes a `TeamMembers` object to them on every snapshot — `members: []` when nobody is in it — and to nobody else. Requires `executeTeam`. See **Team leads** in `guide/lead.md`. |
| `preferences` | What the team left to this person, with where each stands and who set it. Omitted when nothing was. Requires `setPreference`. See **Who decides what an agent may do**. |

A session action is available only when both the capability and Omni local policy permit it.

**Capabilities are current, not fixed.** They describe the login as of its latest `authenticated`
state. A provider that reads roles live — a lead demoted mid-shift — republishes `authenticated`
with the new set through `subscribe()` on the authentication session, which Omni keeps open for
the life of the connection for exactly this reason, and the next snapshot agrees with it. Omni
provisions what the capabilities call for at sign-in — a team panel for a lead, empty until the
team member list arrives, and nothing for anybody else — and withdraws it on the next render when the
capability goes. A command that arrives after its capability was withdrawn is answered `failed`
with `omni.capability-not-enabled`: the provider names it, so Omni never has to infer from a
capability change it may not have rendered yet that "you are no longer a lead" is the message
rather than "that did not work". One trap for adapter authors: the natural guard on a republish
compares the identity, and a demotion does not touch it — compare the capabilities, field by
field, which is what `sameCapabilities()` does. The thing that changed is not the thing you are
comparing, and `assertCapabilityWithdrawal` is the test that catches a guard which never fires.

### Starting authentication

`AuthenticationSession.start(request)` starts one advertised authentication method. Every
request has a stable `requestId`. A successful start returns `interaction-required` with a
short-lived, opaque `flowId`; rejection returns `AuthenticationFailure`.

#### Browser SSO

For `browser-sso`, Omni issues a one-time callback URL and passes it to `start()`:

```ts
{
  requestId: "auth-42",
  method: "browser-sso",
  callbackUrl: "omni-agent://auth/acme-voice/auth-42"
}
```

The adapter creates the OAuth/OIDC request, including PKCE, `state`, and OIDC `nonce`, and returns:

```ts
{
  status: "interaction-required",
  challenge: {
    flowId: "flow-42",
    method: "browser-sso",
    authorizationUrl: "https://identity.example.com/authorize?...",
    browser: "system"
  }
}
```

Omni opens the requested `system` or `omni` browser. After redirect, it passes the complete callback
URL to `complete()`. The adapter validates the flow, exchanges the authorization code, and returns
the authenticated provider identity. Provider tokens never enter Omni UI or general protocol state.
An Omni-hosted SSO browser uses a dedicated temporary authentication session and never shares
cookies or storage with task or personal browsers.

#### Credentials

For `credentials`, `start()` returns the form fields Omni must render:

```ts
{
  status: "interaction-required",
  challenge: {
    flowId: "flow-43",
    method: "credentials",
    fields: [
      { name: "username", label: "Username", type: "text", required: true, autocomplete: "username" },
      { name: "password", label: "Password", type: "password", required: true, autocomplete: "current-password" }
    ]
  }
}
```

Omni submits a short-lived `values` record to `complete()` and does not retain it after the promise
settles. The adapter must not persist raw credentials. Field-specific failures may set
`AuthenticationFailure.field` to a declared field name.

### Cancelling authentication

`cancelAuthentication(flowId)` cancels an abandoned Browser SSO window or credentials form and
releases its temporary state. It does not sign out an already authenticated session. It answers
`applied`; a repeat, or a flow that already ended, is nothing to act on and answers `applied`
too, by the rule that a command asking for a state answers success when that state holds.

### Completion and failures

`complete()` returns either the authenticated state — identity and capabilities — or a typed
failure:

```ts
{ status: "authenticated", identity: { id: "1042", displayName: "Asha Rao", timeZone: "Asia/Kolkata" }, capabilities: { breaks: true } }
```

The `User` it carries is the **root of this provider's user namespace**. Every other person this
provider names — a team member, the manager on a forced break, the agent on a history step —
is identified from the same directory and carries the same `UserId` type.

| Field | Contract |
| --- | --- |
| `id` | Required `UserId`. Unique within this provider and stable across logins: it is what Omni scopes and stores, so a value that changes between sessions breaks every reference to this person. |
| `displayName` | Required agent-facing name. Presentation only — never an identifier, never compared. |

`AuthenticationFailure` contains a stable `code`, safe agent-facing `message`, `retryable` flag,
optional `retryAfterMs`, and optional credential `field`. It must never contain credentials,
authorization codes, tokens, or provider responses containing secrets.

### Sign-out

`signOut()` revokes or invalidates the provider session where supported, deletes stored
session secrets, and moves state to `signed-out`.
`close()` stops authentication-state observation but does not sign the agent out.

### Secure-storage boundary

Omni provides an OS-backed `SecretStore` scoped to the provider manifest ID. It exposes only
`get`, `set`, and `delete`; adapters cannot enumerate another provider's secrets. Adapters may store
refresh tokens or equivalent session material, but never raw submitted credentials. Secrets must
not appear in manifests, logs, events, snapshots, task attributes, errors, or browser storage.

## Connecting to a provider

### `Adapter.connect(context)`

Creates one live provider connection for the signed-in agent.

- Called by Omni after validating the manifest.
- Must resolve only when the connection can provide a meaningful snapshot.
- May reject for authentication, configuration, or startup failure.
- Must not create a second agent session merely because the underlying transport reconnects.
- **One client at a time per login, and the later one wins.** A second `connect()` on a login
  that already has a live client is the agent moving desks -- a desk left open at work, signed in
  from home. The provider takes the new connection, and ends the first with `transport-status`
  `error` and `recovery: "displaced"`, so the first desk stops stating capacity and reporting legs
  and shows the agent they are signed in elsewhere. Two live clients on one login would be two
  sources for one agent, and the lead's list would follow whichever spoke last.
- The returned connection owns reconnect until Omni calls `disconnect()` or aborts `context.signal`.
- May be called again on the same login after that: once per `Connection`, not once per login.
  Omni disposes a connection whose `error` named `recovery: "reconnect"` with `disconnect()` and
  calls `connect()` afresh — see **`transport-status`**. `recovery: "reauthenticate"` ends the same
  way, after the authentication flow has run on the same session and `loginId`: once the state
  returns to `authenticated`, Omni disposes the errored connection and calls `connect()` afresh.
  `expired` alone, with the transport not in `error`, keeps the connection.

### `ConnectContext`

| Field | Contract |
| --- | --- |
| `protocolVersion` | Version negotiated before authentication. Fixed for this login. |
| `loginId` | Omni-generated identity for this login. It is the same value passed as `AuthenticationContext.loginId`, so an adapter can correlate this connection with the session that authenticated it. Stable across transport reconnects and changed only by a new login. |
| `autoAcceptTasks` | Agent local policy policy relayed to the provider at login, stated by the agent application on every connection and never assumed from its absence. When `true`, a pending task states its `acceptance`; when `false`, every task requires agent acceptance. Fixed for this connection, like everything else here: the provider states or omits `acceptance` by the value it was sent, and Omni validates by that same value, not by a policy that has since moved — a change reaches the provider through a fresh `connect()`. |
| `timeZone` | The same value passed as `AuthenticationContext.timeZone`. The provider stores it on the agent and carries it on the identity. See **The agent's day**. |
| `phone` | The same value passed as `AuthenticationContext.phone`: how this login hears its calls. The type ties `host.mute` to it: a `softphone` login's agent application states what its Mute does, and a desk-phone or conversation login's agent application cannot, so the omission is a compile error rather than a live seat's discovery. See **The station is the agent application's** in `guide/phone.md`. |
| `store` | The login's operational store, kept by the agent application for the life of the login, across a reload of the agent application, and cleared at sign-out: where an adapter that composes a record keeps what its platform cannot hold for it, such as the interaction legs an agent application reported. Three functions, by key. Never for anything sensitive, which is `AuthenticationContext.secrets`, a store an agent application may clear aggressively. **A task's keys carry its assignment id and go with the task**: a key written about a task names the assignment id in the key, and is deleted before the task's end is published, so that nothing of a closed task survives its ending and nothing is left for whatever comes next -- a record with legs the agent application never reported against it. A login-scoped key carries no assignment id and outlives any task. The harness requires the store of every connection (`store.shape`, `store.get`, `.set`, `.delete`), watches the one it hands over, and names a task's key still held after `task-ended` (`test.store.retained`) or written about the task after its end -- a persist hung off a timer that saw the task as it was (`test.store.late`). The ordinary late write is the agent application's, not the adapter's: an agent application reports a leg without waiting for the answer, so an unmute can follow `complete` by a tick, and the adapter answers a report about a task that has ended `failed` with `omni.assignment-not-found` and writes nothing -- the agent application ends its own open legs at the task's end, so such a report is the agent application's error to see, and an agent application reads every `recordStep` answer and awaits the one for the leg it closes at a task's end, the only moment a refusal is expected, since a report nobody waits for is an error nobody can see; an adapter that names no task in its keys gets no cleanup check, which is a gap rather than a pass, never an exemption: the obligation is that nothing of a closed task survives its ending, and an adapter that keeps every open task in one login-scoped value owes exactly that inside the value, where the harness cannot look. One key per task, named for it, is the shape the harness can hold, and the shape to reach for. The store lists nothing, so an adapter that needs to find its tasks keeps a login-scoped index of ids beside them; at the task's end it deletes the body first and reindexes after, since a crash between the two then leaves an index naming a task with no body, which a reader skips, where the other order leaves a body for a task that has ended, which is the hazard itself. A reader of the index tolerates an id with no body as an ending that was underway, not as corruption. |
| `host` | The agent application's report of the agent's station — devices, permissions, network — to consult before declaring the agent ready to the platform, and on every change. See **The agent application reports, the adapter decides** in `guide/phone.md`. |
| `signal` | Optional cancellation signal. Stop startup promptly when aborted and do not begin new work. |
| `log` | Optional structured logging callback. Never include credentials, tokens, or sensitive contact data. |

### The agent's day

Every instant on this wire carries an explicit offset, so a moment is unambiguous everywhere and
a desk renders it in the viewer's clock without help. A **day** is different: hours toward
target, an answer streak, a per-queue count for today -- anything bucketed by day -- is bucketed
by somebody's day, and a platform that was never told whose uses its own. An agent in Chennai
then finds their day rolling at 05:30, and a night shift in Chicago lands in two buckets.

So the agent application says whose day it is, and it says so first. `AuthenticationContext.timeZone` is the
agent's zone as an IANA name -- `Asia/Kolkata`, `America/Chicago` -- never an offset, since an
offset cannot survive a daylight-saving boundary and a day boundary is exactly where that bites
(`context.timeZone`). It is stated before any identity exists, and `ConnectContext.timeZone` is the
same value again. The provider **stores it on the agent** and carries it as `identity.timeZone` on
every `authenticated` state and on every `User` it returns from `getUserDetails()`, so a lead
reading a colleague's yesterday sees the colleague's yesterday and a summary is bucketed by the
right day after a session has ended. A roaming agent corrects it by signing in from where they are.

**The zone is never absent.** Time zone awareness is a first-party property of this wire, not a
field to fill in later: an identity without one is refused (`authentication.identity.timeZone`), and
so is a zone that is not an IANA name, wherever it appears. Nothing is ever assumed in its place --
not the viewer's browser, which gives a different answer per reader for the same record, and not the
provider's clock. The harness holds a provider to the round trip: the identity carries the zone the
agent application stated (`authentication.identity.timeZone.republished`), judged by what the name denotes:
`Asia/Kolkata` and `Asia/Calcutta` are one zone, and a provider that keeps the canonical name has
kept the zone. **The round trip is not the store.**
An adapter that echoes the stated zone back onto the identity passes that check with nothing kept,
and a lead reading a colleague's day would still get the wrong one. What proves the store is a zone
the run never sent: a colleague's `User` from `getUserDetails()` carrying theirs. A provider's own
tests are where that is shown, with a second agent whose zone arrived through another session.

### Who the agent is

`ConnectContext` names no agent. The adapter already knows who is connected: it authenticated them,
and `AuthenticationState.identity` holds the result. Omni has nothing to add — it holds no
identifier of its own, as **There is no Omni-wide user identity** sets out.

Omni may still prefill a username into a `credentials` form from the operating-system account,
because Omni renders that form itself. That is a local convenience and never reaches an adapter.

## Provider state

### `Snapshot`

What the login may do is declared on its `AuthenticationState` — see **What the login may do** —
not here. The snapshot carries what the provider holds for the agent now, and where that depends on
a capability it agrees with the login: a lead's snapshot carries `team`, nobody else's does.

| Field | Contract |
| --- | --- |
| `transport` | Current `TransportStatus` — whether this provider's transport can serve the login. Defined under **`transport-status`**. |
| `loginId` | Identity of this login. It must match the connection context. |
| `providerTime` | The provider's own instant of this read. Required of a provider that declares `timeCheck` (`snapshot.providerTime`), forbidden of one that does not (`snapshot.providerTime.unexpected`): a clock sample the desk counts durations from, saving it a `checkTime`. |
| `break` | Complete break state, including status, whether the agent may ask, reasons, retry details, and any forced break. |
| `tasks` | Complete set of tasks currently offered to or owned by this agent. |
| `taskCount` | The provider's own count of those tasks, stated rather than inferred, and it must equal `tasks.length`. A snapshot with no work says `taskCount: 0` in so many words — a blank or unanswered state lacks the count and cannot pass as a confirmed empty. |
| `contacts` | Required complete contact contribution when the manifest declares `contacts`; `[]` clears it. Omitted only when it does not. |
| `calendar` | Required complete calendar contribution when the manifest declares `calendar`; `[]` clears it. Omitted only when it does not. |
| `phone` | The phone as the platform sees it -- the device, whether it can take a call, its own mute where observed -- from a provider whose manifest declares `phoneStatus`; required there (`snapshot.phone.required`) and forbidden otherwise (`snapshot.phone.unexpected`). Replaced whole by `phone-updated`. See **The phone's own view** in `guide/phone.md`. |
| `nextCall` | The agent's standing ask for the next call, while it stands: `since`. It needs an assignment at work to be next after (`snapshot.nextCall.idle`) and the provider clears it when that assignment ends, when a call is lined up, and when the agent withdraws it. Replaced whole by `next-call`. See **The agent's own queue** in `guide/queue.md`. |
| `linedUp` | The call waiting in the agent's own queue, while one is: the caller as shown to this audience, the queue, the caller's wait, when it was lined up, and `release` where the provider lets the agent let it go. Not a task yet. Replaced whole by `lined-up`. See **The agent's own queue** in `guide/queue.md`. |
| `shift` | The agent's own day so far, as the provider counts it -- the same `Shift` their lead sees on the team member list, the same numbers from the same count. Replaced whole by `shift-updated`. Omitted only where the provider cannot say. See **The agent's day is on the wire**. |
| `team` | Required `TeamMembers` when the login declares `capabilities.lead` and the lead has the team feature on, `members: []` when nobody is in it. Forbidden otherwise — the login is the permission, and a lead who turned the feature off gets nothing of the team. |

## Live connection

`Connection` is what `connect()` returns. Its methods are documented in the sections that follow
and under **Breaks** in `guide/breaks.md`, **Team leads** in `guide/lead.md`, **Real-time audio** in `guide/phone.md` and **Task commands** in `guide/agent.md`; this is the whole
surface in one place, and what obliges an adapter to implement each one.

| Method | Implement it when |
| --- | --- |
| `snapshot()` | Always. |
| `checkTime(request)` | The manifest declares `timeCheck: true`. Read-only clock check; no task command or accuracy guarantee. |
| `subscribe(listener)` | Always. |
| `disconnect()` | Always. |
| `refused(report)` | Always. The agent application tells the adapter what it would not take -- a snapshot it did not replace its state with, an event it dropped -- with every rule broken, so a refusal is visible on both sides. See **What the agent application does with what it refuses**. |
| `setCapacity(capacity)` | Always. Nothing may be assigned until a capacity is stated, so there is no connection that does not receive it. |
| `execute(request)` | Always. Every channel has commands no capability gates — see **Which commands need a capability** in `guide/agent.md`. |
| `getUserDetails(ids)` | The adapter publishes any `UserId`: on `ForcedBreak.by` where a person forced it, a team member list, or `history[].by`. Each `User` carries its `timeZone`; a person whose zone the provider cannot name is omitted from the answer, as any unresolvable id is. |
| `dial(request)` | The manifest declares `idleCapabilities.dial`, and with it `dialOutcomes`. |
| `requestBreak(request)` | The login declares `capabilities.breaks`. |
| `commitBreak()` | The login declares `capabilities.breaks`. Commit and cancel are not optional halves of it. |
| `cancelBreak()` | The login declares `capabilities.breaks`. |
| `endBreak()` | The login declares `capabilities.breaks`. |
| `requestNextCall()`, `cancelNextCall()`, `releaseLinedUp()` | The login declares `capabilities.nextCall`. The three stand together: a lined-up call the agent could neither withdraw nor let go is a promise with no way out. See **The agent's own queue** in `guide/queue.md`. |
| `executeTeam(request)` | The login declares `capabilities.lead`: every lead act, on the team surface and nowhere else. See **Lead commands** in `guide/lead.md`. |
| `setPreference(request)` | The login declares `capabilities.preferences`: the person's choice has to have somewhere to go. |
| `recordStep(report)` | The manifest lists `softphone` among its `phones`. On a softphone the agent application mutes its own microphone on any call, and the provider's record has to have somewhere to take that leg; a desk phone's microphone is the phone's. See **The agent application records what it performs** in `guide/agent.md`. |
| `openAudio(request)` | The manifest lists `softphone` among its `phones`. On a softphone the call's audio lands in Omni, so the adapter has to open it; a platform of desk phones alone never does. |

**The four break methods stand or fall together.** Declaring `capabilities.breaks` at login and then
implementing `requestBreak` without `commitBreak` leaves an agent granted a break that can never
start, and the two-phase coordination in **Coordinating a multi-provider break** in `guide/breaks.md` has no way to
report that: `granted` is a promise to honour a later commit.

### `Connection.snapshot()`

Returns the provider's complete authoritative state at one point in time.

- Omni registers `subscribe()` before awaiting the initial snapshot. An event delivered while the
  snapshot is read is held until it lands, and what happens to it then depends on what it is. A
  snapshot restates state, so an event of a state-replacing kind -- `task-offered`, `task-updated`,
  `task-ended`, `task-audio-started`, `task-audio-ended`, `break-state`, `team-updated`,
  `team-member-updated`, `team-member-removed`, `team-policies-updated`, `shift-updated`,
  `contacts-updated`, `calendar-updated`, `transport-status`, `snapshot` -- is dropped, because the
  snapshot accounts for it. An event that reports a transaction no snapshot carries --
  `dial-outcome`, `diagnostic`, `announcement`, `queue-summary` -- is applied after the snapshot,
  in order: a dial's outcome delivered during a resync still ends the dial, and **Every dial has an
  outcome** holds through a snapshot. Events after it are applied in order.
- `tasks` must contain every task currently owned by this agent for this provider.
- A snapshot replaces Omni's state for this provider; it is not a partial patch.
- The adapter may return synchronously when it already holds current live values, or
  asynchronously when it must obtain state.

### `Connection.subscribe(listener)`

Registers a listener for provider changes and returns an idempotent unsubscribe function.

- Every delivery is a `ProviderEventEnvelope`.
- Delivery order must match the order in which the provider observes changes.
- Never replay an event. Recovery is a snapshot, and a re-sent event would apply state the snapshot
  has already superseded.
- On reconnect, the adapter must reactivate provider-side subscriptions and emit a `snapshot`
  event containing the complete refreshed state. This reconciles assignments or endings missed
  while disconnected without requiring a durable event log.
- After unsubscribe, the listener must receive no further events.

### `Connection.getUserDetails(ids)`

Turns `UserId` values into something an agent can read.

```ts
getUserDetails(ids: UserId[]): Promise<User[]>
```

Required of any adapter that publishes a `UserId` — on `ForcedBreak.by` where a person forced it, a
team member list, or `history[].by`. Publishing an identifier Omni cannot resolve puts a name on screen
that reads as a database key.

- **Omit an id you cannot resolve; do not invent a name for it.** A missing entry says *I do not
  know this person*, which Omni renders as such. Ordering is not significant and the response may
  be shorter than the request.
- **Take the whole list in one call.** Omni resolves a team member list or an interaction history as a batch, and
  a per-id round trip multiplies that by its length.
- **Omni caches a result for one hour, then resolves it again.** The identifier is stable across
  logins but the name behind it is not, so the cache expires on a clock rather than living for the
  session. One hour is a starting figure and may be tuned; an adapter must not depend on any
  particular value, or on Omni asking again at any particular moment.

This is the only place a name comes from. Task data carries identifiers alone —
`history[].by` is an id and nothing more — so a name is never copied into a task, never
duplicated across tasks, and never stale.

### `Connection.disconnect()`

Stops the connection and releases adapter-owned resources.

- Must be safe after partial startup and safe to call once during normal shutdown.
- Must stop automatic reconnect.
- Must remove event handlers and release audio resources owned by the adapter.
- Does not imply that active tasks were completed or removed.

## Event delivery

### `ProviderEventEnvelope`

| Field | Contract |
| --- | --- |
| `id` | Required identifier for this event, unique within the login. Omni does not act on it; it exists so an agent application log line and an adapter log line can be matched when something has to be traced. |
| `loginId` | Login session that produced the event. Omni rejects any other value, which only reaches it if an adapter kept an old connection emitting after a re-login. |
| `occurredAt` | Valid RFC-3339 timestamp with an explicit timezone, representing provider observation time. |
| `event` | Typed `ProviderEvent` payload. |

#### Timestamp standard and explicit exceptions

Every provider event envelope carries `occurredAt` as an ISO timestamp in the contract's RFC-3339
form, with `Z` or an explicit numeric timezone offset. Preserve the original instant. Payloads
carry their source event/observation instants wherever available and declared by their type;
publication and receipt time must not be substituted for a missing source instant. A required
instant that the source cannot establish makes that evidence unavailable, not permission to
invent a timestamp or silently omit a required field.

Clock estimation is an exception, not the standard interpretation of events. An ISO timestamp
identifies an instant; it does not prove that the agent application and provider clocks are synchronized.
Use an explicitly trusted clock in the relevant domain. Do not infer a general clock offset
from event arrivals, shift source timestamps, or use an estimate to order events or create history.

The current exceptions and their reasons are:

| Case | Exception and reason |
| --- | --- |
| Agent application display of provider deadlines (`expiresInSeconds`, `previewEndsInSeconds`, `wrapEndsInSeconds`) | Each is seconds from the publication that carried it, counted down on the desk from receipt: the provider's own arithmetic, so no clock is compared and the transport delay is the only error. The countdown estimates the display only; it does not establish that the provider acted. Without usable time, show timing uncertainty. |
| Agent application-triggered preview end | The desk counts `previewEndsInSeconds` down from receipt and issues `dial` when it reaches zero: the provider owns the deadline and the desk owns the trigger. It does not dial before the countdown has run out, and a reload restarts it from the next publication. |
| Recording evidence expiry | A bounded observer-domain clock estimate with monotonic aging may assess freshness because observation and expiry belong to the recorder's clock. If time cannot be trusted, recording state is unknown; never renew evidence from receipt or replay. |
| Unknown recording state | `observedAt` and `validUntil` are absent because there is no confirmed observation. The containing provider event still has its own `occurredAt`; that publication is not a recorder observation. |
| Direct snapshot reads and method requests/results | These are reads/operations, not event envelopes, and their current types have no general event timestamp. A snapshot event still carries `occurredAt`; embedded source instants remain unchanged. Do not treat a method result or read completion time as an occurrence boundary. |
| Agent application-provided provider-clock estimate | Best-effort ISO time may be supplied by the agent application for optional comparisons; it is not a source observation or accuracy guarantee. The reason is that the agent application does not own the provider clock. |
| Provider receipt timestamps | The provider may use its own receipt instant for final records of receipt/processing because agent application timestamps are untrusted advisory input. Receipt must not be presented as an earlier action or capture boundary. |
| Optional source instants and deadlines | Omit only where the declared type permits absence and the source has no evidence or the policy has no deadline (for example unlimited preview). Do not replace absence with agent application time. |

Every additional exception must be listed with its scope and reason before adoption. Estimates
must specify their uncertainty and validity; elapsed time should use monotonic aging, and a clock
jump invalidates the estimate. The optional check below samples provider time without changing event timestamps. Report
source-measured durations where required; timestamp subtraction is not a substitute.

#### Every screen counts from the provider's clock

Two screens watching the same agent -- their own desk, their lead's, a manager's on another floor
-- must show the same numbers. Delay between them is fine; arithmetic that differs is not. So
nothing the desk shows is its own count, with one exception: the running duration of the active
task or call, which a screen times itself from the moment it saw the call begin -- the
`task-audio-started` on a softphone, the answer it sent on a desk phone -- and which two such
screens may therefore disagree on, since their clocks differ. That is the whole exception. A call
a screen found already up -- on a connect or reconnect snapshot, on a lead's list, after a reload
-- is counted from the provider's `answered` step's `at` against the provider's clock, like every
other duration, so a reloaded desk shows 12:40 beside the lead's 12:40 and not 0:05. And a leg
that has closed shows the provider's `seconds` on every screen, never the count a screen kept.
Everything else comes from the wire.

Durations off the active call -- how long a member has been `on-break` from their `since`, how
long a lead has been listening, how long since `signedInAt` -- are counted from the provider's
clock, never the screen's. The desk keeps the latest provider instant it has received -- a
snapshot's `providerTime`, an envelope's `occurredAt`, a `checkTime` result -- with the monotonic
elapsed time since receipt, and renders every such duration from that; a sample older than
`maxSampleAgeMs` is refreshed with `checkTime`. Without a usable sample the desk shows the instant
and no count. A provider that publishes any of these instants therefore declares `timeCheck`
(`manifest.timeCheck.required`) and states `providerTime` on every snapshot
(`snapshot.providerTime`). Two screens then differ by their delay and nothing else.

**Seconds left are worked out at each publication.** `expiresInSeconds`, `previewEndsInSeconds`,
`wrapEndsInSeconds` and `expectedEndsInSeconds` are each the provider's arithmetic at the instant
of the publication that carries them, never a value copied from an earlier one. A provider that
builds the next publication by spreading the last one forward hands a reloaded desk a countdown
already spent -- sixty seconds shown beside a lead's screen showing twenty -- and the stream
names it: between two publications of one countdown the value loses at least the seconds the
provider's own clock says passed, within a second of rounding (`stream.countdown.copied`, on an
update against the last publication, and on a snapshot from a provider with a clock against its
`providerTime`). Under `agent-command` the wrap's value reaches `0` and stays there while the agent
overruns; that is the true value, not a copy.

**A deadline stated is a deadline kept.** The provider that says how long an offer has ends it
`expired` when it runs out, and the test holds it to that: where the first offer carries
`expiresInSeconds` within the test's timeout, the test leaves that offer unanswered and expects
the `expired` ending within the seconds plus `settleMs`, then tests the next offer
(`test.offer.expired`). A preview's deadline is held to its `atDeadline` the same way: under
`provider-dials` the provider dials when it runs out, under `host-dials` and `waits` the preview
stands until the desk dials (`test.preview.deadline`).

#### Optional periodic provider time checks and agent application estimates

A provider may declare `Manifest.timeCheck: true` and implement `Connection.checkTime(request)`.
Omission means unsupported. The agent application separately opts in with `ProviderTimeCheckPolicy`; these
agent application-local settings are not task policy or a guarantee. All four durations are explicit positive
safe integer milliseconds, with `maxRoundTripMs <= timeoutMs <= intervalMs`. No default interval
is assumed. Validate settings with `validateProviderTimeCheckPolicy`.

While the connection is active, the agent application checks immediately on opt-in and then at `intervalMs`
using a monotonic scheduler. Only one check may be outstanding. Missed ticks are skipped, never
replayed in a burst. Each request has a fresh ID. The provider samples its own event/deadline
clock after receiving the request and before returning `providerTime` as an ISO/RFC3339 instant,
with the request ID, authenticated login ID and `clockId`. No cached sample or adapter-local time
may masquerade as provider time. A provider unable to sample that domain must not declare support.
Clock authority replacement or a discontinuity changes `clockId`.

Validate requests and responses with `validateProviderTimeCheckRequest` and
`validateProviderTimeCheckResult`. The agent application also checks the outstanding request, provider/connection
and login, monotonic elapsed time and cancellation after the await: a late successful response is
still rejected. Reject samples at or beyond `timeoutMs`, or above `maxRoundTripMs`. Cancel local
tracking and invalidate estimates on disconnect, logout, policy disable, clock change or clock
jump; late results cannot restore them. Resume with a fresh check after reconnection. Expire a
sample at `maxSampleAgeMs` using monotonic elapsed time. Failure is visible through the agent application's
existing diagnostic path, with the estimate unavailable; the next scheduled check can recover.
Checking failure alone does not assert call/recording state or require a healthy connection to close.
This read-only check is not a task command. Protocol supplies declarations and validators; the
agent application implements the scheduler and the provider implements the clock read.

The agent application may also expose `Host.estimateProviderTime({ providerId, loginId })`. It returns an ISO
`at` in that provider's clock domain, the same explicit scope and `clockId`, or `undefined` when
unavailable. Optional `uncertaintyMs` is an estimate, not a guaranteed bound. The method is optional
at the agent application level and is deliberately absent from `HostGuarantees`. A provider declaring time
checks does not require the agent application to expose estimates, and an estimate need not originate from
this check if the agent application has another explicitly configured source for that provider clock.

To estimate the difference, the agent application brackets the request with local send/receive instants and
measures elapsed time monotonically. For provider sample P and local bracketing instants H0/H1,
the offset under stable clocks lies between P-H1 and P-H0, before clock error and timestamp
precision are considered. A midpoint is only an estimate; one-way delays need not be symmetric.
Never treat round-trip uncertainty as proof of the source clock's accuracy. Advance a retained
sample with monotonic elapsed time, and return unavailable after its configured validity ends.
`validateProviderTimeEstimate` checks shape and scope, not actual accuracy or freshness.

A provider may declare `Manifest.timestampAuthority: "provider"`: its own timestamps are
used for final records, and agent application-supplied timestamps are advisory. This declaration is independent
of time-check support and the optional agent application estimate; neither changes who owns the final record.
Omission makes no promise that agent application timestamps will be trusted. No agent application-authoritative default
is inferred. Successful `recordStep` responses identify the provider-selected history instant;
see **The agent application records what it performs** in `guide/agent.md` for correlation and retained bindings.

A provider need not trust or adopt any agent application-supplied timestamp. It may timestamp an incoming
message using its own clock at receipt and use that for its own processing/accounting. The reason
for this exception is that agent application clocks and agent application estimates are not authoritative at the provider.
Receipt time must be described as receipt/observation time, not relabeled as the original agent application
action, recorder capture boundary, or proof an operation applied. An existing field with a
specific occurrence meaning still requires that evidence; this option does not silently redefine
it. Agent application-only instants remain advisory input; the provider owns its authoritative publication.

This agent application estimate is another explicit timestamp exception: it helps optional displays and
provider-clock comparisons when the agent application lacks that clock directly. It is not a source occurrence,
may not replace event/history timestamps, and alone cannot authorize deadline actions or prove
recording freshness. Uses requiring a trustworthy bound still need independently established
clock accuracy/drift assumptions. It neither synchronizes the operating-system clock nor changes
ISO timestamps already published by the provider.

#### Nothing is lost until the connection drops

There is no sequence number and no gap to detect. The transport delivers in order and does not
silently lose a message, so while the connection is up Omni has seen everything the provider sent.

Loss has exactly one shape: the connection went away. The adapter reports `connecting` or `error`,
reconnects, and emits a `snapshot` event carrying complete state. That snapshot is the repair —
whatever was missed while the connection was down is in it, and Omni replaces its provider view
rather than reasoning about what it did not receive. A repair is an answer like any other: a
platform that has not yet answered for this login after a reconnect — a state read served empty by
a backend that does not know the session yet — yields no snapshot, and the adapter stays
`connecting` holding what it holds. See **Snapshots establish state; events report transactions**.

A snapshot must account for **everything the adapter has emitted before it resolves**, not merely
everything emitted when it was requested. Omni drops the state-replacing events held during the
read on that promise, and applies the rest after it (see **`Connection.snapshot()`**); an adapter
that serves a stale snapshot and then lets an earlier event through will have Omni apply state the
snapshot already superseded. The harness reads its connect snapshot the same way, and holds the
snapshot to accounting for every task event it superseded: a task published during the read and
missing from the snapshot, or ended during the read and still carried, is named
(`snapshot.accounts.task`, `snapshot.accounts.ended`).

#### Liveness

`transport-status` is the only signal Omni has that a transport died. An adapter must emit
`transport-status` with `connecting` or `error` as soon as it loses its transport, rather than
leaving a stale `active` in place while it retries internally; Omni cannot distinguish a quiet
healthy provider from a dead one. And what Omni is told, the agent is shown — see **The status is
seen, not merely known** under `transport-status`.

#### Requesting a resync

Omni calls `snapshot()` at connect; after that, snapshots come to it — on reconnect, and when the
provider asks. It may still call `snapshot()` at any time, but never to learn a command's fate:
the reconnect snapshot already carries it. `reason: "provider-requested"` covers the opposite
direction — the provider asking Omni to reconcile — and neither replaces the other.

### `snapshot`

Carries a complete `Snapshot` after reconnect or when the provider explicitly requests
reconciliation. `reason` is `reconnected` or `provider-requested`. Omni replaces the provider's
current status, break state, tasks, contacts, scheduled activities, the agent's day and the team
member list with this snapshot. It carries what the login and its switches call for — the whole
team for a lead with the feature on, on every snapshot — and nothing they do not; a capability is withdrawn by a republished `authenticated`,
never by an omission from a snapshot.

### `transport-status`

Updates `TransportStatus`, and carries an optional `message` that may explain an error but must be
safe for the agent to see.

| Value | Contract |
| --- | --- |
| `connecting` | No usable transport right now, and the adapter expects to recover on its own. Nobody needs to act. Startup and every reconnect pass through this value. |
| `active` | The transport is up and the provider is serving this session. It is the only value under which work arrives. |
| `error` | The adapter cannot serve the session and is not simply mid-reconnect. Say why in `message`, and say what revives it in `recovery` — required here, forbidden on any other status. It is not terminal: an adapter that recovers on its own still reports `connecting` and then `active`, and one that cannot is revived as `recovery` says. |

**An error names its recovery, and the agent application acts on that word.** The adapter knows why its session
died; the agent application knows how to run a login. `recovery` joins the two:

- **`reconnect`** — the login is good and this connection is not: a backend restart, a session the
  platform no longer recognises. Omni calls `disconnect()` on the dead connection and then
  `connect()` again on the same login — same `loginId` — and the fresh connect snapshot
  re-establishes state exactly as a reconnect snapshot does. `connect()` is once per
  `Connection`, not once per login.
- **`reauthenticate`** — the session under the login died: a token rejected, a remote logout. Omni
  runs the authentication flow first, on the same session and `loginId`, never through
  `signed-out`; the authentication session decides whether stored material refreshes it silently or
  the agent must act, exactly as at sign-in. Once the state returns to `authenticated`, Omni
  disposes the errored connection with `disconnect()` and calls `connect()` afresh, as for
  `reconnect`, and the fresh snapshot re-establishes state. The adapter tears nothing down itself
  and expects nothing to carry on: the connection that reported `error` is finished.
- **`displaced`** — another client connected on this login and took it: the agent moved desks.
  Nothing revives this connection on its own -- Omni does not reconnect, or it would take the
  login straight back from the desk the agent just sat down at -- and the desk shows the agent
  they are signed in elsewhere, with a way to take the login back, which is a `connect()` that
  displaces the other. See **`Adapter.connect(context)`**.

**Patience is the agent application's.** An adapter in `connecting` retries for as long as it takes and never
has to decide when to stop. Omni owns giving up: after however long it chooses to wait, it may
call `disconnect()` and either `connect()` afresh or surface the failure — so neither side waits
for the other to blink.

**`transport` is about the transport, nothing else.** It does not say whether the agent is available,
whether they are on a break, or how much work they can take: capacity travels on `setCapacity`,
availability on `BreakState`. Nor does it carry authentication — a session that expired reports
`expired` on `AuthenticationState` and fails actions with `omni.not-authenticated`, while
the transport underneath may be perfectly `active`. Provider login identity likewise belongs to
authentication state, not here.

**Only `active` means work can arrive.** Omni stops expecting assignments in any other value, so an
adapter that leaves a stale `active` in place is telling Omni to keep waiting for work that cannot
come — see **Liveness**.

**The status is seen, not merely known.** An agent application renders the transport's status where the agent
works — `connecting` from the moment it is reported, `error` with what revives it — and never a
healthy workspace over a transport that cannot serve it: an agent talking on a desk whose transport
died was an incident, and it happened because the desk knew and did not say. The same obligation
covers a `diagnostic`: shown where the agent works, and counted.

### `break-state`

Replaces this provider's complete `break` object. Its `status` uses the canonical
`not-requested`, `awaiting-approval`, `granted`, `starting-after-task` and
`on-break` states defined under Breaks; the event also carries the corresponding may-ask state,
reasons, retry details, and any forced break.

Each state is also held to the one before it. A commit's states, `starting-after-task` and
`on-break`, follow a grant — the one arrival in a committed state nobody asked for is a forced
break, which says so with `forced`: in effect at once, or `starting-after-task` while the member
finishes the call they are on (`stream.breakState.commitBeforeGrant`); and a break never moves backwards —
from `on-break` or `starting-after-task` to a grant or a request, or from `granted` to
`awaiting-approval` — a new request passes through `not-requested` (`stream.breakState.backwards`).
`testAdapter` holds the stream to that from the connect snapshot on;
`assertBreakFollowsItsRequests` holds any sequence.

Adapters and hosts can call `validateBreakTransition(before, after)` from the package’s validation entry point
with two complete break objects before applying an event. It checks shape and the transition
rules above; it does not mutate either state or apply the event. Report a violation visibly,
retain the last accepted state without claiming it remains current, and reconcile from the
source. Continue to validate the full envelope/login and task/break consistency separately.
The conformance `BreakStream` validates its baseline, retains the last accepted state on a
rejected delta, and sets `needsRecovery`. Transport loss also requires reseeding; an `active` transport
notification alone does not restore a break baseline. Until a fresh validated snapshot is seeded, further
break deltas are refused (`stream.breakState.baseline`); the first delta is never an implicit
snapshot. `seed(snapshot)` returns violations, which callers must check. This is a conformance
tracker, not a complete production reducer: snapshot freshness, login/connection fencing and
full task consistency remain separately required.

**Both sides must enforce the order.** The agent application validates immediately before dispatch; the
provider rechecks current permission and state atomically before acting. The provider validates
the resulting break/task state before publication and serializes those publications. The agent application
validates the envelope, transition and full task consistency before replacing local state. A
request result does not optimistically advance break state, and a delayed command cannot apply
to a later attempt merely because its status happens to look compatible. Keep at most one
unresolved operation per provider/attempt; recovery must resolve uncertainty before another
operation is dispatched. The source must fence delayed operations against its own attempt state.

Normal order is `not-requested` → `awaiting-approval` → `granted` →
`starting-after-task` → `on-break` → `not-requested`. Auto-approval may go directly to
`granted`; a commit with no outstanding work may go directly to `on-break`. Denial/cancel
returns a precommit request to `not-requested`; an explicit agent end returns a committed
break there. Same-state restatements are allowed. An evidenced forced break is the explicit
exception to requesting/granting, and must carry its forced actor/state. Neither skipped
publication nor an agent application-local guess creates another exception. A later normal attempt starts
from `not-requested`, never by regressing an active break into a request.

A fresh authoritative snapshot establishes a new baseline; do not run this event-transition
check across it. A snapshot may legitimately establish a later request or an already active
break after reconnect. Its freshness must be established by the source/adapter's ordered
snapshot/publication boundary and fencing of obsolete callbacks and reads. A delayed old
snapshot is not detectable from break status alone. Neither envelope time nor event ID
supplies a break revision. Do not suppress all requests after an active break: a later attempt
passes through `not-requested`, and then may request again. Do not replay earlier ProviderEvents
after recovery. Raw backend break handlers must preserve source order too; this helper does
not implement or assume invocation of Protocol's two-phase request/commit coordinator.


For a multi-provider break attempt, "every provider" is the set of providers frozen when the
attempt entered `requesting-break`. Omni commits only after every asked provider reports `granted` —
that one is unconditional, because nothing has stopped yet and waiting costs only time. It enters
`on-break` once every kept provider reports `on-break`; the commit bound decides who is kept,
setting aside a provider that has not applied the commit rather than holding a break that has
already begun elsewhere. Otherwise it follows the two-phase rules under **Coordinating a
multi-provider break**.

### `task-offered`

Offers a task to Omni without a separate offer acknowledgement. An offer does not accept
the task: when its phase is `pending`, Omni applies `autoAcceptTasks` and the task's
`acceptance`. `task-offered` must not introduce a task as `in-progress`; only a reconnect or
resync snapshot may report work already in progress. The provider includes the task in later
snapshots until it ends.

**Every offer is owed an ending.** An assignment the provider introduced is an assignment it ends,
with `task-ended` and an outcome, whatever became of the call: answered and completed, declined,
withdrawn, abandoned in the ring, lapsed, taken over. An offer that is simply never mentioned
again leaves the desk holding a task nobody will close, and the test names it
(`stream.taskOffered.unended`).

### `task-updated`

Replaces the current representation of one provider-local task. It is a full task value, not a
partial patch.

### `task-audio-started`

The provider's word that the task's audio should now attach. Omni calls `openAudio` on it — and on
a task carried with `audio: "started"`, which is how a reconnect snapshot reattaches audio an
earlier event brought — and renders the call as live from that word, never from its own senses. It
precedes `openAudio` and is never a reply to it: a provider whose audio state comes from the
platform, a station going in use the moment a call is answered, sends it then, before any agent application has
opened anything, and `openAudio` has its own answer for what the agent application did. It
names a task whose work has begun, and it alternates with `task-audio-ended`: audio that never
started cannot end, so a live call whose provider says nothing about its audio is a provider in
breach, not a state a desk fills in from its own devices.

The event is the transition and the task's `audio` field is the state. A `task-updated` re-states
the audio its task already holds — republishing `started` on a hold is a statement, not a second
arrival — but it does not move it: an update that itself flips the field is refused
(`stream.taskUpdated.audio`), and the pairing at the moment audio arrives is the phase change
without the field, then the event. Releasing `ended` is the one move an update may make, since
wrapped audio has nothing left to end.

### `task-audio-ended`

Signals that a task's real-time audio ended. For voice and similar channels, the `completing`
publication that follows carries `wrapEndsInSeconds` where a wrap allowance is stated: under
`provider-automatic` the provider ends the task when it runs out, under `agent-command` it is shown
and nothing more. It does not remove the task, and it ends only audio that `task-audio-started` — or
a task carried with `audio: "started"` — attached.

### `task-ended`

Every outcome ends the task for this agent. On `task-ended`, Omni:

- removes the task from its current provider view;
- clears the task workspace when it is selected;
- stops task timers and audio;
- releases task-scoped resources; and
- selects another task or returns to the idle workspace.

A `taken-over` outcome arrives at the member's own completion, after the wrap that follows a
take-over as it follows an `end-call` -- see **Lead assist** in `guide/lead.md`.

A successful `complete` command does not clear the task. Omni waits for `task-ended`,
and not for ever: `applied` to a `complete` says the
provider has completed the task, and its `task-ended` follows within the
manifest's `settleMs`. A provider never answers `applied` for a completion it has not yet
performed. Past the bound the agent application calls `snapshot()`: a snapshot still carrying the task is a task
held open by a provider that said it was done, and the desk shows it as unsettled -- "Completing...
the provider has not confirmed" -- naming the command; a snapshot no longer carrying it clears the
task, since the ending was owed and lost. The test holds a provider to the same bound
(`test.completion.unsettled`). The `task-audio-ended` event and the `completing` phase are likewise
non-terminal. A replacement
snapshot that no longer contains the task also clears it. Repeated `task-ended` delivery with the
same envelope ID is harmless, and a `task-ended` naming an assignment that has already ended is
recognised as the late event it is, never applied to whatever assignment is open now.

### `dial-outcome`

How a dial the agent application placed ended, once, either way, named by the `dialId` the agent application sent: `answered`,
or one of the declared ways of not reaching the destination, with the switch's `reason` where it
gave one. `assignmentId` names the task the dial was on, where there was one, and that task may already
have ended. Omni shows it to the agent against the call it belonged to and does nothing else: no
audio moves, since the provider bridges the leg on its side, and no dial is repeated. See **Every
dial has an outcome**.

### `announcement`

Publishes an agent-facing message. `text` is always required and is the accessible fallback.
Optional HTML is sanitized by Omni. `announcedAt` and optional `expiresAt` are RFC-3339 times with
explicit timezones.

### `diagnostic`

The provider's report that something its platform answered broke a rule the adapter relies on — a
state read that contradicted itself, a `task-ended` naming a task nobody held, a party arriving
without a name. `expected` is the rule as a sentence, `observed` is what came instead, and
`assignmentId` names the task where there is one. **Informational, never behavioural**: the provider has
already done the safe thing before it speaks, and nothing in the task or break machinery reacts to
a diagnostic. It exists so that the loudness reaches a person — an agent application renders each one where the
agent works and keeps a count an operator can read, because a healthy workspace over a shouting
console is the silence problem one layer up. One event per occurrence; the agent application counts, the
provider does not batch. `testAdapter` treats a diagnostic delivered during a run as a
violation (`diagnostic.raised`): a conformance run against a platform that is breaking its rules
fails loudly rather than passing with a note. A task published under `capabilitySource:
"not-yet-read"` is the same kind of fact, stated on the task instead, and fails a run the same way
(`capabilitySource.notYetRead`); see **Task capabilities** in `guide/agent.md`.

| Field | Contract |
| --- | --- |
| `expected` | Required. The rule that was broken, as a sentence a person can read. |
| `observed` | Required. What the platform answered instead. |
| `assignmentId` | Optional. The task concerned, where there is one, named by its assignment. |

### `queue-summary`

Publishes the provider's current dashboard contribution. Omni combines only the latest summary from
each connected provider.

| Field | Contract |
| --- | --- |
| `title` | Required agent-facing heading for this provider's contribution. |
| `subtitle` | Optional second line. |
| `waitingCount` | Required non-negative count of work waiting at this provider. `0` says the queue is empty; omit the summary entirely rather than guessing. |
| `updatedAt` | Required time the provider observed these figures, not the time it sent them. |
| `metrics` | Optional `SummaryMetric` entries the provider chooses to display. `id` values are stable and unique within that provider's summary. |

### `team-updated`

The whole `TeamMembers`, replacing what the lead had. It is emitted once, after the lead switches
the team feature on, and to nobody the provider does not publish a team to; every snapshot while
the feature is on carries the same whole team. The changes that follow arrive one member at a
time, below; the whole team is never resent for one of them. Nothing of the team goes to a login
that no longer declares `capabilities.lead` on a republished `authenticated`, or to a lead who
turned the feature off (`event.team.features`).

### `team-member-updated`

One member, whole, as they now stand: their availability, their tasks, their listening, their
shift, their request. It replaces the member of that `id` on the lead's list, or adds them where
the list did not carry them, so applying it twice changes nothing. It comes only after the whole
team has (`stream.team.baseline`), and it is what every publication of a member's task to the
member publishes to the lead, as **Team leads** in `guide/lead.md` sets out: never fewer.

### `team-member-removed`

One member taken off the lead's list, by `memberId`: somebody who left the team, not somebody who
signed out, which is an availability the member is published with. It names a member the list
carried (`stream.teamMember.unknown`).

### `team-policies-updated`

The team's policies, whole, replacing what the lead had -- as `TeamMembers.policies` carried them.
Emitted where the provider offers policy control, after the whole team has (`stream.team.baseline`).

### `contacts-updated`

Replaces this provider's complete contact contribution. It is emitted only when the manifest declares
the `contacts` idle capability.

### `calendar-updated`

Replaces this provider's complete scheduled-activity contribution. It is emitted only when the manifest
declares the `calendar` idle capability.

### `next-call`

The agent's ask for the next call as it now stands, replacing `Snapshot.nextCall`: present while
the ask stands, absent once it was met by a lined-up call, withdrawn by the agent, or outlived by
the assignment it was pressed on. See **The agent's own queue** in `guide/queue.md`.

### `lined-up`

The agent's own queue as it now stands, replacing `Snapshot.linedUp`: the call lined up for them,
or nothing. It clears when the call becomes a task, on the ordinary `task-offered`, and when the
queue gave the call to somebody else, the caller gave up, or the agent let it go. See **The
agent's own queue** in `guide/queue.md`.

### `phone-updated`

The phone as the platform now sees it, whole, replacing `Snapshot.phone`: a registration lost or
back, do-not-disturb pressed or cleared, the handset lifted with no call or replaced, the desk
phone's own mute. Emitted only by a provider whose manifest declares `phoneStatus`
(`event.phone.capability`). The lead's member carries the same `PhoneState`, republished with the
member. See **The phone's own view** in `guide/phone.md`.

### `shift-updated`

The agent's own day, whole, replacing `Snapshot.shift`: emitted whenever a total moves -- a task
ended, a break ended, a sign-out -- and never to say nothing changed. It carries the same `Shift`
the agent's lead sees for them on the team member list, so the two screens show one day. See
**The agent's day is on the wire**.

## Utilities

### `assignmentKey(providerId, assignmentId)`

Returns a collision-safe global task key by encoding and joining the provider id and the
assignment id. Use this key in Omni state; an assignment id is unique within its provider and
never across providers.

### `userKey(providerId, userId)`

The same treatment for a `UserId`, and needed for the same reason: user identifiers are
issued by each provider independently, so two providers will eventually issue the same string for
different people. Encode and join before storing or comparing.

Use it for every `UserId` — `history[].by`, team members, `memberId` on a
lead command, `ForcedBreak.by` where it names a person rather than `"provider"`. A bare one is only ever compared against another from the **same** provider; anything
wider goes through this key.

### `sameCapabilities(a, b)`

Whether two logins declare the same capabilities, field by field — key order aside, and with
`team: {}` distinct from `team` absent. It is the comparison an adapter makes before republishing
`authenticated`, and the one `testAdapter` holds `refreshing` to.

## Runtime validation

Structural rules in this document are executable through the runtime validators Omni applies to
adapter output. Behavioral rules are exercised through deterministic conformance scenarios. The
same exported checks are used by Omni and adapter tests so their interpretations do not drift.

| Function | Validates |
| --- | --- |
| `validateManifest(manifest)` | Identity, protocol-version interoperability, authentication methods, and idle-capability shapes. |
| `validateTask(task, { channel, locked? })` | Identity, channel agreement, phase, wrap allowance, capability shapes, custom controls, and browsers. Given `locked`, the values the queue locked, a task whose party stands locked carries none of them anywhere else (`task.locked.leak`). |
| `validateSnapshot(snapshot, manifest)` | Status, break state, break reasons, team member list, the stated `taskCount` reconciled against the tasks carried, and every task, contact, and activity, including idle-capability gating both ways: a contribution the manifest never declared is refused, and one it declares is required, `[]` included. |
| `validateEventEnvelope(envelope, manifest)` | Envelope identity, timestamp, and the payload for each event type. |
| `validateContact(contact)` | Contact field shapes and attribute keys. Every field is optional, so this checks what is present rather than what is missing. |
| `validateScheduledActivity(activity)` | Required activity fields and start/end ordering. |
| `validateHostGuarantees(guarantees)` | What an agent application promises: only the guarantees this contract names, each declared by presence and never `false`. The harness validates the guarantees of whatever agent application a test hands the adapter. |
| `validateProviderTimeCheckPolicy(policy)` | Explicit optional polling settings, positive safe-integer durations and round-trip/timeout/interval ordering. |
| `validateProviderTimeCheckRequest(request)` | Fresh-request shape; the agent application enforces actual uniqueness and outstanding-request lifetime. |
| `validateProviderTimeCheckResult(result, request, loginId)` | ISO timestamp, clock identity, exact request/login correlation; timing and source accuracy remain runtime checks. |
| `validateProviderTimeEstimate(estimate, scope)` | Optional agent application estimate shape and provider/login scope; no accuracy guarantee. |
| `validateHistoryReport(report, path?, manifest?)` | What the agent application reports of a leg it performed, for an adapter to check before forwarding: a task, a step, when it began, a positive `seconds` where stated, and an explicit `ended` that carries the final duration. Given the manifest, a running report is refused unless it declares `runningStepReports`. |
| `validateHostReport(report)` | The agent application's own report as published to an adapter: `online`, and where there is audio, an input that is `available` with the microphone and `flowing`, or `unavailable` with a reason and the failure that says why, and an output that is `available` or `unavailable` with its failure. The harness validates whatever agent application a test hands the adapter; `stillHost(report)` builds one that never changes. |
| `validateHostMute(mute, softphone)` | What the agent application's Mute does, stated on a softphone login and nowhere else: `stream` or `station` (`host.mute`), required where the agent application holds a microphone (`host.mute.required`) and refused where it does not (`host.mute.unexpected`). The harness holds `ConnectContext.host.mute` to it. |
| `validateLoginStore(store)` | The login's store the agent application hands every connection: an object with `get`, `set` and `delete` (`store.shape`, `store.get`, `.set`, `.delete`). The harness holds `ConnectContext.store` to it. |
| `validateCapacity(capacity)` | What the agent application states as capacity: a whole number of zero or more (`capacity.count`), zero being agent application-stopped. The harness states one on connect and two, one and zero after the test, each answered `applied`, and holds any offer to the count in force (`stream.taskOffered.overCapacity`). |
| `validateAuthenticationResult(result, method)` | What `start()` or `complete()` answered: a challenge or a rejection, a login or a rejection. A rejection's failure is held to its rules -- an `omni.` code the contract lists, and `omni.phone-not-permitted` never retryable, since the agent's station is configuration. `validateAuthenticationFailure(failure)` is the same check on a failure alone. |
| `validateTaskCommand(command, task?)` | What a command needs to be issuable, against the task it names: its own shape -- a dial's `dialId`, a conference's item, a schedule's time, a remove naming exactly one person -- and, with the task, the capability the table above gates it on (`command.capability.<name>`, `.locked`), the phase it belongs to (`command.phase.*`, `command.phase.interaction` for every control on the call or the conversation), and the state that has to stand: a lead requested, somebody else still on the call (`command.conference.remove.alone`). An agent application validates before sending and an adapter before acting. |
| `validateResult(result, method)` | What a connection method answered: the status it gives, a failure where the status says so and nowhere else, the failure's shape, and that an `omni.` code is one this contract names. |
| `validateAuthenticationState(state)` | The identity each state must carry, the capabilities a usable login declares, and the expiry that only `authenticated` may. Omni applies it to every state a session publishes — the republished as much as the first. |

Each returns `ProtocolViolation[]` rather than throwing, so a caller can report every problem at
once. A violation carries a stable `rule` id such as `task.browser.url.scheme`, the `path` it was
found at such as `snapshot.tasks[0].browsers[1].url`, and a `message`.

Some rules need to know who is reading. `validateTeamMembers`, `validateSnapshot`, and
`validateEventEnvelope` take an optional final `{ self, capabilities, leadFeatures }` — the signed-in agent's
`AuthenticationState.identity.id` and their login's `capabilities`. Given `self`, a team member list that
carries that agent reports `team.member.self`, on a `team-member-updated` and a `team-member-removed` as on the list. Given `capabilities`, a team member list published to a login that does not lead
reports `team.unentitled`, and a team event to such a login reports `event.team.capability`; given
`leadFeatures: true`, a snapshot without a team reports `team.required`, and given `leadFeatures: false`,
anything of the team reaching the lead reports `team.unexpected` or `event.team.features`. Without them those rules are not checked, because they cannot be.
`testAdapter` passes all three, holding the switch off until it has sent it. Given the manifest, a
snapshot or event that carries an instant the desk renders as a running duration under a manifest
without `timeCheck` reports `manifest.timeCheck.required`.

`assertNoViolations(violations)` throws `ProtocolConformanceError` — which carries the full
`violations` array — when the list is non-empty.

**Omni must validate at runtime, not only in tests.** An adapter is loaded from a separate package
and may be compiled against a different protocol version, so its output is untrusted input.
Validating a snapshot before it replaces provider state is what stops a malformed task from
reaching the workspace.

### What the agent application does with what it refuses

A refusal has an aftermath on the desk and a report to the provider, and both are stated.

- **A refused snapshot replaces nothing.** The agent application keeps the last state it took from this
  provider whole, and shows the provider as faulted -- the transport as it stands, and the words
  "last update refused" with the rule -- so the agent knows the view is standing still rather than
  believing it current. It does not adopt the good half of a snapshot: a task the agent is on would
  vanish from the desk while the call is up.
- **A refused event is dropped and counted.** The state the agent application holds does not move for it. The
  provider is told, and may republish a corrected state or raise a `diagnostic`; the agent application retries
  nothing. The desk shows nothing for it: the view kept moving for every other event, so "last
  update refused" would be false of it, and a chip that said nothing would be right about the
  transport. Counted, and the provider told, is all an agent application can truthfully do for one event.
- **The provider is told, every time.** `refused(report)` carries the artefact, the envelope id for
  an event, and every violation with its rule and path. An adapter logs it at error and treats it as
  its own defect until shown otherwise: what the agent application refused never reached the agent, and a
  provider that hears nothing runs a whole shift beside a frozen desk with nothing wrong on its
  side. The harness tells an adapter under test exactly as an agent application does
  (`connection.refused.required`, `connection.refused.rejected`).

## Testing an adapter

### `testAdapter(adapter, context, options?)`

Adapter conformance exercise from `@xema/omni-protocol/testing`.

It validates the manifest, opens an authenticated session, connects, checks required capability
methods, subscribes, validates the snapshot, every delivered event, and every authentication state
the session publishes during the run — each against the latest login, since capabilities are
current, not fixed — states a capacity, then unsubscribes and disconnects. Provider packages should
run it with a deterministic test transport and authentication state.

By default it throws `ProtocolConformanceError` listing every violation. Pass
`{ collectOnly: true }` to receive them on the result instead:

```ts
const result = await testAdapter(adapter, context, { collectOnly: true });
expect(result.violations).toEqual([]);
expect(result.disconnectWasClean).toBe(true);
```

`result.authenticationState` is the state the session was restored with; `result.login` is the
latest the session published during the run, which differs only when the adapter republished
`authenticated`. A published state that fails validation is reported and not adopted, and a
`refreshing` state must carry over the login it refreshes — a different identity is
`authentication.refreshing.identity`, a changed capability set `authentication.refreshing.capabilities`.
A capability granted by a later login requires its methods just as one declared at sign-in does.

`result.notTested` lists what the run never reached — one subject per family of rules: each
optional part of a task (`task.browsers`, `task.history`, `task.leadAssist`, …), the break's
`reasons` and `forced`, the team member list's `members` and a member's `request`, each declared contribution, and
each event type (`event.task-ended`, …) — and so what a clean `violations` says nothing about.
Nothing there is a violation: an adapter with no team has nothing to exercise. But a fixture with
no tasks exercises no task rule, and a pass over it reads as coverage it is not.

**A static run never answers a call.** It states a capacity and disconnects, so everything
downstream of `answer` -- the room, the stage, audio, every phase past `pending`, every dial
outcome -- stays in `notTested` for every adapter, and a rule about a live call is enforced only
in each adopter's own tests. `{ withCall: true }` closes that: the exercise takes the first task the
provider offers through one ordinary lifecycle -- accept it, wait for its audio and open it on a
softphone, hold and resume where the task offers `hold`, end the call where it offers `endCall`,
complete it with an outcome where the agent completes -- and holds every step to the rules a
agent application holds a provider to. Each command is validated against the task as published
(`test.command.*`), each answer for its method, a refusal of a control the task offered is a
violation (`test.command.failed`), and an event the provider owes and never sends is one too
(`test.timeout`, after `timeoutMs`, 5000 by default). A first offer that says how long it has is left to
lapse and expected to end `expired`, and a preview's deadline is held to its `atDeadline`
(`test.offer.expired`, `test.preview.deadline`); see **Every screen counts from the provider's
clock**. Around the test the exercise holds
the run to what an agent application holds a provider to between commands: an offer before the agent application stated
capacity, or beyond the count with nothing dialled on it, is named
(`stream.taskOffered.beforeCapacity`, `.overCapacity`); every user the snapshot names is looked up
through `getUserDetails` and the answer held to the shape, nobody unasked, nobody described as
nothing (`getUserDetails.user.*`, `getUserDetails.unasked`, `connection.getUserDetails.empty`); and
the second adapter a `rebuild` gives comes up signed in as the same login from the secrets alone
before it reads anything (`test.reload.login`), and is then held to everything the first was on
connect: the methods its declarations call for, the agent application's report, a capacity stated to it, its
snapshot read as the connect snapshot was, and its audio opened afresh on a task carried with
`audio: "started"`, since the first client's session died with it. The result also says which rules the
run evaluated, pass or fail, in `rulesTested`: the validators' as each was applied, the stream's
as each case was considered, so a test that needs a rule to have run asserts it there rather than
inferring it from an empty `violations`, and a rule absent from it was never looked at, which is a
gap and not a pass. With the audio open on a softphone,
the test mutes it for one second and reports the leg through `recordStep`, begun and then ended,
expecting each report `recorded` with the provider-selected history `at` (`test.recordStep.failed`, `.rejected`, `result.recordStep.at`); then it mutes again and
ends the call muted, as agents do, so the leg is open when the audio ends, the provider closes it
in the completing publication or the open entry is refused (`task.history.muted.open`),
and the test's closing report after the audio ended is expected `recorded` and to change nothing:
a record restated afterwards with that leg's duration altered is named (`test.recordStep.overwritten`).
Where the provider restates the task's record afterwards, each leg is in it or the hole is named
(`test.recordStep.history`). Given `rebuild`, a way to build the adapter again as an agent application reload
does, the test reloads the agent application as a reload happens: the first client is unsubscribed,
disconnected and its session closed (`test.reload.handover`), and only then is a second adapter
built and connected for the same login with the same context and the same `store`; its snapshot
must carry the task with that leg at its acknowledged provider timestamp and the reported actor, and the run goes on with the second as its
connection to the end. A platform that holds the record hands it back, and an adapter that composed
the record in memory has nothing and is named (`test.reload.snapshot`, `test.reload.history`,
`.rejected`). The second adapter's snapshot is taken as any resync is: held to what the stream knew
before it replaces it, so a phase gone backwards, a record that shrank or audio forgotten on a task
still at work is named by the stream's own rules (`stream.snapshot.phase`, `.history`,
`.audio`) and a reload is a place those rules keep working, not one where they stop. The second
adapter is held to what the first was: the same provider
(`test.reload.manifest`), a snapshot that stands as any snapshot must, and a record that lost none
of the entries the first had published -- a record once read is not unread across a reload either.
A reconnect on the same adapter object would prove nothing, since an in-process adapter's memory
survives it; only a second object separates kept-in-the-store from never-lost. And because the
first client is gone before the second connects, there is no client for the platform to push the
open task back to, and nothing about the reload is exempt from any rule. The second adapter opens its session from the same
`secrets`, so the reload is a restore before it is anything else: an adapter that holds a session
has already put what would rebuild it into the secrets store, from the moment it was handed one,
not only when a flow completes -- the session is the adapter's, the store is the agent application's, and a
agent application reload is exactly when no flow will run. And once the task has ended, the store the test
handed the adapter holds no key naming the task's assignment id, delimited, never as a run of characters inside
another id (`test.store.retained`); an adapter whose keys never named the task leaves the rule
unevaluated, and the result says so rather than passing it: a task's keys go
with the task, or whatever comes next inherits them. Outside the
interaction phases with `hold` still declared -- in
`confirmed`, where the provider publishes it, and in `completing` once this agent's interaction has ended -- the
test sends `hold` past the validator that would hold it back, and expects `failed`: the adapter
is the second gate on a control on the contact, and one that applies it outside this task's
current interaction is named (`test.command.interaction`). The test cannot put a task into a phase the provider
never publishes, so a provider that goes straight from `pending` to `in-progress` is checked in
`completing` alone. A task the agent completes is
completed from wherever it stands once the test has nothing left to do on it -- from `completing`
after an `end-call`, or from `in-progress` where there is no call to end, which is every chat and
email and a voice task offering no `endCall` -- so a conversation reaches its end as a call does.
The test stops where the task offers no way on and says nothing about what it could not reach. A
softphone adapter written for a browser needs its audio APIs supplied by whatever runs the
harness: the test opens audio outside a browser, and a provider that quietly stopped carrying audio
where `AudioContext` was missing would be lying about the one thing the channel is for. It is off by default because it issues
commands against whatever platform the adapter is connected to: turn it on against a test backend.

```ts
const tested = await testAdapter(adapter, context, { collectOnly: true, withCall: true });
expect(tested.violations).toEqual([]);
assertReached(tested, ["task.onCall", "task.audio", "event.task-ended"]);
```
`assertReached(result, subjects)` is the paired assertion: it throws naming every subject the run
never met, so a test that meant to check a team member list cannot pass on a fixture that never produced one.
It reads like a guarantee and is a claim the adopter keeps making: it catches an adapter that
stopped reaching a subject, not a list that stopped asking, so a list can rot to nothing and stay
green. Keep it honest with a control beside it -- one subject the run genuinely cannot reach,
asserted to throw -- so the assertion is shown to be looking rather than agreeing.

Three properties of the harness matter to adapter authors:

- **Violations are collected, never thrown from inside the subscribe listener.** Throwing there
  would unwind through the provider's own dispatch for a synchronous emitter, and would be
  swallowed as an unhandled rejection for an asynchronous one — letting a non-conforming async
  adapter pass.
- **Resources are released even when the adapter fails.** Every unsubscribe, `disconnect()`, and
  `close()` run in a `finally` block, and a throw from any of them is reported as
  `disconnectWasClean: false` rather than being hidden.
- **The login is read, never captured.** Everything is validated against the latest
  `authenticated` state, so a withdrawal published before a snapshot is held against that snapshot.

### Contract scenarios

The testing entry point also exports deterministic, reusable checks for lifecycle behavior that
cannot be established from TypeScript structure alone.

| Helper | Contract checked |
| --- | --- |
| `assertCapabilityWithdrawal(states, snapshot, manifest)` | A capability withdrawn by a later `authenticated` state is gone from the next snapshot: no team member list for a login that no longer leads. Every state is validated on the way, `refreshing` must carry the login over, and the sequence passes only through usable states. |
| `assertTaskCapabilityWithdrawal(tasks, manifest, command)` | A capability withdrawn by a republish of the task is gone from the task: every task in the sequence is validated, all carry the offer's id, at least one capability the offer declared is absent at the end (a locked control is present, not withdrawn), and `command` is clean against the first task and refused against the last for want of a withdrawn capability and nothing else. Pair it with `assertCommandRefusedAfterWithdrawal` on the provider's answer. |
| `assertCommandRefusedAfterWithdrawal(result)` | A command that arrives after its capability was withdrawn fails with `omni.capability-not-enabled`, named by the provider. The same assertion serves a command the provider never supported under a capability it declares. |
| `assertReached(result, subjects)` | The exercise met every subject named; throws listing those it did not. Pair it with a clean `testAdapter` result. |
| `assertAuthenticationRestoreAndExpiry(states)` | A restored authenticated session can refresh and ends in expiry. Every state is validated. |
| `assertReconnectWithMissedAssignments(before, reconnect, ids)` | A reconnect snapshot restores assignments received while offline. |
| `stillHost(report?, guarantees?, mute?)` | An agent application that reports one thing and never changes, for a test context: `{ online: true }` by default, a report with audio for a softphone voice adapter, and never for a desk phone. |
| `TaskStream`, `BreakStream` | The cross-event models the harness applies after the connect snapshot, exported for an agent application that wants the same rules at its boundary: `seed(snapshot)`, then `apply(envelope)` returns the violations. |
| `assertBreakFollowsItsRequests(envelopes, snapshot?)` | A break follows its requests: a commit's states only after a grant, never backwards, and a forced break arriving in effect with `forced`. The harness applies the same rules after the connect snapshot. |
| `assertAudioFollowsTheTask(envelopes, snapshot?)` | The audio follows the task and never decides it: every task is introduced once, `task-audio-started` and `task-audio-ended` alternate on work that has begun, audio ends only where it arrived, and what follows the audio ending is `completing` or `task-ended`. The harness applies the same rules to every event after the connect snapshot (`stream.*`). A sequence with no audio satisfies it by never testing it — pair it with the assertion that the audio end is present. |
| `assertBreakAttemptProviders(candidates, asked)` | A break attempt asks every usable provider holding capacity, `refreshing` included, and nothing of a provider whose login is `expired`. |
| `assertForcedBreakStopsTheRest(forcedOn, candidates, stopped)` | A forced break on one provider stops the agent everywhere else: capacity zero stated on every other usable provider holding capacity, nothing on the forcing one, nothing on a dead login. See **Forced breaks** in `guide/breaks.md`. |
| `assertBreakBeginsAfterTask(steps)` | A break asked for on a task is committed as `starting-after-task` while work remains and reaches `on-break` only once nothing is outstanding — never beside a task, never later than the step that has none. |
| `assertDeniedAndRetriedBreak(states)` | A denial transitions directly to `not-requested`; a later request can still be granted. |
| `assertBrowserSessionIsolation(left, right, expected)` | Browser reuse follows only the declared isolation scheme. |
| `assertNoBrowserSessionKeyCollisions(scenarios)` | No two distinct scenarios derive the same session key. Feed it adversarial names. |

Adapters should run the relevant scenarios against deterministic test state before publishing.

> **Assert both directions.** Each helper above rejects a violating input as well as accepting a
> conforming one. A suite that only ever asserts "this conforming case does not throw" passes
> unchanged if the helper is gutted, so pair every positive case with the violating twin.

## A provider does not style the workspace

How a deployment themes Omni is the agent application's concern and is specified with the agent application, not here. What
belongs in this contract is the boundary. A provider says what a control **is** through its
capabilities and what its work is **called** through `phaseLabels` and `taskTypePresentation`; how
any of it is drawn is Omni's. A task cannot select a design language, inject a component, or
override the agent's theme and font preferences.
