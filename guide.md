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

## Terms

**Define a vocabulary; do not merely list it** applies to this document's own prose. These words
are used precisely throughout and mean nothing looser here.

| Word | What it means |
| --- | --- |
| **Omni** | The desktop application an agent works in. It composes several providers into one agent-facing experience and owns everything outside a provider's own system. |
| **Host** | Omni, named that way where the contrast with a provider is the point — *the host carries the audio*, *host-side input*. |
| **Provider** | One independently connected external system: a voice platform, a chat platform, a mail platform. |
| **Adapter** | The package implementing this contract for one provider. One adapter is one provider, so the words are often interchangeable; *provider* names the system, *adapter* the code speaking for it. |
| **Agent** | The person signed in and taking work. On `onCall`, `agent` is a person on the call by user id; a transfer never names one, since a contact goes back to a queue. |
| **Lead** | An agent whose login declares `capabilities.team`. The provider publishes a `TeamRoster` to them and to nobody else: **the login is the permission**. |
| **Provisioning** | Omni-side policy about this agent, configured outside the protocol and never sent to a provider. It gates whether an offer may be rejected, whether the agent goes ready on login, and whether tasks are auto-accepted. Where a capability and provisioning disagree, the stricter wins. |
| **Task** | One unit of assigned work — a call, a chat, a mail. |
| **Channel** | The kind of work a provider carries: `voice`, `chat`, or `email`. Fixed per provider by its manifest. |
| **Task type** | The provider's own name for a category of work — a queue, a mailbox folder, a chat source. Free-form, and finer-grained than a channel. |
| **Capability** | A provider's declaration that a control exists for a task or a session. It says *offer this*; the provider performs it, and the host only offers it — see **Where a command executes**. |
| **Login** | One authenticated sign-in to one provider, identified by `loginId`. A transport reconnect keeps it; signing in again replaces it, and nothing tied to the old `loginId` survives. |
| **Transport** | The adapter's connection to its platform: a WebSocket or SignalR connection, required to be persistent and ordered. Which one and how it reconnects are the adapter's business; losing it does not end a login. |
| **Connection** | The `Connection` object Omni holds for one login: the methods it can call and the events it receives. |
| **Concurrent capacity** | How many tasks this provider may have allocated to the agent at once — an absolute ceiling, stated as `AgentCapacity.count` and standing until Omni restates it. The provider counts its own outstanding tasks against it. |
| **Snapshot** | The provider's complete state at one moment. It replaces what Omni holds; it is never a patch. |
| **Event** | One completed transaction reported after a snapshot established the baseline. |
| **Break** | A reported, supervised state in which the agent is not working — one with a reason, a decision behind it and a return. It covers what a platform may call *not-ready*, including equipment trouble. An agent who is merely at capacity is not on a break. |
| **Workspace** | What Omni shows the agent. The **task workspace** holds the selected task, its controls and its browsers; the **idle workspace** holds what a provider contributes when no task is selected — dialpad, contacts, calendar, roster. |
| **Dial** | One outbound call the host asks a provider to place — from the idle dialpad, a cold or warm transfer, a conference add, or a connect-back. Identified by the host's `dialId`, accepted as `dialling`, and ended by exactly one `dial-outcome`. See **Every dial has an outcome**. |
| **Monitor** | A lead listening to a member's call unasked, from the roster: `monitor` in silence, `whisper` heard by the agent alone, `barge` heard by everyone. Nothing of it reaches the member's task, and there is no take-over in it. See **Monitoring a call**. |
| **On the call** | Who a voice task's audio joins, or is bringing in, as the provider states it on `Task.onCall`: the party, the agents, and anyone consulted or conferenced in from the moment their dial is placed. |

Six words describe *what state a thing is in*, and they are not interchangeable: each belongs to
one thing, so a bare "status" in conversation is always the authentication session's, and a
transport, a task, a break and a call each have a word of their own:

| Word | Belongs to | Values |
| --- | --- | --- |
| `phase` | A task | `pending`, `confirmed`, `preview`, `in-progress`, `paused`, `completing` |
| `media` | A task's audio | `started`, `ended` |
| `transport` | A connection | `connecting`, `active`, `error` |
| `status` | An authentication session | `signed-out`, `authenticating`, `authenticated`, `refreshing`, `expired` |
| `approval` | A break request | `not-requested`, `awaiting-decision`, `granted`, `starting-after-task`, `in-effect` |
| `availability` | A roster member | `ready`, `on-task`, `on-break`, `signed-out` |

## Versioning

### `OMNI_PROTOCOL_VERSION`

The exact protocol version implemented by this package. The current value is `1`.

### `Manifest.supportedProtocolVersions`

An adapter declares **every** version it can speak, not just the one it was compiled against:

```ts
supportedProtocolVersions: [1]        // v1 only
supportedProtocolVersions: [1, 2]     // can serve either host
```

A single pinned version would make migration impossible: recompiling against a newer package
would silently move an adapter to the new version with no window in which both sides
interoperate. Declaring a set lets an adapter support the old and new host at once, so the two
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
type TaskId = string;
type AllocationId = string;
type DialId = string;
type DurationSeconds = number;
```

| Semantic type | Wire type | Meaning and constraints |
| --- | --- | --- |
| `IsoTimestamp` | `string` | An RFC-3339 timestamp with `Z` or an explicit numeric offset. Timezone-less values are invalid. It must pass the shared runtime validator. A JavaScript `Date` never crosses the protocol boundary. |
| `UserId` | `string` | A non-empty, opaque, stable identifier for a person, **issued by the provider** and drawn from the same directory as `AuthenticationState.identity.id`. It names agents and managers alike; the role is established by where the value appears, not by its type. Compare it exactly and only within one provider; do not parse it or infer meaning from its format. |
| `TaskId` | `string` | A non-empty, opaque task identifier unique within one provider. Omni scopes it with the provider ID. |
| `DurationSeconds` | `number` | A non-negative integer duration measured in seconds. |

### There is no Omni-wide user identity

Every person named in this protocol is named by the provider that reported them. Omni holds no
identifier of its own for an agent or a manager, and none crosses this boundary — not the
operating-system account, not a directory identity, not a licence.

So a `UserId` means nothing outside the provider that issued it. Provider A's
`handlingHistory[].by` and provider B's roster `memberId` are unrelated strings that will
eventually collide, and one person on several providers has several identities that nothing here
pairs. Scope every user identifier with its provider ID before storing or comparing it, exactly as
`taskKey()` already does for tasks — see `userKey()` under **Utilities**.

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
  phaseLabels?: TaskPhaseLabels;
  taskTypePresentation?: Record<string, TaskTypePresentation>;
  orgLevels?: LevelDeclaration[];
  dialOutcomes?: C extends "voice" ? DialOutcome[] : never;
  phones?: C extends "voice" ? Phone[] : never;
  runningStepReports?: true;
  disposalSettleMs: number;
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

type MonitorMode = "monitor" | "whisper" | "barge";

type TeamCapabilities = {
  breakControl?: true;
  leadAssistControl?: true;
  monitorControl?: MonitorMode[];
  policyControl?: true;
};

type UserCapabilities = {
  breaks?: true;
  preferences?: AgentPreference[];
  team?: TeamCapabilities;
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

type HostReport = {
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

type Host = {
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
  | { phone?: "deskPhone"; host: { mute?: never } }
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

type HandlingReport = { taskId: TaskId; allocationId: AllocationId; at: IsoTimestamp } & (
  | { step: "muted"; mutedBy: MutedBy }
  | { step: Exclude<HandlingStep, "muted">; mutedBy?: never }
) & (
  | { ended: true; seconds: DurationSeconds }
  | { ended?: never; seconds?: DurationSeconds }
);

type HandlingReportResult =
  | { status: "recorded" }
  | { status: "failed"; failure: ProtocolFailure };

type PreferenceResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };

type Snapshot = {
  transport: TransportStatus;
  loginId: string;
  break: BreakState;
  tasks: Task[];
  taskCount: number;
  contacts?: Contact[];
  scheduledActivities?: ScheduledActivity[];
  team?: TeamRoster;
};

type AgentCapacity = {
  count: number; // absolute ceiling, zero or more; zero is host-stopped
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
type DispositionCode = { id: string; label: string; group?: string };

type DispositionRules = {
  required?: boolean;
  notes?: "required" | "optional" | "none";
  codes?: DispositionCode[];
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
  dispositions?: true | DispositionRules;
  custom?: CustomCapability[];
};

type TaskCapabilities<C extends Channel = Channel> =
  C extends "voice"
    ? SharedTaskCapabilities & {
        decline?: Lockable<true>;
        hold?: Lockable<true>;
        endCall?: Lockable<true>;
        connectBack?: Lockable<true>;
        coldTransfer?: Lockable<DestinationDirectory>;
        warmTransfer?: Lockable<DestinationDirectory>;
        leadAssist?: Lockable<true>;
        conference?: Lockable<DestinationDirectory>;
        recording?: Lockable<true>;
      }
    : C extends "chat"
      ? SharedTaskCapabilities & { decline?: Lockable<true>; hold?: Lockable<true> }
      : SharedTaskCapabilities & { decline?: Lockable<true> };
```

The channel arms are why `Task<"email">` rejects `hold` at compile time rather than at runtime.

### Task workspace

```ts
const BROWSER_ISOLATION_SCHEMES = {
  PROVIDER_NAME__TASK_ID__TAB_NAME: "ProviderName.TaskId.TabName",
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
  taskId: TaskId;
  allocationId: AllocationId;
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

type HandlingStep =
  | "queued"
  | "offered"
  | "answered"
  | "held"
  | "muted"
  | "transferred"
  | "conferenced"
  | "unanswered";

type TaskHandlingHistory = {
  steps: TaskHandlingStep[];
  handleSeconds?: DurationSeconds;
  holdSeconds?: DurationSeconds;
  queueSeconds?: DurationSeconds;
  transfers?: number;
};

type TaskHandlingStep = {
  step: HandlingStep;
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

type OnCallRole = "party" | "agent" | "consulted" | "conferenced";

type OnCallStage = "ringing" | "joined";

type OnCall = { since: IsoTimestamp; held?: true } & (
  | { role: "party"; dialId?: never; stage?: never }
  | { role: "party"; stage: OnCallStage; dialId?: DialId }
  | { role: "agent"; userId: UserId }
  | { role: "consulted" | "conferenced"; destinationId: string; stage: OnCallStage; dialId?: DialId; label?: string }
);

type TaskLeadAssist = { note?: string; since: IsoTimestamp } & (
  | { stage: "requested"; leadId?: never }
  | { stage: "joined"; leadId: UserId }
);

type TaskAssisting = {
  memberId: UserId;
  note?: string;
  since: IsoTimestamp;
};

type TaskMonitoring = {
  memberId: UserId;
  taskId: TaskId;
  allocationId: AllocationId;
  mode: MonitorMode;
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

type TaskMediaState = "started" | "ended";

type CapabilitySource = "queue" | "ungoverned" | "undetermined";

type Task<C extends Channel = Channel> = {
  id: TaskId;
  allocationId: AllocationId;
  title: string;
  channel: C;
  taskType: string;
  capabilities: TaskCapabilities<C>;
  capabilitySource: CapabilitySource;
  browsers: TaskBrowser[];
  party?: Contact;
  phase: TaskPhase;
  acceptance?: AcceptanceMode;
  previewEndsAt?: IsoTimestamp;
  atDeadline?: PreviewDeadline;
  reference?: string;
  attributes?: TaskAttribute[];
  handlingHistory?: TaskHandlingHistory;
} & TaskCompletion & (
  C extends "voice"
    ? { onCall?: OnCall[]; leadAssist?: TaskLeadAssist; assisting?: TaskAssisting; monitoring?: TaskMonitoring; media?: TaskMediaState }
    : { onCall?: never; leadAssist?: never; assisting?: never; monitoring?: never; media?: never }
);

type PreviewDeadline = "calls" | "expires";

type AcceptanceMode =
  | "no-preference"
  | "consent"
  | "automatic";

type TaskOutcome =
  | { type: "completed"; by: "agent" | "provider" }
  | { type: "transferred"; destinationId?: string }
  | { type: "taken-over"; leadId: UserId }
  | { type: "cancelled"; by: "agent" | "provider" | "party"; reason?: string }
  | { type: "expired"; phase: "pending" | "confirmed" | "preview" }
  | { type: "left" }
  | { type: "failed"; failure: ProtocolFailure };
```

### Task commands

```ts
const TASK_COMMAND_NAMES = {
  voice: [
    "answer",
    "decline",
    "call",
    "hold",
    "resume",
    "end-call",
    "connect-back",
    "transfer",
    "lead-assist",
    "conference",
    "recording",
    "complete",
  ],
  chat: ["accept", "decline", "pause", "resume", "complete"],
  email: ["accept", "decline", "complete"],
} as const;

type TaskCommandName<C extends keyof typeof TASK_COMMAND_NAMES> =
  (typeof TASK_COMMAND_NAMES)[C][number];

type DispositionPayload = { disposition?: string; notes?: string };

type VoiceTaskCommand =
  | { type: "answer" }
  | { type: "decline" }
  | { type: "call"; dialId: DialId }
  | { type: "hold" }
  | { type: "resume" }
  | { type: "end-call" }
  | { type: "connect-back"; dialId: DialId }
  | { type: "transfer"; action: "cold"; dialId: DialId; destinationId: string }
  | { type: "transfer"; action: "warm"; dialId: DialId; destinationId: string }
  | { type: "transfer"; action: "complete" }
  | { type: "transfer"; action: "cancel" }
  | { type: "lead-assist"; action: "request"; note?: string }
  | { type: "lead-assist"; action: "cancel" }
  | { type: "lead-assist"; action: "take-over" }
  | { type: "lead-assist"; action: "leave" }
  | { type: "conference"; action: "add"; dialId: DialId; destinationId: string }
  | { type: "conference"; action: "remove"; destinationId: string; party?: never }
  | { type: "conference"; action: "remove"; party: true; destinationId?: never }
  | { type: "recording"; action: "start" | "pause" | "resume" | "stop" }
  | ({ type: "complete" } & DispositionPayload);

type ChatTaskCommand =
  | { type: "accept" }
  | { type: "decline" }
  | { type: "pause" }
  | { type: "resume" }
  | ({ type: "complete" } & DispositionPayload);

type EmailTaskCommand =
  | { type: "accept" }
  | { type: "decline" }
  | ({ type: "complete" } & DispositionPayload);

type CustomTaskCommand = { type: "custom"; name: string; [key: string]: unknown };

type TaskCommand<C extends Channel = Channel> =
  | (C extends "voice" ? VoiceTaskCommand : C extends "chat" ? ChatTaskCommand : EmailTaskCommand)
  | CustomTaskCommand;

type TaskCommandRequest<C extends Channel = Channel> = {
  taskId: TaskId;
  allocationId: AllocationId;
  command: TaskCommand<C>;
};

type TaskCommandResult =
  | { status: "applied" }
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };
```

### Who decides what an agent may do

An agent desk has two managers, not one. **The queue** — a process, a work type — is owned by a
process manager and **allows** a set of capabilities: hold, connect back, new call, conference,
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
anything and the provider's own configuration supplied the value". A host renders "who decided" from the
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
pass. A host never has the value and never asks. A name is not locked. What the queue provides rather than permits — browsers, dispositions, custom
controls — is content, and is never locked.

**A lead sets the team's policy from their roster.** A login that declares
`capabilities.team.policyControl` may `executeTeamPolicy({ type: "set", capability, setting })`
with `on`, `off`, or `person`, for any task control, `dial`, or a skill — and only `hold`
and skills may be `person`; connect back and new call are the team's, on or off, within what the queue
allows. The roster carries `policies` for such a login: every policy as it stands, who set it, and
`lockedBy` where a level above the team made it theirs to keep, which the lead sees and cannot
change — `executeTeamPolicy` on it answers `failed` with `omni.capability-not-enabled`.

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
at all, and a host renders it in its settings, never as the button on a call. Mute is in none of
these ladders: the microphone is the host's, and nobody on the provider's side allows, locks or
keeps a choice about it. See **The station is the host's**.

## Breaks

```ts
type BreakApproval =
  | "not-requested"
  | "awaiting-decision"
  | "granted"
  | "starting-after-task"
  | "in-effect";

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

type ImposedBreak =
  | { by: UserId; endsAutomatically: true; endsAt: IsoTimestamp }
  | { by: UserId; endsAutomatically: false; endsAt?: never };

type BreakState = {
  approval: BreakApproval;
  mayAsk: boolean;
  refusedReason?: string;
  decisionReason?: string;
  retryAfterMs?: number;
  reasons?: BreakReason[];
  activeReasonId?: string;
  imposed?: ImposedBreak;
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
```

### Team

```ts
type TeamMemberAvailability = "ready" | "on-task" | "on-break" | "reserved" | "signed-out";

type TeamMember = {
  id: UserId;
  availability: TeamMemberAvailability;
  since?: IsoTimestamp;
  break?: Extract<BreakApproval, "awaiting-decision" | "granted" | "starting-after-task">;
};

type LeadRequest = {
  id: string;
  memberId: UserId;
  taskId: TaskId;
  allocationId: AllocationId;
  note?: string;
  since: IsoTimestamp;
};

type TeamRoster = {
  members: TeamMember[];
  requests?: LeadRequest[];
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

type TeamPolicyCommand = { type: "set"; capability: PolicyKey; setting: TeamPolicySetting };

type TeamPolicyCommandRequest = {
  command: TeamPolicyCommand;
};

type TeamLeadAssistCommand =
  | { type: "join"; requestId: string }
  | { type: "decline"; requestId: string; reason?: string };

type TeamBreakCommand =
  | { type: "decide"; memberId: UserId; decision: "granted" | "denied"; reason?: string }
  | { type: "policy"; policy: "ask" | "auto-approve" | "suspended" }
  | { type: "place"; memberId: UserId; reasonId?: string; reason?: string }
  | { type: "release"; memberId: UserId };

type TeamBreakCommandRequest = {
  command: TeamBreakCommand;
};

type TeamLeadAssistCommandRequest = {
  command: TeamLeadAssistCommand;
};

type TeamMonitorCommand =
  | { type: "monitor"; memberId: UserId }
  | { type: "whisper" }
  | { type: "barge" }
  | { type: "leave" };

type TeamMonitorCommandRequest = {
  command: TeamMonitorCommand;
};

type TeamCommandResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };
```

### Media

```ts
type VoiceMediaSession = {
  remoteAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): void;
};

type OpenMediaResult =
  | { status: "opened"; session: VoiceMediaSession }
  | { status: "unavailable"; failure: ProtocolFailure };

type OpenMediaRequest = {
  taskId: TaskId;
  allocationId: AllocationId;
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

type TransportRecovery = "reconnect" | "reauthenticate";

type ProviderEvent =
  | { type: "snapshot"; reason: "reconnected" | "provider-requested"; snapshot: Snapshot }
  | { type: "transport-status"; status: "connecting" | "active"; message?: string }
  | { type: "transport-status"; status: "error"; recovery: TransportRecovery; message?: string }
  | { type: "break-state"; break: BreakState }
  | {
      type: "task-offered";
      task: Task;
      allocationExpiresAt?: IsoTimestamp;
    }
  | { type: "task-updated"; task: Task }
  | { type: "task-media-started"; taskId: TaskId; allocationId: AllocationId }
  | { type: "task-media-ended"; taskId: TaskId; allocationId: AllocationId }
  | { type: "task-ended"; taskId: TaskId; allocationId: AllocationId; outcome: TaskOutcome }
  | { type: "dial-outcome"; dialId: DialId; outcome: DialOutcome; taskId?: TaskId; allocationId?: AllocationId; destinationId?: string; reason?: string }
  | { type: "announcement"; text: string; html?: string; announcedAt: IsoTimestamp; expiresAt?: IsoTimestamp }
  | { type: "queue-summary"; summary: QueueSummary }
  | { type: "diagnostic"; expected: string; observed: string; taskId?: TaskId; allocationId?: AllocationId }
  | { type: "team-updated"; team: TeamRoster }
  | { type: "contacts-updated"; contacts: Contact[] }
  | { type: "calendar-updated"; scheduledActivities: ScheduledActivity[] };

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

type Connection<C extends Channel = Channel> = {
  snapshot(): Snapshot<C> | Promise<Snapshot<C>>;
  subscribe(listener: (envelope: ProviderEventEnvelope<C>) => void): Unsubscribe;
  refused(report: Refusal): void;
  setCapacity(capacity: AgentCapacity): Promise<CapacityResult>;
  execute(request: TaskCommandRequest<C>): Promise<TaskCommandResult>;
  disconnect(): Promise<void>;

  describeUsers?(ids: UserId[]): Promise<User[]>;
  dial?(request: DialRequest): Promise<DialResult>;

  requestBreak?(request: BreakRequest): Promise<BreakRequestResult>;
  commitBreak?(): Promise<BreakCommitResult>;
  cancelBreak?(): Promise<BreakCancelResult>;
  endBreak?(): Promise<BreakEndResult>;

  executeTeamBreak?(request: TeamBreakCommandRequest): Promise<TeamCommandResult>;
  executeTeamLeadAssist?(request: TeamLeadAssistCommandRequest): Promise<TeamCommandResult>;
  executeTeamMonitor?(request: TeamMonitorCommandRequest): Promise<TeamCommandResult>;
  openMedia?(request: OpenMediaRequest): Promise<OpenMediaResult>;
  setPreference?(request: SetPreferenceRequest): Promise<PreferenceResult>;
  recordStep?(report: HandlingReport): Promise<HandlingReportResult>;
  executeTeamPolicy?(request: TeamPolicyCommandRequest): Promise<TeamCommandResult>;
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

const HANDLING_STEPS_WITH_A_PERSON = [
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
  "omni.task-not-found",
  "omni.destination-not-permitted",
  "omni.phone-not-permitted",
  "omni.rate-limited",
  "omni.unavailable",
  "omni.break-already-committed",
] as const;
type OmniFailureCode = (typeof OMNI_FAILURE_CODES)[number];
```

