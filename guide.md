# `@xema/omni-protocol` API contract

This document is the normative contract between Omni Agent and a provider adapter. It describes
observable behavior in addition to TypeScript shapes. When an example and a type declaration
appear to disagree, the exported TypeScript declaration is authoritative.

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
| **Agent** | The person signed in and taking work. Not to be confused with a transfer destination whose `kind` is `agent`, which is a routing target. |
| **Lead** | An agent whose login declares `capabilities.team`. The provider publishes a `TeamRoster` to them and to nobody else: **the login is the permission**. |
| **Provisioning** | Omni-side policy about this agent, configured outside the protocol and never sent to a provider. It gates whether an offer may be rejected, whether the agent goes ready on login, and whether tasks are auto-accepted. Where a capability and provisioning disagree, the stricter wins. |
| **Task** | One unit of assigned work — a call, a chat, a mail. |
| **Channel** | The kind of work a provider carries: `voice`, `chat`, or `email`. Fixed per provider by its manifest. |
| **Task type** | The provider's own name for a category of work — a queue, a mailbox folder, a chat source. Free-form, and finer-grained than a channel. |
| **Capability** | A provider's declaration that a control exists for a task or a session. It says *offer this*, and nothing about who carries it out — that is fixed per command, see **Where a command executes**. |
| **Login** | One authenticated sign-in to one provider, identified by `loginId`. A transport reconnect keeps it; signing in again replaces it, and nothing tied to the old `loginId` survives. |
| **Transport** | The adapter's connection to its platform: a WebSocket or SignalR connection, required to be persistent and ordered. Which one and how it reconnects are the adapter's business; losing it does not end a login. |
| **Connection** | The `Connection` object Omni holds for one login: the methods it can call and the events it receives. |
| **Concurrent capacity** | How many tasks this provider may have allocated to the agent at once — an absolute ceiling, stated as `AgentCapacity.count` and standing until Omni restates it. The provider counts its own outstanding tasks against it. |
| **Snapshot** | The provider's complete state at one moment. It replaces what Omni holds; it is never a patch. |
| **Event** | One completed transaction reported after a snapshot established the baseline. |
| **Break** | A reported, supervised state in which the agent is not working — one with a reason, a decision behind it and a return. It covers what a platform may call *not-ready*, including equipment trouble. An agent who is merely at capacity is not on a break. |
| **Workspace** | What Omni shows the agent. The **task workspace** holds the selected task, its controls and its browsers; the **idle workspace** holds what a provider contributes when no task is selected — dialpad, contacts, calendar, roster. |
| **Dial** | One outbound call the host asks a provider to place — from the idle dialpad, a transfer, a conference add, or a connect-back. Identified by the host's `dialId`, accepted as `dialling`, and ended by exactly one `dial-outcome`. See **Every dial has an outcome**. |
| **On the call** | Who a voice task's audio joins, or is bringing in, as the provider states it on `Task.onCall`: the party, the agents, and anyone consulted or conferenced in from the moment their dial is placed. |

Six words describe *what state a thing is in*, and they are not interchangeable: each belongs to
one thing, so a bare "status" in conversation is always the authentication session's, and a
transport, a task, a break and a call each have a word of their own:

| Word | Belongs to | Values |
| --- | --- | --- |
| `phase` | A task | `pending`, `confirmed`, `preparing`, `in-progress`, `paused`, `completing` |
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

type User = {
  id: UserId;
  displayName: string;
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
  accessAppliesTo?: "initial-url" | "all-navigation";
};

type DialDestinations = "contacts-only" | "any-number";

type DialCapability = { destinations: DialDestinations };

type DialOutcome = "answered" | "busy" | "no-answer" | "unreachable" | "rejected" | "cancelled" | "unexplained";

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
  runningStepReports?: true;
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
  secrets: SecretStore;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
};

type TeamCapabilities = {
  breakControl?: true;
  leadAssistControl?: true;
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

type HostAudioInput =
  | { status: "available"; localAudio: MediaStream; flowing: boolean }
  | { status: "unavailable"; reason: HostAudioUnavailableReason; failure: ProtocolFailure };

type HostAudioOutput =
  | { status: "available" }
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
  report(): HostReport;
  subscribe(listener: (report: HostReport) => void): Unsubscribe;
};

type ConnectContext = {
  protocolVersion: number;
  loginId: string;
  autoAcceptTasks?: boolean;
  host: Host;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
};

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
type PreferenceId = "hold" | "mute" | `skill:${string}`;

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

type HandlingReport = { taskId: TaskId; step: HandlingStep; at: IsoTimestamp } & (
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
  count: number; // absolute ceiling, at least 1
};

type CapacityResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };
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
  address: string;
  kind: "queue" | "agent" | "external";
};

type DestinationDirectory = {
  destinations?: Destination[];
  allowManualEntry: boolean;
};

