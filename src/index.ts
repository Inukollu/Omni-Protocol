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

/**
 * The host's identity for one dial, minted before the command leaves and unique across the
 * installation. A dial is the one command whose outcome arrives later and apart, so the provider
 * names this on the outcome and the host has already placed it. Never shown to the agent.
 */
export type DialId = string;

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

export interface BrowserAccess {
  /** The decision when no list entry matches. */
  mode: "allow-all" | "block-all";
  allowList?: string[];
  blockList?: string[];
}

export interface PersonalBrowserCapability {
  access: BrowserAccess;
  accessAppliesTo?: "initial-url" | "all-navigation";
}

export type DialDestinations = "contacts-only" | "any-number";

export interface DialCapability {
  destinations: DialDestinations;
}

/**
 * How a dial ended, as the switch distinguishes it. `answered` is the one success; the rest are
 * the ways a destination was not reached -- `cancelled` because the dialler called it off before
 * anyone answered, not because the destination failed to. A manifest declares which of these its
 * platform can tell apart (`dialOutcomes`), and a `dial-outcome` carries only a declared one.
 */
export type DialOutcome = "answered" | "busy" | "no-answer" | "unreachable" | "rejected" | "cancelled";

export const DIAL_OUTCOMES = ["answered", "busy", "no-answer", "unreachable", "rejected", "cancelled"] as const satisfies readonly DialOutcome[];

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
  /** The organisation's whole ladder, stated outright, `person` included. Omitted for the typical four, `DEFAULT_LEVELS`. */
  orgLevels?: LevelDeclaration[];
  /**
   * The outcomes this platform distinguishes when a dial ends, `answered` and at least one way of
   * not reaching the destination. Required of a provider that dials at all -- an idle dialpad, or
   * a task that may transfer, conference, or call back -- and forbidden off voice, where nothing dials.
   */
  dialOutcomes?: C extends "voice" ? DialOutcome[] : never;
  /**
   * The provider takes running reports of a host-performed step -- `recordStep` with `seconds`
   * so far and no `ended`. Absent, the host sends exactly two reports per leg, when it began and
   * when it ended, and a running report is refused: what a provider never asked for never crosses.
   */
  runningStepReports?: true;
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
  /** Omni's identity for this login. The same value arrives later as `ConnectContext.loginId`. */
  loginId: string;
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

/** What a lead may do with their team. Declared by presence. */
export interface TeamCapabilities {
  /**
   * This lead may act on their team's breaks through `executeTeamBreak` -- place, release, decide,
   * set policy -- as far as the provider supports; a command it lacks answers
   * `omni.capability-not-enabled`. Requires `executeTeamBreak`.
   */
  breakControl?: true;
  /** This lead may join a member's call on request. Requires `executeTeamConsult`. */
  consultControl?: true;
  /** This lead sets the team's policy per capability -- on, off, or the agent's -- within what the queue allows. Requires `executeTeamPolicy`. */
  policyControl?: true;
}

/**
 * What this login may do, beyond any one task. It travels with the identity because it is part
 * of who the agent is on this provider: the provider knows the roles and says so at sign-in.
 * Current as of the latest `authenticated` state, never fixed for the login.
 */
export interface UserCapabilities {
  /** This login may request a break. Requires the four break methods. */
  breaks?: true;
  /** The choices the team left to this person, with where each stands. Omitted when there are none. Requires `setPreference`. */
  preferences?: AgentPreference[];
  /** This login leads a team: a `TeamRoster` is published to it on every snapshot, `[]` included. */
  team?: TeamCapabilities;
}

/**
 * Only `authenticated` and `refreshing` know who the agent is and what they may do, and only
 * `authenticated` has something to expire. A state carrying more than it knows is a state Omni
 * would render as fact.
 */
export type AuthenticationState =
  | { status: "signed-out" }
  | { status: "authenticating" }
  | { status: "authenticated"; identity: User; capabilities: UserCapabilities; expiresAt?: IsoTimestamp }
  | { status: "refreshing"; identity: User; capabilities: UserCapabilities }
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
  | { status: "authenticated"; identity: User; capabilities: UserCapabilities; expiresAt?: IsoTimestamp }
  | { status: "rejected"; failure: AuthenticationFailure };

