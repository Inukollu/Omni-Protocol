// The Omni protocol.
//
// Where this file and guide.md disagree, the guide is right and this is a defect.

/** The protocol version implemented by this package. */
export const OMNI_PROTOCOL_VERSION = 1 as const;

/** Every version this package can interoperate with. */
export const OMNI_SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [OMNI_PROTOCOL_VERSION];

/**
 * Highest version supported by both the adapter and the host, or `undefined` when they cannot
 * interoperate. Omni must refuse to connect on `undefined` rather than attempting partial
 * compatibility.
 */
export function negotiateProtocolVersion(
  adapterVersions: readonly number[],
  hostVersions: readonly number[] = OMNI_SUPPORTED_PROTOCOL_VERSIONS,
): number | undefined {
  const host = new Set(hostVersions);
  const shared = adapterVersions.filter(version => host.has(version));
  return shared.length === 0 ? undefined : Math.max(...shared);
}

// ---------------------------------------------------------------------------
// Semantic types.
//
// Two values sharing a primitive wire representation but differing in meaning or validation get
// a name here, and every contract field uses the name rather than repeating the primitive.
// ---------------------------------------------------------------------------

/**
 * An RFC-3339 timestamp with `Z` or an explicit numeric offset.
 *
 * Timezone-less values are invalid: the same string read on two hosts would be two different
 * instants. A JavaScript `Date` never crosses this boundary.
 */
export type IsoTimestamp = string;

/**
 * A non-empty, opaque, stable identifier for a person, issued by the provider.
 *
 * It names agents and managers alike; the role comes from where the value appears, not from its
 * type. Compare it exactly and only within one provider -- there is no Omni-wide user identity,
 * so two providers will eventually issue the same string for different people. Scope it with the
 * provider id through `userKey()` before storing or comparing.
 */
export type UserId = string;

/** A non-empty, opaque task identifier unique within one provider. Scope it with `taskKey()`. */
export type TaskId = string;

/** A non-negative whole number of seconds. */
export type DurationSeconds = number;

// ---------------------------------------------------------------------------
// Channel and identity.
// ---------------------------------------------------------------------------

/** New channels require a later protocol version. */
export type Channel = "voice" | "chat" | "email";

export interface User {
  id: UserId;
  displayName: string;
}

/** Key/value detail on a `Contact` or a `ScheduledActivity`. A task's attributes are typed. */
export interface Attribute {
  key: string;
  value: string;
}

export interface ProtocolFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/** One broken rule. Validators return every violation they find rather than throwing. */
export interface ProtocolViolation {
  /** Stable machine-readable rule id, such as `task.browser.url.scheme`. */
  rule: string;
  /** Dotted path to the offending value, such as `snapshot.tasks[0].browsers[1].url`. */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Manifest.
// ---------------------------------------------------------------------------

export type AuthenticationMethod = "browser-sso" | "credentials";

export interface BrowserAccessPolicy {
  /** The decision when no list entry matches. */
  mode: "allow-all" | "block-all";
  allowList?: string[];
  blockList?: string[];
}

export interface PersonalBrowserCapability {
  access: BrowserAccessPolicy;
  accessPolicyScope?: "initial-url" | "all-navigation";
}

export type DialDestinationPolicy = "contacts-only" | "any-number";

export interface DialCapability {
  destinationPolicy: DialDestinationPolicy;
}

/** Every idle capability a provider may declare. Only voice may `dial`; the channel arm says so. */
export const IDLE_CAPABILITIES = ["dial", "personalBrowser", "calendar", "contacts"] as const;

export type IdleCapability = (typeof IDLE_CAPABILITIES)[number];

/** What Omni calls each idle capability. */
export const IDLE_CAPABILITY_UI = {
  dial: "Dialpad",
  personalBrowser: "Browser",
  calendar: "Calendar",
  contacts: "Contacts",
} as const satisfies Readonly<Record<IdleCapability, string>>;

/**
 * Actions Omni may offer while the agent has no active task.
 *
 * The channel arm is what makes `dial` a compile error on chat and email rather than a runtime
 * one. Presence is the declaration: `calendar: true` says offer it, and omitting it says do not.
 */
export type IdleCapabilities<C extends Channel = Channel> = {
  personalBrowser?: PersonalBrowserCapability;
  calendar?: true;
  contacts?: true;
} & (C extends "voice" ? { dial?: DialCapability } : { dial?: never });

export type TaskPhaseLabels = Readonly<Partial<Record<TaskPhase, string>>>;

export interface TaskTypePresentation {
  singular: string;
  plural: string;
  referenceLabel?: string;
}

export interface Manifest<C extends Channel = Channel> {
  /** Stable, installation-wide unique, and unchanged between launches. */
  id: string;
  displayName: string;
  channel: C;
  /** Every version this adapter can speak, not only the one it was compiled against. */
  supportedProtocolVersions: number[];
  authenticationMethods: AuthenticationMethod[];
  idleCapabilities?: IdleCapabilities<C>;
  phaseLabels?: TaskPhaseLabels;
  /** Keyed by `taskType`. An entry replaces the channel default outright rather than merging. */
  taskTypePresentation?: Record<string, TaskTypePresentation>;
}

// ---------------------------------------------------------------------------
// Authentication and connection.
// ---------------------------------------------------------------------------

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AuthenticationContext {
  protocolVersion: number;
  /** Omni's identity for this login. The same value arrives later as `ConnectContext.sessionId`. */
  sessionId: string;
  /** Scoped to this provider's manifest id. */
  secrets: SecretStore;
  signal?: AbortSignal;
  /** Never include credentials, tokens, or contact data. */
  log?: (entry: unknown) => void;
}

export interface AuthenticationFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  /** Names a declared credentials field when the failure belongs to one. */
  field?: string;
}