`HANDLING_STEPS_WITH_A_PERSON` is every `HandlingStep` except `queued`, which is the one nobody
takes part in. `handlingStepExpectsAPerson()` tests membership.

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

`referenceLabel` labels `Task.reference`; it does not label the protocol `id`. Omni shows a
reference only when both values are present.

**So supply it whenever the task type has references.** Because an entry replaces the channel
default outright, naming a task type and omitting `referenceLabel` removes the reference from the
agent's view — the case or call number simply stops appearing, with nothing to indicate it was
dropped. An adapter that wanted only a better noun loses a field it never meant to touch.

## Protocol contract rules

Nine rules govern protocol data and behavior.

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

Send whichever is true. A host renders them differently and cannot recover the distinction once
it is lost.

The same distinction applies to nested fields. Omit a nested field only when its value is unknown;
use an explicit empty value when the provider knows it contains nothing.

### 4. Presence is the permission

A capability authorizes a control the provider **chooses** to offer. Omni may offer or issue one
only where the corresponding capability is declared; an absent capability means unavailable, and
there is no separate permission flag.

The commands every task has are authorized by other fields the provider declared — a task that was
offered can be accepted, one in `preview` can be called, one whose `completionMode` is
`agent-command` can be completed. Nothing is issuable that the provider did not publish; only
which field says so varies. See **Which commands need a capability**.

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

A command therefore carries no key. The provider names its own records — a task, a lead request, a
member — and Omni refers to them by those names; **Omni never asks a provider to remember a name
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

Allocate only within the concurrent capacity Omni has stated for this agent.

An allocation beyond that capacity, or with none currently stated, is invalid and Omni rejects it
as a protocol violation. Work the agent was already handling when the connection came back is
reported in the snapshot; it is not an allocation.

### 8. State is authoritative at the provider

Each provider is authoritative for the state it owns. Omni composes that state with Omni-owned
policy and user actions. When provider-owned state diverges, Omni obtains a fresh snapshot and
replaces its local provider view; it does not overwrite the provider.

### 9. Define a vocabulary; do not merely list it

Every member of a closed set — break kinds, handling steps, destination kinds — must have a
normative definition; matching names alone do not establish shared meaning.

### 10. Order on the wire is display order

A list the provider publishes — a destination directory, disposition codes, a task's custom
controls, its browsers — is in the order the provider wants it shown, and a host keeps that order.
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
the login's store where the platform cannot hold it. Per offer, the `allocationId` comes from what
the offer itself states; per call, the media follows `task-media-started` and `task-media-ended`,
never a flag set when the audio was opened; per session, the phone the agent holds is what the
platform restates on activation, not a mapping read once over HTTP. What the platform cannot hold
-- a host's muted leg -- goes in `ConnectContext.store`, keyed by the task and gone with it.