export type AuthenticationActionResult =
  | { status: "applied" }
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

/**
 * How the host's own audio stands: the microphone Omni captures for the agent, and whether it has
 * it. Omni facilitates the microphone -- captures it, prompts, retries, tells the agent -- and
 * does not decide for the adapter what a missing one means. The adapter does what its platform
 * needs: go not-ready, refuse calls, or carry on because audio lands elsewhere.
 */
export type HostAudioInput =
  /** Omni has the microphone. `flowing` is false while the hardware or OS says no audio moves through it. */
  | { status: "available"; localAudio: MediaStream; flowing: boolean }
  /** Omni does not, and `reason` says which fix the agent needs; `failure` is the words Omni showed them. */
  | { status: "unavailable"; reason: HostAudioUnavailableReason; failure: ProtocolFailure };

/**
 * Why the host has no microphone, each wanting a different fix from the agent: no device;
 * permission refused; permission never asked for (a host that asks at connect never says this);
 * a device present and permitted that another application holds; a capture that ended.
 */
export type HostAudioUnavailableReason = "no-device" | "denied" | "not-asked" | "in-use" | "lost";

/** Why the host has no speaker: no device, or one that was removed. */
export type HostOutputUnavailableReason = "no-device" | "lost";

export type HostAudioOutput =
  | { status: "available" }
  | { status: "unavailable"; reason: HostOutputUnavailableReason; failure: ProtocolFailure };

/**
 * What only the host can see about the agent's station: the devices, the permissions, the
 * network. Omni reports it; the adapter decides what any of it means for its platform and what
 * to relay. `audio` is present on a voice connection.
 */
/** What Omni's own chrome shows of a task browser's URL: nothing, the domain, or all of it. */
export type UrlVisibility = "full" | "domain" | "hidden";

export interface HostReport {
  /** Whether the host has a network interface up. Not a claim that anything is reachable: the adapter knows its own platform's reachability better than the host does. */
  online: boolean;
  audio?: {
    input: HostAudioInput;
    output: HostAudioOutput;
  };
}

/** The host, as an adapter may ask it: a report now, and every change for the life of the connection. */
/**
 * What the host promises the provider, declared once per connection. Presence is the guarantee:
 * an absent key is a host that makes no such promise, and a provider that needs one checks before
 * it acts -- tokenising a URL it would otherwise send in the clear, or declining to offer work
 * that only a person may accept.
 */
export interface HostGuarantees {
  /** Every task browser's `urlVisibility` is honoured in this host's chrome, tab by tab. */
  browserUrlVisibility?: true;
  /** A `consent` offer is accepted only by the person's own explicit act, never on their behalf. */
  personConsent?: true;
}

export interface Host {
  guarantees: HostGuarantees;
  report(): HostReport;
  subscribe(listener: (report: HostReport) => void): Unsubscribe;
}

export interface ConnectContext {
  protocolVersion: number;
  /** The session that authenticated this connection. */
  loginId: string;
  /** Omni-side policy: whether the agent's tasks are accepted without asking them. */
  autoAcceptTasks?: boolean;
  /**
   * The host's report of the agent's station, to consult before declaring the agent ready to the
   * platform and whenever it changes. Omni reports; the adapter decides.
   */
  host: Host;
  signal?: AbortSignal;
  log?: (entry: unknown) => void;
}

export type TransportStatus = "connecting" | "active" | "error";

/**
 * What revives a connection that reported `error`: `reconnect` -- the login is good, dispose this
 * connection and call `connect()` again -- or `reauthenticate` -- run the authentication flow
 * first. The adapter knows which; the host acts on its word.
 */
export type TransportRecovery = "reconnect" | "reauthenticate";

// ---------------------------------------------------------------------------
// Idle contributions.
// ---------------------------------------------------------------------------

/** Every field is optional: a provider sends what it knows and omits what it does not. */
export interface Contact {
  name?: string;
  /** The number, or `{ lockedBy }` where the queue says the agent may not see it: the last digits or nothing are sent, never a flag to honour. */
  number?: Lockable<string>;
  /** The email, or `{ lockedBy }` where the agent may not see it; it identifies a person as a number does. */
  email?: Lockable<string>;
  attributes?: Attribute[];
}