/**
 * Only `authenticated` and `refreshing` know who the agent is, and only `authenticated` has
 * something to expire. A state carrying more than it knows is a state Omni would render as fact.
 */
export type AuthenticationState =
  | { status: "signed-out" }
  | { status: "authenticating" }
  | { status: "authenticated"; identity: User; expiresAt?: IsoTimestamp }
  | { status: "refreshing"; identity: User }
  | { status: "expired"; identity?: User; failure?: AuthenticationFailure };

export interface CredentialField {
  name: string;
  label: string;
  type: "text" | "password";
  required?: boolean;
  autocomplete?: string;
}

export type AuthenticationChallenge =
  | { flowId: string; method: "browser-sso"; authorizationUrl: string; browser: "system" | "omni" }
  | { flowId: string; method: "credentials"; fields: CredentialField[] };

export type StartAuthenticationRequest =
  | { requestId: string; method: "browser-sso"; callbackUrl: string }
  | { requestId: string; method: "credentials" };

export type StartAuthenticationResult =
  | { status: "interaction-required"; challenge: AuthenticationChallenge }
  | { status: "rejected"; failure: AuthenticationFailure };

export type CompleteAuthenticationRequest =
  | { flowId: string; method: "browser-sso"; callbackUrl: string }
  | { flowId: string; method: "credentials"; values: Readonly<Record<string, string>> };

export type CompleteAuthenticationResult =
  | { status: "authenticated"; identity: User; expiresAt?: IsoTimestamp }
  | { status: "rejected"; failure: AuthenticationFailure };

export type AuthenticationActionResult =
  | { status: "accepted" }
  | { status: "failed"; failure: AuthenticationFailure };

export type Unsubscribe = () => void;

export interface AuthenticationSession {
  state(): AuthenticationState | Promise<AuthenticationState>;
  subscribe(listener: (state: AuthenticationState) => void): Unsubscribe;
  start(request: StartAuthenticationRequest): Promise<StartAuthenticationResult>;
  complete(request: CompleteAuthenticationRequest): Promise<CompleteAuthenticationResult>;
  /** Cancels an abandoned SSO window or credentials form. */
  cancelAuthentication(flowId: string): Promise<AuthenticationActionResult>;
  signOut(): Promise<AuthenticationActionResult>;
  close(): Promise<void>;
}

export interface ConnectContext {
  protocolVersion: number;
  /** The session that authenticated this connection. */
  sessionId: string;
  /** Omni-side policy: whether the agent's tasks are accepted without asking them. */
  autoAcceptTasks?: boolean;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
}

export type ConnectionStatus = "connecting" | "active" | "error";

// ---------------------------------------------------------------------------
// Idle contributions.
// ---------------------------------------------------------------------------

/** Every field is optional: a provider sends what it knows and omits what it does not. */
export interface Contact {
  name?: string;
  number?: string;
  email?: string;
  attributes?: Attribute[];
}