A fact read once over a connection and kept in the adapter object dies with the client. A host
reload is the first client dying and a second coming up for the same login, and the second
publishes the same truth about the same task as the first did, or the first was publishing
something it made up: an allocation minted for the connection, media remembered as a boolean, a
phone the second never read. Three pieces of exactly that state were found in one adapter in an
afternoon, and none of it was visible until the adapter was built twice. The drive's `rebuild` is the test of this
principle: given a way to build the adapter again, the run hands the login over and holds the
second to what the first published (`drive.reload.allocation`, `.history`, `.openMedia`, and the
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
    disposalSettleMs: 5000,
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
| `phones` | Voice only, and required there: the phones this platform can put an agent on, `softphone` (the call's audio lands in the host) and/or `deskPhone` (a handset the platform rings; the host shows the call and opens nothing). The host picks one per login. See **How the agent hears the call**. |
| `dialOutcomes` | Voice only. How a dial can end on this platform, as it distinguishes them: `answered` and at least one way of not reaching the destination. Required of a provider that dials at all — an idle dialpad, or tasks that transfer, conference or call back — and a `dial-outcome` carries only a declared member. See **Every dial has an outcome**. |
| `runningStepReports` | The provider takes running reports of a host-performed step — `recordStep` with `seconds` so far and no `ended`. Omitted, the host sends exactly two reports per leg, when it began and when it ended, and a running one is refused. See **The host records what it performs**. |
| `disposalSettleMs` | Required. How long after an applied disposal -- `complete`, or a lead's `take-over` -- the provider's `task-ended` is owed, a positive whole number of milliseconds (`manifest.disposalSettleMs`). A warm transfer's `complete` is not a disposal: the agent's wrap runs after it. Stated per provider, since platforms settle at different speeds. See **`task-ended`**. |

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
read-only in protocol v1: Omni can display activities but cannot create, reschedule, cancel, or
complete them.

```ts
idleCapabilities: { calendar: true }
```

Omit `calendar` to make no calendar contribution. Omni combines calendar
contributions from active providers into one agent-facing calendar while retaining the source
provider identity for each activity.

When declared, the provider publishes its authoritative list through
`Snapshot.scheduledActivities` and replaces it with a `calendar-updated` event when it
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

Nothing is lost by that here, because there is nothing for a category to drive. A read-only
calendar has no action to vary by kind, and what an activity *is* already shows in what it carries:
a callback has a `contact`, a training does not.

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
| `timeZone` | The zone the agent's day is reckoned in, as an IANA name from the host's clock, stated before any identity exists so the first `authenticated` state already carries it. The same value Omni later passes as `ConnectContext.timeZone`. See **The agent's day**. |
| `phone` | How this login hears its calls, chosen by the host from the manifest's `phones`: required for a voice provider, absent for any other. The same value Omni later passes as `ConnectContext.phone`. See **How the agent hears the call**. |
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
the agent may ask for a break, and whether they lead a team — and if so, whether they decide its
breaks and whether they may join a member's call. It is declared by presence, like every capability
in this contract, and it travels with the identity because it is part of who the agent is on this
provider: the provider knows the roles, and says so at sign-in rather than leaving Omni to infer
them from what arrives later.

| Field | Contract |
| --- | --- |
| `breaks` | This login may request a break. Requires the four break methods on the connection. |
| `team` | This login leads a team. The provider publishes a `TeamRoster` to it on every snapshot — `[]` when nobody is in it — and to nobody else. |
| `team.breakControl` | This lead may act on their team's breaks through `executeTeamBreak` — place, release, decide, set policy — as far as the provider supports; a command it lacks answers `omni.capability-not-enabled`. Omni asks for a decision only against a member whose `break` is `awaiting-decision`, so a provider that grants on request is never asked to decide. Requires `executeTeamBreak`. |
| `team.leadAssistControl` | This lead may join a member's call on request. Requires `executeTeamLeadAssist`. |
| `team.monitorControl` | This lead may listen to a member's call unasked, in the listed modes and no others: `monitor`, `whisper`, `barge`. The list always includes `monitor`, since the other two begin from one. Requires `executeTeamMonitor`. See **Monitoring a call**. |
| `team.policyControl` | This lead sets the team's policy per capability — on, off, or the person's — within what the queue allows. Requires `executeTeamPolicy`; the roster carries `policies`. |
| `preferences` | What the team left to this person, with where each stands and who set it. Omitted when nothing was. Requires `setPreference`. See **Who decides what an agent may do**. |

A session action is available only when both the capability and Omni provisioning permit it.

**Capabilities are current, not fixed.** They describe the login as of its latest `authenticated`
state. A provider that reads roles live — a lead demoted mid-shift — republishes `authenticated`
with the new set through `subscribe()` on the authentication session, which Omni keeps open for
the life of the connection for exactly this reason, and the next snapshot agrees with it. Omni
provisions what the capabilities call for at sign-in — a team panel for a lead, empty until the
roster arrives, and nothing for anybody else — and withdraws it on the next render when the
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

For `browser-sso`, Omni allocates a one-time callback URL and passes it to `start()`:

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
provider names — a roster member, the manager on an imposed break, the agent on a handling step —
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
| `autoAcceptTasks` | Agent provisioning policy relayed to the provider at login, stated by the host on every connection and never assumed from its absence. When `true`, a pending task states its `acceptance`; when `false`, every task requires agent acceptance. Fixed for this connection, like everything else here: the provider states or omits `acceptance` by the value it was sent, and Omni validates by that same value, not by a policy that has since moved — a change reaches the provider through a fresh `connect()`. |
| `timeZone` | The same value passed as `AuthenticationContext.timeZone`. The provider stores it on the agent and carries it on the identity. See **The agent's day**. |
| `phone` | The same value passed as `AuthenticationContext.phone`: how this login hears its calls. The type ties `host.mute` to it: a `softphone` login's host states what its Mute does, and a desk-phone or conversation login's host cannot, so the omission is a compile error rather than a live seat's discovery. See **The station is the host's**. |
| `store` | The login's operational store, kept by the host for the life of the login, across a reload of the host, and cleared at sign-out: where an adapter that composes a record keeps what its platform cannot hold for it, such as the handling legs a host reported. Three functions, by key. Never for anything sensitive, which is `AuthenticationContext.secrets`, a store a host may clear aggressively. **A task's keys carry the task id and go with the task**: a key written about a task names the task's id in the key, and is deleted before the task's end is published, because a platform retires a task id minutes after closing it and a requeue takes seconds, so a key that outlives its task is inherited by the next offer of the same id -- a record with legs the host never reported against it. A login-scoped key carries no task id and outlives any task. The harness requires the store of every connection (`store.shape`, `store.get`, `.set`, `.delete`), watches the one it hands over, and names a task's key still held after `task-ended` (`drive.store.retained`) or written about the task after its end -- a persist hung off a timer that saw the task as it was (`drive.store.late`). The ordinary late write is the host's, not the adapter's: a host reports a leg without waiting for the answer, so an unmute can follow `complete` by a tick, and the adapter answers a report about a task that has ended `failed` with `omni.task-not-found` and writes nothing -- the host ends its own open legs at the task's end, so such a report is the host's error to see, and a host reads every `recordStep` answer and awaits the one for the leg it closes at a task's end, the only moment a refusal is expected, since a report nobody waits for is an error nobody can see; an adapter that names no task in its keys gets no cleanup check, which is a gap rather than a pass, never an exemption: the obligation is that nothing of a closed task survives its ending, and an adapter that keeps every open task in one login-scoped value owes exactly that inside the value, where the harness cannot look. One key per task, named for it, is the shape the harness can hold, and the shape to reach for. The store lists nothing, so an adapter that needs to find its tasks keeps a login-scoped index of ids beside them; at the task's end it deletes the body first and reindexes after, since a crash between the two then leaves an index naming a task with no body, which a reader skips, where the other order leaves a body for a task that has ended, which is the hazard itself. A reader of the index tolerates an id with no body as an ending that was underway, not as corruption. |
| `host` | The host's report of the agent's station — devices, permissions, network — to consult before declaring the agent ready to the platform, and on every change. See **The host reports, the adapter decides**. |
| `signal` | Optional cancellation signal. Stop startup promptly when aborted and do not begin new work. |
| `log` | Optional structured logging callback. Never include credentials, tokens, or sensitive contact data. |

### The agent's day

Every instant on this wire carries an explicit offset, so a moment is unambiguous everywhere and
a desk renders it in the viewer's clock without help. A **day** is different: hours toward
target, an answer streak, a per-queue count for today -- anything bucketed by day -- is bucketed
by somebody's day, and a platform that was never told whose uses its own. An agent in Chennai
then finds their day rolling at 05:30, and a night shift in Chicago lands in two buckets.

So the host says whose day it is, and it says so first. `AuthenticationContext.timeZone` is the
agent's zone as an IANA name -- `Asia/Kolkata`, `America/Chicago` -- never an offset, since an
offset cannot survive a daylight-saving boundary and a day boundary is exactly where that bites
(`context.timeZone`). It is stated before any identity exists, and `ConnectContext.timeZone` is the
same value again. The provider **stores it on the agent** and carries it as `identity.timeZone` on
every `authenticated` state and on every `User` it returns from `describeUsers()`, so a lead
reading a colleague's yesterday sees the colleague's yesterday and a summary is bucketed by the
right day after a session has ended. A roaming agent corrects it by signing in from where they are.

**The zone is never absent.** Time zone awareness is a first-party property of this wire, not a
field to fill in later: an identity without one is refused (`authentication.identity.timeZone`), and
so is a zone that is not an IANA name, wherever it appears. Nothing is ever assumed in its place --
not the viewer's browser, which gives a different answer per reader for the same record, and not the
provider's clock. The harness holds a provider to the round trip: the identity carries the zone the
host stated (`authentication.identity.timeZone.republished`), judged by what the name denotes:
`Asia/Kolkata` and `Asia/Calcutta` are one zone, and a provider that keeps the canonical name has
kept the zone. **The round trip is not the store.**
An adapter that echoes the stated zone back onto the identity passes that check with nothing kept,
and a lead reading a colleague's day would still get the wrong one. What proves the store is a zone
the run never sent: a colleague's `User` from `describeUsers()` carrying theirs. A provider's own
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
| `break` | Complete break state, including approval, whether the agent may ask, reasons, retry details, and any imposed break. |
| `tasks` | Complete set of tasks currently offered to or owned by this agent. |
| `taskCount` | The provider's own count of those tasks, stated rather than inferred, and it must equal `tasks.length`. A snapshot with no work says `taskCount: 0` in so many words — a blank or unanswered state lacks the count and cannot pass as a confirmed empty. |
| `contacts` | Required complete contact contribution when the manifest declares `contacts`; `[]` clears it. Omitted only when it does not. |
| `scheduledActivities` | Required complete calendar contribution when the manifest declares `calendar`; `[]` clears it. Omitted only when it does not. |
| `team` | Required `TeamRoster` when the login declares `capabilities.team`, `[]` when nobody is in it. Forbidden otherwise — the login is the permission. |

## Live connection

`Connection` is what `connect()` returns. Its methods are documented in the sections that follow
and under **Breaks**, **Team leads**, **Real-time media** and **Task commands**; this is the whole
surface in one place, and what obliges an adapter to implement each one.

| Method | Implement it when |
| --- | --- |
| `snapshot()` | Always. |
| `subscribe(listener)` | Always. |
| `disconnect()` | Always. |
| `refused(report)` | Always. The host tells the adapter what it would not take -- a snapshot it did not replace its state with, an event it dropped -- with every rule broken, so a refusal is visible on both sides. See **What the host does with what it refuses**. |
| `setCapacity(capacity)` | Always. Nothing may be allocated until a capacity is stated, so there is no connection that does not receive it. |
| `execute(request)` | Always. Every channel has commands no capability gates — see **Which commands need a capability**. |
| `describeUsers(ids)` | The adapter publishes any `UserId`: on `ImposedBreak.by`, a roster, or `handlingHistory[].by`. Each `User` carries its `timeZone`; a person whose zone the provider cannot name is omitted from the answer, as any unresolvable id is. |
| `dial(request)` | The manifest declares `idleCapabilities.dial`, and with it `dialOutcomes`. |
| `requestBreak(request)` | The login declares `capabilities.breaks`. |
| `commitBreak()` | The login declares `capabilities.breaks`. Commit and cancel are not optional halves of it. |
| `cancelBreak()` | The login declares `capabilities.breaks`. |
| `endBreak()` | The login declares `capabilities.breaks`. |
| `executeTeamBreak(command)` | The login declares `capabilities.team.breakControl`. |
| `executeTeamLeadAssist(command)` | The login declares `capabilities.team.leadAssistControl`. |
| `executeTeamMonitor(command)` | The login declares `capabilities.team.monitorControl`. |
| `setPreference(request)` | The login declares `capabilities.preferences`: the person's choice has to have somewhere to go. |
| `recordStep(report)` | The manifest lists `softphone` among its `phones`. On a softphone the host mutes its own microphone on any call, and the provider's record has to have somewhere to take that leg; a desk phone's microphone is the phone's. See **The host records what it performs**. |
| `executeTeamPolicy(command)` | The login declares `capabilities.team.policyControl`. |
| `openMedia(request)` | The manifest lists `softphone` among its `phones`. On a softphone the call's audio lands in Omni, so the adapter has to open it; a platform of desk phones alone never does. |

**The four break methods stand or fall together.** Declaring `capabilities.breaks` at login and then
implementing `requestBreak` without `commitBreak` leaves an agent granted a break that can never
start, and the two-phase coordination in **Coordinating a multi-provider break** has no way to
report that: `granted` is a promise to honour a later commit.

### `Connection.snapshot()`

Returns the provider's complete authoritative state at one point in time.

- Omni registers `subscribe()` before awaiting the initial snapshot. An event delivered while the
  snapshot is read is held until it lands, and what happens to it then depends on what it is. A
  snapshot restates state, so an event of a state-replacing kind -- `task-offered`, `task-updated`,
  `task-ended`, `task-media-started`, `task-media-ended`, `break-state`, `team-updated`,
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

### `Connection.describeUsers(ids)`

Turns `UserId` values into something an agent can read.

```ts
describeUsers(ids: UserId[]): Promise<User[]>
```

Required of any adapter that publishes a `UserId` — on `ImposedBreak.by`, a team roster, or
`handlingHistory[].by`. Publishing an identifier Omni cannot resolve puts a name on screen
that reads as a database key.

- **Omit an id you cannot resolve; do not invent a name for it.** A missing entry says *I do not
  know this person*, which Omni renders as such. Ordering is not significant and the response may
  be shorter than the request.
- **Take the whole list in one call.** Omni resolves a roster or a handling history as a batch, and
  a per-id round trip multiplies that by its length.
- **Omni caches a result for one hour, then resolves it again.** The identifier is stable across
  logins but the name behind it is not, so the cache expires on a clock rather than living for the
  session. One hour is a starting figure and may be tuned; an adapter must not depend on any
  particular value, or on Omni asking again at any particular moment.

This is the only place a name comes from. Task data carries identifiers alone —
`handlingHistory[].by` is an id and nothing more — so a name is never copied into a task, never
duplicated across tasks, and never stale.

### `Connection.disconnect()`

Stops the connection and releases adapter-owned resources.

- Must be safe after partial startup and safe to call once during normal shutdown.
- Must stop automatic reconnect.
- Must remove event handlers and release media resources owned by the adapter.
- Does not imply that active tasks were completed or removed.

## Task allocation lifecycle

The task-allocation lifecycle has five ordered stages:

**1. The agent signs in.** Nothing on the wire says ready or not-ready: the agent is not ready
until the host has stated a capacity, and ready once it has. A provider allocates nothing before a
capacity is stated, and needs no other word for it.

**2. The agent becomes ready.** The host states the capacity when its provisioning says: at once,
or when the agent presses Ready. A successful connection, a healthy provider, or the absence of a
break does not imply readiness. After that, the only way an agent stops taking work is a break,
under `capabilities.breaks`; a login that declares no breaks cannot go not-ready once its capacity
is stated, and `count: 0` is the host's division of capacity, not the agent's choice.

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
reconnect snapshot says it too and an offer the host never received is not accepted on the
person's behalf for want of a word:

| Directive | Contract |
| --- | --- |
| `no-preference` | The provider leaves acceptance to Omni; with `autoAcceptTasks: true`, Omni accepts automatically. |
| `consent` | The provider requires the person's explicit consent: Omni presents **Accept** and waits, whatever its own policy would have done. A host that declares `guarantees.personConsent` promises exactly this; a provider checks it before offering work only a person may take. |
| `automatic` | Omni accepts immediately without agent interaction. |

When Omni sent `autoAcceptTasks: false`, the provider omits `acceptance` and every task the
queue routes requires agent acceptance. The two are never confused on the wire: `consent` is always the
provider's requirement, stated on a wire where Omni was willing to accept for the agent; Omni's own
no-auto-accept policy puts no word on the wire at all — the field is absent, and the **Accept**
press is Omni's doing, not the provider's.

**The value is stated, never assumed.** `autoAcceptTasks` is required of every connection: a
host says which policy the deployment provisioned, and a validator that is not told checks
neither rule rather than guess the permissive one (`task.acceptance.required` and
`.unexpected` fire only against a stated value). `acceptance` is the provider's own control and
outranks the policy: `consent` puts the decision back in the agent's hands for any task where it
belongs, whatever the host was configured with.

An automatically accepted task still arrives through `task-offered`.

**Work the agent originated is accepted by the command that created it.** A task born of the
agent's own act — a dialpad call or a connect-back, recognisable by the host's `dialId` on
`onCall`; a lead's join, carrying `assisting`; a lead's monitor, carrying `monitoring` — arrives
through `task-offered` with `acceptance: "automatic"` whatever `autoAcceptTasks` says, and the
validator holds it there under either provisioning and under none (`task.acceptance.originated`):
the desk shows no **Accept** for a call the agent placed. The provisioning governs work the queue
routes to the agent, and nothing else.

### Pending

A task in the `pending` phase has been **offered to the agent and not yet accepted**. Omni applies
`autoAcceptTasks` and the task's `acceptance` to decide whether acceptance is
automatic or requires the agent. A provider that requires automatic acceptance still emits
`task-offered`; it does not introduce new work as `in-progress`.

```ts
declare const task: Task;

const allocation = {
  type: "task-offered",
  task: { ...task, phase: "pending", acceptance: "consent" },
  allocationExpiresAt: "2026-08-25T10:41:07.000Z",
} satisfies Extract<ProviderEvent, { type: "task-offered" }>;
```

The rule the phase exists to express: **nothing is acquired on the agent's behalf while a task
is pending.** A host that carries media must not open the microphone until the task is
accepted. Omni does not open the task's browsers either — a task that rings out costs nothing.

When consent is required, Omni offers the agent an **Accept** control. The call is the
medium the task arrives on, not a separate decision.

**Once a task is accepted, the call that comes with it is answered.** Omni has no discretion
there and the provider is not consulted twice: one decision about the work, and the medium
follows it. Where the audio lands was settled at sign-in — in Omni on a softphone, on the handset
on a desk phone — and is not in question per call. See **How the agent hears the call**.

Automatic acceptance still begins with `task-offered`.

`allocationExpiresAt` is the deadline after which the offer lapses. Where present, Omni counts
down and stops offering **Accept** once it passes; the provider ends the lapsed offer with
`task-ended` and an `expired` outcome naming `pending`, since nobody cancelled it. **Omit it unless the provider can observe it.**
A provider that reports only elapsed ring time after the fact cannot say when an offer is due
to end, and a computed value would have Omni withdraw **Accept** from a task still pending.

A preview's deadline is not on the offer. It travels on the task, as `previewEndsAt` with
`atDeadline`, so a snapshot carries it too -- see **Preview: the agent presses Call**.

A provider may withdraw a pending task by emitting `task-ended` with a `cancelled` outcome, `by:
"provider"`. **`cancelled` says who called the work off**, as `completed` says who completed it:
`agent` for a decline, `provider` for a withdrawal or a re-route, `party` for a caller who abandoned
the ring. One word for the three left a supervisor's record unable to tell them apart, so `by` is
required and closed (`event.taskEnded.outcome.cancelled.by`). An offer nobody acted on before
`allocationExpiresAt` is not cancelled by anyone: it lapses, and ends `expired` naming `pending`.

### Tasks already in progress

The provider does not introduce new work as already `in-progress`.

A task appears already `in-progress` only in a snapshot taken after a reconnect or a resync,
reporting work that began earlier in this login and never stopped. A fresh login has none to
report: nothing has been allocated yet, and work the agent was handling elsewhere is not carried
into a new session.

## Tasks

### `Task`

`Task` is the provider-owned description of one task presented to Omni.

`task-offered` introduces a new task and does not imply acceptance.

`Task<C>` is channel-discriminated. For example, `Task<"email">` accepts
`browsers` and `dispositions`, but rejects voice-only controls such as `hold` and `endCall` at compile
time. Runtime conformance checks also require the task channel to match its provider manifest.

| Field | Contract |
| --- | --- |
| `id` | Required `TaskId`, the platform's own identity for the task. Unique among the tasks open at once; a platform retires an id minutes after closing it, so the same id comes back for another customer. Omni scopes it with the provider ID. |
| `allocationId` | Required `AllocationId`: this life of the task, minted once per offer and never reused for the life of the login, whatever the id does. Every event, command and report that names a task names its allocation too, so a late dial outcome or a late handling report for the first customer never lands on the next under the same id. The stream refuses an offer reusing one (`stream.taskOffered.allocation`), an update restating another life of the id (`stream.taskUpdated.allocation`), and a media or ending event naming a life that has ended or that nobody has seen (`stream.allocation.ended`, `.unknown`); a `dial-outcome` may name an ended life, since a dial placed late routinely outlives its call, and the host routes it there. See **A task's life on the wire**. |
| `title` | Agent-facing task title. |
| `channel` | Channel handling this task. It must equal the source provider's manifest channel. |
| `taskType` | Required provider-defined source or category of work, such as a voice `Queue Name`, `Mailbox Folder`, `Chat Source`, `Support`, `Billing`, or `Returns`. |
| `capabilities` | Controls and workspace features available for this specific task. |
| `capabilitySource` | Required. Who chose the capabilities: `queue` when somebody configured these terms, `ungoverned` when nothing handed the work over -- an agent's own outbound -- and `undetermined` when a queue was named and its terms could not be read, in which case `capabilities` is what the provider will honour, not what the platform permits. A host shows `undetermined` where the agent works. See **Task capabilities**. |
| `browsers` | Named browser definitions for the task workspace: at least one when the task declares the `browsers` capability, empty when it does not. |
| `party` | The person or entity on the other end of this task, as a `Contact`: often a name and one address; a withheld caller ID may leave nothing to send at all. Optional. The party is who the task is *with*; `contacts` is the directory. |
| `phase` | Current canonical task phase: `pending`, `confirmed`, `preview`, `in-progress`, `paused`, or `completing`. `preview` is voice only. |
| `media` | Voice only. The task's real-time audio as the provider holds it: `started` while audio is attached, `ended` once it ended, omitted while none is. The provider's word — see **`task-media-started`**. Media names a task whose work has begun, or whose party the host is dialling: on a `pending`, `confirmed` or `preview` task with nobody ringing it is refused (`task.media.beforeWork`), on a snapshot as on the event, since a host opens the microphone on it; with the party ringing by a host dial, ring-back is audio and media starts on `dialling`. |
| `acceptance` | How this offer is accepted — `no-preference`, `consent`, or `automatic` — stated on the pending task so a reconnect snapshot says it too. Required while `pending` when `autoAcceptTasks` was `true`, forbidden when it was `false`, and absent past `pending`. See **Acceptance modes**. |
| `previewEndsAt` | Voice only, in `preview`: when the system stops waiting for the agent to press Call. Absent, the agent has as long as they need. Always with `atDeadline`. See **Preview: the agent presses Call**. |
| `atDeadline` | Voice only, in `preview`, with `previewEndsAt`: what the system does at the deadline -- `calls` places the call itself, `expires` takes the record back and the task ends `expired`. |
| `reference` | Optional agent-facing reference such as a case, call, conversation, ticket, or message number. It is distinct from the protocol `id`. |
| `completionMode` | `agent-command` waits for the channel's `complete` command; `provider-automatic` completes without one. |
| `wrapAllowance` | Fixed time allowed to complete the task after primary handling ends. For real-time media, it begins after `task-media-ended`. Required under `provider-automatic`, where the provider acts on it. Optional under `agent-command`: omitted says the provider imposes no deadline, and Omni counts nothing down. |
| `attributes` | Optional ordered, typed `TaskAttribute` entries with keys unique within the task. Each contact or timestamp is a separate array item; new attribute shapes require new union members. |
| `handlingHistory` | The call record: `steps` — the ordered handling history of this open task, one entry per occurrence, oldest first — and what they add up to before this agent, `handleSeconds`, `holdSeconds`, `queueSeconds`, `transfers`, each present when the provider knows it. Live task data restated with the task, not a permanent archive. See **How a task has been handled**. |
| `onCall` | Voice only. Who is on the call, or being brought onto it, as the provider states it, replaced whole with the task: `party` is the customer -- carrying a `stage` while being dialled again on the same task, a connect-back with the host's `dialId` or a platform's callback without, ringing from the moment the dial is placed and joined on its answered outcome --, `agent` a person by user id, `consulted` and `conferenced` somebody a dial is bringing in, listed from the moment the dial is placed -- with the `destinationId` dialled, the `dialId` where a host placed it, the `stage` reached (`ringing` until answered, `joined` after), and `held: true` on anyone joined and parked. A `consulted` entry is what makes `transfer` `complete` and `cancel` issuable. `label` names a destination -- a person, a queue -- not a phrase; the host supplies the verb. Present when the provider knows the room, absent when it does not. See **Every dial has an outcome**. |
| `leadAssist` | Voice only. Present from the agent's request for a lead until the lead leaves or the request ends: `requested` while nobody has joined, `joined` with the lead's `leadId` once somebody has. See **Lead assist**. |
| `assisting` | Voice only, on the lead's own task for a call they joined: which member asked, with their note. Its presence is what makes `lead-assist` `take-over` and `leave` issuable. See **Lead assist**. |
| `monitoring` | Voice only, on the lead's own task while they listen to a member's call: whose call, which call, and the `mode` they are heard in, restated on every change. Never on the member's task, and never together with `assisting`. See **Monitoring a call**. |

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
| No task | Provider allocates a task | `pending` |
| `pending` | Task is accepted | `confirmed` |
| `confirmed` | The customer's record is put in front of the agent before any call goes out (voice) | `preview` |
| `confirmed` | Work begins | `in-progress` |
| `preview` | Agent presses Call (`call`) and the customer answers, or the deadline `calls` and they answer | `in-progress` |
| `preview` | The call goes out and nobody answers | `completing` |
| `preview` | The deadline `expires` | Removed by `task-ended` with `expired` outcome |
| `pending` | Provider withdraws the allocation, the agent declines, or the party abandons the ring | Removed by `task-ended` with `cancelled` outcome, `by` saying which |
| `pending` | The offer lapses at `allocationExpiresAt` | Removed by `task-ended` with `expired` outcome naming `pending` |
| No task | Snapshot reports work already underway | `in-progress` |
| `in-progress` | Provider or agent pauses the task | `paused` |
| `in-progress` | Agent starts a warm transfer (`transfer` `warm`); the customer is parked | `paused` |
| `paused` | Provider or agent resumes the task | `in-progress` |
| `paused` | Agent cancels a warm transfer (`transfer` `cancel`) | `in-progress` |
| `in-progress` or `paused` | Contact handling ends and follow-up work remains | `completing` |
| `completing` | Agent connects back to the party (`connect-back`) | `in-progress` |
| Any phase | Provider emits `task-ended` | Removed |

#### A task's life on the wire

A task id is the platform's, and platforms reuse them: a closed id is retired minutes later, a
requeue takes seconds, and on one platform a call was offered twice, thirteen seconds apart, under
one id, through a close and a re-offer. Everything that names a task after the fact -- a dial
outcome, a media event, an ending, a handling report, a command -- would land on whichever life of
the id is open when it arrives. So every offer mints an `allocationId`, unique for the life of the
login, and every one of those names it beside the `taskId`. The host keys its state on the pair, a
late event finds the life it belongs to or is refused, and a task-scoped browser session
(`PROVIDER_NAME__TASK_ID__TAB_NAME`) lives one allocation, never the next customer's cookies under
a reused id. A dial the host placed was already safe, since its outcome is placed by the host's own
`dialId`; where the allocation earns its place is everything the host does not mint --
`task-media-started`, `task-media-ended`, `task-ended`, a `recordStep` naming a task -- any of which
would otherwise find the new task under the old id and act on it. The allocation is part of the task
the adapter keeps, not a field held in memory beside it: a rebuilt adapter comes back with the same
allocation on the same task, or every late event it was minted to catch mismatches
(`drive.reload.allocation`).

Allocation, acceptance, and progress are distinct. Acceptance follows `autoAcceptTasks` and the
task's `acceptance`, moving the task from `pending` to `confirmed`. The provider reports
subsequent transitions to `preview` or `in-progress`; Omni does not infer them from the acceptance
command.

#### Preview: the agent presses Call

An outbound campaign that lets the agent see who they are about to call is a **preview**: the
record arrives as a task, the task sits in `preview` with the party on it, and no call has gone
out. The agent reads and presses Call. That is the whole phase, and it exists on voice alone --
chat and email have no call to place, and their reading is ordinary work in `in-progress`.

```ts
const previewed = {
  channel: "voice",
  capabilities: {},
  phase: "preview",
  party: { name: "Maya Rao", number: "+919876543210" },
  previewEndsAt: "2026-08-25T10:40:37.000Z",
  atDeadline: "calls",
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "party" | "previewEndsAt" | "atDeadline">;

// The agent presses Call. It is a dial like any other.
const pressed: TaskCommand<"voice"> = { type: "call", dialId: "dial-7f2" };
```

**Call is a dial.** It carries the host's `dialId`, is answered `dialling`, and ends in exactly one
`dial-outcome`; the phase is its gate and there is no capability, since a record put in front of an
agent is there to be called. Its media starts on `dialling`, as every host-placed dial's does --
ring-back is audio the agent hears -- so `task-media-started` arrives on the `preview` task with
its party ringing. On `answered` the task is `in-progress`; on any other outcome the media ends,
`task-media-ended` starts the wrap clock as on every voice task, and the task goes to
`completing`, so the agent records the
no-answer as the disposition it is -- in a campaign that is the commonest outcome there is, and it
is work, not a cancellation. A `preview` task therefore needs a manifest that says how a dial ends
(`task.preview.dialOutcomes.required`).

**The deadline says what the system will do.** A provider that will not wait forever states
`previewEndsAt`, and with it `atDeadline`: `calls` means the system places the call itself when the
time runs out, which is progressive dialling; `expires` means the record is taken back and the task
ends with an `expired` outcome naming `preview`. The two travel together
(`task.preview.atDeadline.required`, `task.preview.previewEndsAt.required`), only while the task is in
`preview` (`task.preview.deadline.unexpected`), and Omni's countdown reads "calling in 12s" or
"expires in 12s" from the provider's word. With neither, the agent has as long as they need.
Reaching the instant is not itself a transition: the provider reports what it did, as an event.

**Drop both fields when the phase moves.** A provider that builds the `in-progress` task by
spreading the `preview` one carries `previewEndsAt` and `atDeadline` with it, and the host refuses
the update (`task.preview.deadline.unexpected`): the desk keeps the task as it last stood, and the
provider is told through `refused` exactly which rule, so the state that looked right on its side
is named on its side. The task past preview has no deadline to wait for, so it carries neither
field.

**A task is never its audio.** A voice task is the allocation: the call is offered when it is
routed to the agent and accepted as its `acceptance` dictates, and its presence and phase follow
the provider's reports about the work — never the audio. Wherever audio moves — an offer, a hold, a
consult, a conference leg joining or leaving, a transfer, a connect-back — the media follows
separately, arriving on `task-media-started`, attaching through `openMedia` and ending with
`task-media-ended`. Omni does not ring,
bridge, or hold a line. How the phone rings, whether it rings at all, and where legs join and leave
are the adapter's and the platform's, transient, and decide neither when a task exists nor what
phase it is in.

The line runs between the provider's word and Omni's own senses. `task-media-ended` is the
provider's report that primary handling ended — a fact about the work, which is why the completion
allowance starts on it and the Connect back control appears on it — and Omni follows that report as it
follows any other. What Omni never does is derive a task's state from its own media session: a
stream that drops, a track that ends, a transport that disconnects, a microphone that fails, an
endpoint re-registering change nothing about the task until the provider says so. Structurally:
`task-media-started` and `task-media-ended` alternate on a task whose work has begun, media ends
only where it arrived, what follows the media ending is `completing` or `task-ended`, and every
task is introduced once — `exerciseAdapter` holds the stream to that from the connect snapshot on,
and `assertMediaFollowsTheTask` holds any sequence.

#### Completion timing

`completionMode` determines how completion is triggered. With `agent-command`, the provider keeps
the task open until Omni sends the channel's `complete` command. With `provider-automatic`, the
provider may complete the task without receiving that command.

`wrapAllowance` is independent of that decision. It is fixed, and when it starts depends on
whether the channel carries real-time media:

| Channel | Wrap allowance starts at |
| --- | --- |
| Voice and any channel with real-time media | The `task-media-ended` event |
| Chat | The `task-updated` that moves the task to `completing`: the provider's word that the conversation is closed on its side, the allowance running from that publication's `occurredAt` |
| Email | The `task-updated` that moves the task to `completing`: the provider's word that the platform has accepted the outgoing message, the allowance running from that publication's `occurredAt` |
| Other non-media channels | The `task-updated` that moves the task to `completing` |

**Off voice, `completing` is the provider's word that handling ended.** There is no media event to
carry it, so the phase does; a host starts the wrap clock at that publication and nowhere else. It
is optional: a conversation with nothing to wrap moves from `in-progress` to `task-ended` and
`completing` is never published. Under `provider-automatic` with a non-zero `wrapAllowance` it is
required, because the clock has to start somewhere: a chat or email task the provider completes
from `in-progress` with an allowance to run gave the agent none of it, and the stream refuses the
ending (`stream.taskEnded.unwrapped`). Under `agent-command` the agent's `complete` is the end,
from `in-progress` or from `completing` alike.

```ts
const emailCompletion = {
  completionMode: "agent-command",
  wrapAllowance: 120,
} satisfies Pick<Task<"email">, "completionMode" | "wrapAllowance">;
```

In this example, the agent has two minutes after sending the email to add notes, select a
disposition, and complete the task.

`0` means completion may happen immediately. With `provider-automatic`, the provider may complete
without waiting for a command; with `agent-command`, it still waits for `complete`.

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

Here the customer has hung up, `task-media-ended` has been sent on time, the task is `completing`,
and the agent takes as long as the work needs. Moving the task to `completing` late to avoid a
deadline is not an alternative on a media channel: the clock starts at a real event, and delaying
that event would falsify the phase and everything timed from it.

#### Connecting back during completion

A task that declares `connectBack` lets the agent connect back to the party while the task is
`completing` -- to finish what the call left unfinished, on the same task rather than a new one,
whoever placed the call in the first place. Most such calls came in, so this is not a redial: the
agent rings a party who rang them. Omni issues `{ type: "connect-back", dialId }`; it is issuable
only in `completing`, and only where the capability is declared. The provider knows who the party
is; the command carries no destination, and it is a dial like any other, so it carries the host's
`dialId`, is answered `dialling`, and ends in one `dial-outcome`.

On `dialling` the provider is placing the call and the task returns to `in-progress`: the agent is
working again, and the wrap allowance is **discarded, not paused**. From there the call is
reported as any call is -- `paused`, `in-progress`, and when its media ends, `task-media-ended`
again, which starts a fresh allowance from that instant. A party who does not answer is a dial
whose outcome says so and a call whose media ended: the task returns to `completing` through the
same event and the clock starts again from there. At no point is an agent dialling against a
deadline.

**The room shows the party being dialled.** From the moment any host dial places the party -- a
dialpad call, a preview Call, a connect-back -- the `party` entry carries `stage: "ringing"` and
the host's `dialId`, exactly as a consulted or conferenced entry does from its dial; `joined` on
the publication that follows the answered `dial-outcome` and never before it
(`stream.taskUpdated.stage`); and no stage from the next publication on, so `joined` is transient
and a later copy still carrying it is stale (`stream.taskUpdated.stage.lingering`). A host shows a
call being placed, not a party it asserts is on a call that is still ringing. A callback the platform places itself on the same task -- the first
call over, the platform dialling the party again without a command -- shows the same thing with no
host `dialId`, as any platform-placed dial does. A party with no stage is on the call, and a dial
with no stage is half a claim (`task.onCall.party.dial`). The stage is also what lets the stream
tell a task coming back from one going backwards (`stream.taskUpdated.phase`).

**The control exists only while there is a window to use it in.** Under `agent-command` the task
stays `completing` until the agent completes it, so the window is open for as long as they need.
Under `provider-automatic` the window is the allowance -- and with `wrapAllowance: 0` there
is none: the provider disposes the task at provider end, and Omni does not offer Connect back,
whatever the task declares. A capability names a control that can be used; on a task with no `completing`
window it cannot, and declaring it there changes nothing.

```ts
const connectBackCapable = {
  channel: "voice",
  capabilities: { hold: true, connectBack: true, dispositions: true },
  phase: "completing",
  completionMode: "provider-automatic",
  wrapAllowance: 30,
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "completionMode" | "wrapAllowance">;
```

With ten seconds of the thirty left, the agent presses Connect back: `execute({ command: { type:
"connect-back", dialId } })` returns `dialling`, the task is `in-progress`, and the thirty seconds
are gone.
The second call ends: `task-media-ended`, the task is `completing`, and a new thirty seconds runs
from that instant.

```ts
const immediateProviderCompletion = {
  completionMode: "provider-automatic",
  wrapAllowance: 0,
} satisfies Pick<Task, "completionMode" | "wrapAllowance">;
```

### How a task has been handled

`Task.handlingHistory` is the call record: the steps that brought the task to the agent, oldest
first, and what they add up to before this agent:

```ts
handlingHistory: {
  steps: [
    { step: "queued",      at: "2026-08-21T00:59:00Z", seconds: 41 },
    { step: "answered",    at: "2026-08-21T00:59:41Z", seconds: 312, by: "a-17" },
    { step: "held",        at: "2026-08-21T01:02:10Z", seconds: 35, by: "a-17" },
    { step: "transferred", at: "2026-08-21T01:04:53Z", by: "a-17" },
    { step: "answered",    at: "2026-08-21T01:05:02Z", by: "a-23" },
  ],
  handleSeconds: 312,   // handled by others before this agent
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
`unanswered`, and each is defined on `TaskHandlingStep`.

**The record is one entry per occurrence, oldest first.** Each hold is its own `held` entry — `at`
when it began, `seconds` once it ended and omitted while it runs — and a second hold is a second
entry after the first, never a revision of it. A leg that has ended states its duration, and the
task says whether a leg can still be running: a hold runs only while the task is `paused`, a mute
only while its media is up, so a `held` entry without `seconds` on a task that is not paused, or a
`muted` one on a call that is over, is a leg nobody closed and reads exactly like a leg running now
(`task.handlingHistory.held.open`, `.muted.open`). Whoever performs the leg closes it — the
provider whose platform parks the caller, the host whose microphone it is — by restating the entry
with its duration, and **an entry that cannot be closed is not written**: open for ever is a
plausible nought one level down from a total. **A leg still open when the media ends is closed by
the provider**, at that instant, in the same publication that says the media ended: the provider
is the one that knows the instant, and the host can only learn of it afterwards. Agents end calls
muted, so the host's leg is routinely open at media end; the provider closes it with the duration
from the leg's `at` to the media's end, and the host's own closing report for that leg, which
follows what it hears, is answered `recorded` and changes nothing, the entry standing as the
provider closed it. One publisher of the closed leg, and no order between them to get right. There is no resumed step; a resume is the end of a
hold, at the entry's `at` plus its `seconds`, and nothing is lost by not naming it twice. The same goes for every step: two mutes are two
`muted` entries, and a call that joined two queues -- a menu's, then this one -- has two `queued`
entries, one per join. Order is enforced: an entry earlier than the one before it is refused
(`task.handlingHistory.order`). **Intervals between steps are the host's to subtract**, never a
total the provider adds: *time to offer*, from the call's arrival to the agent's screen lighting
up, is the `offered` entry's `at` minus the last `queued` entry's, and the ring is outside it.
`queueSeconds` keeps the industry's meaning -- the whole wait until somebody answered -- and is not
that interval. **The second is the record's grain.** A duration is a positive whole number of
seconds, and nought is refused because it claims no time; a leg that happened is stated at the
grain: rounded to the nearest second, and a leg that rounds to nought is stated as `1`, the error
being under the contract's resolution, where dropping the entry would say the leg never happened.

**A record once read is not unread.** Every restatement of a task's record -- on `task-updated`,
on a resync snapshot -- carries every entry the host has already read, by step and instant, and
may add to them; it never has fewer, and never drops the record while the task is open. A fact
stated to the host and then withdrawn without an event is a record contradicting itself, exactly
as a task that lost the terms it had read would be, and the stream refuses it the same way
(`stream.taskUpdated.handlingHistory`, `stream.snapshot.handlingHistory`). A provider whose
platform cannot hold a leg the host reported keeps it in the login's `store` for the life of the
task, so a reload of the host restates the same record; the entry is keyed by `step` and `at`, so
a running hold restated with its final `seconds` is the same entry.

**The record is ordered by the instants stated in it, whoever stamped them.** The host stamps the
legs it performs from the same clock it reports everything else with, and the provider writes a
host leg into the record with the host's `at`, in its place among the others by that instant, and
answers `recorded`: it never refuses a leg, or the task, for a timestamp it did not write. A host
whose clock runs ahead of the platform's puts its own mute before the platform's answer, and the
record shows what was stated; that is the host's clock to fix, not the provider's record to edit. **Handle time is anchored, not restarted.** It runs from the
`answered` step's `at` — from the task's first `in-progress` where the provider reports no
history — until the task's media ends, and a hold neither pauses nor resets it: the hold's own
duration is the `held` entry's `seconds`, and a desk that restarts its counter on resume is
counting the wrong thing.

`muted` is there because the mute is the host's and never the provider's — see **The station is
the host's** — so without a step the provider, which alone keeps the task's record, would have no
account of a period the agent could not be heard. Each `muted` entry carries `mutedBy`, as the host
reported it: `host` for the agent's own Mute, `station` for a headset or system mute the host
observed. No other step has it (`task.handlingHistory.mutedBy`, `.mutedBy.unexpected`).

**A step that dialled says which dial and where.** `transferred`, `conferenced` and `unanswered`
each end a dial, so the entry carries the `destinationId` it went to and, where a host placed it, the
`dialId` the host minted; no other step dialled, and either field on one is refused
(`task.handlingHistory.dialId.unexpected`). This is how a dial made before a transfer is placeable
by whoever holds the task now: a `dial-outcome` naming a `dialId` the host never minted is looked
up in the record, not discarded.

Four rules a provider has to keep:

- **Report `seconds`; never expect Omni to derive it.** Omni does not subtract one timestamp from
  the next. An entry can be written while its leg is still running, so the arithmetic has no second
  operand, and a provider holding the authoritative number should not have it recomputed from
  instants that may be rounded or clock-skewed.
- **Omit `seconds` while it is unknown. Never send `0`.** A leg still talking is not a zero-second
  conversation, and on live data that is the ordinary case rather than an edge. A zero is rejected.
- **`by` is a bare `UserId`, and not necessarily an agent.** A lead or a manager takes part
  in handling too — a transfer accepted, a call conferenced in — so the field names whoever it was,
  the same way `ImposedBreak.by` does. It comes from this provider's own directory, the same
  namespace as `AuthenticationState.identity.id` and the team roster, so entries pair
  within a provider and never across one.
- **A task carries no names.** Omni resolves what to display with `describeUsers()`. Two people
  called Arun on one site is ordinary, and anything pairing entries on a display name pairs them
  wrongly; carrying the name here would also copy it into every task and leave it to go stale.

**An absent `by` means different things on different steps, and both are legitimate.** On
`queued` nobody takes part, so there is nothing to name. On every other step somebody did — see
`HANDLING_STEPS_WITH_A_PERSON` and `handlingStepExpectsAPerson()` — so an absent `by` there says
*this was handled and the provider cannot say by whom*. The one step that is never unattributed is
`muted`: the host has exactly one agent and the provider knows who, so `by` is required there
(`task.handlingHistory.muted.by`).

That case is ordinary rather than theoretical: a leg answered on a shared phone, a manager's
handset, or a device the provider cannot resolve to a person. **Report the step without `by`
rather than dropping it.** A list missing a real handler looks complete and is wrong, which is
worse than one saying plainly it could not attribute a leg — and far better than publishing
nothing because a single leg could not be named.

A host must render the two differently. Showing an unattributed `answered` the same way as
`queued` tells the agent nobody was involved, which is not what was said. Omni renders it as
*"not recorded"* in the place the name would go.

Omit `handlingHistory` entirely when the provider cannot observe the steps. Empty `steps` is a
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

#### The host records what it performs

`muted` is the one leg the host performs rather than the provider, and a record kept by the
provider would have a hole exactly there. So the host reports it, through `recordStep`, and the provider
writes it into its record as it writes every other leg:

```ts
declare const connection: Connection<"voice">;
declare const taskId: TaskId;
declare const allocationId: AllocationId;
declare const at: IsoTimestamp;

void connection.recordStep?.({ taskId, allocationId, step: "muted", at, mutedBy: "host" });                          // the moment the agent mutes
void connection.recordStep?.({ taskId, allocationId, step: "muted", at, mutedBy: "host", seconds: 15 });             // still running, if the host chooses to say
void connection.recordStep?.({ taskId, allocationId, step: "muted", at, mutedBy: "host", seconds: 42, ended: true }); // the moment they unmute
```

The entry is keyed by `step` and `at`, so every report about one leg names the same instant. The
host is the authority for the legs it performs, so it may say how long so far — `seconds` is
elapsed while the leg runs and final once it has ended — and **the end is stated, never
inferred**: `ended: true` marks the last report, and it carries the final duration. **What a
provider never asked for never crosses.** The running report is sent only to a provider whose
manifest declares `runningStepReports`; every other provider receives exactly two reports per
leg, when it began and when it ended, and `validateHandlingReport(report, path, manifest)` refuses
a running one it was never asked for (`handlingReport.running.unexpected`). What a provider that
did ask for them forwards upstream, and how often, is its own business. The step appears in
`handlingHistory` when the *provider* publishes it: Omni never writes the record itself.
`recordStep` is required of every softphone login's connection, since every call on a softphone
can be muted by the host, and answers `recorded`. A `muted` report says whose the silence was,
`mutedBy: "host"` or `"station"`, and no other report has the word (`handlingReport.mutedBy`,
`.mutedBy.unexpected`). On a desk phone the microphone is the phone's:
the host mutes nothing and records nothing.

**A host-performed leg still open when the task's media ends, or the task ends, is ended by the
host at that instant** — `ended: true`, `seconds` to the end, the same `at` — since a provider
left to close it would be guessing at a host-performed duration. Both ends are read off one clock,
the host's, and a leg shorter than a second is reported as the second it was, never as the nought
the record refuses.

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
| `urlVisibility` | What the agent sees of this tab's URL in Omni's chrome: `hidden`, `domain`, or `full`. Omitted, the URL shows as any browser's does; a provider says `hidden` where the URL carries what the agent may not read — a caller's number, a CRM token. Per browser, on the provider's word; a host that declares `guarantees.browserUrlVisibility` honours it tab by tab, and a provider checks that guarantee before it sends such a URL at all. |

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

The supported `BrowserIsolationScheme` values, declared under **Shapes**, key as follows:

| Enum member | Example session key |
| --- | --- |
| `PROVIDER_NAME__TASK_ID__TAB_NAME` | `mailflow.EMAIL-829102%2Ea1.CRM` -- the task's allocation, so one life of the id, never the next customer's cookies |
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
chose those terms. `queue` says somebody configured them. `ungoverned` says nothing handed the work
over: an agent's own outbound call has no queue behind it, and the provider states what it permits
for such a call. Neither changes where a host reads the capabilities from, which is the task; the
source is one more published fact about them, and the one that lets a host tell a fact from a fault
(see below).

**Completing the task is not a capability, and no capability set withholds it.** `complete` is
governed by `completionMode` alone: under `agent-command` it is always available, whatever the set
says, and the `dispositions` capability decides only whether a code travels with it. Likewise
Answer on a pending task and Call on a preview are the phase's controls, not the set's. The
capability set governs what the agent may do *with* the task; disposing of it is never on the
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
once at offer or answer and never corrected is a fact with a shelf life and no expiry, and a host
draws a control the provider will now refuse -- or withholds one the agent now has. So the provider republishes
the task, with its capabilities as they now stand, and a host treats the last statement as current
rather than re-deriving anything. This is the same shape as a room left full after the call ends
-- a field describing the present, carried past the moment it stopped being true -- carried past
this time not by a spread but by nobody sending the correction. A provider whose platform can
change a permission mid-task and does not republish is in breach, however conformant its offer was.
A capability set can shrink as well as grow, and a host that has only ever seen it grow meets a
control that was there a moment ago and is gone; a command that arrives after its capability was
withdrawn is refused with a reason, never acted on. The asymmetry decides which direction a
provider gets right first: a control gained late is a nicety, a control withdrawn and not
republished is a button that fails when pressed. `assertTaskCapabilityWithdrawal` is the test for that
direction: the task as offered and as republished, and one command that was issuable under the
first and is refused under the last for want of the capability withdrawn -- and nothing else.

**An empty capability set is a statement, not a shrug.** `capabilities: {}` under `queue` or
`ungoverned` says the platform permits nothing capability-gated on this task, and a host draws
nothing beyond what the phase and `completionMode` require. A provider that has not yet learned
what the platform permits -- a queue's configuration that has not reached it -- knows nothing of
the kind, and must not publish the task as if it did, neither as `{}` nor as every control it has.
It publishes the task under `capabilitySource: "undetermined"`, with the capabilities it will
honour until it knows, and a host shows that where the agent works, beside the controls it draws
from them: "no queue governs this call" is a fact, "the configuration has not arrived" is a fault,
and the set alone cannot tell them apart, so the provider says which. What a provider honours
under undetermined terms is its own call -- a floor that would rather an agent briefly hold a
control the platform might not have granted than lose hold or hang-up mid-call over a slow
configuration read publishes those -- and the protocol chooses no default set for it. The fault is
also reported as a `diagnostic` naming the task, one per occurrence, so an operator counts it. When
the terms arrive, the task is republished under `queue` with the set as it now stands: the same
republish as any other permission that changed while the task was open. The move goes one way.
Terms once read stay read: a re-read that fails mid-task is not a new fact about the task, so the
last statement stands and the failure is a `diagnostic`, and a task that was published under
`queue` or `ungoverned` never returns to `undetermined`, on an update (`stream.taskUpdated.capabilitySource`)
or on a resync snapshot (`stream.snapshot.capabilitySource`); a record once read never loses an
entry the same two ways (`stream.taskUpdated.handlingHistory`, `stream.snapshot.handlingHistory`);
a snapshot carrying a task still at work does not forget the audio the stream held up, since media
ends on `task-media-ended` and the call moves on (`stream.snapshot.media`); a voice task ends after
its audio ends, never around it, whatever the outcome (`stream.taskEnded.mediaOpen`); and a task does not go
backwards, on an update or on a resync (`stream.taskUpdated.phase`, `stream.snapshot.phase`): the
stream sees publications, not
transitions, and a task may pass through a phase between two, so `pending` to `in-progress` stands
with `confirmed` between them, and what is refused is a phase unreachable from the last one read by
the transition table -- back to `pending`, back to `confirmed` or `preview` once work began, out of
`completing` except by the party being dialled again, a connect-back or a platform's callback,
which the update itself shows: the party ringing, or joined by a dial whose answered outcome the
stream saw in this life. A completing task republished as `in-progress` from a stale copy carries
no such stage, and that is the ending the agent never saw. Audio arrives only on a task at work: `task-media-started` on a `completing` task
is refused as it is on a pending one (`stream.taskMediaStarted.beforeWork`), since a connect-back
returns the task to `in-progress` before any media. And a task completes after its audio ends,
never around it: an update moving a task to `completing` while the stream holds its media as
started is refused (`stream.taskUpdated.mediaOpen`), whoever caused the ending, and a task stating
`completing` with `media: "started"` contradicts itself on any snapshot or update
(`task.media.completing`). The consequence the rule exists for is concrete: the customer's audio
keeps playing through the agent's wrap-up.

What the agent is told differs by source, and only one source tells them anything. Under `queue`
and `ungoverned` the agent sees controls and nothing about where they came from: both are facts,
and an agent working a call has no use for the name of the rule behind its buttons. Under
`undetermined` the agent is told, beside the controls, that these are what the provider will honour
until the queue's terms arrive, and that the controls may change when they do -- a statement about
the buttons in front of them now, not about the provider, because that is what changes when the
republish lands. It stays for as long as the set is provisional, beside the controls it qualifies;
a message that shows and clears has said nothing about the buttons still on the screen. The two
words are close in English and far apart on the desk: `ungoverned` is silence, `undetermined` is a
standing notice.

One consequence for whoever builds the host: because a conformance run fails on `undetermined`, a
conformant adapter never shows a host `undetermined` under test, and a clean `exerciseAdapter`
result says nothing about how the host renders it. That rendering is tested against a fixture --
a task published under `undetermined` shows the notice, the same task under `queue` shows none --
and never against an adapter, even in principle. `exerciseAdapter` treats a
task published under `undetermined` as a violation (`capabilitySource.undetermined`), as it treats
a diagnostic: a conformance run against a platform that cannot say what it permits fails loudly
rather than passing with a note.

```ts
const taskCapabilities = {
  channel: "voice",
  capabilities: {
    hold: true,
    dispositions: true,
  },
  browsers: [],
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "browsers">;
```

A capability says the control may be offered; the task's phase says whether there is anything to use
it on. Every control below that acts on the call or the conversation -- everything but `decline`,
`connectBack` and `dispositions` -- is offered only while the task is `in-progress` or `paused`.
See **Which commands need a capability**.

### Voice capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending voice offer. Omni shows it only when provisioning also permits declining. |
| `hold` | Primary toggle: Hold | Omni may issue voice-task `hold` and `resume` commands. |
| `endCall` | Primary button: End call | Omni may end the whole call: everyone leaves, the media ends, and the task stays for its wrap-up. See **Ending a call, and removing one person from it**. |
| `connectBack` | Completing-task button: Connect back | Omni may have the provider connect the agent back to the task's party while the task is `completing`, returning it to `in-progress` on the same task. Not offered where there is no `completing` window: `provider-automatic` with a zero allowance disposes at provider end. See **Connecting back during completion**. |
| `coldTransfer` | Secondary menu item: Cold transfer | Omni may hand the customer straight to a destination, with nobody spoken to first. |
| `warmTransfer` | Secondary menu item: Warm transfer | Omni may park the customer and call a destination first, then hand the customer over or cancel back. See **Warm transfer**. |
| `leadAssist` | Secondary menu item: Lead assist | Omni may ask a lead to join this call, with a note. The lead's decision reaches the agent on `Task.leadAssist`. See **Lead assist**. |
| `conference` | Secondary button: Conference | Omni may dial a destination into the active call, and remove one person from it -- a conferenced entry, one still ringing included, which calls the dial off, or the party, leaving the agent with the colleague. See **Ending a call, and removing one person from it**. |
| `recording` | Overflow menu item: Recording | Omni may expose start, pause, resume, and stop recording controls. |
| `dispositions` | Primary button: Complete | Omni may request task disposal with a provider disposition and notes. |

### Publishing codes and destinations

Four capabilities accept an object when the provider wants Omni to render real choices. For
`dispositions` alone, `true` remains valid and means "offer the control with nothing published";
the three directory controls -- `coldTransfer`, `warmTransfer`, `conference` -- carry their
directory or are refused, since once nothing is typed the directory is the control.

#### `dispositions`

```ts
capabilities: {
  dispositions: {
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
| `codes` | Codes Omni offers. `id` values are non-empty and unique; Omni sends the chosen `id` as `TaskCommand.complete.disposition`. |

With `dispositions: true` Omni shows a Complete control and sends `complete` with no code, because
the provider published none.

#### `coldTransfer`, `warmTransfer` and `conference`

```ts
capabilities: {
  coldTransfer: {
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
| `id` | What Omni sends as `destinationId` on a `transfer` or `conference` command, and what the provider executes. |
| `label` | What the agent reads. |

**The protocol does not say what an item does.** A queue, an IVR menu, an outside line, a
skill group -- that is the queue's configuration and the provider's business. The agent sees a
list of labels, picks one, and Omni sends its `id`; the provider executes whatever the item is. No
kind travels, nothing is typed, and a control with an empty directory has nothing to offer and is
refused (`task.destinations.offer`). A control declared as bare `true` is refused for the same
reason (`task.destinations.shape`): once nothing is typed, the directory is the control.

**An agent never transfers to a named agent**, warm or cold. A contact that needs another pair of
hands goes back to a queue or a menu the queue configured, and who takes it next is the queue's
decision: routing by skill, availability and fairness is what the queue is for, and a hand-off to a
chosen colleague bypasses all three. The desk shows no agent picker and no dial pad on a transfer.
The one way a named person ends up with an agent's call is a lead taking it over through lead
assist, which is the lead's act, not a transfer the agent chose.

#### Ending a call, and removing one person from it

A call has everyone on `Task.onCall`, and two commands take people off it, both performed by the
provider.

```ts
{ type: "end-call" }                                             // everyone leaves; the media ends; the task stays for its wrap-up
{ type: "conference", action: "remove", party: true }            // the customer leaves; the agent stays with the colleague
{ type: "conference", action: "remove", destinationId: "tier2" } // the conferenced person leaves; ringing, this calls the dial off
```

`end-call` ends the whole conversation for everyone on it, and is gated by `endCall`. The task does
not end with it: `task-media-ended` follows, any wrap allowance runs, and the agent dispositions
the call. `conference` `remove` takes one person off, named as the room names them, and the call
goes on for the rest; it is gated by `conference`, since it only means something with a third
person on the line. Removing the party leaves the agent with the colleague, a warm hand-over in
reverse. A remove that would leave the agent alone is not a remove but an `end-call`, and a
provider answers it `failed`. The consulted destination of a warm transfer is not removed this way:
`transfer` `cancel` is its own step, which returns the agent to the parked customer, and a remove
never promises that.

#### Warm transfer

A warm transfer parks the customer, calls the destination so the agent can speak to it first, and
then either hands the customer over or returns to them. Cold and warm are the words agents use;
telephony says blind and consult. It is its own capability, distinct from `coldTransfer` (a
hand-over with nobody spoken to first) and from `conference` (everybody on one call): a queue may
offer any of the three without the others, and each is declared on its own.

```ts
// 1. Warm. A dial: the provider parks the customer and calls the destination, answers
//    `dialling`, and the task reports `paused` with the destination `consulted` on `onCall`
//    while the call to it stands.
{ type: "transfer", action: "warm", dialId: "dial-7f2", destinationId: "tier2" }

// 2a. Hand the customer to the consulted destination and leave.
{ type: "transfer", action: "complete" }

// 2b. Or drop the destination and return to the customer.
{ type: "transfer", action: "cancel" }
```

`warm` is gated by the `warmTransfer` capability and names a directory item exactly as a cold
transfer does, from the same kind of directory. It is a dial, so it carries the host's `dialId`
and is answered `dialling`, and its `dial-outcome` says whether the destination was reached. While
the destination is on the line the task carries a `consulted` entry on `onCall`, and that presence
is what makes `complete` and `cancel` issuable -- they name no destination because there is exactly
one they could mean, which is why a task carries at most one `consulted` entry
(`task.onCall.consulted.single`). A consultation that could be started but not finished would
strand the customer and the destination both, which is why all three are commands and a provider
that offers `warmTransfer` implements all three.

`applied` on `complete` says the provider is bridging the customer to the destination and
dropping the agent's leg. What follows is what follows any call the agent leaves: the agent's
media ends and the provider reports `task-media-ended`, the task moves to `completing`, any wrap
allowance runs, and the task ends `completed` as any call does. A warm complete is not a disposal:
the agent has a wrap to do, so nothing is owed within `disposalSettleMs`. `transferred` names a
cold transfer alone, where the agent had no wrap. `applied` on `cancel` says the destination is
dropped; the task returns to `in-progress` with the `consulted` entry gone. Omni waits for the
provider's report of both, as it does for every command.

A destination that does not answer is a dial that ended: the provider reports its `dial-outcome`,
returns the task to `in-progress` with no `consulted` entry, and the agent is back with the
customer.

### Chat capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending chat offer. Omni shows it only when provisioning also permits declining. |
| `hold` | Primary toggle: Hold | Omni may pause and resume agent handling of the chat. |
| `dispositions` | Primary button: Complete | Omni may request task disposal with a provider disposition and notes. |

### Email capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending email offer. Omni shows it only when provisioning also permits declining. |
| `dispositions` | Primary button: Complete | Omni may request task disposal with a provider disposition and notes. |

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

`name` is the `id` of the custom capability the agent used. There is no `taskId` here: like every
other command it travels on the `TaskCommandRequest` around it. A `toggle` carries the state it
wants — `{ type: "custom", name: "mark-vip", on: true }` — never a flip, for the reason under
**Task commands**.

Custom capabilities must not redefine the meaning of a standard channel capability.

## Idle actions

### `dial(request)`

Starts one outbound call from the idle dialpad. It is present only when the voice provider
declares `dial`.

- `dialId` is the host's identity for this dial, minted before the request leaves.
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

Four commands place a call: `dial` from the idle dialpad, a blind or consult `transfer`, a
`conference` `add`, and `connect-back`. Each is accepted or refused at once, and each then ends later
and apart from its answer -- the destination picks up, is busy, or never does -- and a dial placed
late in a call routinely outlives the call. Nothing in between is reported: the wire says
`dialling`, then says how it ended, once.

**The host mints the identity.** Every command that dials carries a `dialId` the host made, unique
across the installation, and it travels four ways so no leg is a lookup:

```ts
declare const connection: Connection<"voice">;
declare const taskId: TaskId;
declare const allocationId: AllocationId;

// 1. Out, minted by the host.
const result = await connection.execute({ taskId, allocationId, command: { type: "conference", action: "add", dialId: "dial-7f2", destinationId: "tier2" } });

// 2. Back on the result, restated, so the host compares and confirms.
expect(result).toEqual({ status: "dialling", dialId: "dial-7f2" });

// 3. On the outcome, however late, against the task it belonged to.
const outcome: ProviderEvent<"voice"> = { type: "dial-outcome", dialId: "dial-7f2", taskId, allocationId, destinationId: "tier2", outcome: "no-answer", reason: "No route to destination" };

// 4. In the record, so a dial made before a transfer is placeable by whoever holds the task now.
const step: TaskHandlingStep = { step: "unanswered", at: "2026-08-21T09:15:30Z", by: "A-12", dialId: "dial-7f2", destinationId: "tier2" };
```

The identity is a correlation handle between host and provider and **is never shown to the
agent**. A host holding several tasks places an outcome by the `dialId` it minted; one it did not
mint -- a dial made by the previous agent before a transfer -- it finds on the task's `onCall` or in
its `handlingHistory`, which is why the steps that dial carry it. The `dialId` is not a retry key:
Omni never repeats a dial, and a command still carries no key for that purpose.

**`dialling` is the answer to a dial, and `applied` is not.** A command that dials answers
`{ status: "dialling", dialId }`, restating the host's identity (`result.dialId`,
`result.dialId.mismatch`); `applied` from such a command, or `dialling` from one that dialled
nothing, is refused (`result.status`). `validateResult(result, method, path, dialId)` takes the
`dialId` the host sent for that reason.

**The outcome is stated, once, either way.** A `dial-outcome` names the `dialId`, the task where
there was one, the directory item it went to where there was one, and how the dial ended -- from a closed
set: `answered`, `busy`, `no-answer`, `unreachable`, `rejected`, `cancelled`, `unexplained`.
`answered` is stated rather than read off somebody appearing on the call, because a host that infers
success cannot tell "reached" from "still ringing". `cancelled` is the dialler calling the dial off
before anyone answered -- the agent hanging up while a consult still rings -- which is not a
`no-answer` the destination never gave. `unexplained` is the switch dropping the call with no cause among
those named here: a statement about the switch, sent instead of the nearest cause it did not give.
`reason` is the switch's own words, optional, and shown to the agent attributed to the switch rather
than to Omni. The two are different things and may travel together: a switch can say "could not
create dialog" in words and still name no cause a code would carry, so `unexplained` with a
`reason` is a dial the switch described but did not classify, and a desk renders the words without
inventing the class.

**`taskId` is the task the dial was placed on**, resolved from the dial's own identity and never from
whatever task the agent is looking at when the outcome arrives. That task may already have ended,
and the harness places the outcome all the same (`TaskStream`, `stream.dialOutcome.unknown`,
`stream.dialOutcome.duplicate`); an agent who moved on still learns nobody was reached, against the
call it belonged to and never against the next one.

The stream knows a dial from three places: `TaskStream.dialled(dialId)`, which a host calls when it
places one; an entry on a task's `onCall`; and a step in its `handlingHistory`. Since a dialled entry
is listed from placement, `dialled()` is load-bearing only for a dial that never has an entry -- a
cold transfer, a connect-back, an idle dialpad call -- or whose entry has already left the room; an
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
dialpad requires it (`manifest.dialOutcomes.required`), and a task that declares `connectBack`,
`coldTransfer`, `warmTransfer` or `conference` under a manifest without it is refused
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
neither carries a destination. `consulted` and `conferenced` were, so both carry the
`destinationId` of the directory item and, where a host's dial brought them, its `dialId`; a person
the platform added itself carries none. `held: true` is presence as claim. A snapshot establishes state, so a host that attaches
after a transfer reads the room from here rather than inferring it from a sequence of outcomes it
never saw.

**`onCall` is who is on the call now, and a task outlives its call.** Wrap-up is not an ending:
the task is alive, the agent is working, and nothing arrives to say the call ended until they
dispose. So the room must not be the last word about a call that has ended. Once the call is over
-- the task `completing`, or its `media` ended -- `onCall` is empty, or absent only where the
provider never publishes the room at all, and a task carrying people on a call that has ended is
refused (`task.onCall.ended`). Empty says nobody is on the call; absent says the provider does not
say who is, which is a different claim, so a provider that publishes the room publishes one last
change: the empty room.

**A field that describes the present is cleared by the transition that ends it.** `onCall`,
`previewEndsAt` and `atDeadline` are three instances of one shape, and there will be more: each
describes a state that is true now, and each is carried past the moment it stops being true by the
most natural implementation there is, building the next task by spreading the last one. The
provider's own state looks right, the claim on the wire is stale, and only the host sees it. An
adapter that builds each transition from what is true after it, rather than from what was true
before, needs none of these rules named. Two agents were
once shown on calls for the better part of an hour while callers queued, because the last message
describing the room live was never followed by one saying it had emptied, and every consumer that
derived anything from it was wrong in a way that looked like its own bug.

**A dialled entry is listed from the moment the dial is placed, not from the answer.** The entry is
what makes `transfer` `cancel` issuable and what `conference` `remove` names, and a destination the
agent cannot call off while it rings is a parked customer with no way back -- which is the very case
`cancelled` exists for. Consult and conference behave alike here: the `consulted` or `conferenced`
entry appears with its `dialId` when the dial is placed, and a `conference` `remove` naming a
still-ringing `destinationId` calls that dial off, with `cancelled` as its outcome.

**The entry says where it stands.** A dialled entry carries `stage`: `ringing` until its dial is
answered, `joined` after. The `dial-outcome` is the transition and the stage is the state, the same
pairing as `task-media-started` and `media`: an `answered` outcome and the task restated with the
entry `joined` say one thing twice, and any other outcome removes the entry. The outcome comes
first: a `task-updated` that itself moves an entry from `ringing` to `joined` before an `answered`
outcome for its dial is refused (`stream.taskUpdated.stage`), as an update that moves `media` is.
The rule keys on the entry's `dialId`, so an entry the platform added itself, with none, is one
whose move the stream cannot hold to an outcome: a clean stream proves nothing about ordering there. It is stated rather
than left to whoever placed the dial because that knowledge lives in one process: after a reload,
on a second session, or on a supervisor's screen the snapshot is the only source, and a room that
cannot tell ringing from joined says it contains someone who may never arrive. Nobody ringing is
held (`task.onCall.held.ringing`). A consult destination that never answers is a dial that
ended: the provider returns the task to `in-progress` with no `consulted` entry, as **Consult
transfer** states, so the customer is never left parked by a conforming provider.

The desk shows a dial as placed on `dialling`, never as reached; shows the person in the room when
they appear on `onCall`; and shows the outcome, with the switch's reason, against the call it
belonged to -- with no retry, since a wrong number is not worth redialling and the decision is the
agent's.

## Breaks

Everything about an agent's breaks on one provider arrives as one object, `Snapshot.break`,
replaced whole by a single `break-state` event. These facts are only meaningful together — an
approval says nothing without knowing whether the agent chose the break, and a list of reasons says
nothing while none are being accepted — so they are not published separately.

| Field | Contract |
| --- | --- |
| `approval` | Where the agent's current request stands. See the states below. |
| `mayAsk` | Whether the agent may ask at all. Distinct from `approval`. |
| `refusedReason` | Display-ready reason shown when `mayAsk` is false — a standing gate that applies to everyone. |
| `decisionReason` | The words whoever decided attached, from `decide.reason`. About one request and one decision, not a standing gate. |
| `retryAfterMs` | How long until the agent may retry, when the provider can say. |
| `reasons` | Not-ready codes this provider offers. Omitted when it defines none; an empty list is refused, being a second spelling of the same fact. |
| `activeReasonId` | The `BreakReason.id` the current break is on. Omitted when there is no break. Required on a break `in-effect` or `starting-after-task` where the provider publishes `reasons`, an imposed break included (`break.activeReasonId.required`): a break with a kind the provider cannot name is a break whose rules nobody can apply. |
| `imposed` | Set when the break was placed on the agent rather than requested. |

A request can be waiting for two unrelated things, and they are separate values because
rendering one as the other tells an agent to wait for somebody who is never coming:

| `approval` | Meaning |
| --- | --- |
| `not-requested` | No request outstanding. |
| `awaiting-decision` | A person has to decide. The agent is waiting on somebody. |
| `granted` | A person decided yes. Omni may now tell this provider to stop the agent; until it does, work continues normally, and this says nothing about why Omni has not. |
| `starting-after-task` | Omni has told the provider to stop; the break begins when the current task ends. No new work arrives meanwhile, and nobody needs to act. It waits on a task, so beside no task it is refused (`break.starting-after-task.tasks`): a committed break with nothing outstanding is `in-effect`. |
| `in-effect` | The agent is on the break now. It holds no task: a break begins when the work ends, so a snapshot reporting `in-effect` beside a task is refused as `break.in-effect.tasks`. The one exception is a lead's monitoring task during a `coaching`, `administrative` or `training` break -- see **Monitoring a call**. |

A denial is a decision, not a standing approval state. The provider transitions the request directly
to `not-requested`; Omni returns the agent to idle and never asks again on their behalf. They saw the
answer and ask again when they want to. `decisionReason` may carry the words attached to that
decision, but `approval` does not remain denied.

A provider reports `starting-after-task` only after Omni commits a `granted` request while
work is still active. Omni does not send the request again, because asking again would not move
it; it sends the commit again only from a reconnect snapshot that shows the grant still standing.

`mayAsk: false` is what lets Omni withdraw the control rather than let an agent ask and be
refused. A `BreakReason` marked `alwaysAvailable` survives it: a mandatory rest period is not
something a busy hour can cancel, and Omni keeps offering those while the rest are withdrawn.

### Imposed breaks

`ImposedBreak` says who placed the break, whether automatic ending is enabled, and, when enabled,
when the provider will end it. A break the agent did not choose is not manually resumable by them.

**Every imposed break has a person behind it.** A lead or a manager placed it; there is no such
thing as a break the platform imposed on its own. Where a platform applies one automatically, it is
executing a preference somebody configured, and that person is the owner of the action — `by` names
them, not the machinery that carried it out.

Omni resolves the name to show with `describeUsers()`, so a provider sends the identifier and never
a display name.

**An imposed break travels with `in-effect` or `starting-after-task`, and nothing else.** It is a
break in progress or about to be; beside `granted` or `awaiting-decision` the host would read a
request the agent never made and commit it (`break.imposed.approval`). Where the provider publishes
`reasons`, the lead's `place` named one, and the member's state carries it as `activeReasonId`.

For example:

```ts
imposed: {
  by: "manager-1042",
  endsAutomatically: true,
  endsAt: "2026-08-21T10:00:00.000Z"
}
```

The presence of `imposed` means the agent cannot end the break manually, so Omni withdraws its
Resume control from that agent. With `endsAutomatically: true`, the provider ends the break at
`endsAt`; with `endsAutomatically: false`, it does not end the break on a timer. An authorized lead
may end either form with **Resume**, not only whoever placed it. Omni shows **Stopped by <who>**,
resolving the name with `describeUsers()`, and shows when the break will end where automatic ending
is enabled.

A break applies to the **agent**, not to one provider. When a provider imposes one, Omni immediately
requests a break on every other connected provider, or they would keep routing work to somebody who
is not there. Providers should expect that follow-on request.

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

States how many tasks this provider may have allocated to the agent **at once**.

`count` is an absolute ceiling, not an increment, a whole number of zero or more
(`capacity.count`). An agent's capacity is a property of the agent, not of the moment: it is
stated when the agent is set up and restated only when it genuinely changes, which is a
provisioning change rather than a task starting or ending -- with one exception below.

**The provider counts its own outstanding tasks against it.** Allocate while you hold fewer than
`count` tasks for this agent, and stop when you hold that many; when one of yours ends you have
room again and need no new signal to know it. Omni does not re-state capacity as tasks come and
go, and a provider that waits for it will stall.

Your own tasks are the only ones you count. What the agent holds at other providers is not your
concern — Omni set `count` knowing it, and this is how: the agent is one person on several
providers, and the host divides their capacity among them rather than telling each the whole. A
provider that has none of it for now is told **`count: 0`, host-stopped**: allocate nothing, show
the member as `reserved` on the roster -- signed in here, capacity held by the host for elsewhere,
a fact this provider holds, where `on-task` would assert work it cannot see -- and take the next
count as any other when the host has capacity for this provider again. Zero is the one restatement
that follows work rather than provisioning.

**A capacity is taken, never refused.** `setCapacity` answers `applied` and nothing else: a
statement has no failure to report, and a `failed` arm gave four host-provider pairings four
readings of which ceiling stood after it. A provider that cannot carry the count allocates within
what it can and says so on a `diagnostic`, so the gap is visible and nothing is inferred from a
refusal.

Capacity supersedes rather than accumulates: the latest value is the ceiling, and a decrease is as
ordinary as an increase. A provider whose ceiling can only rise -- one that keeps the highest count
it was ever told, or returns early on a small one -- cannot be told to take less work, and a host
taking capacity away is answered `applied` while the work keeps coming. The harness moves the axis
both ways after the drive, two then one then nought, and an offer after a lower count is caught
against it (`stream.taskOffered.overCapacity`).

**Capacity gates what the provider allocates, not what the agent starts.** A call placed from the
idle dialpad arrives through `task-offered` like any other task, and a full agent does not forbid
it: the ceiling binds allocation, not the agent's own hand.

### `requestBreak(request)`

Requests permission to stop the agent later; it does not itself stop work. The provider continues
offering work and reports `awaiting-decision` or `granted` through `break-state` events. If the request is denied, the
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
| `coaching` | Reviewing this agent's own work with somebody accountable for it: a call listened back, quality feedback, a one-to-one about their handling. Even where the outcome is that they learn something. |
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

**A break somebody placed on the agent is not automatically one of these.** Where the agent was
stopped rather than choosing to stop — see **Imposed breaks** — set `BreakState.imposed` and prefer
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

Omni separately tracks the aggregate host states `working`, `requesting-break`, `committing-break`,
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
   available and work continues. `assertBreakAttemptProviders` holds a host to this set.
2. Enter `requesting-break`. Keep the agent's normal capacity in place throughout this phase.
3. Send one `requestBreak` to every asked provider. A provider reports `awaiting-decision` or
   `granted`; neither state stops work. A denial transitions directly to `not-requested` and
   causes Omni to take the cancel path.
4. If every asked provider reports `granted`, durably choose commit, enter `committing-break`,
   and send `commitBreak()` to each of them. A provider then stops offering new work
   and reports `starting-after-task` or `in-effect`. The **commit bound** — ten seconds from the
   decision, tunable per deployment — decides who is kept: a provider that has not applied the
   commit by then, still `granted` or unreachable, is set aside as unreconciled and the break
   begins without it. `in-effect` decides `on-break`: Omni enters it once every kept provider
   reports `in-effect`. A kept provider reporting `starting-after-task` has applied the commit
   and is finishing a task; the bound is on delivery, not on that task. Omni shows the break as
   settled and beginning when the task ends, and offers no cancel, because the commit is durable.
5. If any asked provider fails or denies the request, cannot be reconciled within the bounded
   decision timeout, or the agent cancels before commit, durably choose cancel and enter
   `cancelling-break`. Send `cancelBreak()` to every provider still reporting
   `awaiting-decision` or `granted`. Work continues during cancellation because no stop was
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

- `in-effect` or `starting-after-task` — the commit arrived after all. Nothing to send.
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
would stop an agent who is working again; `starting-after-task` or `in-effect` gets `endBreak()`.
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

An imposed break is not rolled back by this algorithm. If one appears during either the request or
cancellation, Omni follows the imposed-break rule on the other providers and commits each grant as
soon as it reaches `granted`; it does not wait for unanimity because the agent has already
stopped elsewhere.

This is two-phase coordination across vendor systems: the approval phase keeps the agent working;
the durable commit decision and snapshot reconciliation provide convergence after partial delivery.

#### Reporting the break the agent is on

`BreakState.activeReasonId` is the `BreakReason.id` the current break is on. Omni remembers what it
asked for, but only until the session ends — after a reload or reconnect, or where the provider put
the agent on the break itself, the provider is the only one who knows.

Omit it when you cannot say, and when there is no break: reporting a reason alongside
`approval: "not-requested"` describes a break that is not happening, and is rejected.

### `cancelBreak()`

Cancels the active pre-commit request while its approval is `awaiting-decision` or `granted`.
Cancellation releases the request but does not restore work because work never stopped. If
commit already won, the provider returns `omni.break-already-committed`. The resulting state is
reported through `break-state`.

### `commitBreak()`

Commits the `granted` request. Once the provider has reported `granted`, it cannot fail for a
business reason. On commit the provider stops offering new work and reports
`starting-after-task` while existing work finishes, or `in-effect` when the break is in effect.
Committing a break that is already in effect changes nothing and answers `committed`.

### `endBreak()`

Tells a provider that an agent already on a break wants to become available again. The provider
reports the resulting state through `break-state` and provider status events.

It ends the break, which is the thing that started. Nothing about the connection was ever paused,
so there is nothing on it to resume.

## Team leads

A lead who also takes calls sees their team on the idle dashboard. `Snapshot.team` carries a
`TeamRoster`, replaced whole by `team-updated`.

| Field | Contract |
| --- | --- |
| `members` | Every member of this lead's team, whatever their state. `[]` says the lead has a team with nobody in it; omitting the roster says something else entirely — see **The login is the permission** below. |
| `requests` | The members currently asking this lead to join a call, each with the task and the note. Required when the login declares `team.leadAssistControl`, `[]` when nobody is asking; omitted when it does not. See **Lead assist**. |
| `policies` | The team's policy per capability as it stands — the setting, who set it, and `lockedBy` where a level above the team made it theirs to keep. Required when the login declares `team.policyControl`; omitted when it does not. See **Who decides what an agent may do**. |

| `TeamMember` field | Contract |
| --- | --- |
| `id` | Required `UserId`. A task carries no names and neither does a roster: Omni resolves what to display with `describeUsers()`. |
| `availability` | Required. What the member is doing now. |
| `since` | Optional. When the current `availability` began — not when they signed in, and not when the roster was read. |
| `break` | Present only while the member has an outstanding break request. See **A member waiting for a break**. |

Each availability value means one thing:

| Value | Meaning |
| --- | --- |
| `ready` | Signed in, able to take work, none assigned. |
| `on-task` | Handling at least one task. It says nothing about how many, and nothing about whether more will fit. |
| `on-break` | Stopped and not taking work, whether they asked or somebody stopped them. The reason lives on their own `BreakState`, not here. |
| `reserved` | Signed in here, and the host holds this agent's capacity for another provider (`count: 0`, host-stopped): not receiving this provider's work, and not on a break. See **Capacity**. |
| `signed-out` | Known to this team but not signed in to this provider. |

**Always publish the complete roster, never a change to it.** Team presence typically reaches an
adapter over a best-effort channel with no ordering and no delivery guarantee, so a stream of deltas
cannot be trusted to reconstruct the truth. The adapter reconciles against its own authoritative
read and publishes the result.

**Omit `since` rather than inventing one.** Omni renders it as a duration, so a timestamp
synthesised from the adapter's own clock at seed time reads as "on task for 0 seconds" for
everybody — worse than showing nothing, because it looks like data. Send it only when the provider
knows when the state actually began. It times the current `availability`, so it moves every time
that value does.

**The login is the permission.** A roster goes to a login that declares `capabilities.team`, on
every snapshot, and to nobody else. Omni never decides who leads a team: the provider said so at
sign-in, and the roster agrees with it — present, `[]` included, for a lead; absent for everybody
else, which is the correct rendering for an agent who leads nobody. What the lead may do with the
roster is on the login too, `team.breakControl` and `team.leadAssistControl`, never on the roster.

**The roster never carries the agent it is published to — not in `members`, and not in
`requests`.** A lead does not report to themself: their own break request and their own ask for a
lead go up to whoever leads them and appear on *that* person's roster, while the requester sees
only their own `BreakState` and their task's `leadAssist` move. An adapter whose platform lists the lead
among their own members filters the signed-in identity out before publishing. **Being a lead is a
role the provider knows, never inferred from who is listed:** it is declared at sign-in, a lead
with nobody in their team publishes `[]`, an agent with no such role publishes nothing, and no
member count can tell those two apart.

### Lead commands

One method, `executeTeamBreak`, taking a discriminated command exactly as `execute` takes a
`TaskCommand`:

| Command | Effect |
| --- | --- |
| `{ type: "decide", memberId: UserId, decision, reason? }` | Settles one pending request. `decision` is `granted` or `denied`. A grant moves the member to `granted`; a denial ends the request and moves it directly to `not-requested`. |
| `{ type: "policy", policy }` | `ask`, `auto-approve`, or `suspended`. |
| `{ type: "place", memberId: UserId, reasonId?, reason? }` | Puts a member on a break they did not ask for. `reasonId` names a published `BreakReason.id` and is required whenever the provider publishes `reasons`; the member's imposed break carries it as `activeReasonId`, so its kind is known. |
| `{ type: "release", memberId: UserId }` | Ends an imposed break on that member, whoever placed it. |

`memberId` is this provider's own identifier for the member, as published on its roster. It is
never an identifier from another provider, and Omni does not translate between them; names come
from `describeUsers()`.

`suspended` means requests are **rejected outright** rather than left pending — nobody is coming to
approve them. A provider that suspends breaks must also publish `mayAsk: false` to the team's
agents so they see it before asking. A `place` must likewise reach that member as an `imposed` break
on their own `BreakState`, or they are stopped from working with no way to see why.

What happens when no lead is online — auto-approving, for instance — is the provider's decision and is
never expressed here.

### Lead assist

An agent on a call may ask a lead to join it -- a dispute that needs approval, a customer who
asks for a manager, a moment the agent wants a second pair of ears. A call centre calls this
assistance or escalation, and the name says who assists: the capability is `leadAssist` on the task; the lead's side is the roster, which is already the lead's view of the
team, and a second lead method beside `executeTeamBreak`:

```ts
executeTeamLeadAssist({ command: TeamLeadAssistCommand }): Promise<TeamCommandResult>
```

Required when the login declares `capabilities.team.leadAssistControl`, and gated by it exactly as
`executeTeamBreak` is by `team.breakControl`. The flow, in order:

```ts
// 1. The agent asks, with a small note. Their task carries `leadAssist` from here on.
execute({ taskId: "call-42", command: { type: "lead-assist", action: "request", note: "Refund dispute, needs approval" } })
//    task.leadAssist = { stage: "requested", note: "Refund dispute, needs approval", since }

// 2. Every lead entitled to it sees the request on their roster.
//    team-updated: requests: [{ id: "req-7", memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", note, since }]

// 3. A lead joins, or declines.
executeTeamLeadAssist({ command: { type: "join", requestId: "req-7" } })
executeTeamLeadAssist({ command: { type: "decline", requestId: "req-7", reason: "In a call" } })
```

**On `join` the provider bridges three parties and the lead is on a task of their own**, on the
same task id, arriving on the lead's connection as `task-offered` with `automatic`
-- the way a call an agent placed themselves arrives -- and carrying `assisting`. The agent's task
moves to `leadAssist: { stage: "joined", leadId }`. A join is the lead's own act, so capacity does not
trigger it; but from then on it is an outstanding task the provider counts against the lead's
stated ceiling like any other, nothing more is allocated to the lead while it stands, and a
provider whose lead is already at the ceiling answers the join `failed`.

**A lead assists one call at a time.** A `join` from a lead already on a call -- their own or one
they joined -- is answered `failed`, whatever their ceiling; the request stands for another lead,
or until it is withdrawn or declined.

**A lead on a break does not join.** A break is a reported state in which the agent is not working,
and a join is work. Omni offers Join to a lead only while their own `BreakState.approval` is neither
`starting-after-task` nor `in-effect` -- a committed break waiting for the lead's current work to
finish is not given more -- and a provider answers a `join` from a lead on such a break `failed`.
The request stands for another lead, as it does when this one is already on a call.

**On `decline`, or a request the agent withdraws with `{ type: "lead-assist", action: "cancel" }`, the
provider clears `leadAssist` from the agent's task** and drops the request from every roster. Nothing
else changes; the agent is still on the call.

The lead then has two commands on their copy, gated by `assisting` being present, and a third
choice that is no command at all:

| The lead | The agent's task | The lead's task |
| --- | --- | --- |
| `{ type: "lead-assist", action: "take-over" }` | `task-media-ended`, then `task-ended` with `{ type: "taken-over", leadId }`: **no `completing` window**, the agent is idle at once. The audio ends first, as before every voice ending (`stream.taskEnded.mediaOpen`), and the lead is named by user id, since a lead is not a directory item | Continues alone, and ends as any call does |
| `{ type: "lead-assist", action: "leave" }` | Continues; `leadAssist` is cleared | `task-media-ended`, then `task-ended` with `{ type: "left" }` -- the call goes on without them |
| Stays until the customer hangs up | `task-media-ended`, `completing`, its own disposition | The same, independently: **both have the disposal window** |

`left` is the one outcome that ends a task without ending the call: this agent left a call that
continues without them. It reads as neither a completion nor a cancellation, because it is
neither.

```ts
const leadAssistCapable = {
  channel: "voice",
  capabilities: { hold: true, leadAssist: true, dispositions: true },
  phase: "in-progress",
  leadAssist: { stage: "joined", leadId: "L-9", note: "Refund dispute, needs approval", since: "2026-08-21T09:04:00Z" },
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "leadAssist">;
```

Lead and member alike are `UserId`s of this provider, so an adapter publishing them implements
`describeUsers()`; names never travel on a task or a roster.

### Monitoring a call

A lead may listen to a member's call without being asked -- to coach, to check quality, to step in
when it goes wrong. This is not lead assist: nobody requested it, the member's task says nothing
about it, and there is no take-over in it. A lead who wants the call itself uses lead assist. The
three modes are the call centre's own words:

| Mode | Who hears the lead |
| --- | --- |
| `monitor` | Nobody. The lead hears both sides in silence. |
| `whisper` | The agent alone. The customer hears nothing. |
| `barge` | Everyone on the call. |

The login says which modes this lead has, as a list on `team.monitorControl`, and it always
includes `monitor`, because whisper and barge begin from one
(`authentication.capability.team.monitorControl.monitor`). A centre that lets every lead listen but
reserves barging declares `["monitor", "whisper"]`, and Omni offers no Barge to that lead. The
declaration requires `executeTeamMonitor`, gated exactly as `executeTeamLeadAssist` is by
`team.leadAssistControl`.

```ts
// 1. The lead picks a member from the roster and starts silent.
executeTeamMonitor({ command: { type: "monitor", memberId: "A-1" } })

// 2. The lead's own task arrives -- task-offered with `automatic`, as a joined call does -- and
//    carries `monitoring`; the task id is the lead's, the member's call is named inside it.
//    monitoring: { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "monitor", since }

// 3. The lead changes how they are heard; the provider restates the task with the new mode.
executeTeamMonitor({ command: { type: "whisper" } })
executeTeamMonitor({ command: { type: "barge" } })

// 4. The lead leaves; their task ends with `{ type: "left" }`. The member's call goes on.
executeTeamMonitor({ command: { type: "leave" } })
```

**The lead's task is what gives them audio**: Omni opens media on it as on any voice task, and the
provider bridges the lead's leg into the member's call in the mode stated. `monitoring.mode` is
the state, restated on every change, and a `whisper` or `barge` the login's list does not include
is answered `failed`. **A lead listens to one call at a time** (`snapshot.monitoring.single`), and
a task is a joined call or a monitored one, never both (`task.monitoring.assisting`). The member's
call ending ends the lead's task as it ends the member's, with `left`, since the lead was never
handling it.

**A lead listens only while holding no work of their own.** A monitoring task is the lead's only
task, and a snapshot carrying one beside any other is refused (`snapshot.monitoring.alone`); Omni
offers Monitor to a lead with no task. That includes a lead on a break -- unlike joining, which a
break forbids -- but only a break that is work of another sort: `coaching`, `administrative` or
`training`, the kinds in `MONITORING_BREAK_KINDS`, and never a meal or a rest. A break in effect
otherwise holds no task; the monitoring task is its one exception, and a snapshot carrying one
during a break whose active reason is of any other kind, or of no stated kind, is refused
(`snapshot.monitoring.break`). The kind decides, not the reason's name: a centre that wants leads
listening during a break declares that break `coaching`, `administrative` or `training`.

**Nothing reaches the member.** The member's task carries no trace of a monitoring lead in any
mode: not on `onCall`, not in the record. Whether a whisper is announced to the agent is the
platform's business and travels on the audio, not on this wire.

```ts
const monitoringLead = {
  channel: "voice",
  capabilities: {},
  phase: "in-progress",
  monitoring: { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "whisper", since: "2026-08-21T09:04:00Z" },
} satisfies Pick<Task<"voice">, "channel" | "capabilities" | "phase" | "monitoring">;
```

### A member waiting for a break

A member who has asked for a break **keeps working** until Omni commits it, so asking is not an
availability of its own — it rides alongside one on `break`. That a request exists says nothing
about whether anybody has to act on it, and the difference is a lead's entire action list:

| `break` | Means |
| --- | --- |
| `awaiting-decision` | Somebody has to decide. This is the lead's queue. |
| `granted` | Decided yes, but Omni has not told the provider to stop yet. Work continues and nobody needs to decide. |
| `starting-after-task` | Already granted; it begins when their current task ends. Nobody needs to act. |

Those three are the only values that appear here. `not-requested` is absence — omit `break`
instead. `in-effect` is `availability: "on-break"`, and a denial transitions to `not-requested`,
so neither survives to be reported. It is otherwise the same `BreakApproval` the member's own
break state uses, rather than a parallel vocabulary for the lead's view, so the two cannot drift
apart.

Omni offers Approve and Deny only while a member is `awaiting-decision`, shows `granted` as agreed
but not started, and shows `starting-after-task` as settled.

**Live status, not a record.** The provider derives it from what is true now — not stored, not
historical, carrying no decision made earlier. Like the roster it belongs to, it is published
whole and replaced whole, and a provider that cannot say omits it.

**An agent is not waiting on one person.** Authority is held by several, everyone who holds it
sees the request on their own console, and **any one of them settles it**. Omni offers the
decision to every login that declares `team.breakControl` — which is how the provider already
says who may decide — and does not try to work out whose turn it is.

A request needing *more than one* approval is not something this contract describes. There is
no partial state to report and no progress to display: a request is either still owed a
decision or it is not.

## Real-time media

Every voice provider has media. There is nothing to announce, no capability to declare and no
endpoint to choose: `channel: "voice"` says audio exists, and **Omni is the device it lands on**.

Other endpoints exist in a deployment — desk phones, the provider's own hardware, whatever the
platform already rings — and none of them is the agent's. Omni does not enumerate them, map the
agent onto one, or follow a change made to one. There is no device list, no device selection and
no device on the snapshot, because there is no choice to record: audio for this agent arrives in
Omni, and Omni registers the endpoint for it.

That removes a whole class of state the provider would otherwise own and Omni would have to track,
and it removes the branch that came with it: no command has to ask where the audio went before
deciding who performs it. Nor does the audio ever stand in for the task: a task's presence and
phase follow the provider's reports about the work, and the media — attaching, moving through a
hold, a consult, a conference or a transfer, and ending — is transient beside it. See **A task is
never its audio** under **Task allocation lifecycle**.

### The host reports, the adapter decides

The adapter runs inside Omni and sees nothing of the station for itself: the devices, the
permissions, the audio element and the network are the host's, and only the host can tell. So
the host reports, and the adapter asks. **An adapter consults `ConnectContext.host` before it
declares the agent ready to its platform, and again whenever the report changes**, and it decides
what any of it means and what to relay upstream — go not-ready, refuse calls, carry on because the
platform's audio lands elsewhere. Omni facilitates and does not take responsibility: it captures
the microphone once as the voice connection opens, so the permission prompt lands while the agent
is signing in rather than over a contact, prompts, retries on the agent's request, tells the agent
what failed, and reports. It never decides for the adapter what a missing microphone means.

**The host also guarantees, and a promise the provider cannot see is not one it can rely on.**
Two of this contract's obligations fall on the host rather than the provider — honouring a task
browser's `urlVisibility`, and taking a `consent` offer only on the person's own press — and more
than one desk speaks this contract: a browser and a native application differ in what they can
reach, and a provider never branches on which it is talking to, only on what it has declared —
here, and in `host.mute` (see **The station is the host's**). So `ConnectContext.host.guarantees` says which promises the
connected host makes, declared once per connection, presence being the guarantee exactly as it is
the permission everywhere else:

| Guarantee | Contract |
| --- | --- |
| `browserUrlVisibility` | Every task browser's `urlVisibility` is honoured in this host's chrome, tab by tab. A provider that would send a caller's number in a URL checks this first and tokenises where the promise is absent. |
| `personConsent` | A `consent` offer is accepted only by the person's own explicit act, never on their behalf. A provider whose work may only be taken by a human checks this first and does not offer it where the promise is absent. |

A guarantee the host does not make is an absent key, never `false` — `validateHostGuarantees`
refuses a false one, as it refuses a name this contract does not list.

| Field | Contract |
| --- | --- |
| `online` | Whether the host has a network interface up. Not a claim that anything is reachable — the adapter knows whether it can reach its own platform far better than the host does — so `false` is a reason not to go ready and `true` is not a reason to. |
| `audio` | Present on a voice connection, absent where there is no audio. |
| `audio.input` | `available` with `localAudio` — the microphone as captured, the same stream `openMedia` receives — and `flowing`, false while no audio moves through it, when `mutedBy` says who stopped it: `host`, the host's own Mute on a host that mutes the station, or `station`, a slider on the headset or the operating system, which the host observed and did not do. An adapter treats `host` as the agent's act on a call and `station` as a condition of the station. `unavailable` with `reason`, since each wants a different fix from the agent: `no-device`; `denied`; `not-asked`, which a host that asks at connect never publishes; `in-use`, a device present and permitted that another application holds — on an agent desktop the commonest of all; `lost`, a capture that ended. A host decides the reason from the devices before the error name: a browser can report a permission error on a machine with no microphone at all, and "grant permission" is the wrong instruction for an agent who needs to plug one in. `failure` carries the words Omni showed them. |
| `audio.output` | `available`, with `flowing` where the host can know whether audio reaches the speaker — a browser mostly cannot, and omits it; a native host reads the endpoint — false while it is silenced, when `mutedBy` says who did it, as on input. Or `unavailable` with `reason` — `no-device`, or `lost` for one removed — and `failure`: an agent who cannot hear is as unable to take a call as one who cannot speak. |

Omni republishes the report whenever it changes — a permission granted late, a headset unplugged,
a network gone — and it publishes a state, not a flicker: a change that resolves within moments is
not reported, so an adapter may act on what it reads without debouncing it again. Nothing in the
report is a task fact or a capacity fact; it is what the station can do, and the adapter's platform
is the one that knows whether an agent without a microphone, or without a speaker, can work.

The host's own obligations here — asking at connect, never publishing `not-asked` when it does,
publishing a state and not a flicker — are Omni's tests' to hold. `exerciseAdapter` holds the
other side: it validates the shape of whatever host a test hands the adapter, requires `audio` on
a softphone login and none elsewhere -- not on a desk phone, not off voice
(`context.host.audio.required` / `.unexpected`), holds `host.mute` to the same line (`host.mute.required`
/ `.unexpected`, `host.mute` for a third word) -- and refuses a voice adapter that never asked the
host anything (`connection.host.consulted`), and one that subscribed to nothing will never hear of a
change (`connection.host.subscribed`): the obligation has two halves, and each is held.

### Capacity around setup

Connecting is not the same as being able to take a call. A provider that treats a live connection
as reachability opens a window where it believes the agent is available and the agent is not yet
set up — the adapter's own registration incomplete, its credentials not yet renewed.

Nothing closes that window, because nothing opens it: **Omni states no capacity until the
connection is established**, and **Work is pulled, never pushed** makes an allocation with none
stated a violation. Capacity does not wait on the microphone: whether an agent without host audio
can take calls is the platform's question, answered by the adapter from the host's report, not by
Omni withholding capacity for every platform alike.

Capacity follows **automatically** once the connection is established; the agent does not press
anything to become available.

| Situation | What Omni sends |
| --- | --- |
| Connecting | Nothing. No capacity has been stated, so nothing may be allocated. |
| Connected and idle | `setCapacity({ count: n })`, with the host's report already available to consult. |
| A task starts or ends | Nothing. The provider counts its own against the ceiling. |
| The agent's provisioned capacity changes | `setCapacity({ count: n })` |
| Agent asks for a break | `requestBreak`. Capacity is unchanged and work continues. |
| Omni commits a break | `commitBreak`. The break stops allocation, not the ceiling. |
| Agent returns from break | `endBreak` |

**A break is not a capacity of zero, and neither is the reverse.** Capacity says how much of this
agent this provider may carry; a break says they are not working at all. A provider told
`count: 0` shows an agent whose capacity is elsewhere, `on-task`; a provider told a break shows
`on-break`. Collapsing the two would leave a provider unable to tell an agent working on another
provider from an agent who has gone to lunch, and only one of those needs a reason, a decision and
a return.

### How the agent hears the call

A voice platform can put an agent on a **softphone**, where the call's audio lands in the host
and Omni owns the microphone and the playback, or on a **desk phone**, a handset on the platform's
switch that the platform rings, where the host owns no audio and only shows the call. Which of
these a platform can do is a fact about the platform, and which one a login is on is a choice the
host makes for that agent -- so the manifest declares and the host chooses.

```ts
// Manifest: what the platform can do
phones: ["softphone", "deskPhone"]
// The host, at authentication and again at connect: which one this login is on
{ phone: "softphone" }
```

A voice manifest lists its `phones` and any other channel lists none (`manifest.phones.required`,
`manifest.phones.channel`). The host's `phone` is required on a voice login, absent on any other,
and one the manifest listed (`context.phone.required`, `.unexpected`, `.unsupported`). Everything
about audio then follows the phone rather than the channel: on a softphone the host reports its
audio, the adapter implements `openMedia`, and `task-media-started` is the word to open it; on a
desk phone the host reports no audio, opens nothing, and `task-media-started` still marks the
moment the call is live so the desk shows it, with the sound on the handset. A platform that lists
`deskPhone` alone never implements `openMedia`; one that lists `softphone` always does.

**The mode comes from the host; the status comes from the provider.** The host knows which kind
of station the agent signed in at, because the person chose it, and nothing else can know that.
The provider knows whether that station can carry a call right now -- whether a handset is
registered -- which a host in a browser cannot see. So the host's `phone` selects the branch, and
the provider's own knowledge of the device decides readiness within it. A provider never overrides
the host's declaration from its device record: treating a desk-phone login as a softphone because
the handset is momentarily unregistered, and demanding a microphone of it, is the reading this
sentence exists to refuse. What the provider does when the handset is not registered is what it
does for any station that cannot take a call -- hold the agent not-ready and say why.

**On a desk-phone login the host never calls `openMedia`.** There is no stream to hand over and
no audio to attach; a host that calls it anyway is in error, and an adapter that receives the call
answers `unavailable` with a non-retryable failure, since waiting changes nothing about a station
that is a telephone. The harness requires no `openMedia` of such an adapter and never calls it.

**Which handset a desk-phone login rings is the platform's configuration for that agent**, and
this wire never asks the agent for it: a host declares `phone` and nothing more. What a platform
asks on surfaces of its own is its own decision.

**A declared phone the platform does not permit for this agent is a login that cannot be
established.** The manifest says what the platform can do; the agent's record, kept by an
administrator, says what this agent is configured for, and the two can disagree with the host's
declaration -- a softphone declared for an agent whose record says desk phone. Honouring that
declaration on a switch that allows one registration per endpoint would evict the handset: the
agent's phone stops ringing and their calls land in a tab, and nobody is told. So the provider
refuses the login at authentication, with `omni.phone-not-permitted` and a message the host shows
-- "this agent is configured for a desk phone" -- and refusing is correct, not an override of the
host. It is a refusal, never a negotiation afterwards and never a quiet substitution, and it is
never retryable: trying again does not reconfigure the agent, and a host validating the answer
(`validateAuthenticationResult`) refuses a phone refusal marked otherwise
(`authentication.failure.phone.retryable`). And **a
provider never makes a declared phone true by changing the platform's configuration**: the record
is the administrator's, and a login is not a request to reconfigure an agent.

### Opening the audio

`openMedia` hands Omni the remote audio for one task. Every adapter whose manifest lists
`softphone` implements it, because on a softphone the call's audio lands in Omni:

```ts
openMedia({ taskId, localAudio }): Promise<OpenMediaResult>
// { status: "opened", session } | { status: "unavailable", failure }
```

The adapter speaks whatever its platform speaks — SIP over WebSocket, a vendor SDK, plain
WebRTC — and **none of that appears in this contract**. Registration, signalling, credential
renewal and reconnect are the adapter's, exactly as its authentication and transport already
are. Omni owns what belongs to the host: the microphone, the output element, mute, and when a
session ends — owning the microphone meaning capturing it, prompting, retrying and reporting how
it stands, never deciding for the adapter what a missing one means (see **The host reports, the
adapter decides**).

| Member | Contract |
| --- | --- |
| `remoteAudio` | `MediaStream` Omni plays. |
| `setMuted(muted)` | Mutes the agent's microphone on this session. |
| `close()` | Releases the session. Omni calls it when the task ends. |

`localAudio` is the agent's microphone as Omni captured it, the same stream the host's report
carries as `audio.input.localAudio`, and absent while that input is `unavailable`. A provider that
bridges audio without a host-side input may ignore it; one that needs it and finds it absent
answers `unavailable` with a failure Omni shows the agent.

**When to ask is the provider's word, not Omni's guess.** Omni opens media on `task-media-started`,
and on a task arriving with `media: "started"` on a snapshot; it closes on `task-media-ended` and
when the task ends. Between those words, nothing Omni's own senses report — a stream that drops, a
track that ends — moves the task or its audio.

**A task-scoped session does not oblige one call per task.** A platform holding a nailed-up
leg for a whole shift may return the same session for every task and release the underlying
path only when the connection closes. A platform placing a call per contact returns a new one
each time. Omni asks when it needs audio and closes when it is done; how that maps to the
platform is the adapter's business.

## Task commands

Command names follow the channel's operational vocabulary, and each channel's command is a union
discriminated by `type` — the same discriminant `executeTeamBreak` and `custom` already use. The
unions are declared under **Shapes**.

`taskId` is not repeated on the command. It travels on the `TaskCommandRequest` around it.

**A toggle carries the state it wants, not a flip.** Inverting whatever is found cannot converge
with a stale view: a flip against a state the provider has already changed turns something on and
then off again. A custom `toggle` control therefore carries its own boolean. `hold` and `resume`,
`pause` and `resume` need no flag, being pairs rather than toggles.

**`complete` sends a disposition only where one was published.** `disposition` is a
`DispositionCode.id` from the task's own `dispositions` capability, and `notes` obeys that
capability's `notes` setting. A task publishing no codes still receives `complete`, with neither.

### Where a command executes

Every command reaches the provider through `execute`, with no branch at the call site, and every
command asks the provider to **perform** something: `hold`, `transfer`, `conference`, `end-call`,
`recording` and the rest act on the platform's own call leg, its bridge, or its record of the
task. Nothing has happened until the provider applies them, and `failed` means nothing happened.

**The provider performs every action; the host only offers it.** A control drawn on the host is
an affordance, never the enforcement: the host asks, and the provider does or declines. A provider
answers `failed` for a command whose capability it did not publish, and that is the provider
honouring its own declaration, not the host deciding policy -- a host that refuses a command on
its own reading of a queue's flag has decided something that was never its to decide. What a
command means on the platform is the provider's to work out: `end-call` ends the conversation, and
which legs on which bridge that touches is a fact about the switch, never a choice the host makes.
The one thing the host performs physically is the microphone, and that is not a command at all.

### The station is the host's

The microphone, the speaker, the headset and its buttons are the station's, and the station is the
host's. So mute is not a capability a provider declares, not a control a queue allows or a team
locks, not a preference the person keeps with the provider, and not a command: nothing about the
station crosses to the provider except two things -- the station's condition, in the host report,
and the record of when the agent could not be heard, through `recordStep`. A host offers Mute on
every voice task with media open, under its own provisioning, in `in-progress` and `paused`
alone, and performs it through `VoiceMediaSession.setMuted()`. A task carrying
`capabilities.mute` is refused (`task.capability.unknown`), and so is a `mute` command
(`command.type`), a `mute` preference (`preference.id`) and a `mute` policy (`team.policy.key`).

**Two mutes, and the host states which its Mute performs.** A *stream* mute stops the audio the
host sends: the microphone keeps capturing, the party hears silence, nothing else on the machine
changes, and every softphone host can do it. A *station* mute silences the microphone itself at
the operating system: every application on the machine goes quiet, the system shows it, and a
headset that follows the system follows it. Only a native host can do it. `Host.mute` says which
this host does -- `stream` or `station` -- stated on a softphone login, where the host holds the
microphone, and absent on a desk phone and off voice (`host.mute.required` / `.unexpected`). A
browser says `stream`. A native host says whichever it does. Nothing on the wire says what kind of
application the host is; a provider reads only what the host declared.

**A silenced device says who silenced it.** `audio.input.flowing: false` and
`audio.output.flowing: false` carry `mutedBy`: `host` when the host's own Mute did it -- which is
only ever true of a host whose mute is `station`, since a stream mute leaves the microphone
flowing -- and `station` when a slider on the headset or the operating system did, which the host
observed and did not do. Without the word, a station-muting host's own Mute would read as a fault
and an adapter would take the agent out of ready in the middle of a call. A browser reads a station
mute through the capture track's muted state, read-only, and cannot lift it; a native host reads
the endpoint and can clear an operating-system mute. A hardware slider is nobody's to clear.

**The record carries the same word.** A `muted` handling leg is a period the agent could not be
heard, and the record exists so that period is not a hole. The host reports every such period
through `recordStep` -- its own Mute, and a station mute it observed during a call -- with
`mutedBy` saying whose the silence was, and the provider writes the word into the entry
(`task.handlingHistory.mutedBy`). The report names no agent because the host has exactly one, and
the provider knows who that is: it attributes the leg to the login's agent in `by`, a fact it
holds and not an inference, for a station mute as much as for the host's own. An unattributed
`muted` entry is refused (`task.handlingHistory.muted.by`); a shared handset's unattributed hold
is a different claim, and stands. A supervisor reading the record then sees "the agent muted for
forty seconds" and "the agent's headset was muted for forty seconds" as the different things they
are. See **The host records what it performs**.

**Mute has a lifecycle, and none of it is inferred.** A call that starts while the station is
already muted begins a `muted` leg the moment its media starts, `mutedBy: "station"`. Media that
ends while any leg is open ends the leg at that instant, as every host-performed leg ends. And the
host's own Mute starts off on every call, which is every `task-media-started` -- a connect-back
opens a second call on the same task with no offer -- so an agent is never muted by the call before.

**Every press on a headset is the agent's own press**, performed the host's way, and the lights
follow the host's state. The `personConsent` guarantee is honoured by a hook-switch press exactly
as by a click. What a call-control headset sends, and what becomes of it:

| Input | Where it comes from | What the host does | What crosses to the provider |
| --- | --- | --- | --- |
| Mute button | The headset, on the HID Telephony usage page: a Phone Mute report on the press, a Mute LED the host writes back | A press of the host's Mute, performed the host's way; the LED follows the host's state, so button, light and control are one state with one owner | The `muted` leg, `mutedBy: "host"` |
| Hook switch | The headset, HID Telephony | A press of the host's Answer or End call, only where the task is in a phase that has one; the off-hook and ring lights follow the task | The existing `answer` and `end-call` commands |
| Flash, redial, speed dial | Older headsets and desk-phone style devices | Flash is Hold and Resume where the task offers `hold`; redial and speed dial map to nothing on a desk with no dial pad on a transfer, and are ignored | Nothing new |
| Volume up and down | The headset's own amplifier, or the operating system through the consumer-control keys | Nothing: the device and the system handle it | Nothing, except that a speaker at nought is `audio.output.flowing: false` where the host can know it |
| Microphone gain and level | The operating system, the headset's own boost | A level meter, so the agent can see they are heard | Nothing: a level is a flicker, not a state |
| Hardware or operating-system mute | A slider on the headset, the system's input mute | Observes it, publishes `flowing: false, mutedBy: "station"`, records the leg during a call, and tells the agent which it is where it knows -- headset or system -- and what to do; a host whose mute is `station` clears a system mute itself, a browser can only say so | The report and the leg |
| Device changed, unplugged, permission revoked | The operating system | Re-capture, prompt, report | Already `audio.input` and `audio.output` with `lost`, `denied`, `no-device` |

**What the host shows.** Beside Mute, a standing line while the station is muted, saying which and
what to do, with a button that clears a system mute only on a host whose mute is `station`. The
Mute control does not pretend: while the station is muted it shows the agent cannot be heard and
that pressing it will not change that, and a press still toggles the host's own mute, so the two
states stay separate and the agent is not unmuted by surprise when the slider moves back. Before a
call, the same line in the ready state, so an agent does not learn of it from a silent customer;
whether work is held back is the adapter's decision from the report, as it is for every station
fact. Where a provider's own platform holds a mute of its own -- a bridge that silences a leg --
that is a fact about the switch, reported as the provider sees fit, and never the host's Mute.

### Which commands need a capability

**Presence is the permission** gates the controls a provider chooses to offer. Four commands are
not among them, because every task has them; each is authorized by a different field the provider
declared:

| Command | What makes it available |
| --- | --- |
| `answer`, `accept` | Nothing. A task that was offered can be accepted, or offering it meant nothing. |
| `end-call` | The `endCall` capability. |
| `conference` with `action: "remove"` | The `conference` capability, and somebody else on the call: a remove that would leave the agent alone is `end-call`, and a provider answers it `failed`. |
| `decline` | The `decline` capability on any channel, **and** Omni provisioning permitting it. One word for refusing an offer, whatever the channel. |
| `call` | The `preview` phase. A record put in front of an agent is there to be called, so the phase is the gate and there is no capability. It is a dial, with a `dialId` and a `dial-outcome`. |
| `complete` | `completionMode: "agent-command"`. The `dispositions` capability decides whether a code travels with the command, never whether the command exists — a task Omni cannot complete never ends. What travels is what the capability published: a code from its list where it has one (`command.complete.disposition.unknown`), a code at all where it requires one (`.disposition.required`), notes as it said (`.notes.required`, `.notes.unexpected`), and neither where the task declares no dispositions (`.disposition.unexpected`). |
| `connect-back` | The `connectBack` capability **and** the `completing` phase. It exists to reach the party again after the call, so it has no meaning while the call is up. |
| `transfer` with `action: "warm"` | The `warmTransfer` capability. `action: "cold"` is gated by `coldTransfer`; the two are declared and offered separately. |
| `transfer` with `action: "complete"` or `"cancel"` | A consultation in progress -- a `consulted` entry on `Task.onCall`. Without one there is nothing to complete or cancel, and a provider that receives either answers `failed`. |
| `lead-assist` with `action: "request"` or `"cancel"` | The `leadAssist` capability. `cancel` needs a request standing -- `Task.leadAssist` with status `requested`. |
| `lead-assist` with `action: "take-over"` or `"leave"` | The lead's own task, on a call they joined -- `Task.assisting` present. An agent's task never has it, and a provider that receives either without it answers `failed`. |
| `transfer` with a destination, `conference` with `action: "add"` | Its capability, and a `destinationId` the directory offered: the id Omni sends is the id the provider published (`command.destination.unknown`). |
| `custom` | A control the task published under `capabilities.custom`, by its `id` (`command.capability.custom`), carrying every field the control's `prompt` asked for (`command.custom.prompt`). |
| Everything else | Its own named capability. |

**A control on the contact belongs to the handling phases**, `in-progress` and `paused`:
`hold`, `resume` and `pause`, `end-call`, `recording`, every `transfer` and `conference` action, and
every `lead-assist` action. Each acts on the call or the conversation, and only while there is one.
Before `in-progress` nothing has been placed or opened; in `completing` the handling has ended -- a
call with nobody on it, a conversation closed -- and a wrap-up that still shows Transfer shows it
for nothing. The capability stays declared, because it is a property of the task and the task is
still open; the phase says there is nothing to use it on. Omni shows none of these controls outside
the two phases, and `validateTaskCommand` refuses each of them there (`command.phase.handling`).
The commands with a phase of their own -- `answer`, `accept` and `decline` in `pending`,
`call` in `preview`, `connect-back` in `completing`, `complete` in any -- are not among them.

`validateTaskCommand(command, task)` holds a command to this table at runtime, both ways: the
capability it needs, the phase it belongs to, and the state that has to stand. The task it wants
is the one the provider published, not a host's own mapping of it: a host that keeps only its
mapped shape has nothing honest to pass, and then checks shape alone, which is still worth doing
-- it names a command the wire never had -- but is not the table. Keeping the published task
beside the mapped one is what the full check costs a host; an adapter has it for free. The
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
| `omni.task-not-found` | The provider-local task id is unknown, typically after the task already ended. |
| `omni.phone-not-permitted` | The host declared a `phone` the platform does not permit for this agent -- a softphone for an agent configured for a desk phone, or the reverse. The login is refused at authentication, and the provider never reconfigures the agent to make the declaration true. See **How the agent hears the call**. |
| `omni.destination-not-permitted` | The dialled number, or the `destinationId` named, is not one the provider offers this agent. |
| `omni.rate-limited` | The action was throttled. Pair with `retryAfterMs`. |
| `omni.unavailable` | The provider is temporarily unable to serve the action, including any command sent while `transport-status` is not `active`. |
| `omni.break-already-committed` | Cancellation lost the commit/cancel race; Omni must finish commit recovery. |

They are published as `OMNI_FAILURE_CODES`.

## Event delivery

### `ProviderEventEnvelope`

| Field | Contract |
| --- | --- |
| `id` | Required identifier for this event, unique within the login. Omni does not act on it; it exists so a host log line and an adapter log line can be matched when something has to be traced. |
| `loginId` | Login session that produced the event. Omni rejects any other value, which only reaches it if an adapter kept an old connection emitting after a re-login. |
| `occurredAt` | Valid RFC-3339 timestamp with an explicit timezone, representing provider observation time. |
| `event` | Typed `ProviderEvent` payload. |

#### Provider instants are read against a provider clock

Every deadline in this contract is a provider instant that Omni counts down: `allocationExpiresAt`,
`previewEndsAt`, and the wrap deadline of `task-media-ended` plus `wrapAllowance` where
one is stated.
Comparing those against the host clock is wrong by whatever the two machines disagree by, and the
damaging direction is early — **Accept** withdrawn from an offer still ringing, a wrap timer
expiring before the agent has finished.

`occurredAt` is what fixes it. Omni notes the host time at which each envelope arrives, keeps the
running offset against the `occurredAt` inside it, and translates provider instants through that
offset before counting down. What remains is network delay, which biases every deadline later —
the direction that costs a second rather than an action.

**Report `seconds`; never expect Omni to derive it** is the same hazard from the provider's side:
neither party recomputes a duration across a clock it does not own.

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
current status, break state, tasks, contacts, scheduled activities and team roster with this
snapshot. It carries what the login's capabilities call for — a roster for a lead, on every
snapshot — and nothing they do not; a capability is withdrawn by a republished `authenticated`,
never by an omission from a snapshot.

### `transport-status`

Updates `TransportStatus`, and carries an optional `message` that may explain an error but must be
safe for the agent to see.

| Value | Contract |
| --- | --- |
| `connecting` | No usable transport right now, and the adapter expects to recover on its own. Nobody needs to act. Startup and every reconnect pass through this value. |
| `active` | The transport is up and the provider is serving this session. It is the only value under which work arrives. |
| `error` | The adapter cannot serve the session and is not simply mid-reconnect. Say why in `message`, and say what revives it in `recovery` — required here, forbidden on any other status. It is not terminal: an adapter that recovers on its own still reports `connecting` and then `active`, and one that cannot is revived as `recovery` says. |

**An error names its recovery, and the host acts on that word.** The adapter knows why its session
died; the host knows how to run a login. `recovery` joins the two:

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

**Patience is the host's.** An adapter in `connecting` retries for as long as it takes and never
has to decide when to stop. Omni owns giving up: after however long it chooses to wait, it may
call `disconnect()` and either `connect()` afresh or surface the failure — so neither side waits
for the other to blink.

**`transport` is about the transport, nothing else.** It does not say whether the agent is available,
whether they are on a break, or how much work they can take: capacity travels on `setCapacity`,
availability on `BreakState`. Nor does it carry authentication — a session that expired reports
`expired` on `AuthenticationState` and fails actions with `omni.not-authenticated`, while
the transport underneath may be perfectly `active`. Provider login identity likewise belongs to
authentication state, not here.

**Only `active` means work can arrive.** Omni stops expecting allocations in any other value, so an
adapter that leaves a stale `active` in place is telling Omni to keep waiting for work that cannot
come — see **Liveness**.

**The status is seen, not merely known.** A host renders the transport's status where the agent
works — `connecting` from the moment it is reported, `error` with what revives it — and never a
healthy workspace over a transport that cannot serve it: an agent talking on a desk whose transport
died was an incident, and it happened because the desk knew and did not say. The same obligation
covers a `diagnostic`: shown where the agent works, and counted.

### `break-state`

Replaces this provider's complete `break` object. Its `approval` uses the canonical
`not-requested`, `awaiting-decision`, `granted`, `starting-after-task` and
`in-effect` states defined under Breaks; the event also carries the corresponding may-ask state,
reasons, retry details, and any imposed break.

Each state is also held to the one before it. A commit's states, `starting-after-task` and
`in-effect`, follow a grant — the one arrival in a committed state nobody asked for is a placed
break, which says so with `imposed`: in effect at once, or `starting-after-task` while the member
finishes the call they are on (`stream.breakState.commitBeforeGrant`); and a break never moves backwards —
from `in-effect` or `starting-after-task` to a grant or a request, or from `granted` to
`awaiting-decision` — a new request passes through `not-requested` (`stream.breakState.backwards`).
`exerciseAdapter` holds the stream to that from the connect snapshot on;
`assertBreakFollowsItsRequests` holds any sequence.

For a multi-provider break attempt, "every provider" is the set of providers frozen when the
attempt entered `requesting-break`. Omni commits only after every asked provider reports `granted` —
that one is unconditional, because nothing has stopped yet and waiting costs only time. It enters
`on-break` once every kept provider reports `in-effect`; the commit bound decides who is kept,
setting aside a provider that has not applied the commit rather than holding a break that has
already begun elsewhere. Otherwise it follows the two-phase rules under **Coordinating a
multi-provider break**.

### `task-offered`

Offers a task to Omni without a separate offer acknowledgement. An offer does not accept
the task: when its phase is `pending`, Omni applies `autoAcceptTasks` and the task's
`acceptance`. `task-offered` must not introduce a task as `in-progress`; only a reconnect or
resync snapshot may report work already in progress. The provider should include the task in later
snapshots until it ends.

### `task-updated`

Replaces the current representation of one provider-local task. It is a full task value, not a
partial patch.

### `task-media-started`

The provider's word that the task's audio should now attach. Omni calls `openMedia` on it — and on
a task carried with `media: "started"`, which is how a reconnect snapshot reattaches audio an
earlier event brought — and renders the call as live from that word, never from its own senses. It
precedes `openMedia` and is never a reply to it: a provider whose media state comes from the
platform, a station going in use the moment a call is answered, sends it then, before any host has
opened anything, and `openMedia` has its own answer for what the host did. It
names a task whose work has begun, and it alternates with `task-media-ended`: media that never
started cannot end, so a live call whose provider says nothing about its audio is a provider in
breach, not a state a desk fills in from its own devices.

The event is the transition and the task's `media` field is the state. A `task-updated` re-states
the media its task already holds — republishing `started` on a hold is a statement, not a second
arrival — but it does not move it: an update that itself flips the field is refused
(`stream.taskUpdated.media`), and the pairing at the moment audio arrives is the phase change
without the field, then the event. Releasing `ended` is the one move an update may make, since
wrapped audio has nothing left to end.

### `task-media-ended`

Signals that a task's real-time media ended. For voice and similar channels, this starts the fixed
completion timer. It does not remove the task, and it ends only audio that `task-media-started` — or
a task carried with `media: "started"` — attached.

### `task-ended`

Every outcome ends the task for this agent. On `task-ended`, Omni:

- removes the task from its current provider view;
- clears the task workspace when it is selected;
- stops task timers and media;
- releases task-scoped resources; and
- selects another task or returns to the idle workspace.

A `left` outcome ends the task for this agent alone: the call continues without them, as it does
when a lead who joined it leaves -- see **Lead assist**.

A successful `complete` or `transfer` command does not clear the task. Omni waits for `task-ended`,
and not for ever: `applied` to a disposal -- `complete`, or a lead's `take-over` -- says the
provider has disposed of the task, and its `task-ended` follows within the
manifest's `disposalSettleMs`. A provider never answers `applied` for a disposal it has not yet
performed. Past the bound the host calls `snapshot()`: a snapshot still carrying the task is a task
held open by a provider that said it was done, and the desk shows it as unsettled -- "Completing...
the provider has not confirmed" -- naming the command; a snapshot no longer carrying it clears the
task, since the ending was owed and lost. The drive holds a provider to the same bound
(`drive.disposal.unsettled`). The `task-media-ended` event and the `completing` phase are likewise
non-terminal. A replacement
snapshot that no longer contains the task also clears it. Repeated `task-ended` delivery with the
same envelope ID is harmless, and a `task-ended` naming an allocation that has already ended is
recognised as the late event it is, never applied to the life now open under the same id.

### `dial-outcome`

How a dial the host placed ended, once, either way, named by the `dialId` the host sent: `answered`,
or one of the declared ways of not reaching the destination, with the switch's `reason` where it
gave one. `taskId` names the task the dial was on, where there was one, and that task may already
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
`taskId` names the task where there is one. **Informational, never behavioural**: the provider has
already done the safe thing before it speaks, and nothing in the task or break machinery reacts to
a diagnostic. It exists so that the loudness reaches a person — a host renders each one where the
agent works and keeps a count an operator can read, because a healthy workspace over a shouting
console is the silence problem one layer up. One event per occurrence; the host counts, the
provider does not batch. `exerciseAdapter` treats a diagnostic delivered during a run as a
violation (`diagnostic.raised`): a conformance run against a platform that is breaking its rules
fails loudly rather than passing with a note. A task published under `capabilitySource:
"undetermined"` is the same kind of fact, stated on the task instead, and fails a run the same way
(`capabilitySource.undetermined`); see **Task capabilities**.

| Field | Contract |
| --- | --- |
| `expected` | Required. The rule that was broken, as a sentence a person can read. |
| `observed` | Required. What the platform answered instead. |
| `taskId` | Optional. The task concerned, where there is one, with its `allocationId` beside it: a task is named with its life, and an allocation never alone. |

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

Replaces this provider's complete `TeamRoster`. It is emitted only for an agent the provider
publishes a roster to, and it carries the whole team every time — never a change to it, for the
reason set out under **Team leads**. A lead's snapshot always carries the roster; it goes only when
a republished `authenticated` no longer declares `capabilities.team`.

### `contacts-updated`

Replaces this provider's complete contact contribution. It is emitted only when the manifest declares
the `contacts` idle capability.

### `calendar-updated`

Replaces this provider's complete scheduled-activity contribution. It is emitted only when the manifest
declares the `calendar` idle capability.

## Utilities

### `taskKey(providerId, taskId)`

Returns a collision-safe global task key by encoding and joining the provider-local identifiers.
Use this key in Omni state; never assume task IDs are unique across providers.

### `userKey(providerId, userId)`

The same treatment for a `UserId`, and needed for the same reason: user identifiers are
issued by each provider independently, so two providers will eventually issue the same string for
different people. Encode and join before storing or comparing.

Use it for every `UserId` — `handlingHistory[].by`, roster members, `memberId` on a
lead command, `ImposedBreak.by`. A bare one is only ever compared against another from the **same** provider; anything
wider goes through this key.

### `sameCapabilities(a, b)`

Whether two logins declare the same capabilities, field by field — key order aside, and with
`team: {}` distinct from `team` absent. It is the comparison an adapter makes before republishing
`authenticated`, and the one `exerciseAdapter` holds `refreshing` to.

## Runtime validation

Structural rules in this document are executable through the runtime validators Omni applies to
adapter output. Behavioral rules are exercised through deterministic conformance scenarios. The
same exported checks are used by Omni and adapter tests so their interpretations do not drift.

| Function | Validates |
| --- | --- |
| `validateManifest(manifest)` | Identity, protocol-version interoperability, authentication methods, and idle-capability shapes. |
| `validateTask(task, { channel, locked? })` | Identity, channel agreement, phase, wrap allowance, capability shapes, custom controls, and browsers. Given `locked`, the values the queue locked, a task whose party stands locked carries none of them anywhere else (`task.locked.leak`). |
| `validateSnapshot(snapshot, manifest)` | Status, break state, break reasons, team roster, the stated `taskCount` reconciled against the tasks carried, and every task, contact, and activity, including idle-capability gating both ways: a contribution the manifest never declared is refused, and one it declares is required, `[]` included. |
| `validateEventEnvelope(envelope, manifest)` | Envelope identity, timestamp, and the payload for each event type. |
| `validateContact(contact)` | Contact field shapes and attribute keys. Every field is optional, so this checks what is present rather than what is missing. |
| `validateScheduledActivity(activity)` | Required activity fields and start/end ordering. |
| `validateHostGuarantees(guarantees)` | What a host promises: only the guarantees this contract names, each declared by presence and never `false`. The harness validates the guarantees of whatever host a test hands the adapter. |
| `validateHandlingReport(report, path?, manifest?)` | What the host reports of a leg it performed, for an adapter to check before forwarding: a task, a step, when it began, a positive `seconds` where stated, and an explicit `ended` that carries the final duration. Given the manifest, a running report is refused unless it declares `runningStepReports`. |
| `validateHostReport(report)` | The host's own report as published to an adapter: `online`, and where there is audio, an input that is `available` with the microphone and `flowing`, or `unavailable` with a reason and the failure that says why, and an output that is `available` or `unavailable` with its failure. The harness validates whatever host a test hands the adapter; `stillHost(report)` builds one that never changes. |
| `validateHostMute(mute, softphone)` | What the host's Mute does, stated on a softphone login and nowhere else: `stream` or `station` (`host.mute`), required where the host holds a microphone (`host.mute.required`) and refused where it does not (`host.mute.unexpected`). The harness holds `ConnectContext.host.mute` to it. |
| `validateLoginStore(store)` | The login's store the host hands every connection: an object with `get`, `set` and `delete` (`store.shape`, `store.get`, `.set`, `.delete`). The harness holds `ConnectContext.store` to it. |
| `validateCapacity(capacity)` | What the host states as capacity: a whole number of zero or more (`capacity.count`), zero being host-stopped. The harness states one on connect and two, one and zero after the drive, each answered `applied`, and holds any offer to the count in force (`stream.taskOffered.overCapacity`). |
| `validateAuthenticationResult(result, method)` | What `start()` or `complete()` answered: a challenge or a rejection, a login or a rejection. A rejection's failure is held to its rules -- an `omni.` code the contract lists, and `omni.phone-not-permitted` never retryable, since the agent's station is configuration. `validateAuthenticationFailure(failure)` is the same check on a failure alone. |
| `validateTaskCommand(command, task?)` | What a command needs to be issuable, against the task it names: its own shape -- a dial's `dialId`, a transfer's item, a remove naming exactly one person -- and, with the task, the capability the table above gates it on (`command.capability.<name>`, `.locked`), the phase it belongs to (`command.phase.*`, `command.phase.handling` for every control on the call or the conversation), and the state that has to stand: a consulted entry, a lead requested, somebody else still on the call (`command.conference.remove.alone`). A host validates before sending and an adapter before acting. |
| `validateResult(result, method)` | What a connection method answered: the status it gives, a failure where the status says so and nowhere else, the failure's shape, and that an `omni.` code is one this contract names. |
| `validateAuthenticationState(state)` | The identity each state must carry, the capabilities a usable login declares, and the expiry that only `authenticated` may. Omni applies it to every state a session publishes — the republished as much as the first. |

Each returns `ProtocolViolation[]` rather than throwing, so a caller can report every problem at
once. A violation carries a stable `rule` id such as `task.browser.url.scheme`, the `path` it was
found at such as `snapshot.tasks[0].browsers[1].url`, and a `message`.

Some rules need to know who is reading. `validateTeamRoster`, `validateSnapshot`, and
`validateEventEnvelope` take an optional final `{ self, capabilities }` — the signed-in agent's
`AuthenticationState.identity.id` and their login's `capabilities`. Given `self`, a roster that
carries that agent reports `team.member.self` or `team.request.self`. Given `capabilities`, a lead's
snapshot without a roster reports `team.required`, a roster published to a login that does not lead
reports `team.unentitled`, `requests` on a roster whose login lacks `team.leadAssistControl` reports
`team.requests.capability`, and a roster without them on a login that declares it reports
`team.requests.required`. Without them those rules are not checked, because they cannot be.
`exerciseAdapter` always passes both.

`assertNoViolations(violations)` throws `ProtocolConformanceError` — which carries the full
`violations` array — when the list is non-empty.

**Omni must validate at runtime, not only in tests.** An adapter is loaded from a separate package
and may be compiled against a different protocol version, so its output is untrusted input.
Validating a snapshot before it replaces provider state is what stops a malformed task from
reaching the workspace.

### What the host does with what it refuses

A refusal has an aftermath on the desk and a report to the provider, and both are stated.

- **A refused snapshot replaces nothing.** The host keeps the last state it took from this
  provider whole, and shows the provider as faulted -- the transport as it stands, and the words
  "last update refused" with the rule -- so the agent knows the view is standing still rather than
  believing it current. It does not adopt the good half of a snapshot: a task the agent is on would
  vanish from the desk while the call is up.
- **A refused event is dropped and counted.** The state the host holds does not move for it. The
  provider is told, and may republish a corrected state or raise a `diagnostic`; the host retries
  nothing. The desk shows nothing for it: the view kept moving for every other event, so "last
  update refused" would be false of it, and a chip that said nothing would be right about the
  transport. Counted, and the provider told, is all a host can truthfully do for one event.
- **The provider is told, every time.** `refused(report)` carries the artefact, the envelope id for
  an event, and every violation with its rule and path. An adapter logs it at error and treats it as
  its own defect until shown otherwise: what the host refused never reached the agent, and a
  provider that hears nothing runs a whole shift beside a frozen desk with nothing wrong on its
  side. The harness tells an adapter under test exactly as a host does
  (`connection.refused.required`, `connection.refused.rejected`).

## Conformance helpers

### `exerciseAdapter(adapter, context, options?)`

Adapter conformance exercise from `@xema/omni-protocol/testing`.

It validates the manifest, opens an authenticated session, connects, checks required capability
methods, subscribes, validates the snapshot, every delivered event, and every authentication state
the session publishes during the run — each against the latest login, since capabilities are
current, not fixed — states a capacity, then unsubscribes and disconnects. Provider packages should
run it with a deterministic test transport and authentication state.

By default it throws `ProtocolConformanceError` listing every violation. Pass
`{ collectOnly: true }` to receive them on the result instead:

```ts
const result = await exerciseAdapter(adapter, context, { collectOnly: true });
expect(result.violations).toEqual([]);
expect(result.disconnectWasClean).toBe(true);
```

`result.authenticationState` is the state the session was restored with; `result.login` is the
latest the session published during the run, which differs only when the adapter republished
`authenticated`. A published state that fails validation is reported and not adopted, and a
`refreshing` state must carry over the login it refreshes — a different identity is
`authentication.refreshing.identity`, a changed capability set `authentication.refreshing.capabilities`.
A capability granted by a later login requires its methods just as one declared at sign-in does.

`result.notExercised` lists what the run never reached — one subject per family of rules: each
optional part of a task (`task.browsers`, `task.handlingHistory`, `task.leadAssist`, …), the break's
`reasons` and `imposed`, the roster's `members` and `requests`, each declared contribution, and
each event type (`event.task-ended`, …) — and so what a clean `violations` says nothing about.
Nothing there is a violation: an adapter with no team has nothing to exercise. But a fixture with
no tasks exercises no task rule, and a pass over it reads as coverage it is not.

**A static run never answers a call.** It states a capacity and disconnects, so everything
downstream of `answer` -- the room, the stage, media, every phase past `pending`, every dial
outcome -- stays in `notExercised` for every adapter, and a rule about a live call is enforced only
in each adopter's own tests. `{ drive: true }` closes that: the exercise takes the first task the
provider offers through one ordinary lifecycle -- accept it, wait for its media and open it on a
softphone, hold and resume where the task offers `hold`, end the call where it offers `endCall`,
complete it with a disposition where the agent completes -- and holds every step to the rules a
host holds a provider to. Each command is validated against the task as published
(`drive.command.*`), each answer for its method, a refusal of a control the task offered is a
violation (`drive.command.failed`), and an event the provider owes and never sends is one too
(`drive.timeout`, after `driveTimeoutMs`, 5000 by default). Around the drive the exercise holds
the run to what a host holds a provider to between commands: an offer before the host stated
capacity, or beyond the count with nothing dialled on it, is named
(`stream.taskOffered.beforeCapacity`, `.overCapacity`); every user the snapshot names is looked up
through `describeUsers` and the answer held to the shape, nobody unasked, nobody described as
nothing (`describeUsers.user.*`, `describeUsers.unasked`, `connection.describeUsers.empty`); and
the second adapter a `rebuild` gives comes up signed in as the same login from the secrets alone
before it reads anything (`drive.reload.login`), and is then held to everything the first was on
connect: the methods its declarations call for, the host's report, a capacity stated to it, its
snapshot read as the connect snapshot was, and its media opened afresh on a task carried with
`media: "started"`, since the first client's session died with it. The result also says which rules the
run evaluated, pass or fail, in `rulesEvaluated`: the validators' as each was applied, the stream's
as each case was considered, so a test that needs a rule to have run asserts it there rather than
inferring it from an empty `violations`, and a rule absent from it was never looked at, which is a
gap and not a pass. With the audio open on a softphone,
the drive mutes it for one second and reports the leg through `recordStep`, begun and then ended,
expecting each report `recorded` (`drive.recordStep.failed`, `.rejected`); then it mutes again and
ends the call muted, as agents do, so the leg is open when the media ends, the provider closes it
in the completing publication or the open entry is refused (`task.handlingHistory.muted.open`),
and the drive's closing report after the media ended is expected `recorded` and to change nothing:
a record restated afterwards with that leg's duration altered is named (`drive.recordStep.overwritten`).
Where the provider restates the task's record afterwards, each leg is in it or the hole is named
(`drive.recordStep.history`). Given `rebuild`, a way to build the adapter again as a host reload
does, the drive reloads the host as a reload happens: the first client is unsubscribed,
disconnected and its session closed (`drive.reload.handover`), and only then is a second adapter
built and connected for the same login with the same context and the same `store`; its snapshot
must carry the task with that leg and the host's word, and the run goes on with the second as its
connection to the end. A platform that holds the record hands it back, and an adapter that composed
the record in memory has nothing and is named (`drive.reload.snapshot`, `drive.reload.history`,
`.rejected`). The second adapter's snapshot is taken as any resync is: held to what the stream knew
before it replaces it, so a phase gone backwards, a record that shrank or audio forgotten on a task
still at work is named by the stream's own rules (`stream.snapshot.phase`, `.handlingHistory`,
`.media`) and a reload is a place those rules keep working, not one where they stop. The second
adapter is held to what the first was: the same provider
(`drive.reload.manifest`), a snapshot that stands as any snapshot must, and a record that lost none
of the entries the first had published -- a record once read is not unread across a reload either.
A reconnect on the same adapter object would prove nothing, since an in-process adapter's memory
survives it; only a second object separates kept-in-the-store from never-lost. And because the
first client is gone before the second connects, there is no client for the platform to push the
open task back to, and nothing about the reload is exempt from any rule. The second adapter opens its session from the same
`secrets`, so the reload is a restore before it is anything else: an adapter that holds a session
has already put what would rebuild it into the secrets store, from the moment it was handed one,
not only when a flow completes -- the session is the adapter's, the store is the host's, and a
host reload is exactly when no flow will run. And once the task has ended, the store the drive
handed the adapter holds no key naming the task's id, delimited, never as a run of characters inside
another id (`drive.store.retained`); an adapter whose keys never named the task leaves the rule
unevaluated, and the result says so rather than passing it: a task's keys go
with the task, or the next offer of the same id inherits them. Outside the
handling phases with `hold` still declared -- in
`confirmed`, where the provider publishes it, and in `completing` once the call has ended -- the
drive sends `hold` past the validator that would hold it back, and expects `failed`: the adapter
is the second gate on a control on the contact, and one that applies it where there is nothing to
hold is named (`drive.command.handling`). The drive cannot put a task into a phase the provider
never publishes, so a provider that goes straight from `pending` to `in-progress` is checked in
`completing` alone. A task the agent completes is
completed from wherever it stands once the drive has nothing left to do on it -- from `completing`
after an `end-call`, or from `in-progress` where there is no call to end, which is every chat and
email and a voice task offering no `endCall` -- so a conversation reaches its end as a call does.
The drive stops where the task offers no way on and says nothing about what it could not reach. A
softphone adapter written for a browser needs its media APIs supplied by whatever runs the
harness: the drive opens media outside a browser, and a provider that quietly stopped carrying audio
where `AudioContext` was missing would be lying about the one thing the channel is for. It is off by default because it issues
commands against whatever platform the adapter is connected to: turn it on against a test backend.

```ts
const driven = await exerciseAdapter(adapter, context, { collectOnly: true, drive: true });
expect(driven.violations).toEqual([]);
assertReached(driven, ["task.onCall", "task.media", "event.task-ended"]);
```
`assertReached(result, subjects)` is the paired assertion: it throws naming every subject the run
never met, so a test that meant to check a roster cannot pass on a fixture that never produced one.
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
| `assertCapabilityWithdrawal(states, snapshot, manifest)` | A capability withdrawn by a later `authenticated` state is gone from the next snapshot: no roster for a login that no longer leads, no requests for one that may no longer join. Every state is validated on the way, `refreshing` must carry the login over, and the sequence passes only through usable states. |
| `assertTaskCapabilityWithdrawal(tasks, manifest, command)` | A capability withdrawn by a republish of the task is gone from the task: every task in the sequence is validated, all carry the offer's id, at least one capability the offer declared is absent at the end (a locked control is present, not withdrawn), and `command` is clean against the first task and refused against the last for want of a withdrawn capability and nothing else. Pair it with `assertCommandRefusedAfterWithdrawal` on the provider's answer. |
| `assertCommandRefusedAfterWithdrawal(result)` | A command that arrives after its capability was withdrawn fails with `omni.capability-not-enabled`, named by the provider. The same assertion serves a command the provider never supported under a capability it declares. |
| `assertReached(result, subjects)` | The exercise met every subject named; throws listing those it did not. Pair it with a clean `exerciseAdapter` result. |
| `assertAuthenticationRestoreAndExpiry(states)` | A restored authenticated session can refresh and ends in expiry. Every state is validated. |
| `assertReconnectWithMissedAssignments(before, reconnect, ids)` | A reconnect snapshot restores assignments received while offline. |
| `stillHost(report?, guarantees?, mute?)` | A host that reports one thing and never changes, for a test context: `{ online: true }` by default, a report with audio for a softphone voice adapter, and never for a desk phone. |
| `TaskStream`, `BreakStream` | The cross-event models the harness applies after the connect snapshot, exported for a host that wants the same rules at its boundary: `seed(snapshot)`, then `apply(envelope)` returns the violations. |
| `assertBreakFollowsItsRequests(envelopes, snapshot?)` | A break follows its requests: a commit's states only after a grant, never backwards, and a placed break arriving in effect with `imposed`. The harness applies the same rules after the connect snapshot. |
| `assertMediaFollowsTheTask(envelopes, snapshot?)` | The media follows the task and never decides it: every task is introduced once, `task-media-started` and `task-media-ended` alternate on work that has begun, media ends only where it arrived, and what follows the media ending is `completing` or `task-ended`. The harness applies the same rules to every event after the connect snapshot (`stream.*`). A sequence with no media satisfies it by never testing it — pair it with the assertion that the media end is present. |
| `assertBreakAttemptProviders(candidates, asked)` | A break attempt asks every usable provider holding capacity, `refreshing` included, and nothing of a provider whose login is `expired`. |
| `assertBreakBeginsAfterTask(steps)` | A break asked for on a task is committed as `starting-after-task` while work remains and reaches `in-effect` only once nothing is outstanding — never beside a task, never later than the step that has none. |
| `assertDeniedAndRetriedBreak(states)` | A denial transitions directly to `not-requested`; a later request can still be granted. |
| `assertWrapTimeout(task, mediaEndedAt, deadline, toleranceMs?)` | The wrap deadline equals media end plus the task allowance, within a tolerance that defaults to 1000ms; a task with no allowance has no deadline, and one observed is the violation. |
| `assertBrowserSessionIsolation(left, right, expected)` | Browser reuse follows only the declared isolation scheme. |
| `assertNoBrowserSessionKeyCollisions(scenarios)` | No two distinct scenarios derive the same session key. Feed it adversarial names. |

Adapters should run the relevant scenarios against deterministic test state before publishing.

> **Assert both directions.** Each helper above rejects a violating input as well as accepting a
> conforming one. A suite that only ever asserts "this conforming case does not throw" passes
> unchanged if the helper is gutted, so pair every positive case with the violating twin.

## A provider does not style the workspace

How a deployment themes Omni is the host's concern and is specified with the host, not here. What
belongs in this contract is the boundary. A provider says what a control **is** through its
capabilities and what its work is **called** through `phaseLabels` and `taskTypePresentation`; how
any of it is drawn is Omni's. A task cannot select a design language, inject a component, or
override the agent's theme and font preferences.