export interface ScheduledActivity {
  id: string;
  title: string;
  startsAt: IsoTimestamp;
  endsAt?: IsoTimestamp;
  /** The person the activity reaches -- a callback's customer. */
  party?: Contact;
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

export interface DispositionRules {
  required?: boolean;
  notes?: "required" | "optional" | "none";
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
    control: "button" | "toggle" | "menu-item";
    label: string;
    placement: "primary" | "secondary" | "overflow";
    /** Where the control's work renders: inline in the workspace, or as a page of its own. Inline when absent. */
    render?: "inline" | "page";
  };
  /** What the agent supplies before the action runs; the values travel on the custom command. */
  prompt?: { fields: CredentialField[] };
}

export interface SharedTaskCapabilities {
  browsers?: true;
  dispositions?: true | DispositionRules;
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
        decline?: Lockable<true>;
        mute?: Lockable<true>;
        hold?: Lockable<true>;
        agentDisconnect?: Lockable<true>;
        /** Reach the party again while `completing`; the task returns to `in-progress`. */
        callback?: Lockable<true>;
        blindTransfer?: Lockable<true | DestinationDirectory>;
        /** Park the customer and call a destination first; then `complete` or `cancel`. */
        consultTransfer?: Lockable<true | DestinationDirectory>;
        /** Ask a lead to join this call, with a note. The lead's decision arrives on `Task.lead`. */
        consultLead?: Lockable<true>;
        conference?: Lockable<true | DestinationDirectory>;
        recording?: Lockable<true>;
      }
    : C extends "chat"
      ? SharedTaskCapabilities & { reject?: Lockable<true>; hold?: Lockable<true> }
      : SharedTaskCapabilities & { reject?: Lockable<true> };

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

/** One tab, in either workspace. */
export interface Browser {
  id: string;
  name: string;
  /** `http:` or `https:` only. */
  url: string;
}

/**
 * A tab the task brought: fixed at the task's definition -- count and details -- with why it is
 * there, whether its session is shared across tasks, and whether the agent may read its URL. The
 * union is what makes a reusing browser with no scheme fail to compile rather than inherit a
 * default -- which is how two tasks end up sharing a session nobody intended.
 */
export type TaskBrowser = Browser & {
  purpose: string;
  /** Hide this tab's URL from the agent in Omni's chrome. Omitted, the URL shows as any browser's does; a provider says `hidden` where the URL carries what the agent may not read. */
  urlVisibility?: UrlVisibility;
} & (
  | { sharedSession: false; isolationScheme?: never }
  | { sharedSession: true; isolationScheme: BrowserIsolationScheme }
);

/** A tab the agent opened in the personal workspace: theirs, as many as they like, and never on the wire. */
export type PersonalBrowser = Browser;

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
  | { type: "contact"; party: Contact }
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

/**
 * The call record: the steps that brought the task here, one entry per occurrence and oldest
 * first, and what they add up to before this agent -- stated by the provider from its own record,
 * never summed by a desk from instants. Each total is present when the provider knows it and
 * absent when it does not; a plausible nought is the fallback the no-fallbacks rule forbids. The
 * record rides on the task and is replaced with it, so a late entry corrects the sums.
 */
export interface TaskHandlingHistory {
  steps: TaskHandlingStep[];
  /** Seconds others spent handling it before this agent. */
  handleSeconds?: DurationSeconds;
  /** Seconds the caller spent on hold at others' hands. */
  holdSeconds?: DurationSeconds;
  /** Seconds waiting before anyone answered. */
  queueSeconds?: DurationSeconds;
  /** How many times the task changed hands. */
  transfers?: number;
}