type CustomCapability = {
  id: string;
  ui: {
    control: "button" | "toggle" | "menu-item";
    label: string;
    placement: "primary" | "secondary" | "overflow";
    render?: "inline" | "page";
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
        mute?: Lockable<true>;
        hold?: Lockable<true>;
        agentDisconnect?: Lockable<true>;
        connectBack?: Lockable<true>;
        blindTransfer?: Lockable<true | DestinationDirectory>;
        consultTransfer?: Lockable<true | DestinationDirectory>;
        leadAssist?: Lockable<true>;
        conference?: Lockable<true | DestinationDirectory>;
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
  | "preparing"
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
  destination?: string;
  seconds?: DurationSeconds;
  by?: UserId;
};

type TaskCompletion =
  | { completionMode: "agent-command"; wrapAllowance?: DurationSeconds }
  | { completionMode: "provider-automatic"; wrapAllowance: DurationSeconds };

type OnCallRole = "party" | "agent" | "consulted" | "conferenced";

type OnCallStage = "ringing" | "joined";

type OnCall = { since: IsoTimestamp; held?: true } & (
  | { role: "party" }
  | { role: "agent"; userId: UserId }
  | { role: "consulted" | "conferenced"; destination: string; stage: OnCallStage; dialId?: DialId; label?: string }
);

type TaskLeadAssist = {
  stage: "requested" | "joined";
  leadId?: UserId;
  note?: string;
  since: IsoTimestamp;
};

type TaskAssisting = {
  memberId: UserId;
  note?: string;
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

type Task<C extends Channel = Channel> = {
  id: TaskId;
  title: string;
  channel: C;
  taskType: string;
  capabilities: TaskCapabilities<C>;
  browsers: TaskBrowser[];
  party?: Contact;
  phase: TaskPhase;
  acceptance?: AcceptanceMode;
  reference?: string;
  attributes?: TaskAttribute[];
  handlingHistory?: TaskHandlingHistory;
} & TaskCompletion & (
  C extends "voice"
    ? { onCall?: OnCall[]; leadAssist?: TaskLeadAssist; assisting?: TaskAssisting; media?: TaskMediaState }
    : { onCall?: never; leadAssist?: never; assisting?: never; media?: never }
);

type AcceptanceMode =
  | "no-preference"
  | "consent"
  | "automatic";

type TaskOutcome =
  | { type: "completed"; by: "agent" | "provider" }
  | { type: "transferred"; destination?: string }
  | { type: "cancelled"; reason?: string }
  | { type: "expired"; phase: "pending" | "confirmed" | "preparing" }
  | { type: "left" }
  | { type: "failed"; failure: ProtocolFailure };
```

### Task commands

```ts
const TASK_COMMAND_NAMES = {
  voice: [
    "answer",
    "decline",
    "start-call",
    "mute",
    "hold",
    "resume",
    "disconnect",
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
  | { type: "start-call" }
  | { type: "mute"; muted: boolean }
  | { type: "hold" }
  | { type: "resume" }
  | { type: "disconnect" }
  | { type: "connect-back"; dialId: DialId }
  | { type: "transfer"; dialId: DialId; destination: string; action?: never }
  | { type: "transfer"; action: "consult"; dialId: DialId; destination: string }
  | { type: "transfer"; action: "complete" }
  | { type: "transfer"; action: "cancel" }
  | { type: "lead-assist"; action: "request"; note?: string }
  | { type: "lead-assist"; action: "cancel" }
  | { type: "lead-assist"; action: "take-over" }
  | { type: "lead-assist"; action: "leave" }
  | { type: "conference"; action: "add"; dialId: DialId; destination: string }
  | { type: "conference"; action: "remove"; destination: string }
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
  command: TaskCommand<C>;
};

type TaskCommandResult =
  | { status: "applied" }
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };
```

### Who decides what an agent may do

An agent desk has two managers, not one. **The queue** — a process, a work type — is owned by a
process manager and **allows** a set of capabilities: hold, mute, connect back, new call, conference,
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
value would be — `mute: { lockedBy: "team", reason: "Nobody on this team mutes" }` — and Omni
renders that control disabled, saying who decided, so an agent who cannot press Mute knows whether
to ask their lead or their site. `lockedBy` is the discriminant: a value that carries it is the
lock, so nothing that can be locked — a directory, a number — may carry that key itself. A
contact's number and email are the same, since each identifies a person: where the queue says
the agent may not see it, the provider sends `{ lockedBy }` in its place — the last digits or
nothing — and a CRM link carries a token, never the value with a flag the desk is asked to honour.
A name is not locked. What the queue provides rather than permits — browsers, dispositions, custom
controls — is content, and is never locked.

**A lead sets the team's policy from their roster.** A login that declares
`capabilities.team.policyControl` may `executeTeamPolicy({ type: "set", capability, setting })`
with `on`, `off`, or `person`, for any task control, `dial`, or a skill — and only `hold`, `mute`
and skills may be `person`; connect back and new call are the team's, on or off, within what the queue
allows. The roster carries `policies` for such a login: every policy as it stands, who set it, and
`lockedBy` where a level above the team made it theirs to keep, which the lead sees and cannot
change — `executeTeamPolicy` on it answers `failed` with `omni.capability-not-enabled`.

**What the team left to the person is the person's, and the provider keeps it.** The login's
`capabilities.preferences` lists every preference the person may hold — `hold`, `mute`, a skill —
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
command `mute` acts on one call; the preference `mute` says whether the person wants the control
at all, and a host renders it in its settings, never as the button on a call.

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
type TeamMemberAvailability = "ready" | "on-task" | "on-break" | "signed-out";

type TeamMember = {
  id: UserId;
  availability: TeamMemberAvailability;
  since?: IsoTimestamp;
  break?: BreakApproval;
};

type LeadRequest = {
  id: string;
  memberId: UserId;
  taskId: TaskId;
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
  | { type: "place"; memberId: UserId; reason?: string }
  | { type: "release"; memberId: UserId };

type TeamBreakCommandRequest = {
  command: TeamBreakCommand;
};

type TeamLeadAssistCommandRequest = {
  command: TeamLeadAssistCommand;
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
      preparationEndsAt?: IsoTimestamp;
    }
  | { type: "task-updated"; task: Task }
  | { type: "task-media-started"; taskId: TaskId }
  | { type: "task-media-ended"; taskId: TaskId }
  | { type: "task-ended"; taskId: TaskId; outcome: TaskOutcome }
  | { type: "dial-outcome"; dialId: DialId; outcome: DialOutcome; taskId?: TaskId; destination?: string; reason?: string }
  | { type: "announcement"; text: string; html?: string; announcedAt: IsoTimestamp; expiresAt?: IsoTimestamp }
  | { type: "queue-summary"; summary: QueueSummary }
  | { type: "diagnostic"; expected: string; observed: string; taskId?: TaskId }
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
type Connection<C extends Channel = Channel> = {
  snapshot(): Snapshot<C> | Promise<Snapshot<C>>;
  subscribe(listener: (envelope: ProviderEventEnvelope<C>) => void): Unsubscribe;
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
    preparing: "Preview",
    "in-progress": "On Call",
    paused: "On Hold",
    completing: "After Call Work",
  },
  chat: {
    pending: "Incoming Chat",
    confirmed: "Accepted",
    preparing: "Preparing",
    "in-progress": "In Chat",
    paused: "Paused",
    completing: "Wrap-up",
  },
  email: {
    pending: "Assigned",
    confirmed: "Accepted",
    preparing: "Reviewing",
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
offered can be accepted, one in `preparing` can be started, one whose `completionMode` is
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
is the provider's answer only when it carries the provider's answer — a failure the provider
named. Every other rejection is transport loss, whatever the last `transport-status` said.

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
| `dialOutcomes` | Voice only. How a dial can end on this platform, as it distinguishes them: `answered` and at least one way of not reaching the destination. Required of a provider that dials at all — an idle dialpad, or tasks that transfer, conference or call back — and a `dial-outcome` carries only a declared member. See **Every dial has an outcome**. |
| `runningStepReports` | The provider takes running reports of a host-performed step — `recordStep` with `seconds` so far and no `ended`. Omitted, the host sends exactly two reports per leg, when it began and when it ended, and a running one is refused. See **The host records what it performs**. |

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
| `accessAppliesTo` | `all-navigation` by default: every redirect and navigation is checked. `initial-url` checks the starting URL alone. |

Patterns use the standard `URLPattern` syntax. Omni owns browser navigation, and the browser is
hidden when no active provider contributes one.

`accessAppliesTo` defaults to `all-navigation`: every redirect and subsequent navigation is
validated against the current combined policy, not only the starting URL. A provider may set
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
session for one agent. What "signing in again replaces the login" describes is a new
`AuthenticationSession` under a new `loginId`, after `signed-out`.

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
{ status: "authenticated", identity: { id: "1042", displayName: "Asha Rao" }, capabilities: { breaks: true } }
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
  calls `connect()` afresh — see **`transport-status`**.

### `ConnectContext`

| Field | Contract |
| --- | --- |
| `protocolVersion` | Version negotiated before authentication. Fixed for this login. |
| `loginId` | Omni-generated identity for this login. It is the same value passed as `AuthenticationContext.loginId`, so an adapter can correlate this connection with the session that authenticated it. Stable across transport reconnects and changed only by a new login. |
| `autoAcceptTasks` | Agent provisioning policy relayed to the provider at login. Treated as `true` when omitted. When `true`, a pending task states its `acceptance`; when `false`, every task requires agent acceptance. Fixed for this connection, like everything else here: the provider states or omits `acceptance` by the value it was sent, and Omni validates by that same value, not by a policy that has since moved — a change reaches the provider through a fresh `connect()`. |
| `host` | The host's report of the agent's station — devices, permissions, network — to consult before declaring the agent ready to the platform, and on every change. See **The host reports, the adapter decides**. |
| `signal` | Optional cancellation signal. Stop startup promptly when aborted and do not begin new work. |
| `log` | Optional structured logging callback. Never include credentials, tokens, or sensitive contact data. |

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
| `setCapacity(capacity)` | Always. Nothing may be allocated until a capacity is stated, so there is no connection that does not receive it. |
| `execute(request)` | Always. Every channel has commands no capability gates — see **Which commands need a capability**. |
| `describeUsers(ids)` | The adapter publishes any `UserId`: on `ImposedBreak.by`, a roster, or `handlingHistory[].by`. |
| `dial(request)` | The manifest declares `idleCapabilities.dial`, and with it `dialOutcomes`. |
| `requestBreak(request)` | The login declares `capabilities.breaks`. |
| `commitBreak()` | The login declares `capabilities.breaks`. Commit and cancel are not optional halves of it. |
| `cancelBreak()` | The login declares `capabilities.breaks`. |
| `endBreak()` | The login declares `capabilities.breaks`. |
| `executeTeamBreak(command)` | The login declares `capabilities.team.breakControl`. |
| `executeTeamLeadAssist(command)` | The login declares `capabilities.team.leadAssistControl`. |
| `setPreference(request)` | The login declares `capabilities.preferences`: the person's choice has to have somewhere to go. |
| `recordStep(report)` | A task declares `mute`: the host performs that leg, and the provider's record has to have somewhere to take it. See **The host records what it performs**. |
| `executeTeamPolicy(command)` | The login declares `capabilities.team.policyControl`. |
| `openMedia(request)` | The manifest channel is `voice`. Every voice task's audio lands in Omni, so there is no voice adapter that does not implement it. |

**The four break methods stand or fall together.** Declaring `capabilities.breaks` at login and then
implementing `requestBreak` without `commitBreak` leaves an agent granted a break that can never
start, and the two-phase coordination in **Coordinating a multi-provider break** has no way to
report that: `granted` is a promise to honour a later commit.

### `Connection.snapshot()`

Returns the provider's complete authoritative state at one point in time.

- Omni registers `subscribe()` before awaiting the initial snapshot and discards anything delivered
  while the snapshot is read, because the snapshot accounts for it. Events after it are applied in
  order.
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

**1. The agent signs in.** Omni initially places the agent in `not-ready`. The provisioning file's
`readyOnLogin` flag determines whether Omni transitions them to `ready` immediately and defaults to
`true`. A provider must allocate nothing while the agent remains `not-ready`.

**2. The agent becomes ready.** With `readyOnLogin: true`, Omni makes the transition automatically.
Otherwise, the agent explicitly signals that they are ready to take work. A successful connection,
a healthy provider, or the absence of a break does not imply readiness.

**3. Omni states their concurrent capacity.** Only now does Omni ask providers for work, saying how
much the agent can take at once. It is a standing declaration rather than a poll: Omni restates the
capacity every time it changes, in either direction, and does not ask again while that value holds.
Silence keeps the last one in force, so a provider that waits to be asked a second time will never
deliver again once it has gone quiet. Hold the capacity and deliver when work arrives.

**4. A provider offers a task.** The provider emits `task-offered` within the stated capacity.

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

When Omni sent `autoAcceptTasks: false`, the provider omits `acceptance` and every task
requires agent acceptance. The two are never confused on the wire: `consent` is always the
provider's requirement, stated on a wire where Omni was willing to accept for the agent; Omni's own
no-auto-accept policy puts no word on the wire at all — the field is absent, and the **Accept**
press is Omni's doing, not the provider's.

**An absent value means `true`**, as `readyOnLogin` does, because an agent who has signed in and
gone ready is telling the deployment they are working. Requiring a press before every contact is
the exception a provisioning file asks for, not the state it falls into when a flag is missing.

Nothing is given away by that default. `acceptance` is the provider's own control and outranks
it: `consent` puts the decision back in the agent's hands for any task where it
belongs, whatever the host was configured with.

An automatically accepted task still arrives through `task-offered`.

Agent-initiated work arrives through `task-offered` with the task's
`acceptance: "automatic"`.

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
  preparationEndsAt: "2026-08-25T10:40:37.000Z",
} satisfies Extract<ProviderEvent, { type: "task-offered" }>;
```

The rule the phase exists to express: **nothing is acquired on the agent's behalf while a task
is pending.** A host that carries media must not open the microphone until the task is
accepted. Omni does not open the task's browsers either — a task that rings out costs nothing.

When consent is required, Omni offers the agent an **Accept** control. The call is the
medium the task arrives on, not a separate decision.

**Once a task is accepted, the call that comes with it is answered.** Omni has no discretion
there and the provider is not consulted twice: one decision about the work, and the medium
follows it. Where the audio lands is not in question — it opens in Omni, as it always does.

Automatic acceptance still begins with `task-offered`.

`allocationExpiresAt` is the deadline after which the offer lapses. Where present, Omni counts
down and stops offering **Accept** once it passes. **Omit it unless the provider can observe it.**
A provider that reports only elapsed ring time after the fact cannot say when an offer is due
to end, and a computed value would have Omni withdraw **Accept** from a task still pending.

`preparationEndsAt` is the time available for the agent to review the task context before acting.
Omni presents the deadline with the allocation so a preview-based dialer can show how long remains
before the agent must start the contact. Reaching the timestamp does not imply a transition; the
provider reports what happens next through an event.

A provider may withdraw a pending task by emitting `task-ended` with a `cancelled` outcome.

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
`browsers` and `dispositions`, but rejects voice-only controls such as `mute` and `hold` at compile
time. Runtime conformance checks also require the task channel to match its provider manifest.

| Field | Contract |
| --- | --- |
| `id` | Required `TaskId`, unique within the provider. Omni scopes it with the provider ID. |
| `title` | Agent-facing task title. |
| `channel` | Channel handling this task. It must equal the source provider's manifest channel. |
| `taskType` | Required provider-defined source or category of work, such as a voice `Queue Name`, `Mailbox Folder`, `Chat Source`, `Support`, `Billing`, or `Returns`. |
| `capabilities` | Controls and workspace features available for this specific task. |
| `browsers` | Named browser definitions for the task workspace: at least one when the task declares the `browsers` capability, empty when it does not. |
| `party` | The person or entity on the other end of this task, as a `Contact`: often a name and one address; a withheld caller ID may leave nothing to send at all. Optional. The party is who the task is *with*; `contacts` is the directory. |
| `phase` | Current canonical task phase: `pending`, `confirmed`, `preparing`, `in-progress`, `paused`, or `completing`. |
| `media` | Voice only. The task's real-time audio as the provider holds it: `started` while audio is attached, `ended` once it ended, omitted while none is. The provider's word — see **`task-media-started`**. |
| `acceptance` | How this offer is accepted — `no-preference`, `consent`, or `automatic` — stated on the pending task so a reconnect snapshot says it too. Required while `pending` when `autoAcceptTasks` was `true`, forbidden when it was `false`, and absent past `pending`. See **Acceptance modes**. |
| `reference` | Optional agent-facing reference such as a case, call, conversation, ticket, or message number. It is distinct from the protocol `id`. |
| `completionMode` | `agent-command` waits for the channel's `complete` command; `provider-automatic` completes without one. |
| `wrapAllowance` | Fixed time allowed to complete the task after primary handling ends. For real-time media, it begins after `task-media-ended`. Required under `provider-automatic`, where the provider acts on it. Optional under `agent-command`: omitted says the provider imposes no deadline, and Omni counts nothing down. |
| `attributes` | Optional ordered, typed `TaskAttribute` entries with keys unique within the task. Each contact or timestamp is a separate array item; new attribute shapes require new union members. |
| `handlingHistory` | The call record: `steps` — the ordered handling history of this open task, one entry per occurrence, oldest first — and what they add up to before this agent, `handleSeconds`, `holdSeconds`, `queueSeconds`, `transfers`, each present when the provider knows it. Live task data restated with the task, not a permanent archive. See **How a task has been handled**. |
| `onCall` | Voice only. Who is on the call, or being brought onto it, as the provider states it, replaced whole with the task: `party` is the customer, `agent` a person by user id, `consulted` and `conferenced` somebody a dial is bringing in, listed from the moment the dial is placed -- with the `destination` dialled, the `dialId` where a host placed it, the `stage` reached (`ringing` until answered, `joined` after), and `held: true` on anyone joined and parked. A `consulted` entry is what makes `transfer` `complete` and `cancel` issuable. `label` names a destination -- a person, a queue -- not a phrase; the host supplies the verb. Present when the provider knows the room, absent when it does not. See **Every dial has an outcome**. |
| `leadAssist` | Voice only. Present from the agent's request for a lead until the lead leaves or the request ends: `requested` while nobody has joined, `joined` with the lead's `leadId` once somebody has. See **Lead assist**. |
| `assisting` | Voice only, on the lead's own task for a call they joined: which member asked, with their note. Its presence is what makes `lead-assist` `take-over` and `leave` issuable. See **Lead assist**. |

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
| `confirmed` | Preparation begins | `preparing` |
| `confirmed` | Work begins without preparation | `in-progress` |
| `preparing` | Agent starts the contact | `in-progress` |
| `pending` | Provider withdraws the allocation | Removed by `task-ended` with `cancelled` outcome |
| No task | Snapshot reports work already underway | `in-progress` |
| `in-progress` | Provider or agent pauses the task | `paused` |
| `in-progress` | Agent consults a transfer destination (`transfer` `consult`); the customer is parked | `paused` |
| `paused` | Provider or agent resumes the task | `in-progress` |
| `paused` | Agent cancels a consultation (`transfer` `cancel`) | `in-progress` |
| `in-progress` or `paused` | Contact handling ends and follow-up work remains | `completing` |
| `completing` | Agent connects back to the party (`connect-back`) | `in-progress` |
| Any phase | Provider emits `task-ended` | Removed |

Allocation, acceptance, and progress are distinct. Acceptance follows `autoAcceptTasks` and the
task's `acceptance`, moving the task from `pending` to `confirmed`. The provider reports
subsequent transitions to `preparing` or `in-progress`; Omni does not infer them from the acceptance
command.

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
| Chat | When the conversation ends and the task enters `completing` |
| Email | After the message is sent and the task enters `completing` |
| Other non-media channels | The moment the task enters `completing` |

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
entry after the first, never a revision of it. The same goes for every step: two mutes are two
`muted` entries. Order is enforced: an entry earlier than the one before it is refused
(`task.handlingHistory.order`). **Handle time is anchored, not restarted.** It runs from the
`answered` step's `at` — from the task's first `in-progress` where the provider reports no
history — until the task's media ends, and a hold neither pauses nor resets it: the hold's own
duration is the `held` entry's `seconds`, and a desk that restarts its counter on resume is
counting the wrong thing.

`muted` is there because Omni performs the mute rather than the provider — see **Where a command
executes** — so without a step the provider, which alone keeps the task's record, would have no
account of a period the agent could not be heard.

**A step that dialled says which dial and where.** `transferred`, `conferenced` and `unanswered`
each end a dial, so the entry carries the `destination` it went to and, where a host placed it, the
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
*this was handled and the provider cannot say by whom*.

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

`muted` is the one leg Omni performs rather than the provider, and a record kept by the provider
would have a hole exactly there. So the host reports it, through `recordStep`, and the provider
writes it into its record as it writes every other leg:

```ts
declare const connection: Connection<"voice">;
declare const taskId: TaskId;
declare const at: IsoTimestamp;

void connection.recordStep?.({ taskId, step: "muted", at });                          // the moment the agent mutes
void connection.recordStep?.({ taskId, step: "muted", at, seconds: 15 });             // still running, if the host chooses to say
void connection.recordStep?.({ taskId, step: "muted", at, seconds: 42, ended: true }); // the moment they unmute
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
`recordStep` is required of a connection whose tasks declare `mute`, and answers `recorded`.

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
| `PROVIDER_NAME__TASK_ID__TAB_NAME` | `mailflow.EMAIL-829102.CRM` |
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

### Voice capabilities

| Capability | Omni UI | Contract |
| --- | --- | --- |
| `decline` | Pending-task button: Decline | The provider can decline a pending voice offer. Omni shows it only when provisioning also permits declining. |
| `mute` | Primary toggle: Mute | Omni may mute and unmute the agent's outbound audio. |
| `hold` | Primary toggle: Hold | Omni may issue voice-task `hold` and `resume` commands. |
| `agentDisconnect` | Primary button: Disconnect | Omni may disconnect real-time media without disposing the task. |
| `connectBack` | Completing-task button: Connect back | Omni may have the provider connect the agent back to the task's party while the task is `completing`, returning it to `in-progress` on the same task. Not offered where there is no `completing` window: `provider-automatic` with a zero allowance disposes at provider end. See **Connecting back during completion**. |
| `blindTransfer` | Secondary menu item: Blind transfer | Omni may transfer the caller directly to a destination. |
| `consultTransfer` | Secondary menu item: Consult transfer | Omni may park the customer and call a destination first, then hand the customer over or cancel back. See **Consult transfer**. |
| `leadAssist` | Secondary menu item: Lead assist | Omni may ask a lead to join this call, with a note. The lead's decision reaches the agent on `Task.leadAssist`. See **Lead assist**. |
| `conference` | Secondary button: Conference | Omni may dial a destination into the active call, and drop a `conferenced` entry from it -- one still ringing included, which calls the dial off. |
| `recording` | Overflow menu item: Recording | Omni may expose start, pause, resume, and stop recording controls. |
| `dispositions` | Primary button: Complete | Omni may request task disposal with a provider disposition and notes. |

### Publishing codes and destinations

Four capabilities accept an object instead of `true` when the provider wants Omni to render real
choices. `true` remains valid and means "offer the control with nothing published".

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

#### `blindTransfer`, `consultTransfer` and `conference`

```ts
capabilities: {
  blindTransfer: {
    allowManualEntry: false,
    destinations: [
      { id: "tier2", label: "Tier 2 support", address: "+14155550111", kind: "queue" },
    ],
  },
}
```

| Field | Contract |
| --- | --- |
| `destinations` | Directory Omni renders, with unique `id` values. |
| `address` | The value Omni sends as `destination` on a `transfer` or a `conference` command. |
| `kind` | Where the contact is going. See below. |
| `allowManualEntry` | Whether the agent may type a destination that is not in the directory. A directory with no destinations must allow manual entry, or the control has nothing to offer. |

`kind` says who receives the contact and whether this provider still holds it afterwards:

| Kind | What it means |
| --- | --- |
| `queue` | A routing point on this provider. Whoever is next takes it, nobody is named, and the provider keeps the contact. |
| `agent` | One named person on this provider. The provider keeps the contact and knows who has it. |
| `external` | An address outside this provider — another platform, a PSTN number, a partner's line. The contact leaves, and the provider generally stops being able to report on it. |

A destination the agent types is not in the directory and has no `kind`. Omni treats it as
`external` unless the provider says otherwise in its response, because that is the assumption that
does not overstate what the provider can still see.

#### Consult transfer

A consult transfer parks the customer, calls the destination so the agent can speak to it first,
and then either hands the customer over or returns to them. It is its own capability, distinct
from `blindTransfer` (a hand-over with nobody consulted) and from `conference` (everybody on one
call): a queue may offer any of the three without the others, and each is declared on its own.

```ts
// 1. Consult. A dial: the provider parks the customer and calls the destination, answers
//    `dialling`, and the task reports `paused` with the destination `consulted` on `onCall`
//    while the call to it stands.
{ type: "transfer", action: "consult", dialId: "dial-7f2", destination: "+14155550111" }

// 2a. Hand the customer to the consulted destination and leave.
{ type: "transfer", action: "complete" }

// 2b. Or drop the destination and return to the customer.
{ type: "transfer", action: "cancel" }
```

`consult` is gated by the `consultTransfer` capability and takes a destination exactly as a blind
transfer does, from the same kind of directory. It is a dial, so it carries the host's `dialId`
and is answered `dialling`, and its `dial-outcome` says whether the destination was reached. While
the destination is on the line the task carries a `consulted` entry on `onCall`, and that presence
is what makes `complete` and `cancel` issuable -- they name no destination because there is exactly
one they could mean, which is why a task carries at most one `consulted` entry
(`task.onCall.consulted.single`). A consultation that could be started but not finished would
strand the customer and the destination both, which is why all three are commands and a provider
that offers `consultTransfer` implements all three.

`applied` on `complete` says the provider is bridging the customer to the destination and
dropping the agent's leg. What follows is what follows any transfer: the agent's media ends and
the provider reports `task-media-ended`, any wrap allowance runs, and the task ends with a
`transferred` outcome naming the destination. `applied` on `cancel` says the destination is
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
none; inline when absent. `prompt.fields` are what the agent supplies before the action runs — a
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

// 1. Out, minted by the host.
const result = await connection.execute({ taskId, command: { type: "conference", action: "add", dialId: "dial-7f2", destination: "+14155550111" } });

// 2. Back on the result, restated, so the host compares and confirms.
expect(result).toEqual({ status: "dialling", dialId: "dial-7f2" });

// 3. On the outcome, however late, against the task it belonged to.
const outcome: ProviderEvent<"voice"> = { type: "dial-outcome", dialId: "dial-7f2", taskId, destination: "+14155550111", outcome: "no-answer", reason: "No route to destination" };

// 4. In the record, so a dial made before a transfer is placeable by whoever holds the task now.
const step: TaskHandlingStep = { step: "unanswered", at: "2026-08-21T09:15:30Z", by: "A-12", dialId: "dial-7f2", destination: "+14155550111" };
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
there was one, the destination where the provider knows it, and how the dial ended -- from a closed
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
blind transfer, a connect-back, an idle dialpad call -- or whose entry has already left the room; an
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
`blindTransfer`, `consultTransfer` or `conference` under a manifest without it is refused
(`task.capability.dialOutcomes.required`). Off voice nothing dials, and the field is a compile
error there.

**Who is on the call is stated on the task.** `Task.onCall` lists everyone the task's audio joins
right now, replaced whole with the task like every other field, and present when the provider
knows the room:

```ts
const onCall: OnCall[] = [
  { role: "party", since: "2026-08-21T09:12:00Z" },
  { role: "agent", userId: "A-12", since: "2026-08-21T09:12:04Z" },
  { role: "conferenced", destination: "+14155550111", dialId: "dial-7f2", stage: "joined", held: true, since: "2026-08-21T09:15:30Z" },
  { role: "conferenced", destination: "+14155550199", dialId: "dial-3c9", stage: "ringing", since: "2026-08-21T09:16:02Z" },
];
```

`party` is the customer and `agent` a person by user id; neither was dialled from anywhere, so
neither carries a destination. `consulted` and `conferenced` were, so both carry the `destination`
and, where a host's dial brought them, its `dialId`; a person the platform added itself carries
none. `held: true` is presence as claim. A snapshot establishes state, so a host that attaches
after a transfer reads the room from here rather than inferring it from a sequence of outcomes it
never saw.

**A dialled entry is listed from the moment the dial is placed, not from the answer.** The entry is
what makes `transfer` `cancel` issuable and what `conference` `remove` names, and a destination the
agent cannot call off while it rings is a parked customer with no way back -- which is the very case
`cancelled` exists for. Consult and conference behave alike here: the `consulted` or `conferenced`
entry appears with its `dialId` when the dial is placed, and a `conference` `remove` naming a
still-ringing `destination` calls that dial off, with `cancelled` as its outcome.

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
| `activeReasonId` | The `BreakReason.id` the current break is on. Omitted when there is no break, or when the provider cannot say. |
| `imposed` | Set when the break was placed on the agent rather than requested. |

A request can be waiting for two unrelated things, and they are separate values because
rendering one as the other tells an agent to wait for somebody who is never coming:

| `approval` | Meaning |
| --- | --- |
| `not-requested` | No request outstanding. |
| `awaiting-decision` | A person has to decide. The agent is waiting on somebody. |
| `granted` | A person decided yes. Omni may now tell this provider to stop the agent; until it does, work continues normally, and this says nothing about why Omni has not. |
| `starting-after-task` | Omni has told the provider to stop; the break begins when the current task ends. No new work arrives meanwhile, and nobody needs to act. |
| `in-effect` | The agent is on the break now. It holds no task: a break begins when the work ends, so a snapshot reporting `in-effect` beside a task is refused as `break.in-effect.tasks`. |

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

`count` is an absolute ceiling, not an increment and never less than 1. An agent's capacity is a
property of the agent, not of the moment: it is stated when the agent is set up and restated only
when it genuinely changes, which is a provisioning change rather than a task starting or ending.

**The provider counts its own outstanding tasks against it.** Allocate while you hold fewer than
`count` tasks for this agent, and stop when you hold that many; when one of yours ends you have
room again and need no new signal to know it. Omni does not re-state capacity as tasks come and
go, and a provider that waits for it will stall.

Your own tasks are the only ones you count. What the agent holds at other providers is not your
concern — Omni set `count` knowing it.

Capacity supersedes rather than accumulates: the latest value is the ceiling.

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
| `{ type: "place", memberId: UserId, reason? }` | Puts a member on a break they did not ask for. |
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
//    task.leadAssist = { status: "requested", note: "Refund dispute, needs approval", since }

// 2. Every lead entitled to it sees the request on their roster.
//    team-updated: requests: [{ id: "req-7", memberId: "A-1", taskId: "call-42", note, since }]

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
| `{ type: "lead-assist", action: "take-over" }` | `task-ended` with `{ type: "transferred", destination: leadId }`, straight from `in-progress`: **no `completing` window**, the agent is idle at once | Continues alone, and ends as any call does |
| `{ type: "lead-assist", action: "leave" }` | Continues; `leadAssist` is cleared | `task-ended` with `{ type: "left" }` -- the call goes on without them |
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
than one desk speaks this contract. So `ConnectContext.host.guarantees` says which promises the
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
| `audio.input` | `available` with `localAudio` — the microphone as captured, the same stream `openMedia` receives — and `flowing`, false while the hardware or OS says no audio moves through it (a headset's own mute switch, which Omni's Mute control never touches). `unavailable` with `reason`, since each wants a different fix from the agent: `no-device`; `denied`; `not-asked`, which a host that asks at connect never publishes; `in-use`, a device present and permitted that another application holds — on an agent desktop the commonest of all; `lost`, a capture that ended. A host decides the reason from the devices before the error name: a browser can report a permission error on a machine with no microphone at all, and "grant permission" is the wrong instruction for an agent who needs to plug one in. `failure` carries the words Omni showed them. |
| `audio.output` | `available`, or `unavailable` with `reason` — `no-device`, or `lost` for one removed — and `failure`: an agent who cannot hear is as unable to take a call as one who cannot speak. |

Omni republishes the report whenever it changes — a permission granted late, a headset unplugged,
a network gone — and it publishes a state, not a flicker: a change that resolves within moments is
not reported, so an adapter may act on what it reads without debouncing it again. Nothing in the
report is a task fact or a capacity fact; it is what the station can do, and the adapter's platform
is the one that knows whether an agent without a microphone, or without a speaker, can work.

The host's own obligations here — asking at connect, never publishing `not-asked` when it does,
publishing a state and not a flicker — are Omni's tests' to hold. `exerciseAdapter` holds the
other side: it validates the shape of whatever host a test hands the adapter, requires `audio` on
a voice connection and none elsewhere (`context.host.audio.required` / `.unexpected`), and
refuses a voice adapter that never asked the host anything (`connection.host.consulted`).

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

**Stopping is a break, not a capacity of zero.** Capacity says how much this agent can carry at
once; a break says they are not working. Collapsing the two would leave a provider unable to tell
an agent at their limit from an agent who has gone to lunch, and only one of those needs a reason,
a decision and a return.

### Opening the audio

`openMedia` hands Omni the remote audio for one task. Every voice adapter implements it, because
every voice task's audio lands in Omni:

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
then off again. `mute` therefore carries `muted`, and a custom `toggle` control carries its own
boolean. `hold` and `resume`, `pause` and `resume` need no flag, being pairs rather than toggles.

**`complete` sends a disposition only where one was published.** `disposition` is a
`DispositionCode.id` from the task's own `dispositions` capability, and `notes` obeys that
capability's `notes` setting. A task publishing no codes still receives `complete`, with neither.

### Where a command executes

Every command reaches the provider through `execute`, with no branch at the call site. What differs
is what the provider is being asked for: to **perform** the command, or to **record** that Omni
already did.

| Command | The provider's part |
| --- | --- |
| `mute` | **Record it, and keep the history.** The microphone is the host's, so Omni has already stopped the audio through `VoiceMediaSession.setMuted()` — no adapter can do that on the host's behalf. The command still arrives because the provider owns the task's record: it holds the current state for supervision, and each change as a `muted` handling step, exactly as it does for `held`. A platform that never hears about it shows a supervisor an agent who sounds absent for no reason, and reports a call with a silence it cannot explain. |
| Every other command | **Perform it.** `hold`, `transfer`, `conference`, `recording`, `disconnect` and the rest act on the platform's own call leg, its bridge, or its record of the task. Nothing has happened until the provider applies them. |

**A failed `mute` does not unmute the agent.** The agent asked, Omni holds the microphone, and it
is already done; a failure means only that the provider did not record it, leaving its view stale
until the next snapshot. That is the safe direction to fail in, and it is the one place where
`failed` does not mean *nothing happened* — everywhere else it does.

`mute` carries `muted` rather than flipping, so a stale view converges on the stated state
instead of flipping it back — see **Task commands**.

### Which commands need a capability

**Presence is the permission** gates the controls a provider chooses to offer. Four commands are
not among them, because every task has them; each is authorized by a different field the provider
declared:

| Command | What makes it available |
| --- | --- |
| `answer`, `accept` | Nothing. A task that was offered can be accepted, or offering it meant nothing. |
| `decline` | The `decline` capability on any channel, **and** Omni provisioning permitting it. One word for refusing an offer, whatever the channel. |
| `start-call` | The `preparing` phase. It starts the contact a preview gave the agent time to read, so the phase is the gate and there is no capability. |
| `complete` | `completionMode: "agent-command"`. The `dispositions` capability decides whether a code travels with the command, never whether the command exists — a task Omni cannot complete never ends. |
| `connect-back` | The `connectBack` capability **and** the `completing` phase. It exists to reach the party again after the call, so it has no meaning while the call is up. |
| `transfer` with `action: "consult"` | The `consultTransfer` capability. Blind `transfer` is gated by `blindTransfer`; the two are declared and offered separately. |
| `transfer` with `action: "complete"` or `"cancel"` | A consultation in progress -- a `consulted` entry on `Task.onCall`. Without one there is nothing to complete or cancel, and a provider that receives either answers `failed`. |
| `lead-assist` with `action: "request"` or `"cancel"` | The `leadAssist` capability. `cancel` needs a request standing -- `Task.leadAssist` with status `requested`. |
| `lead-assist` with `action: "take-over"` or `"leave"` | The lead's own task, on a call they joined -- `Task.assisting` present. An agent's task never has it, and a provider that receives either without it answers `failed`. |
| Everything else | Its own named capability. |

Declining or rejecting a pending offer ends it without accepting or completing it. The provider
confirms the end with `task-ended` and a `cancelled` outcome.

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
| `omni.destination-not-permitted` | The dial or transfer destination violates the provider's policy. |
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
`preparationEndsAt`, and the wrap deadline of `task-media-ended` plus `wrapAllowance` where
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
everything emitted when it was requested. Omni discards events buffered during the read on that
promise; an adapter that serves a stale snapshot and then lets an earlier event through will have
Omni apply state the snapshot already superseded.

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
  runs the authentication flow first; the authentication session decides whether stored material
  refreshes it silently or the agent must act, exactly as at sign-in.

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

A successful `complete` or `transfer` command does not clear the task. Omni waits for `task-ended`.
The `task-media-ended` event and the `completing` phase are likewise non-terminal. A replacement
snapshot that no longer contains the task also clears it. Repeated `task-ended` delivery with the
same envelope ID is harmless.

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
fails loudly rather than passing with a note.

| Field | Contract |
| --- | --- |
| `expected` | Required. The rule that was broken, as a sentence a person can read. |
| `observed` | Required. What the platform answered instead. |
| `taskId` | Optional. The task concerned, where there is one. |

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
| `validateTask(task, { channel })` | Identity, channel agreement, phase, wrap allowance, capability shapes, custom controls, and browsers. |
| `validateSnapshot(snapshot, manifest)` | Status, break state, break reasons, team roster, the stated `taskCount` reconciled against the tasks carried, and every task, contact, and activity, including idle-capability gating both ways: a contribution the manifest never declared is refused, and one it declares is required, `[]` included. |
| `validateEventEnvelope(envelope, manifest)` | Envelope identity, timestamp, and the payload for each event type. |
| `validateContact(contact)` | Contact field shapes and attribute keys. Every field is optional, so this checks what is present rather than what is missing. |
| `validateScheduledActivity(activity)` | Required activity fields and start/end ordering. |
| `validateHostGuarantees(guarantees)` | What a host promises: only the guarantees this contract names, each declared by presence and never `false`. The harness validates the guarantees of whatever host a test hands the adapter. |
| `validateHandlingReport(report, path?, manifest?)` | What the host reports of a leg it performed, for an adapter to check before forwarding: a task, a step, when it began, a positive `seconds` where stated, and an explicit `ended` that carries the final duration. Given the manifest, a running report is refused unless it declares `runningStepReports`. |
| `validateHostReport(report)` | The host's own report as published to an adapter: `online`, and where there is audio, an input that is `available` with the microphone and `flowing`, or `unavailable` with a reason and the failure that says why, and an output that is `available` or `unavailable` with its failure. The harness validates whatever host a test hands the adapter; `stillHost(report)` builds one that never changes. |
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
`assertReached(result, subjects)` is the paired assertion: it throws naming every subject the run
never met, so a test that meant to check a roster cannot pass on a fixture that never produced one.

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
| `assertCommandRefusedAfterWithdrawal(result)` | A command that arrives after its capability was withdrawn fails with `omni.capability-not-enabled`, named by the provider. The same assertion serves a command the provider never supported under a capability it declares. |
| `assertReached(result, subjects)` | The exercise met every subject named; throws listing those it did not. Pair it with a clean `exerciseAdapter` result. |
| `assertAuthenticationRestoreAndExpiry(states)` | A restored authenticated session can refresh and ends in expiry. Every state is validated. |
| `assertReconnectWithMissedAssignments(before, reconnect, ids)` | A reconnect snapshot restores assignments received while offline. |
| `stillHost(report?)` | A host that reports one thing and never changes, for a test context: `{ online: true }` by default, a report with audio for a voice adapter. |
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