export interface ScheduledActivity {
  id: string;
  title: string;
  startsAt: IsoTimestamp;
  endsAt?: IsoTimestamp;
  contact?: Contact;
  attributes?: Attribute[];
}

// ---------------------------------------------------------------------------
// Task capabilities.
// ---------------------------------------------------------------------------

export interface DispositionCode {
  id: string;
  label: string;
  group?: string;
}

export interface DispositionPolicy {
  required?: boolean;
  notes?: "required" | "optional" | "hidden";
  codes?: DispositionCode[];
}

export interface Destination {
  id: string;
  label: string;
  address: string;
  /** `agent` here is a routing target, not the person signed in. */
  kind: "queue" | "agent" | "external";
}

export interface DestinationDirectory {
  destinations?: Destination[];
  allowManualEntry: boolean;
}

export interface CustomCapability {
  id: string;
  ui: {
    kind: "button" | "toggle" | "menu-item";
    label: string;
    placement: "primary" | "secondary" | "overflow";
  };
}

export interface SharedTaskCapabilities {
  browsers?: true;
  dispositions?: true | DispositionPolicy;
  custom?: CustomCapability[];
}

/**
 * A capability says *offer this control*, and nothing about who carries it out.
 *
 * The channel arms are why `Task<"email">` rejects `hold` at compile time rather than at runtime.
 */
export type TaskCapabilities<C extends Channel = Channel> =
  C extends "voice"
    ? SharedTaskCapabilities & {
        decline?: true;
        mute?: true;
        hold?: true;
        agentDisconnect?: true;
        /** Reach the party again while `completing`; the task returns to `in-progress`. */
        callback?: true;
        blindTransfer?: true | DestinationDirectory;
        conference?: true | DestinationDirectory;
        recording?: true;
      }
    : C extends "chat"
      ? SharedTaskCapabilities & { reject?: true; hold?: true }
      : SharedTaskCapabilities & { reject?: true };

// ---------------------------------------------------------------------------
// Task workspace.
// ---------------------------------------------------------------------------

/**
 * How a reusing browser's session is keyed.
 *
 * Named constants rather than a bare union because the values are structured strings: easy to
 * mistype and unreadable as an argument.
 */
export const BROWSER_ISOLATION_SCHEMES = {
  PROVIDER_NAME__TASK_ID__TAB_NAME: "ProviderName.TaskId.TabName",
  TAB_NAME: "TabName",
  PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME: "ProviderName.TaskTypeName.TabName",
  PROVIDER_NAME__TAB_NAME: "ProviderName.TabName",
  PROVIDER_NAME__TASK_TYPE_NAME: "ProviderName.TaskTypeName",
  TASK_TYPE_NAME__TAB_NAME: "TaskTypeName.TabName",
} as const;

export type BrowserIsolationScheme =
  (typeof BROWSER_ISOLATION_SCHEMES)[keyof typeof BROWSER_ISOLATION_SCHEMES];

export interface TaskBrowserBase {
  id: string;
  name: string;
  purpose: string;
  /** `http:` or `https:` only. */
  url: string;
}

/**
 * The union is what makes a reusing browser with no scheme fail to compile rather than inherit
 * a default -- which is how two tasks end up sharing a session nobody intended.
 */
export type TaskBrowser = TaskBrowserBase & (
  | { reuse: false; isolationScheme?: never }
  | { reuse: true; isolationScheme: BrowserIsolationScheme }
);

export const ALLOWED_BROWSER_URL_SCHEMES = ["http:", "https:"] as const;