export interface TaskHandlingStep {
  step: HandlingStep;
  at: IsoTimestamp;
  /**
   * On a step that dialled -- `transferred`, `conferenced`, `unanswered` -- the host's identity for
   * that dial when a host placed it, and the address it went to. Neither belongs on any other step.
   */
  dialId?: DialId;
  destination?: string;
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
  | { completionMode: "agent-command"; wrapAllowance?: DurationSeconds }
  | { completionMode: "provider-automatic"; wrapAllowance: DurationSeconds };

export type OnCallRole = "party" | "agent" | "consulted" | "conferenced";

export const ON_CALL_ROLES = ["party", "agent", "consulted", "conferenced"] as const satisfies readonly OnCallRole[];

/**
 * Somebody on the call, or being brought onto it, as the provider states it: who, since when, and
 * whether they are held aside. `party` is the customer; `agent` a person, by user id; `consulted`
 * and `conferenced` someone a dial is bringing in -- listed from the moment the dial is placed, so
 * the agent can call it off while it rings -- carrying the dial when a host placed it and the
 * address either way. Whether they answered is the `dial-outcome`'s to say. `label` names a
 * destination -- a person, a queue -- not a phrase. At most one `party` and one `consulted`: the
 * consult commands name neither because there is exactly one.
 */
export type OnCall = { since: IsoTimestamp; held?: true } & (
  | { role: "party" }
  | { role: "agent"; userId: UserId }
  | { role: "consulted" | "conferenced"; destination: string; dialId?: DialId; label?: string }
);

/**
 * The agent's request for a lead, from asking until the lead leaves or the request ends.
 * `requested` while nobody has joined; `joined`, with `leadId`, once somebody has.
 */
export interface TaskLead {
  stage: "requested" | "joined";
  leadId?: UserId;
  note?: string;
  since: IsoTimestamp;
}

/**
 * On the lead's own task for a call they joined: which member asked, with their note. Its
 * presence is what makes `lead` `take-over` and `leave` issuable.
 */
export interface TaskAssisting {
  memberId: UserId;
  note?: string;
  since: IsoTimestamp;
}

/**
 * A level of the organisation's structure, by the id its manifest declares -- or one of the four
 * a typical organisation has, `DEFAULT_LEVELS`, when the manifest declares no ladder. The protocol
 * never describes the chain: which levels a person passes through is the structure's to know.
 */
export type Level = string;

/** A level the structure has, with the label a desk shows for "who decided". */
export interface LevelDeclaration {
  id: Level;
  label: string;
}

/**
 * The levels a typical organisation has: the ladder in force when a manifest declares no
 * `orgLevels`. A manifest that declares any states its whole ladder outright.
 */
export const DEFAULT_LEVELS = [
  { id: "org", label: "Your organisation" },
  { id: "site", label: "Your site" },
  { id: "team", label: "Your team" },
  { id: "person", label: "You" },
] as const satisfies readonly LevelDeclaration[];

/** The ladder in force for a manifest: exactly what it declares, or the defaults when it declares none. */
export function effectiveLevels(declared: readonly LevelDeclaration[] | undefined): LevelDeclaration[] {
  return [...(declared ?? DEFAULT_LEVELS)];
}

/**
 * Something the queue could allow, locked above the person: the level that made it unchangeable,
 * and why if they said. `person` never locks their own value, and the queue is not a level --
 * what the queue does not allow at all is simply absent.
 */
export interface Locked {
  lockedBy: Level;
  reason?: string;
}

/**
 * A value, or `{ lockedBy }` in its place: present without permission, saying whose. `lockedBy`
 * is the discriminant: a value that carries it is the lock, so no `T` may carry that key.
 */
export type Lockable<T> = T | Locked;

export type Task<C extends Channel = Channel> = {
  id: TaskId;
  title: string;
  channel: C;
  /** The provider's own name for a category of work. Finer-grained than a channel. */
  taskType: string;
  capabilities: TaskCapabilities<C>;
  browsers: TaskBrowser[];
  /** The person or entity on the other end of this task. Who the task is with; `contacts` on the snapshot is the directory. */
  party?: Contact;
  phase: TaskPhase;
  /**
   * How this offer is accepted, stated on the pending task rather than the offer so a reconnect
   * snapshot says it too: an offer the host never received is not accepted on the person's behalf
   * for want of a word. Required while `pending` when Omni said it may auto-accept
   * (`autoAcceptTasks: true`), forbidden when it said not, and absent past `pending`.
   */
  acceptance?: AcceptanceMode;
  /** The identifier an agent reads back to a customer, where the provider has one. */
  reference?: string;
  attributes?: TaskAttribute[];
  handlingHistory?: TaskHandlingHistory;
} & TaskCompletion
  // Who is on the call, a lead on it, and real-time media are voice affairs; the arm makes them compile errors elsewhere.
  & (C extends "voice"
    ? { onCall?: OnCall[]; lead?: TaskLead; assisting?: TaskAssisting; media?: TaskMediaState }
    : { onCall?: never; lead?: never; assisting?: never; media?: never });

/**
 * What the provider wants of Omni's acceptance policy for one offer. Present only where Omni was
 * willing to accept for the agent (`autoAcceptTasks: true`): `consent` is therefore always the
 * provider's requirement of an explicit acceptance, never Omni's own policy, which travels as an
 * absent field.
 */
export type AcceptanceMode =
  | "no-preference"
  | "consent"
  | "automatic";

export type TaskOutcome =
  | { type: "completed"; by: "agent" | "provider" }
  | { type: "transferred"; destination?: string }
  | { type: "cancelled"; reason?: string }
  /** Only the phases in which somebody is still being waited on can expire. */
  | { type: "expired"; phase: "pending" | "confirmed" | "preparing" }
  /** This agent left a call that continues without them: a lead who joined and dropped. */
  | { type: "left" }
  | { type: "failed"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Task commands.
// ---------------------------------------------------------------------------

export const TASK_COMMAND_NAMES = {
  voice: ["answer", "decline", "start-call", "mute", "hold", "resume", "disconnect",
          "callback", "transfer", "lead", "conference", "recording", "complete"],
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
  /** Issuable only in `completing`, under the `callback` capability. Dials the party's own number, so it names none. */
  | { type: "callback"; dialId: DialId }
  /** Blind: hand the customer to `destination` with nobody consulted. Gated by `blindTransfer`. */
  | { type: "transfer"; dialId: DialId; destination: string; action?: never }
  /** Park the customer and call `destination` first. Gated by `consultTransfer`. */
  | { type: "transfer"; action: "consult"; dialId: DialId; destination: string }
  /** Hand the customer to the consulted destination and leave. Needs a `consulted` entry on `Task.onCall`. */
  | { type: "transfer"; action: "complete" }
  /** Drop the consulted destination and return to the customer. Needs a `consulted` entry on `Task.onCall`. */
  | { type: "transfer"; action: "cancel" }
  /** Ask a lead to join, with a note. Gated by `consultLead`. */
  | { type: "lead"; action: "request"; note?: string }
  /** Withdraw a standing request. Needs `Task.lead` with status `requested`. */
  | { type: "lead"; action: "cancel" }
  /** The lead keeps the customer; the agent's task ends `transferred`. Needs `Task.assisting`. */
  | { type: "lead"; action: "take-over" }
  /** The lead drops; the agent continues. The lead's task ends `left`. Needs `Task.assisting`. */
  | { type: "lead"; action: "leave" }
  /** Dial `destination` into the call. Gated by `conference`. */
  | { type: "conference"; action: "add"; dialId: DialId; destination: string }
  /** Drop the `conferenced` entry on `Task.onCall` with this destination; while it still rings, this calls the dial off. */
  | { type: "conference"; action: "remove"; destination: string }
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
  taskId: TaskId;
  command: TaskCommand<C>;
}

/**
 * `applied` rather than a verb per command: the command travels in the request, so
 * `execute({ command: { type: "hold" } })` returning `applied` already says the hold applied.
 * A command that dials answers `dialling` instead, restating the host's `dialId`: accepted, the
 * call being placed, and the outcome still to come on `dial-outcome`.
 *
 * A promise that rejects with no result means *unknown*, not `failed`. Omni does not retry --
 * no adapter on the agent's PC can make a repeat safe -- and the next snapshot shows what the
 * provider did. A command therefore carries no retry key of Omni's making; a `dialId` is not
 * one, it is how an outcome arriving later is placed.
 */
export type TaskCommandResult =
  | { status: "applied" }
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };

/** The dial a command places, by the host's identity for it; `undefined` for a command that dials nothing. */
export function commandDialId(command: TaskCommand): DialId | undefined {
  if (command.type === "callback") return command.dialId;
  if (command.type === "transfer" && (command.action === undefined || command.action === "consult")) return command.dialId;
  if (command.type === "conference" && command.action === "add") return command.dialId;
  return undefined;
}

export interface DialRequest {
  dialId: DialId;
  destination: string;
}

/** `dialling` says accepted and being placed, nothing more; the outcome arrives on `dial-outcome`. */
export type DialResult =
  | { status: "dialling"; dialId: DialId }
  | { status: "failed"; failure: ProtocolFailure };

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
  /** Survives `mayAsk: false`: a mandatory rest is not something a busy hour can cancel. */
  alwaysAvailable?: true;
}

export interface BreakRequest {
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
  /** Whether the agent may ask at all. Distinct from the fate of a request already made. */
  mayAsk: boolean;
  /** Shown when `mayAsk` is false, such as "Busy hours". */
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
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };

/** Succeeding is not the outcome: `requested` says the provider holds it, not that it was granted. */
export type BreakRequestResult =
  | { status: "requested" }
  | { status: "failed"; failure: ProtocolFailure };

/** Committing a break already in effect changes nothing and answers `committed`. */
export type BreakCommitResult =
  | { status: "committed" }
  | { status: "failed"; failure: ProtocolFailure };

export type BreakCancelResult =
  | { status: "cancelled" }
  | { status: "failed"; failure: ProtocolFailure };

export type BreakEndResult =
  | { status: "ended" }
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

/** A member asking this lead to join their call. */
export interface LeadRequest {
  id: string;
  memberId: UserId;
  taskId: TaskId;
  note?: string;
  since: IsoTimestamp;
}

/**
 * The login is the permission: published to a login that declares `capabilities.team`, on every
 * snapshot, and to nobody else. What the lead may do with it is on the login too, not here.
 */
export interface TeamRoster {
  members: TeamMember[];
  /** Omitted when the login lacks `team.consultControl`; `[]` when nobody is asking. */
  requests?: LeadRequest[];
  /** The team's policy per capability, as it stands. Present exactly when the login declares `team.policyControl`. */
  policies?: TeamPolicies;
}