export function isAllowedBrowserUrl(url: string): boolean {
  try {
    return (ALLOWED_BROWSER_URL_SCHEMES as readonly string[]).includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Task.
// ---------------------------------------------------------------------------

export type TaskPhase =
  /** Allocated to this agent and not yet accepted. */
  | "pending"
  /** Accepted, and not yet started. */
  | "confirmed"
  /** Being made ready -- a preview the agent reads before the work begins. */
  | "preparing"
  | "in-progress"
  | "paused"
  /** The work is over and the agent is finishing up. */
  | "completing";

/** Who ends the task: the agent issuing `complete`, or the provider deciding it is over. */
export type CompletionMode = "agent-command" | "provider-automatic";

export interface TaskAttributeBase {
  key: string;
  label?: string;
}

export type TaskAttribute = TaskAttributeBase & (
  | { type: "text"; value: string }
  | { type: "contact"; contact: Contact }
  | { type: "timestamp"; at: IsoTimestamp }
);

export type HandlingStep =
  | "queued"
  | "offered"
  | "answered"
  | "held"
  | "muted"
  | "transferred"
  | "conferenced"
  | "unanswered";

export interface TaskHandlingStep {
  step: HandlingStep;
  at: IsoTimestamp;
  /**
   * Reported, never derived. An entry may be written while its leg is still running, so there is
   * no end to subtract from -- and omitted is the honest report of that, where nought would
   * claim it took no time.
   */
  seconds?: DurationSeconds;
  /**
   * Who took part. Absent on `queued`, where nobody does; absent on any other step means the
   * provider could not attribute it, which is a different claim and a legitimate one.
   */
  by?: UserId;
}

/**
 * How the task ends, and how long after handling the provider allows for it.
 *
 * The allowance is coupled to the mode. Under `provider-automatic` the provider acts on it, so it
 * is required. Under `agent-command` the provider will not complete the task itself, so it may
 * omit the allowance to say it imposes no deadline -- and Omni then counts nothing down. Omitted
 * and `0` are different claims: no deadline to see, and a deadline of now.
 */
export type TaskCompletion =
  | { completionMode: "agent-command"; completionAllowance?: DurationSeconds }
  | { completionMode: "provider-automatic"; completionAllowance: DurationSeconds };

export type Task<C extends Channel = Channel> = {
  id: TaskId;
  title: string;
  channel: C;
  /** The provider's own name for a category of work. Finer-grained than a channel. */
  taskType: string;
  capabilities: TaskCapabilities<C>;
  browsers: TaskBrowser[];
  contact?: Contact;
  phase: TaskPhase;
  /** The identifier an agent reads back to a customer, where the provider has one. */
  reference?: string;
  attributes?: TaskAttribute[];
  handlingHistory?: TaskHandlingStep[];
} & TaskCompletion;

/** What the provider wants of Omni's acceptance policy for one offer. */
export type AcceptanceMode =
  | "no-preference"
  | "require-agent-acceptance"
  | "require-automatic-acceptance";

export type TaskOutcome =
  | { type: "completed"; by: "agent" | "provider" }
  | { type: "transferred"; destination?: string }
  | { type: "cancelled"; reason?: string }
  /** Only the phases in which somebody is still being waited on can expire. */
  | { type: "expired"; phase: "pending" | "confirmed" | "preparing" }
  | { type: "failed"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Task commands.
// ---------------------------------------------------------------------------

export const TASK_COMMAND_NAMES = {
  voice: ["answer", "decline", "start-call", "mute", "hold", "resume", "disconnect",
          "callback", "transfer", "conference", "recording", "complete"],
  chat: ["accept", "reject", "pause", "resume", "complete"],
  email: ["accept", "reject", "complete"],
} as const;

export type TaskCommandName<C extends keyof typeof TASK_COMMAND_NAMES> =
  (typeof TASK_COMMAND_NAMES)[C][number];

export interface DispositionPayload {
  disposition?: string;
  notes?: string;
}

export type VoiceTaskCommand =
  | { type: "answer" }
  | { type: "decline" }
  | { type: "start-call" }
  | { type: "mute"; muted: boolean }
  | { type: "hold" }
  | { type: "resume" }
  | { type: "disconnect" }
  /** Issuable only in `completing`, under the `callback` capability. Carries no destination. */
  | { type: "callback" }
  | { type: "transfer"; destination: string }
  | { type: "conference"; participant: string; action: "add" | "remove" }
  | { type: "recording"; action: "start" | "pause" | "resume" | "stop" }
  | ({ type: "complete" } & DispositionPayload);

export type ChatTaskCommand =
  | { type: "accept" }
  | { type: "reject" }
  | { type: "pause" }
  | { type: "resume" }
  | ({ type: "complete" } & DispositionPayload);

export type EmailTaskCommand =
  | { type: "accept" }
  | { type: "reject" }
  | ({ type: "complete" } & DispositionPayload);

export interface CustomTaskCommand {
  type: "custom";
  name: string;
  [key: string]: unknown;
}

export type TaskCommand<C extends Channel = Channel> =
  | (C extends "voice" ? VoiceTaskCommand : C extends "chat" ? ChatTaskCommand : EmailTaskCommand)
  | CustomTaskCommand;

export interface TaskCommandRequest<C extends Channel = Channel> {
  /** Stable across retries. Processing one twice must not repeat its side effects. */
  commandId: string;
  taskId: TaskId;
  command: TaskCommand<C>;
}

/**
 * `applied` and `already-applied` rather than a verb per command: the command travels in the
 * request, so `execute({ command: { type: "hold" } })` returning `applied` already says the hold
 * applied.
 */
export type TaskCommandResult =
  | { commandId: string; status: "applied" | "already-applied" }
  | { commandId: string; status: "failed"; failure: ProtocolFailure };

export interface DialRequest {
  commandId: string;
  destination: string;
}

export type DialResult =
  | { commandId: string; status: "dialled" | "already-dialled" }
  | { commandId: string; status: "failed"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Breaks.
// ---------------------------------------------------------------------------

export type BreakApproval =
  | "not-requested"
  /** Somebody has to decide. The agent is waiting on a person. */
  | "awaiting-decision"
  /** Granted, and a promise to honour a later commit. */
  | "granted"
  /** Granted and begins when the current task ends. Nobody needs to act. */
  | "starting-after-task"
  | "in-effect";

export const BREAK_KINDS = [
  "short-break", "meal", "rest", "training", "coaching",
  "meeting", "administrative", "technical", "personal", "other",
] as const;

/**
 * The breaks a contact centre runs, named once so providers can agree.
 *
 * An agent takes one break, not one per platform, so Omni has to know when two providers mean
 * the same thing -- and it cannot tell from the labels, which are each deployment's own words.
 * Every member's meaning is defined in the guide; ten undefined strings would be the label
 * problem one level up. `other` matches nothing, including another provider's `other`.
 */
export type BreakKind = (typeof BREAK_KINDS)[number];

export interface BreakReason {
  id: string;
  label: string;
  group?: string;
  kind?: BreakKind;
  /** Survives `accepting: false`: a mandatory rest is not something a busy hour can cancel. */
  alwaysAvailable?: true;
}

export interface BreakRequest {
  /** Stable across retries, and what makes `already-requested` recognisable. */
  requestId: string;
  reason?: string;
  /** The chosen `BreakReason.id`, where the provider publishes codes. */
  reasonId?: string;
}

/**
 * A break placed on the agent rather than requested by them.
 *
 * `by` is required in both arms. Who put somebody off the floor survives whether or not the
 * break ends on a clock -- an imposed break with no origin is a state the agent cannot reason
 * about, and one that ends on a condition is still somebody's decision.
 */
export type ImposedBreak =
  | { by: UserId; endsAutomatically: true; endsAt: IsoTimestamp }
  | { by: UserId; endsAutomatically: false; endsAt?: never };

export interface BreakState {
  approval: BreakApproval;
  requestId?: string;
  /** Whether the agent may ask at all. Distinct from the fate of a request already made. */
  accepting: boolean;
  /** Shown when `accepting` is false, such as "Busy hours". */
  refusedReason?: string;
  decisionReason?: string;
  retryAfterMs?: number;
  /** Not-ready codes this provider offers. Omitted when it defines none. */
  reasons?: BreakReason[];
  /** Which reason the current break is on. Omitted when there is no break. */
  activeReasonId?: string;
  imposed?: ImposedBreak;
}

export type CapacityResult =
  | { status: "accepted" }
  | { status: "failed"; failure: ProtocolFailure };

/** Succeeding is not the outcome: `requested` says the provider holds it, not that it was granted. */
export type BreakRequestResult =
  | { requestId: string; status: "requested" | "already-requested" }
  | { requestId: string; status: "failed"; failure: ProtocolFailure };

export type BreakCommitResult =
  | { requestId: string; status: "committed" | "already-committed" }
  | { requestId: string; status: "failed"; failure: ProtocolFailure };

export type BreakCancelResult =
  | { requestId: string; status: "cancelled" | "already-cancelled" }
  | { requestId: string; status: "failed"; failure: ProtocolFailure };

export type BreakEndResult =
  | { status: "ended" | "already-ended" }
  | { status: "failed"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Team.
// ---------------------------------------------------------------------------

export type TeamMemberAvailability = "ready" | "on-task" | "on-break" | "signed-out";

export interface TeamMember {
  id: UserId;
  availability: TeamMemberAvailability;
  /** Omitted rather than invented: Omni renders it as a duration. */
  since?: IsoTimestamp;
  break?: BreakApproval;
}

/**
 * Published only to an agent entitled to one. Its presence is the permission -- nothing else
 * makes somebody a lead, and there is no separate flag to fall out of step with the data.
 */
export interface TeamRoster {
  members: TeamMember[];
  breakControl?: true;
}

export type TeamBreakCommand =
  | { type: "decide"; memberId: UserId; decision: "granted" | "denied"; reason?: string }
  | { type: "policy"; policy: "ask" | "auto-approve" | "suspended" }
  | { type: "place"; memberId: UserId; reason?: string }
  | { type: "release"; memberId: UserId };

export type TeamCommandResult =
  | { commandId: string; status: "applied" | "already-applied" }
  | { commandId: string; status: "failed"; failure: ProtocolFailure };

export interface TeamBreakCommandRequest {
  commandId: string;
  command: TeamBreakCommand;
}

// ---------------------------------------------------------------------------
// Media.
// ---------------------------------------------------------------------------

export interface VoiceMediaSession {
  remoteAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): void;
}

export interface OpenMediaRequest {
  taskId: TaskId;
  localAudio: MediaStream;
}

export type OpenMediaResult =
  | { status: "opened"; session: VoiceMediaSession }
  | { status: "unavailable"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Provider state and events.
// ---------------------------------------------------------------------------

export interface SessionCapabilities {
  breaks?: true;
  teamBreakControl?: true;
}

/** The provider's complete state at one moment. It replaces what Omni holds; never a patch. */
export interface Snapshot<C extends Channel = Channel> {
  status: ConnectionStatus;
  sessionId: string;
  sessionCapabilities: SessionCapabilities;
  break: BreakState;
  /** Every task currently owned by this agent for this provider. */
  tasks: Task<C>[];
  contacts?: Contact[];
  scheduledActivities?: ScheduledActivity[];
  team?: TeamRoster;
}

/**
 * How many tasks this provider may have allocated to the agent at once.
 *
 * An absolute ceiling, never less than 1, standing until Omni restates it. The provider counts
 * its own outstanding tasks against it and needs no new signal when one ends. What the agent
 * holds at other providers is not this provider's concern -- Omni set `count` knowing it.
 */
export interface AgentCapacity {
  count: number;
}

export interface SummaryMetric {
  id: string;
  label: string;
  value: string;
}

export interface ProviderSummary {
  title: string;
  subtitle?: string;
  waitingCount: number;
  updatedAt: IsoTimestamp;
  metrics?: SummaryMetric[];
}

export type ProviderEvent<C extends Channel = Channel> =
  | { type: "snapshot"; reason: "reconnected" | "provider-requested"; snapshot: Snapshot<C> }
  | { type: "provider-status"; status: ConnectionStatus; message?: string }
  | { type: "break-state"; break: BreakState }
  | {
      type: "task-offered";
      task: Task<C>;
      acceptanceMode?: AcceptanceMode;
      allocationExpiresAt?: IsoTimestamp;
      preparationEndsAt?: IsoTimestamp;
    }
  | { type: "task-updated"; task: Task<C> }
  | { type: "task-media-ended"; taskId: TaskId }
  | { type: "task-ended"; taskId: TaskId; outcome: TaskOutcome }
  | { type: "announcement"; text: string; html?: string; announcedAt: IsoTimestamp; expiresAt?: IsoTimestamp }
  | { type: "provider-summary"; summary: ProviderSummary }
  | { type: "team-updated"; team: TeamRoster }
  | { type: "contacts-updated"; contacts: Contact[] }
  | { type: "calendar-updated"; scheduledActivities: ScheduledActivity[] };

/**
 * The `Provider` prefix survives here for a mechanical reason rather than a naming one: `Event`
 * is a DOM global, and a bare one would shadow it for every adapter compiled against the browser
 * lib.
 */
export interface ProviderEventEnvelope<C extends Channel = Channel> {
  id: string;
  /** The login this belongs to. */
  sessionId: string;
  occurredAt: IsoTimestamp;
  event: ProviderEvent<C>;
}

export const OMNI_FAILURE_CODES = [
  "omni.not-authenticated",
  "omni.capability-not-enabled",
  "omni.task-not-found",
  "omni.destination-not-permitted",
  "omni.rate-limited",
  "omni.unavailable",
  "omni.break-already-committed",
] as const;

export type OmniFailureCode = (typeof OMNI_FAILURE_CODES)[number];

// ---------------------------------------------------------------------------
// The live connection.
// ---------------------------------------------------------------------------

export interface Connection<C extends Channel = Channel> {
  snapshot(): Snapshot<C> | Promise<Snapshot<C>>;
  /** Delivery order must match the order the provider observes changes. Never replay. */
  subscribe(listener: (envelope: ProviderEventEnvelope<C>) => void): Unsubscribe;
  /** Nothing may be allocated until a capacity is stated, so every connection receives it. */
  setCapacity(capacity: AgentCapacity): Promise<CapacityResult>;
  execute(request: TaskCommandRequest<C>): Promise<TaskCommandResult>;
  disconnect(): Promise<void>;

  /** Required of any adapter publishing a `UserId` -- on an imposed break, a roster, or history. */
  describeUsers?(ids: UserId[]): Promise<User[]>;
  /** Required when the manifest declares `idleCapabilities.dial`. */
  dial?(request: DialRequest): Promise<DialResult>;

  /**
   * The four break methods stand or fall together. Declaring `sessionCapabilities.breaks` and
   * implementing `requestBreak` without `commitBreak` leaves an agent granted a break that can
   * never start, and the two-phase coordination has no way to report it.
   */
  requestBreak?(request: BreakRequest): Promise<BreakRequestResult>;
  commitBreak?(requestId: string): Promise<BreakCommitResult>;
  cancelBreak?(requestId: string): Promise<BreakCancelResult>;
  endBreak?(): Promise<BreakEndResult>;

  /** Required when the adapter publishes a `TeamRoster` carrying `breakControl`. */
  executeTeamBreak?(request: TeamBreakCommandRequest): Promise<TeamCommandResult>;
  /** Required of every voice adapter: all voice audio lands in Omni. */
  openMedia?(request: OpenMediaRequest): Promise<OpenMediaResult>;
}

export interface Adapter<C extends Channel = Channel> {
  manifest: Manifest<C>;
  createAuthenticationSession(context: AuthenticationContext): Promise<AuthenticationSession> | AuthenticationSession;
  connect(context: ConnectContext): Promise<Connection<C>>;
}

/**
 * Preserves the adapter's inferred concrete type while checking it implements `Adapter`.
 * No connection, no runtime side effects.
 */
export function defineAdapter<C extends Channel, A extends Adapter<C>>(adapter: A): A {
  return adapter;
}

// ---------------------------------------------------------------------------
// Presentation defaults.
// ---------------------------------------------------------------------------

export const DEFAULT_TASK_PHASE_LABELS = {
  voice: {
    pending: "Offered", confirmed: "Accepted", preparing: "Preview",
    "in-progress": "On Call", paused: "On Hold", completing: "After Call Work",
  },
  chat: {
    pending: "Incoming Chat", confirmed: "Accepted", preparing: "Preparing",
    "in-progress": "In Chat", paused: "Paused", completing: "Wrap-up",
  },
  email: {
    pending: "Assigned", confirmed: "Accepted", preparing: "Reviewing",
    "in-progress": "Working", paused: "Paused", completing: "Completing",
  },
} as const satisfies Readonly<Record<Channel, Readonly<Record<TaskPhase, string>>>>;

export const DEFAULT_TASK_TYPE_PRESENTATION = {
  voice: { singular: "Call", plural: "Calls", referenceLabel: "Call ID" },
  chat: { singular: "Chat", plural: "Chats", referenceLabel: "Chat ID" },
  email: { singular: "Email", plural: "Emails", referenceLabel: "Email ID" },
} as const satisfies Readonly<Record<Channel, TaskTypePresentation>>;

// ---------------------------------------------------------------------------
// Utilities.
// ---------------------------------------------------------------------------

/**
 * A collision-safe global task key.
 *
 * Task ids are unique only within one provider, so two providers will eventually issue the same
 * string. Encoding before joining is what stops a provider id containing a separator from
 * forging another provider's key.
 */
export const taskKey = (providerId: string, taskId: TaskId): string =>
  `${encodeURIComponent(providerId)}:${encodeURIComponent(taskId)}`;

/**
 * The same treatment for a `UserId`, and needed for the same reason.
 *
 * There is no Omni-wide user identity: one person on several providers has several identities
 * and nothing here pairs them. A bare `UserId` is only ever compared against another from the
 * same provider; anything wider goes through this.
 */
export const userKey = (providerId: string, userId: UserId): string =>
  `${encodeURIComponent(providerId)}:${encodeURIComponent(userId)}`;

/** Every handling step somebody takes part in. `queued` is the one nobody does. */
export const HANDLING_STEPS_WITH_A_PERSON = [
  "offered", "answered", "held", "muted", "transferred", "conferenced", "unanswered",
] as const satisfies readonly HandlingStep[];

// Pinned both ways: a step added to `HandlingStep` has to be placed here, and a step listed here
// has to exist there. `satisfies` covers the second; this covers the first.
type Assert<T extends true> = T;
type _EveryStepButQueuedIsListed = Assert<
  [Exclude<HandlingStep, "queued">] extends [(typeof HANDLING_STEPS_WITH_A_PERSON)[number]] ? true : false
>;

/** Whether an absent `by` means "could not attribute" rather than "nobody was involved". */
export function handlingStepExpectsAPerson(step: HandlingStep): boolean {
  return (HANDLING_STEPS_WITH_A_PERSON as readonly HandlingStep[]).includes(step);
}

export interface BrowserSessionKeyInput {
  /** `Manifest.id`, never `displayName`: only the id is unique across an installation and stable. */
  providerId: string;
  taskId: TaskId;
  /** `Task.taskType`. */
  taskType: string;
  browser: TaskBrowser;
}

/**
 * The storage-profile key a reusing browser shares, or `undefined` where it shares nothing.
 *
 * Fails closed. A browser with `reuse: false` has no key; nor does a reusing one whose scheme is
 * missing or unknown -- the type forbids that, but an adapter compiled against another version can
 * still send it, and the safe reading is "do not share", never "share with everyone named the
 * same". Every part is encoded, separator included, before joining, so a tab called `a.b`
 * cannot collide with a provider called `a` and a tab called `b`.
 */
export function browserSessionKey(input: BrowserSessionKeyInput): string | undefined {
  const { providerId, taskId, taskType, browser } = input;
  if (browser.reuse !== true) return undefined;
  // `encodeURIComponent` leaves `.` untouched, and `.` is the separator: a raw join would let
  // provider `Acme.Voice` with type `Support` forge the key of `Acme` with `Voice.Support`.
  const part = (value: string) => encodeURIComponent(value).replaceAll(".", "%2E");
  switch (browser.isolationScheme) {
    case BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_ID__TAB_NAME:
      return `${part(providerId)}.${part(taskId)}.${part(browser.name)}`;
    case BROWSER_ISOLATION_SCHEMES.TAB_NAME:
      return part(browser.name);
    case BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME:
      return `${part(providerId)}.${part(taskType)}.${part(browser.name)}`;
    case BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TAB_NAME:
      return `${part(providerId)}.${part(browser.name)}`;
    case BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME:
      return `${part(providerId)}.${part(taskType)}`;
    case BROWSER_ISOLATION_SCHEMES.TASK_TYPE_NAME__TAB_NAME:
      return `${part(taskType)}.${part(browser.name)}`;
    default:
      return undefined;
  }
}

/**
 * The comparison key for a contact number. Never for display: keep the original value for that.
 *
 * Applies NFKC, strips whitespace, brackets, slashes, periods and every Unicode dash, and rewrites
 * a leading `00` to `+`, so `+1 (415) 555-0100`, `+1.415.555.0100` and `0014155550100` all merge.
 * Cross-provider merging is reliable only for E.164 input: a national-format number carries no
 * country context, nothing in this protocol supplies one, and so it does not merge with its
 * `+`-prefixed twin.
 */
export function normalizeContactNumber(number: string): string {
  const compact = number
    .normalize("NFKC")
    .trim()
    .replace(/[\s\p{Pd}().\/\\[\]]/gu, "")
    .replace(/^00/, "+");
  const digits = compact.replace(/\D/g, "");
  return compact.startsWith("+") ? `+${digits}` : digits;
}

/** The comparison key for a contact email. Never for display. */
export function normalizeContactEmail(email: string): string {
  return email.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}