/** A capability a team policy can name: any task control, new call, or a skill by its provider id. */
export type PolicyKey =
  | Exclude<keyof TaskCapabilities<"voice">, keyof SharedTaskCapabilities>
  | Exclude<keyof TaskCapabilities<"chat">, keyof SharedTaskCapabilities>
  | Exclude<keyof TaskCapabilities<"email">, keyof SharedTaskCapabilities>
  | "dial"
  | `skill:${string}`;

/** On for everyone, off for everyone, or the agent's own choice. Only `hold`, `mute` and skills may be `agent`. */
export type TeamPolicySetting = "on" | "off" | "person";

/** One policy as the lead sees it: the setting, who set it, and `lockedBy` when a level above the team made it theirs to keep. */
export interface TeamPolicy extends Resolved {
  setting: TeamPolicySetting;
}

export type TeamPolicies = Partial<Record<PolicyKey, TeamPolicy>>;

export type TeamPolicyCommand = { type: "set"; capability: PolicyKey; setting: TeamPolicySetting };

export interface TeamPolicyCommandRequest {
  command: TeamPolicyCommand;
}

export type TeamConsultCommand =
  | { type: "join"; requestId: string }
  | { type: "decline"; requestId: string; reason?: string };

export interface TeamConsultCommandRequest {
  command: TeamConsultCommand;
}

export type TeamBreakCommand =
  | { type: "decide"; memberId: UserId; decision: "granted" | "denied"; reason?: string }
  | { type: "policy"; policy: "ask" | "auto-approve" | "suspended" }
  | { type: "place"; memberId: UserId; reason?: string }
  | { type: "release"; memberId: UserId };

export type TeamCommandResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };

export interface TeamBreakCommandRequest {
  command: TeamBreakCommand;
}

// ---------------------------------------------------------------------------
// Media.
// ---------------------------------------------------------------------------

/**
 * The task's real-time audio as the provider holds it: `ready` while audio should be attached,
 * `ended` once primary handling's audio ended, and the field omitted while none should be. The
 * provider's word -- a desk attaches and renders audio from it, never from its own senses.
 */
export type TaskMediaState = "started" | "ended";

export interface VoiceMediaSession {
  remoteAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): void;
}

export interface OpenMediaRequest {
  taskId: TaskId;
  /** The agent's microphone as Omni captured it, `HostReport.audio.input.localAudio`; absent while that input is `unavailable`. */
  localAudio?: MediaStream;
}

export type OpenMediaResult =
  | { status: "opened"; session: VoiceMediaSession }
  | { status: "unavailable"; failure: ProtocolFailure };

// ---------------------------------------------------------------------------
// Provider state and events.
// ---------------------------------------------------------------------------

/** The provider's complete state at one moment. It replaces what Omni holds; never a patch. */
/**
 * What the team may leave to the person: a capability by its own name -- `hold`, `mute` -- or a
 * skill by its provider id. The same key as in `Task.capabilities`, because it is the same
 * capability seen at another level. Callback and new call are never the person's; they are the
 * team's, on or off, within what the queue allows.
 */
export type PreferenceId = "hold" | "mute" | `skill:${string}`;

/**
 * Who stated a value as it stands: a level -- `person` among them -- or `provisioning`, the
 * protocol's own word for "no level has said anything and the provider's default applies".
 * Nothing is hidden for want of a row.
 */
export type SetBy = Level | "provider";

/** What every resolved value carries: who set it, and who locked it if anyone did. */
export interface Resolved {
  setBy: SetBy;
  lockedBy?: Level;
  /** Given with `lockedBy`, where whoever locked it said why. */
  reason?: string;
}

/**
 * One choice the team may leave to the person, with where it stands and who set it. The provider
 * keeps it: it is the person's across sessions, written through `setPreference`. Listed whether
 * or not anyone has stated it, and even when a level above has since locked it.
 */
export interface AgentPreference extends Resolved {
  id: PreferenceId;
  label: string;
  enabled: boolean;
}

/** The person's act: set their own value, or give it up and inherit again. */
export type SetPreferenceRequest =
  | { id: PreferenceId; enabled: boolean }
  | { id: PreferenceId; inherit: true };

/**
 * The host's report of a handling leg it performed itself -- a mute, which Omni does rather than
 * the provider -- so the provider's record has an account of it. Keyed by `step` and `at`: the
 * same entry is reported when it begins, as often as the host cares to while it runs, and once
 * more with `ended`, when `seconds` is the final duration. The host is the authority for the
 * legs it performs, so `seconds` may say how long so far at any time; the end is stated, never
 * inferred from a number's presence. What the adapter forwards upstream, and how often, is its own.
 */
export type HandlingReport = { taskId: TaskId; step: HandlingStep; at: IsoTimestamp } & (
  | { ended: true; seconds: DurationSeconds }
  | { ended?: never; seconds?: DurationSeconds }
);

export type HandlingReportResult =
  | { status: "recorded" }
  | { status: "failed"; failure: ProtocolFailure };

export type PreferenceResult =
  | { status: "applied" }
  | { status: "failed"; failure: ProtocolFailure };

export interface Snapshot<C extends Channel = Channel> {
  transport: TransportStatus;
  loginId: string;
  break: BreakState;
  /** Every task currently owned by this agent for this provider. */
  tasks: Task<C>[];
  /** The provider's own count of those tasks, stated rather than inferred: it must equal `tasks.length`, so a blank or unanswered state can never pass as a confirmed empty. */
  taskCount: number;
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

export interface QueueSummary {
  title: string;
  subtitle?: string;
  waitingCount: number;
  updatedAt: IsoTimestamp;
  metrics?: SummaryMetric[];
}

export type ProviderEvent<C extends Channel = Channel> =
  | { type: "snapshot"; reason: "reconnected" | "provider-requested"; snapshot: Snapshot<C> }
  | { type: "transport-status"; status: "connecting" | "active"; message?: string }
  | { type: "transport-status"; status: "error"; recovery: TransportRecovery; message?: string }
  | { type: "break-state"; break: BreakState }
  | {
      type: "task-offered";
      task: Task<C>;
      allocationExpiresAt?: IsoTimestamp;
      preparationEndsAt?: IsoTimestamp;
    }
  | { type: "task-updated"; task: Task<C> }
  | { type: "task-media-started"; taskId: TaskId }
  | { type: "task-media-ended"; taskId: TaskId }
  | { type: "task-ended"; taskId: TaskId; outcome: TaskOutcome }
  /**
   * How a dial the host placed ended, once, either way -- `answered` is stated, never read off
   * somebody appearing on the call, and says what happened to the dial; who is on the call is
   * `Task.onCall`. `taskId` is the task the dial was placed on, resolved from the dial and never
   * from what the agent is looking at, and that task may already have ended: a dial placed late
   * routinely outlives its call. `reason` is the switch's own words, shown to the agent as such.
   */
  | { type: "dial-outcome"; dialId: DialId; outcome: DialOutcome; taskId?: TaskId; destination?: string; reason?: string }
  | { type: "announcement"; text: string; html?: string; announcedAt: IsoTimestamp; expiresAt?: IsoTimestamp }
  | { type: "queue-summary"; summary: QueueSummary }
  | { type: "diagnostic"; expected: string; observed: string; taskId?: TaskId }
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
  loginId: string;
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
   * The four break methods stand or fall together. Declaring `capabilities.breaks` at login and
   * implementing `requestBreak` without `commitBreak` leaves an agent granted a break that can
   * never start, and the two-phase coordination has no way to report it.
   */
  requestBreak?(request: BreakRequest): Promise<BreakRequestResult>;
  commitBreak?(): Promise<BreakCommitResult>;
  cancelBreak?(): Promise<BreakCancelResult>;
  endBreak?(): Promise<BreakEndResult>;

  /** Required when the login declares `capabilities.team.breakControl`. */
  executeTeamBreak?(request: TeamBreakCommandRequest): Promise<TeamCommandResult>;
  /** Required when the login declares `capabilities.team.consultControl`. */
  executeTeamConsult?(request: TeamConsultCommandRequest): Promise<TeamCommandResult>;
  /** Required when the login declares `capabilities.team.policyControl`. */
  executeTeamPolicy?(request: TeamPolicyCommandRequest): Promise<TeamCommandResult>;
  /** Required of every voice adapter: all voice audio lands in Omni. */
  openMedia?(request: OpenMediaRequest): Promise<OpenMediaResult>;
  /** Required when the login declares `capabilities.preferences`: the person's own choice, kept by the provider and republished as `authenticated`. */
  setPreference?(request: SetPreferenceRequest): Promise<PreferenceResult>;
  /** Records a handling leg the host performed. Required of a connection whose tasks may declare `mute`. */
  recordStep?(report: HandlingReport): Promise<HandlingReportResult>;
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

/** The steps a dial writes, and so the only ones that carry a `dialId` and a `destination`. */
export const HANDLING_STEPS_THAT_DIAL = ["transferred", "conferenced", "unanswered"] as const satisfies readonly HandlingStep[];

export const handlingStepDials = (step: HandlingStep): boolean =>
  (HANDLING_STEPS_THAT_DIAL as readonly HandlingStep[]).includes(step);

// Pinned both ways: a step added to `HandlingStep` has to be placed here, and a step listed here
// has to exist there. `satisfies` on the list covers the second; this statement covers the first.
true satisfies [Exclude<HandlingStep, "queued">] extends [(typeof HANDLING_STEPS_WITH_A_PERSON)[number]] ? true : false;

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
 * Whether two logins declare the same capabilities, field by field. The comparison an adapter
 * makes before republishing `authenticated`: capabilities are current, not fixed, and the natural
 * guard -- comparing the identity -- never fires on a demotion, because the thing that changed is
 * not the thing being compared. Key order does not matter, and `team: {}` is not `team` absent.
 */
export function sameCapabilities(a: UserCapabilities, b: UserCapabilities): boolean {
  return a.breaks === b.breaks &&
    (a.team === undefined) === (b.team === undefined) &&
    a.team?.breakControl === b.team?.breakControl &&
    a.team?.consultControl === b.team?.consultControl;
}

/**
 * The storage-profile key a reusing browser shares, or `undefined` where it shares nothing.
 *
 * Fails closed. A browser with `sharedSession: false` has no key; nor does a reusing one whose scheme is
 * missing or unknown -- the type forbids that, but an adapter compiled against another version can
 * still send it, and the safe reading is "do not share", never "share with everyone named the
 * same". Every part is encoded, separator included, before joining, so a tab called `a.b`
 * cannot collide with a provider called `a` and a tab called `b`.
 */
export function browserSessionKey(input: BrowserSessionKeyInput): string | undefined {
  const { providerId, taskId, taskType, browser } = input;
  if (browser.sharedSession !== true) return undefined;
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
