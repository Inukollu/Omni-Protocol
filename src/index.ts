/** The protocol version implemented by this package. */
export const OMNI_PROTOCOL_VERSION = 1 as const;

/** Every version this package can interoperate with. */
export const OMNI_SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [OMNI_PROTOCOL_VERSION];

/**
 * Highest version supported by both the adapter and the host, or `undefined` when
 * they cannot interoperate. Omni must refuse to connect on `undefined` rather than
 * attempting partial compatibility.
 */
export function negotiateProtocolVersion(
  adapterVersions: readonly number[],
  hostVersions: readonly number[] = OMNI_SUPPORTED_PROTOCOL_VERSIONS,
): number | undefined {
  const host = new Set(hostVersions);
  const shared = adapterVersions.filter(version => host.has(version));
  return shared.length === 0 ? undefined : Math.max(...shared);
}

export type CoreChannelKind = "voice" | "chat" | "email";
export type ChannelKind = CoreChannelKind | (string & {});
export type ProviderStatus = "connecting" | "active" | "inactive" | "error";
/**
 * Where an agent's break request stands.
 *
 * `pending` used to cover two unrelated situations, and Omni could not tell them apart: a
 * request a person has to act on, and one already granted that simply starts when the current
 * task ends. Rendering the second as the first tells an agent to wait for somebody who is
 * never coming, so they are separate values.
 */
export type BreakApproval =
  | "not-requested"
  /** A person has to decide. The agent is waiting on somebody. */
  | "awaiting-decision"
  /**
   * Granted, and begins when the current task ends. The agent receives no new work in the
   * meantime, so nobody needs to act; the break simply has not started yet.
   */
  | "starting-after-task"
  /** In effect now. */
  | "approved"
  | "denied";
/**
 * Where a task is in its life, from the agent's point of view.
 *
 * `allocated` is chosen by the provider for this agent and not yet accepted.
 *
 * Every channel arrives this way. A call, a chat and a case are all allocated and all wait for
 * the same decision -- ringing is how a handset presents a pending allocation, not a different
 * lifecycle. Omni accepts or rejects by its own policy; a provider that answers on the agent's
 * behalf publishes `active` and never `allocated`.
 *
 * A provider may allocate only to an agent Omni has enlisted with it. Allocating to an agent
 * who has not been enlisted puts a customer through to somebody who has not said they are
 * there.
 *
 * Nothing may be acquired on the agent's behalf while a task is allocated. In particular a
 * host carrying media must not open the microphone until the task is accepted, which is the
 * rule this phase exists to make expressible.
 *
 * Nothing may be acquired on the agent's behalf while a task is allocated. In particular a
 * host that carries media must not open the microphone until the task is accepted, which
 * is the rule this phase exists to make expressible.
 */
export type TaskPhase = "allocated" | "active" | "held" | "wrap-up";
export type TaskEndReason =
  | "disposed"
  | "transferred"
  /** The agent declined the offer. Distinct from the backend withdrawing it. */
  | "rejected-by-agent"
  | "cancelled-by-backend"
  | "failed";

export enum BackendAuthenticationMethod {
  BrowserSSO = "BrowserSSO",
  Credentials = "Credentials",
}
/** Actions Omni may offer while the agent has no active task. */
export const IDLE_CAPABILITIES = {
  voice: ["dial", "personalBrowser", "calendar", "contacts"],
  chat: ["personalBrowser", "calendar", "contacts"],
  email: ["personalBrowser", "calendar", "contacts"],
} as const;

export type VoiceIdleCapability = typeof IDLE_CAPABILITIES.voice[number];
export type ChatIdleCapability = typeof IDLE_CAPABILITIES.chat[number];
export type EmailIdleCapability = typeof IDLE_CAPABILITIES.email[number];
export type IdleCapability = VoiceIdleCapability | ChatIdleCapability | EmailIdleCapability;

export interface BrowserAccessPolicy {
  /** Default decision when no list entry matches. */
  mode: "allow-all" | "block-all";
  /** Exceptions permitted when mode is block-all. */
  allowList: readonly string[];
  /** Explicit denials. A matching block entry takes precedence within this policy. */
  blockList: readonly string[];
}

export type PersonalBrowserIdleCapability =
  | { enabled: false }
  | { enabled: true; access: BrowserAccessPolicy };

export type DialDestinationPolicy = "contacts-only" | "any-number";

export type DialIdleCapability =
  | { enabled: false }
  | {
      enabled: true;
      /** Whether outbound destinations must be known contacts or may be any entered number. */
      destinationPolicy: DialDestinationPolicy;
    };

/** Real-time media transports Omni can establish when it carries a device's audio. */
export type VoiceMediaTransport = "sip-over-websocket";

export interface SharedIdleCapabilities {
  /** Enables Omni's personal browser with this backend's complete URL policy. */
  personalBrowser?: PersonalBrowserIdleCapability;
  /** Enables scheduled activities from this backend on Omni's idle calendar. */
  calendar?: boolean;
  /** Enables contacts from this backend in Omni's idle contact list. */
  contacts?: boolean;
}

export interface IdleCapabilities extends SharedIdleCapabilities {
  /** Enables outbound dialing while idle and controls permitted destinations. */
  dial?: DialIdleCapability;
}

export type IdleCapabilitiesFor<C extends ChannelKind> =
  C extends "voice" ? IdleCapabilities
    : C extends "chat" | "email" ? SharedIdleCapabilities & { dial?: never }
      : IdleCapabilities;

/** Capabilities meaningful on an individual task. Each task declares a subset. */
export const TASK_CAPABILITIES = {
  voice: ["reject", "browsers", "mute", "hold", "agentDisconnect", "blindTransfer", "consultTransfer", "conference", "dtmf", "recording", "dispositions"],
  chat: ["reject", "browsers", "hold", "dispositions"],
  email: ["reject", "browsers", "dispositions"],
} as const;

export type VoiceTaskCapability = typeof TASK_CAPABILITIES.voice[number];
export type ChatTaskCapability = typeof TASK_CAPABILITIES.chat[number];
export type EmailTaskCapability = typeof TASK_CAPABILITIES.email[number];

export interface DispositionCode {
  /** Stable provider-local code Omni sends back as `TaskCommand.dispose.disposition`. */
  id: string;
  label: string;
  /** Optional grouping label Omni may use to section a long list. */
  group?: string;
}

export interface DispositionPolicy {
  /** Whether Omni must collect a code before it may dispose the task. */
  required: boolean;
  /** Whether Omni collects free-text notes alongside the code. */
  notes: "required" | "optional" | "hidden";
  /** Codes Omni offers. An empty list means the backend accepts notes only. */
  codes: readonly DispositionCode[];
}

/** `true` is shorthand for a Complete control with no published codes. */
export type DispositionsCapability = boolean | DispositionPolicy;

export interface TransferDestination {
  /** Stable provider-local identity of this destination. */
  id: string;
  label: string;
  /** Value Omni sends as `TaskCommand.transfer.destination` or `conference.participant`. */
  address: string;
  kind: "queue" | "agent" | "external";
}

export interface TransferDirectory {
  destinations: readonly TransferDestination[];
  /** Whether the agent may enter a destination the backend did not publish. */
  allowManualEntry: boolean;
}

/** `true` is shorthand for a directory-less control that accepts manual entry. */
export type TransferCapability = boolean | TransferDirectory;

type TaskCapabilityValue<K extends string> =
  K extends "dispositions" ? DispositionsCapability
    : K extends "blindTransfer" | "consultTransfer" | "conference" ? TransferCapability
      : boolean;

type TaskCapabilityMap<K extends string> = { [P in K]?: TaskCapabilityValue<P> };

export type TaskCapabilitiesFor<C extends ChannelKind> =
  (C extends "voice" ? TaskCapabilityMap<VoiceTaskCapability>
    : C extends "chat" ? TaskCapabilityMap<ChatTaskCapability>
      : C extends "email" ? TaskCapabilityMap<EmailTaskCapability>
        : TaskCapabilityMap<VoiceTaskCapability | ChatTaskCapability | EmailTaskCapability>)
  & { custom?: readonly CustomCapability[] };

export interface CapabilityUiElement {
  kind: "button" | "toggle" | "menu-item" | "browser" | "dialpad" | "calendar" | "contact-list";
  label: string;
  placement: "primary" | "secondary" | "overflow" | "idle-content" | "task-content";
}

export interface TaskControlUiElement {
  kind: "button" | "toggle" | "menu-item";
  label: string;
  placement: "primary" | "secondary" | "overflow";
}

/** Omni-owned UI mapping for standard capabilities. */
export const TASK_CAPABILITY_UI = {
  reject: { kind: "button", label: "Reject", placement: "primary" },
  browsers: { kind: "browser", label: "Browsers", placement: "task-content" },
  mute: { kind: "toggle", label: "Mute", placement: "primary" },
  hold: { kind: "toggle", label: "Hold", placement: "primary" },
  agentDisconnect: { kind: "button", label: "Disconnect", placement: "primary" },
  blindTransfer: { kind: "menu-item", label: "Blind transfer", placement: "secondary" },
  consultTransfer: { kind: "button", label: "Consult transfer", placement: "secondary" },
  conference: { kind: "button", label: "Conference", placement: "secondary" },
  dtmf: { kind: "button", label: "Keypad", placement: "secondary" },
  recording: { kind: "menu-item", label: "Recording", placement: "overflow" },
  dispositions: { kind: "button", label: "Complete", placement: "primary" },
} as const satisfies Record<VoiceTaskCapability | ChatTaskCapability | EmailTaskCapability, CapabilityUiElement>;

export const IDLE_CAPABILITY_UI = {
  dial: { kind: "dialpad", label: "Dialpad", placement: "idle-content" },
  personalBrowser: { kind: "browser", label: "Browser", placement: "idle-content" },
  calendar: { kind: "calendar", label: "Calendar", placement: "idle-content" },
  contacts: { kind: "contact-list", label: "Contacts", placement: "idle-content" },
} as const satisfies Record<IdleCapability, CapabilityUiElement>;

export interface CustomCapability {
  /** Stable provider-local identifier used as `TaskCommand.custom.name`. */
  id: string;
  /** Required description of the Omni-rendered control. */
  ui: TaskControlUiElement;
}
export enum BrowserIsolationScheme {
  PROVIDER_NAME__TASK_ID__TAB_NAME = "ProviderName.TaskId.TabName",
  TAB_NAME = "TabName",
  PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME = "ProviderName.TaskTypeName.TabName",
  PROVIDER_NAME__TAB_NAME = "ProviderName.TabName",
  PROVIDER_NAME__TASK_TYPE_NAME = "ProviderName.TaskTypeName",
  TASK_TYPE_NAME__TAB_NAME = "TaskTypeName.TabName",
}

export interface AgentIdentity {
  /** In protocol v1, Omni derives this identity from the signed-in OS account. */
  id: string;
  displayName: string;
  team?: string;
}

export interface BackendIdentity {
  id: string;
  displayName: string;
}

export interface BackendSecretStore {
  /** Reads one secret from Omni's OS-backed, backend-scoped store. */
  get(key: string): Promise<string | undefined>;
  /** Writes one secret. Raw user credentials must not be persisted. */
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AuthenticationFailure {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  /** Credentials-only field name when the error belongs to one input. */
  field?: string;
}

export type BackendAuthenticationState =
  | { status: "signed-out" }
  | { status: "authenticating"; method: BackendAuthenticationMethod }
  | { status: "authenticated"; identity: BackendIdentity; expiresAt?: string }
  | { status: "refreshing"; identity: BackendIdentity; expiresAt?: string }
  | { status: "expired"; identity?: BackendIdentity; failure?: AuthenticationFailure };

export interface CredentialField {
  name: string;
  label: string;
  type: "text" | "email" | "password";
  required: boolean;
  autocomplete?: "username" | "email" | "current-password" | "off";
}

export type StartAuthenticationRequest =
  | {
      requestId: string;
      method: BackendAuthenticationMethod.BrowserSSO;
      /** One-time callback URL allocated by Omni for this flow. */
      callbackUrl: string;
    }
  | { requestId: string; method: BackendAuthenticationMethod.Credentials };

export type AuthenticationChallenge =
  | {
      flowId: string;
      method: BackendAuthenticationMethod.BrowserSSO;
      authorizationUrl: string;
      browser: "system" | "omni";
    }
  | {
      flowId: string;
      method: BackendAuthenticationMethod.Credentials;
      fields: readonly CredentialField[];
    };

export type StartAuthenticationResult =
  | { status: "interaction-required"; challenge: AuthenticationChallenge }
  | { status: "rejected"; failure: AuthenticationFailure };

export type CompleteAuthenticationRequest =
  | {
      flowId: string;
      method: BackendAuthenticationMethod.BrowserSSO;
      /** Complete redirect URL received by Omni, including provider parameters. */
      callbackUrl: string;
    }
  | {
      flowId: string;
      method: BackendAuthenticationMethod.Credentials;
      /** Short-lived form values. Omni does not retain them after this call settles. */
      values: Readonly<Record<string, string>>;
    };

export type CompleteAuthenticationResult =
  | { status: "authenticated"; identity: BackendIdentity }
  | { status: "rejected"; failure: AuthenticationFailure };

export type AuthenticationActionResult =
  | { status: "accepted" }
  | { status: "rejected"; failure: AuthenticationFailure };

export interface AuthenticationContext {
  agent: AgentIdentity;
  secrets: BackendSecretStore;
  signal?: AbortSignal;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, details?: unknown) => void;
}

export interface BackendAuthenticationSession {
  state(): BackendAuthenticationState | Promise<BackendAuthenticationState>;
  subscribe(listener: (state: BackendAuthenticationState) => void): Unsubscribe;
  start(request: StartAuthenticationRequest): Promise<StartAuthenticationResult>;
  complete(request: CompleteAuthenticationRequest): Promise<CompleteAuthenticationResult>;
  /** Cancels one interactive flow without signing out an existing session. */
  cancelAuthentication(flowId: string): Promise<AuthenticationActionResult>;
  signOut(requestId: string): Promise<AuthenticationActionResult>;
  close(): Promise<void>;
}

export interface BackendManifest<C extends ChannelKind = ChannelKind> {
  /** Stable installation-wide identifier, for example `north-region-voice`. */
  id: string;
  displayName: string;
  channel: C;
  /** Required non-empty list of protocol versions this adapter can speak. */
  supportedProtocolVersions: readonly [number, ...number[]];
  /** Required non-empty list of login methods supported by this backend. */
  authenticationMethods: readonly BackendAuthenticationMethod[];
  /** Actions available from Omni's idle workspace for this backend. */
  idleCapabilities: IdleCapabilitiesFor<C>;
}

interface TaskBrowserBase {
  /** Stable internal selection and update identity within the task. */
  id: string;
  /** Agent-facing tab label and an input to schemes that include TAB_NAME. */
  name: string;
  /** Human-readable role of this browser in the task workspace. */
  purpose: string;
  url: string;
}

/**
 * A browser in the task workspace.
 *
 * Reuse and its key composition are declared together, and the type will not let them be
 * separated. A backend that shares a signed-in session between tasks is deciding who else
 * may see those credentials, and that decision must be made rather than inherited: every
 * scheme here is supported and the backend picks the one its deployment needs.
 *
 * `TAB_NAME` keys on the tab label alone, so two backends that each publish a browser named
 * "CRM" share one signed-in session. That is legitimate where a deployment wants it and is
 * not something an adapter should arrive at by leaving a field out.
 */
export type TaskBrowser = TaskBrowserBase & (
  | { reuse: false; isolationScheme?: never }
  | { reuse: true; isolationScheme: BrowserIsolationScheme }
);

/** Schemes Omni will load from a backend-supplied browser URL. */
export const ALLOWED_BROWSER_URL_SCHEMES: readonly string[] = ["http:", "https:"];

/** Whether a backend-supplied browser URL is loadable. Rejects file:, javascript:, chrome: and similar. */
export function isAllowedBrowserUrl(url: string): boolean {
  try {
    return ALLOWED_BROWSER_URL_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Escapes one key part so the `.` separator cannot occur inside it.
 * `encodeURIComponent` leaves `.` unescaped, so joining raw parts lets a value
 * forge a separator: provider `A.B` + tab `C` would otherwise collide with
 * provider `A` + type `B` + tab `C`.
 */
const encodeKeyPart = (value: string): string => encodeURIComponent(value).replace(/\./g, "%2E");

export interface BrowserSessionKeyInput {
  providerName: string;
  taskId: string;
  taskType: string;
  browser: Pick<TaskBrowser, "name" | "reuse" | "isolationScheme">;
}

/**
 * Canonical storage-profile key for a task browser, or `undefined` when `reuse`
 * is false and the browser is therefore never shared. Two definitions share
 * cookies, storage, and permissions exactly when this returns the same string.
 */
export function browserSessionKey(input: BrowserSessionKeyInput): string | undefined {
  if (!input.browser.reuse) return undefined;
  // Fails closed. A reusing browser with no scheme is invalid, and the safe reading of an
  // invalid declaration is "do not share", never "share with everyone named the same".
  const scheme = input.browser.isolationScheme;
  if (scheme === undefined) return undefined;
  const parts: Record<BrowserIsolationScheme, readonly string[]> = {
    [BrowserIsolationScheme.PROVIDER_NAME__TASK_ID__TAB_NAME]: [input.providerName, input.taskId, input.browser.name],
    [BrowserIsolationScheme.TAB_NAME]: [input.browser.name],
    [BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME]: [input.providerName, input.taskType, input.browser.name],
    [BrowserIsolationScheme.PROVIDER_NAME__TAB_NAME]: [input.providerName, input.browser.name],
    [BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME]: [input.providerName, input.taskType],
    [BrowserIsolationScheme.TASK_TYPE_NAME__TAB_NAME]: [input.taskType, input.browser.name],
  };
  const values = parts[scheme];
  if (values === undefined) return undefined;
  return values.map(encodeKeyPart).join(".");
}

/**
 * A consultation in progress on a task.
 *
 * Present between `transfer.consult` and whichever of `complete` or `cancel` follows. Omni
 * shows it because the agent is holding two parties at once and needs to see which one they
 * are talking to, and which commands are available.
 */
export interface TaskConsultation {
  /** Display-ready destination the agent is consulting. */
  destination: string;
  /** ISO-8601 time the consultation began, when the backend records one. */
  startedAt?: string;
}

/** Singular and plural names for a kind of work item, supplied together by the backend. */
export interface TaskItemLabel {
  /** Shown for one item: "Phone call". */
  singular: string;
  /** Shown for several: "Phone calls". */
  plural: string;
}

/**
 * What Omni shows when a backend names no item of its own.
 *
 * The default lives here rather than in any one consumer, so every adopter resolves an
 * absent label the same way instead of each inventing its own word for the same silence.
 */
export const DEFAULT_TASK_ITEM_LABEL: TaskItemLabel = { singular: "Task", plural: "Tasks" };

/** One item, in the backend's word where it supplies one. */
export function taskItemName(task: { itemLabel?: TaskItemLabel }): string {
  return task.itemLabel?.singular.trim() || DEFAULT_TASK_ITEM_LABEL.singular;
}

/**
 * Several items, in the backend's word where they all agree.
 *
 * Falls back the moment two disagree: a list holding a call and a chat cannot be headed
 * "Calls" without misdescribing half of it.
 */
export function taskItemPlural(tasks: readonly { itemLabel?: TaskItemLabel }[]): string {
  const names = new Set(tasks.map(task => task.itemLabel?.plural.trim() || DEFAULT_TASK_ITEM_LABEL.plural));
  return names.size === 1 ? [...names][0]! : DEFAULT_TASK_ITEM_LABEL.plural;
}

/**
 * A step in how the task in front of the agent has been handled so far.
 *
 * Deliberately not "history". This is live data about a task that is still open: it travels
 * with the task to whoever holds it next and ends when the task does. Nothing stores it,
 * nothing queries it, and there is no archive behind it. A backend that keeps a record of
 * completed contacts is describing something else, which will arrive under its own name.
 *
 * Every member is defined, because a vocabulary of undefined strings is a vocabulary two
 * backends can agree on while meaning different things.
 */
export type TaskHandlingStep =
  /** Waiting in a queue, with no agent yet. */
  | "queued"
  /** Offered to an agent who has not yet taken it. */
  | "offered"
  /** An agent took it and began working. */
  | "answered"
  /** Parked by the agent holding it, who still holds it. */
  | "held"
  /** Handed to another agent or queue. The agent named is the one who handed it on. */
  | "transferred"
  /** A third party was brought in alongside the agent. */
  | "conferenced"
  /** Offered to an agent who did not take it, and passed on. */
  | "unanswered";

export const TASK_HANDLING_STEPS: readonly TaskHandlingStep[] = [
  "queued", "offered", "answered", "held", "transferred", "conferenced", "unanswered",
] as const satisfies readonly TaskHandlingStep[];

type EveryHandlingStepIsListed = [Exclude<TaskHandlingStep, typeof TASK_HANDLING_STEPS[number]>] extends [never] ? true : never;
const everyHandlingStepIsListed: EveryHandlingStepIsListed = true;
void everyHandlingStepIsListed;

/**
 * The steps somebody takes part in, so an absent `agent` on one means the provider could not
 * attribute it rather than that nobody was involved.
 *
 * `queued` is the only step with no participant. Everything else has one by definition: a
 * task cannot be offered to nobody or transferred by nobody.
 */
export const HANDLING_STEPS_WITH_AN_AGENT: readonly TaskHandlingStep[] =
  TASK_HANDLING_STEPS.filter(step => step !== "queued");

/** Whether an absent `agent` on this step means "unattributed" rather than "nobody involved". */
export function handlingStepExpectsAnAgent(step: TaskHandlingStep): boolean {
  return HANDLING_STEPS_WITH_AN_AGENT.includes(step);
}

export interface TaskHandlingEntry {
  step: TaskHandlingStep;
  /** ISO-8601 instant the step began. */
  at: string;
  /**
   * Who handled the step.
   *
   * `id` and not the name alone: two people called Arun on one site is ordinary, and
   * anything pairing entries on a display name pairs them wrongly.
   *
   * **What absence means depends on the step, and both meanings are legitimate.**
   *
   * On a step no agent takes part in -- `queued` -- there is nobody to name and nothing is
   * missing. On an attributable step (see `HANDLING_STEPS_WITH_AN_AGENT`) somebody did take
   * part, so absence says *this was handled and the provider cannot say by whom*.
   *
   * That second case is real rather than theoretical: a leg answered by a shared phone, a
   * manager's handset or a device the provider cannot resolve to a person. **Report the step
   * without the agent rather than dropping it.** A list missing a real handler looks complete
   * and is wrong, which is worse than a list that says plainly it could not attribute one --
   * and far better than publishing nothing because one leg could not be named.
   *
   * A host must render the two differently. Showing an unattributed `answered` step the same
   * way as `queued` tells the agent nobody was involved, which is not what was said.
   */
  agent?: { id: string; displayName?: string };
  /**
   * How long the step lasted, in seconds.
   *
   * **Reported, never derived.** Omni does not subtract one timestamp from the next: an
   * entry can be written while its leg is still running, so the arithmetic has no second
   * operand, and a backend that holds the authoritative number should not have it recomputed
   * from instants that may have been rounded or clock-skewed.
   *
   * **Omitted while unknown, never zero.** A leg that is still talking is not a zero-second
   * conversation, and on live data that is the common case rather than an edge.
   */
  seconds?: number;
}

export interface BackendTask<C extends ChannelKind = ChannelKind> {
  /** Unique within the provider. Omni scopes it with the provider id. */
  id: string;
  /**
   * What this backend calls `id`, such as "Call ID", "WhatsApp ID" or "Case number".
   *
   * Its presence is the instruction to show it. An agent reading a reference back to a
   * customer or a supervisor needs the provider's own word for it, and only the provider
   * knows whether its identifier is a call, a conversation, a ticket or a message. A backend
   * whose id means nothing outside itself omits this, and Omni shows no reference at all
   * rather than labelling an opaque value with a word Omni invented.
   */
  idLabel?: string;
  title: string;
  /**
   * The channel Omni routes and lays out by. A closed set, because Omni acts on it: voice
   * opens media and offers a dialpad, and no other value can be given that meaning.
   */
  channel: C;
  /**
   * What this item actually is, in the backend's words: "Phone call", "WhatsApp call",
   * "Web chat", "SMS". Display only.
   *
   * `channel` is too coarse to show an agent. A WhatsApp call and a PSTN call are both
   * `voice` to Omni and are not the same thing to the person answering, and only the backend
   * knows which it has.
   *
   * Both forms are required together because pluralisation is not mechanical -- "Query"
   * becomes "Queries", and a backend serving a language Omni does not speak cannot have its
   * plural guessed at all. Omni falls back to "Task" and "Tasks" when this is absent, rather
   * than inventing a medium word of its own.
   *
   * Omni never branches on it. Anything Omni must act on belongs in `channel` or a
   * capability, never in a display string.
   */
  itemLabel?: TaskItemLabel;
  /** Required human-readable backend category of work. */
  taskType: string;
  /** Controls available for this specific task. */
  capabilities: TaskCapabilitiesFor<C>;
  customer?: { id?: string; displayName?: string; address?: string };
  phase: TaskPhase;
  /**
   * ISO-8601 time the offer lapses, while `phase` is `allocated`.
   *
   * Omitted when the backend cannot observe a deadline: a computed guess would have Omni
   * withdraw Answer from a task that is still ringing. Where present, Omni counts down and
   * stops offering Answer once it passes.
   */
  allocationExpiresAt?: string;
  browsers: TaskBrowser[];
  /** Set while the agent is consulting a transfer destination on this task. */
  consultation?: TaskConsultation;
  /** Fixed wrap allowance. For real-time media it starts after `task-media-ended`. */
  wrapSeconds: number;
  /**
   * How this task has been handled so far, oldest first.
   *
   * Live data on an open task, not a record: it arrives in the snapshot, is replaced whole
   * like everything else there, and ends with the task. Omitted by a backend that cannot
   * observe it -- an empty array says the task has had no steps, which is a different claim.
   */
  handling?: readonly TaskHandlingEntry[];
  /** Backend-owned data preserved by Omni without interpretation. */
  attributes?: Readonly<Record<string, unknown>>;
}

/** Suggested display-ready categories; any non-empty backend-defined value is valid. */
export type ContactType =
  | "Contact"
  | "Lead"
  | "Manager"
  | "Trainer"
  | "HR"
  | "External"
  | (string & {});

export interface ContactAttribute {
  key: string;
  value: string;
}

/**
 * Canonical phone key for indexing and deduplication; do not use it for display.
 *
 * Cross-backend merging is reliable only for E.164 input. A national-format number
 * merges with another backend's copy only when both normalize to the same digits,
 * because no country context is available here to expand it.
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

/** Canonical email key for indexing and deduplication; do not use it for display. */
export function normalizeContactEmail(email: string): string {
  return email.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export interface BackendContact {
  name: string;
  /** Original dialable address, preserved for display. */
  number: string;
  /** Original optional email address, preserved for display. */
  email?: string;
  /** Semantic category used to group and present the contact. */
  type: ContactType;
  /** Optional ordered provider-defined details for display in Omni. */
  attributes?: readonly ContactAttribute[];
}

export interface ScheduledActivity {
  /** Stable within the provider. */
  id: string;
  title: string;
  /** Provider-defined display category, such as Callback, Meeting, or Training. */
  type: string;
  /** Required ISO-8601 start time. */
  startsAt: string;
  /** Optional ISO-8601 end time. */
  endsAt?: string;
  contact?: BackendContact;
  attributes?: readonly ContactAttribute[];
}

/** Where a team member is, from a lead's point of view. */
export type TeamMemberAvailability =
  | "offline"
  | "available"
  | "on-task"
  | "break-requested"
  | "on-break";

export interface TeamMember {
  /** Stable backend-local agent identity. */
  id: string;
  displayName: string;
  availability: TeamMemberAvailability;
  /** Display-ready refinement such as "Wrap-up" or "Ringing". Omni does not interpret it. */
  status?: string;
  /** Reason shown for a requested or active break. */
  breakReason?: string;
  /**
   * What a `break-requested` member is actually waiting for.
   *
   * `availability` has one value for both, and they are not the same thing to a lead:
   * `awaiting-decision` needs them, `starting-after-task` needs nobody and is simply
   * finishing a call with approval already given. Without this a lead sees a list of people
   * marked "break requested" and cannot tell their own action list from the settled ones.
   *
   * The same `BreakApproval` the member's own break state uses, rather than a parallel
   * vocabulary for the lead's view, so the two cannot drift apart.
   *
   * **Live status, not a record.** The backend derives this from what is true now; it is not
   * stored, not historical, and carries no decision made earlier. Like the roster it belongs
   * to, it is published whole and replaced whole, and a backend that cannot say omits it.
   *
   * An agent is not waiting on one person: authority is held by several, everyone holding it
   * sees the request on their own console, and **any one of them settles it**. A request
   * needing more than one approval is not a thing this contract describes, so there is no
   * progress to report -- only whether a decision is still owed.
   */
  breakApproval?: BreakApproval;

  /** ISO-8601 time the current availability began, so Omni can show how long. */
  since?: string;
  /** Queue or skill the member's current task arrived from. */
  queue?: string;
  /** Whether this member has a device mapped and can be sent work. */
  deviceReady?: boolean;
  /**
   * Target handle time in seconds for this member's work, when the backend sets one.
   *
   * A real field rather than an attribute because Omni acts on it: compared against `since`
   * while the member is on a task, it is what turns a list of names into an answer to "who
   * needs help". An opaque attribute can be printed but not compared.
   */
  handleTimeTargetSeconds?: number;
  /** Set when this member's break was placed for them, and how they may leave it. */
  imposedBreak?: ImposedBreak;
  /** Ordered provider-defined details Omni displays without interpreting. */
  attributes?: readonly ContactAttribute[];
}

/**
 * The team a lead sees while idle.
 *
 * Always complete. A backend must publish the whole roster rather than a change to it: team
 * presence typically reaches an adapter over a best-effort channel with no ordering and no
 * delivery guarantee, so a stream of deltas cannot be trusted to reconstruct the truth. The
 * adapter reconciles against its own authoritative read and publishes the result.
 *
 * Its presence is the permission. A backend publishes a roster only to an agent entitled to
 * see one, and Omni never decides who that is: no roster means nothing to show, which is the
 * correct rendering for an agent who does not lead a team.
 */
export interface TeamRoster {
  /** Display label for the team, such as "Customer Care". */
  teamName: string;
  members: readonly TeamMember[];
  /** ISO-8601 time the adapter assembled this roster. */
  updatedAt: string;
  /**
   * Present when this lead decides their team's breaks, absent when they do not.
   *
   * Its presence is the permission, exactly as the roster's is. A backend that approves
   * breaks some other way — including auto-approving because no lead is online — simply
   * omits it, and Omni offers no controls. Omni never infers who may decide.
   */
  breakControl?: TeamBreakControl;
}

/**
 * How this team's break requests are handled while the lead is in charge of them.
 *
 * One value rather than a set of flags: a team cannot be auto-approving and suspended at
 * once, and a boolean pair would let that state be written down.
 */
export type TeamBreakPolicy =
  /** Each request waits for the lead to approve or deny it. */
  | "ask"
  /** Requests are granted without the lead acting. */
  | "auto-approve"
  /**
   * No breaks are being accepted, such as during busy hours.
   *
   * A request under this policy is rejected outright rather than left pending — nobody is
   * going to come and approve it. A backend that suspends breaks must also tell the team's
   * agents, through `BreakState.accepting`, so they see it before asking rather than by
   * being refused.
   */
  | "suspended";

export interface TeamBreakControl {
  policy: TeamBreakPolicy;
}

/**
 * What a lead does to their team's breaks.
 *
 * A discriminated union executed through one method, exactly as `TaskCommand` is: the verbs
 * differ but the subject does not, and three bespoke methods said otherwise.
 */
export type TeamBreakCommand =
  /** Grant or refuse one member's pending request. */
  | { type: "decide"; memberId: string; decision: "approved" | "denied"; reason?: string }
  /** Set how requests are handled from now on. */
  | { type: "policy"; policy: TeamBreakPolicy }
  /**
   * Place a member on a break they did not ask for, ending at `until`.
   *
   * A lead taking someone off the floor says until when. The member sees who placed it and
   * when it lifts, rather than a break they appear to have chosen or one with no end.
   */
  | { type: "place"; memberId: string; until: string; reason?: string }
  /** End a break the lead placed. */
  | { type: "release"; memberId: string };

export interface TeamBreakCommandRequest {
  /** Stable across retries. The backend must apply a command id at most once. */
  commandId: string;
  command: TeamBreakCommand;
}

export type TeamCommandResult =
  | { commandId: string; status: "applied" | "already-applied" }
  | { commandId: string; status: "rejected"; failure: ProtocolFailure };

/**
 * Everything about this agent's breaks on one backend.
 *
 * One object rather than four fields, because these facts are only meaningful together: an
 * approval means nothing without knowing whether the agent chose the break, and a list of
 * reasons means nothing while none are being accepted. Published whole and replaced whole,
 * the same way a snapshot replaces provider state.
 */
/**
 * A break the backend placed the agent on, rather than one they asked for.
 *
 * Omni shows an imposed break differently because the agent did not choose it: without
 * saying who placed it and whether it can be ended, the agent is looking at a state they
 * did not create and cannot reason about.
 */
export interface ImposedBreak {
  /** Display-ready origin, such as "Team lead" or "Scheduled rest period". */
  by: string;
  /**
   * ISO-8601 time the break ends. Required.
   *
   * An imposed break runs to a clock rather than to somebody's decision. The agent did not
   * start it and does not end it; it expires. That is the whole of the rule, and it replaces
   * asking whether they may resume -- a question with only one honest answer once the break
   * was placed on them, and one that left a break with no end in it whenever nobody
   * remembered to lift it.
   *
   * A provider that cannot say when a break ends is describing something else. Publish no
   * `imposed` rather than a time you invented.
   */
  until: string;
}

export interface BreakState {
  /** The fate of the agent's current request, if they have made one. */
  approval: BreakApproval;
  /**
   * Whether the agent may ask for a break at all.
   *
   * Distinct from `approval`, which is the fate of a request already made. This is what Omni
   * needs to decide whether to offer the control: an agent whose team has breaks suspended
   * should see that, not discover it by being refused.
   */
  accepting: boolean;
  /** Display-ready reason shown when `accepting` is false, such as "Busy hours". */
  refusedReason?: string;
  /**
   * The words whoever decided attached to it, carried from `decide.reason`.
   *
   * Distinct from `refusedReason`, which explains a standing gate that applies to everyone:
   * this is about one request and one decision. A lead who denies a break with "we are two
   * short until four" has said something the agent needs, and without somewhere to put it
   * that sentence reached them as nothing.
   *
   * Present with `approved` or `denied` where the decider gave a reason, absent where they
   * gave none. Omni shows it and never infers one.
   */
  decisionReason?: string;
  /** How long until the agent may retry, when the backend can say. */
  retryAfterMs?: number;
  /** Not-ready reason codes this provider offers. Omitted when it defines none. */
  reasons?: readonly BreakReason[];
  /**
   * Which reason the agent's break is on, when the provider tracks it.
   *
   * Omni remembers what it asked for, but only until the session ends. After a reload or a
   * reconnect -- or when the provider put the agent on the break itself -- the provider is
   * the only one who knows. Without this, Omni can tell an agent they are on a break but
   * not which one.
   *
   * One of this provider's published `BreakReason.id`s. **Leave it out when the provider
   * cannot say**; never guess and never default. Leave it out when there is no break, too:
   * `approval: "not-requested"` has no reason to report.
   */
  activeReasonId?: string;
  /** Set when the current break was placed on the agent rather than requested by them. */
  imposed?: ImposedBreak;
}

/**
 * The breaks a contact centre runs, named once so providers can agree.
 *
 * A backend decides which breaks it offers and what it calls them; this is the list Omni
 * supports mapping them onto. An agent takes one break, not one per platform, so Omni has to
 * know when two providers mean the same thing -- and it cannot tell from the labels, which
 * are each deployment's own words: "Lunch", "Meal", "Lunch Break (30 min)".
 *
 * Every member is defined below, and the definitions are the point. A vocabulary of ten
 * undefined strings is the label problem one level up: two providers could both declare
 * `technical`, one meaning a dead headset and the other scheduled maintenance, match on it,
 * and nothing could tell the difference.
 *
 * The list is closed on purpose. An open one would be the label problem again.
 */
export type BreakKind =
  /** A brief rest between contacts -- the comfort break a shift plan allows for. */
  | "short-break"
  /** A meal: lunch, dinner, whatever the shift calls it. */
  | "meal"
  /**
   * A rest period the agent is entitled to and a busy hour cannot cancel.
   *
   * Usually the reason a backend also marks `alwaysAvailable`, though the two are separate:
   * this says what the break is, that says whether policy can withdraw it.
   */
  | "rest"
  /** Scheduled learning: a course, a briefing, e-learning. */
  | "training"
  /** One-to-one with a supervisor or reviewer, about this agent's own work. */
  | "coaching"
  /** Any other scheduled gathering -- a team huddle, a project call. */
  | "meeting"
  /** Paperwork and follow-up not attached to a particular contact. */
  | "administrative"
  /**
   * Equipment or system trouble stopping the agent taking work: a dead headset, a phone
   * that never registered, a tool that will not load.
   *
   * The one member that is not an activity. It says why the agent cannot work rather than
   * what they are doing, which is what makes it the right home for a not-ready state the
   * platform raised about the agent's equipment.
   */
  | "technical"
  /** Personal time the deployment does not classify further. */
  | "personal"
  /**
   * None of the above.
   *
   * Not a match: two providers both saying `"other"` have said only that their break does
   * not fit this list, which is no evidence they mean the same thing. Omni falls back to
   * label matching for these, exactly as if no kind were declared.
   *
   * Prefer omitting `kind` to reaching for `"other"` when the state is something the
   * platform did to the agent rather than a break they are taking -- a missed call, an idle
   * timeout. Those are `BreakState.imposed`, and none of these ten describes them.
   */
  | "other";

/**
 * The same list at runtime, for validation.
 *
 * `satisfies` rejects a member that is not a `BreakKind`, and the assignment below fails to
 * compile if one is missing -- so the two cannot drift apart in either direction.
 */
export const BREAK_KINDS = [
  "short-break", "meal", "rest", "training", "coaching",
  "meeting", "administrative", "technical", "personal", "other",
] as const satisfies readonly BreakKind[];

type EveryBreakKindIsListed = [Exclude<BreakKind, typeof BREAK_KINDS[number]>] extends [never] ? true : never;
const everyBreakKindIsListed: EveryBreakKindIsListed = true;
void everyBreakKindIsListed;

export interface BreakReason {
  /** Stable provider-local id Omni sends back as `BreakRequest.reasonId`. */
  id: string;
  label: string;
  /** Optional grouping label Omni may use to section a long list. */
  group?: string;
  /**
   * Which shared break this is, when the provider can say.
   *
   * Omni matches on this first, ahead of the label. So `{ id: "MEAL", label: "Meal", kind:
   * "meal" }` lines up with `{ id: "lunch", label: "Lunch", kind: "meal" }`, and nobody has
   * to word their codes the same way.
   *
   * Leave it out rather than guess. Leaving it out costs a little precision -- Omni falls
   * back to matching labels. Getting it wrong sends an agent to lunch on one platform and
   * to training on another, and nothing can catch that.
   *
   * A provider may publish two reasons of one kind, such as two meal slots. Omni will not
   * pick between them for the agent: saying they are the same kind is not saying they are
   * interchangeable.
   */
  kind?: BreakKind;
  /**
   * Whether this reason survives `BreakState.accepting: false`.
   *
   * A mandatory rest period is not something a busy hour can cancel, so a backend marks it
   * here and Omni keeps offering it while the rest are withdrawn. Which reasons are
   * mandatory is the backend's judgement; Omni only renders what it is told.
   */
  alwaysAvailable?: boolean;
}

export interface BackendSnapshot<C extends ChannelKind = ChannelKind> {
  status: ProviderStatus;
  /** Complete break state for this agent on this provider. */
  break: BreakState;
  tasks: BackendTask<C>[];
  /** Authoritative contacts when the backend enables the contacts capability. */
  contacts?: readonly BackendContact[];
  /** Authoritative activities when the backend enables the calendar capability. */
  scheduledActivities?: readonly ScheduledActivity[];
  /** The agent's team, when this backend gives them one to see. Omitted otherwise. */
  team?: TeamRoster;
  /**
   * Device the agent is currently mapped to. Present on voice once a device is chosen,
   * so Omni can skip the question for an agent who is already set up.
   */
  device?: AgentDevice;
}

export interface OmniAnnouncement {
  id: string;
  /** Required accessible fallback and display text when rich HTML is unavailable. */
  text: string;
  /** Optional rich MOTD markup. Omni sanitizes this to its formatting allowlist. */
  html?: string;
  /** ISO-8601 announcement time. */
  announcedAt: string;
  /** Optional ISO-8601 time after which Omni stops showing the announcement. */
  expiresAt?: string;
}

export interface ProviderSummaryMetric {
  /** Stable provider-local metric identity. */
  id: string;
  label: string;
  /** Display-ready value because providers own units and formatting. */
  value: string;
  detail?: string;
}

export interface ProviderSummary {
  title: string;
  subtitle?: string;
  /** Current work waiting at this provider. */
  waiting: number;
  metrics: readonly ProviderSummaryMetric[];
  updatedAt: string;
}

export type BackendEvent<C extends ChannelKind = ChannelKind> =
  | { type: "snapshot"; snapshot: BackendSnapshot<C>; reason: "reconnected" | "provider-requested" }
  | { type: "provider-status"; status: ProviderStatus; message?: string }
  | { type: "break-state"; break: BreakState }
  | { type: "task-assigned"; task: BackendTask<C> }
  | { type: "task-updated"; task: BackendTask<C> }
  | { type: "task-media-ended"; taskId: string; endedAt: string }
  | { type: "task-ended"; taskId: string; reason: TaskEndReason; message?: string }
  | { type: "contacts-updated"; contacts: readonly BackendContact[] }
  | { type: "calendar-updated"; scheduledActivities: readonly ScheduledActivity[] }
  | { type: "provider-summary"; summary: ProviderSummary }
  | { type: "device-changed"; device?: AgentDevice }
  | { type: "team-updated"; team: TeamRoster }
  | { type: "announcement"; announcement: OmniAnnouncement };

export interface BackendEventEnvelope<C extends ChannelKind = ChannelKind> {
  /** Stable provider-local id. Omni uses it to ignore duplicate delivery. */
  id: string;
  /** ISO-8601 time at which the provider observed the change. */
  occurredAt: string;
  /**
   * Optional per-provider counter that increases by one per distinct event.
   * A gap tells Omni it missed delivery and must resync with `snapshot()`.
   * Redelivery of the same `id` repeats its original sequence.
   */
  sequence?: number;
  event: BackendEvent<C>;
}

export interface WorkDemand {
  /** Number of additional tasks Omni currently has room for from this provider. */
  count: number;
  /** All current tasks, enabling each backend to make its own capacity decision. */
  composite: ReadonlyArray<{
    providerId: string;
    channel: ChannelKind;
    taskId: string;
    phase: TaskPhase;
  }>;
}

export interface BreakRequest {
  requestId: string;
  requestedAt: string;
  /** Selected `BreakReason.id` when the provider publishes reason codes. */
  reasonId?: string;
  /** Free-text reason. Never a substitute for `reasonId` when codes exist. */
  reason?: string;
}

export interface DialRequest {
  /** Stable across retries. The backend must place at most one call for this ID. */
  commandId: string;
  /** Original number selected or entered by the agent. */
  destination: string;
  source: "contact" | "manual";
}

export type DialResult =
  | { commandId: string; status: "applied" | "already-applied" }
  | { commandId: string; status: "rejected"; failure: ProtocolFailure };

export type TaskCommand =
  | { type: "mute"; muted: boolean }
  | { type: "hold" }
  | { type: "resume" }
  | { type: "disconnect" }
  /** Hand the task over and leave immediately. */
  | { type: "transfer"; action: "blind"; destination: string }
  /**
   * Hold the customer and call the destination first.
   *
   * The backend reports the result on `BackendTask.consultation`, and the agent then either
   * completes the handover or cancels back to the customer. A consultation that could be
   * started but not finished would strand both of them, so those are commands too.
   */
  | { type: "transfer"; action: "consult"; destination: string }
  /** Hand the customer to the consulted destination and leave. */
  | { type: "transfer"; action: "complete" }
  /** Drop the consulted destination and return to the customer. */
  | { type: "transfer"; action: "cancel" }
  /**
   * Accept a task that is allocated.
   *
   * Not gated on a capability, deliberately. Accepting is Omni's decision about the *task*:
   * an offer the agent cannot accept is not an offer, so `allocated` carries the ability to
   * accept it. Where the audio then lands is a separate matter the device decides -- a desk
   * phone rings and connects, a softphone opens in Omni -- and that is `hostCarriesMedia`,
   * not a question about whether the agent may take the work.
   *
   * A backend that answers on the agent's behalf never publishes `allocated`, so it never
   * receives this.
   */
  | { type: "answer" }
  /**
   * Decline a task that is allocated.
   *
   * The agent's decision, not the backend's: a provider withdrawing an offer ends the task
   * with `cancelled-by-backend` instead. What a backend does afterwards -- re-queue, make the
   * agent not-ready, count it against them -- is its own policy and not described here.
   */
  | { type: "reject" }
  | { type: "conference"; action: "add" | "remove"; participant: string }
  | { type: "dtmf"; digits: string }
  | { type: "recording"; action: "start" | "pause" | "resume" | "stop" }
  | { type: "dispose"; disposition?: string; notes?: string }
  | { type: "custom"; name: string; payload?: unknown };

/**
 * Failure codes Omni understands and may act on. The `omni.` prefix is reserved:
 * adapters must not invent new codes under it, and any other value is provider-private.
 */
export const OMNI_FAILURE_CODES = {
  notAuthenticated: "omni.not-authenticated",
  capabilityNotEnabled: "omni.capability-not-enabled",
  taskNotFound: "omni.task-not-found",
  destinationNotPermitted: "omni.destination-not-permitted",
  rateLimited: "omni.rate-limited",
  unavailable: "omni.unavailable",
} as const;

export type OmniFailureCode = typeof OMNI_FAILURE_CODES[keyof typeof OMNI_FAILURE_CODES];

export interface ProtocolFailure {
  /** Stable machine-readable value. See `OMNI_FAILURE_CODES` for reserved values. */
  code: OmniFailureCode | (string & {});
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

/** Receipt of an action, not a promise that work or a break will be granted. */
export type ActionResult =
  | { status: "accepted" }
  | { status: "rejected"; failure: ProtocolFailure };

export interface TaskCommandRequest {
  /** Stable across retries. A provider must apply a command id at most once. */
  commandId: string;
  taskId: string;
  command: TaskCommand;
}

export type TaskCommandResult =
  | { commandId: string; status: "applied" | "already-applied" }
  | { commandId: string; status: "rejected"; failure: ProtocolFailure };

export type Unsubscribe = () => void;

/** How an agent's audio reaches them. */
export type AgentDeviceKind = "softphone" | "desk-phone" | "external-number";

export interface AgentDevice {
  /** Stable backend-local identity Omni sends back to select this device. */
  id: string;
  label: string;
  kind: AgentDeviceKind;
  /**
   * Whether this device's audio arrives in Omni.
   *
   * Every voice backend has media; this says where it lands. True for a softphone Omni
   * registers, false for a desk phone or an outside number the backend rings directly.
   * It is a fact about the device, not a capability the backend chooses to offer.
   */
  hostCarriesMedia: boolean;
}

export interface DeviceDirectory {
  devices: readonly AgentDevice[];
  /** Whether the agent may enter a device id or extension that is not listed. */
  allowManualEntry: boolean;
}

export interface SelectDeviceRequest {
  /** Stable across retries. The backend must map the agent at most once for this ID. */
  commandId: string;
  deviceId: string;
  source: "listed" | "manual";
}

export type SelectDeviceResult =
  | { commandId: string; status: "applied" | "already-applied"; device: AgentDevice }
  | { commandId: string; status: "rejected"; failure: ProtocolFailure };

/**
 * A live audio session for one task, established by the backend and played by Omni.
 *
 * The adapter speaks whatever its platform speaks — SIP over WebSocket, a vendor SDK, plain
 * WebRTC — and none of that reaches here. Omni owns the parts that belong to the host: the
 * microphone, the output element, mute, and the session's lifetime. Only voice backends have
 * one; chat and email have no media to carry.
 *
 * The session is scoped to a task from Omni's side, which does not oblige a backend to
 * establish one call per task. A platform holding a nailed-up leg for the whole shift may
 * return the same session for every task and release the underlying path only when the
 * connection closes; a platform placing a call per contact returns a new one each time.
 * Omni asks when it needs audio and closes when it is done, and how that maps is the
 * adapter's business.
 */
export interface VoiceMediaSession {
  /**
   * Remote audio for Omni to play.
   *
   * The adapter must not also attach it to a sink of its own. Returning a session hands
   * playback to Omni; two sinks put the same call in the agent's ears twice, and only one of
   * them answers to the agent's output-device choice.
   */
  readonly remoteAudio: MediaStream;
  /** Mutes the agent's microphone on this session. */
  setMuted(muted: boolean): void;
  /** Sends DTMF to the far end. */
  sendDtmf(digits: string): void;
  /** Releases the session. Omni calls this when the task ends or the device changes. */
  close(): Promise<void> | void;
}

export interface OpenMediaRequest {
  /** Task whose audio this is. */
  taskId: string;
  /**
   * The agent's microphone, captured by Omni.
   *
   * Supplied by the host because permission and input-device choice are the host's to make
   * and to explain to the agent, not something each adapter should ask for separately. A
   * backend that bridges audio without a host-side input may ignore it.
   */
  localAudio: MediaStream;
}

export type OpenMediaResult =
  | { status: "opened"; session: VoiceMediaSession }
  | { status: "unavailable"; failure: ProtocolFailure };

/**
 * Whether a command travels through the media session rather than as a task command.
 *
 * Follows the device the agent is on. When the audio arrives in Omni, mute and DTMF act on
 * the live call, and Omni holds a handle to it — so they go through `VoiceMediaSession`
 * rather than `execute`. The adapter still performs them; it is reached by the shorter path,
 * the one attached to the call itself.
 *
 * Exactly one path is used, never both. Omni does not send the task command when it routes
 * to the session, so a mute cannot be applied twice and cancel itself. Every other command,
 * and every command on a device the backend rings directly, goes to `execute` as before.
 */
export function isHostActuatedCommand(command: TaskCommand, device: AgentDevice | undefined): boolean {
  if (!device?.hostCarriesMedia) return false;
  return command.type === "mute" || command.type === "dtmf";
}

export interface BackendConnection<C extends ChannelKind = ChannelKind> {
  /** Current authoritative state. Omni subscribes before reading it. */
  snapshot(): BackendSnapshot<C> | Promise<BackendSnapshot<C>>;
  /** Watch state changes. The adapter owns transport reconnect and resync. */
  subscribe(listener: (event: BackendEventEnvelope<C>) => void): Unsubscribe;
  requestWork(demand: WorkDemand): Promise<ActionResult>;
  requestBreak(request: BreakRequest): Promise<ActionResult>;
  cancelBreak(requestId: string): Promise<ActionResult>;
  resume(): Promise<ActionResult>;
  /** Required when the manifest enables dial; omitted otherwise. */
  dial?(request: DialRequest): Promise<DialResult>;
  /** Devices this agent may take audio on. Required on voice; omitted otherwise. */
  listDevices?(): Promise<DeviceDirectory>;
  /** Maps the agent onto a device. Required on voice; omitted otherwise. */
  selectDevice?(request: SelectDeviceRequest): Promise<SelectDeviceResult>;
  /**
   * Opens the audio for one task and hands Omni the remote stream.
   *
   * Required on voice whenever any device may report `hostCarriesMedia: true`; a backend that
   * always rings devices itself may omit it. The adapter owns registration, signalling and
   * renewal — none of which Omni sees — and keeps the session alive until Omni closes it.
   */
  openMedia?(request: OpenMediaRequest): Promise<OpenMediaResult>;

  /**
   * Runs a lead's break command against their team.
   *
   * Required when a roster publishes `breakControl`; omitted otherwise. A `place` must reach
   * that member as an `imposed` break on their own `BreakState`, carrying the same `until`,
   * or they are stopped from working with no way to see why or for how long.
   */
  executeTeamBreak?(request: TeamBreakCommandRequest): Promise<TeamCommandResult>;
  execute(request: TaskCommandRequest): Promise<TaskCommandResult>;
  disconnect(): Promise<void>;
}

export interface ConnectContext {
  agent: AgentIdentity;
  signal?: AbortSignal;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, details?: unknown) => void;
}

export interface BackendAdapter<C extends ChannelKind = ChannelKind> {
  readonly manifest: BackendManifest<C>;
  createAuthenticationSession(context: AuthenticationContext): Promise<BackendAuthenticationSession>;
  connect(context: ConnectContext): Promise<BackendConnection<C>>;
}

/** Preserves inference while checking an adopter's adapter at compile time. */
export function defineBackendAdapter<const C extends ChannelKind, T extends BackendAdapter<C>>(adapter: T): T {
  return adapter;
}

/** Globally unique key used by Omni's multi-task workspace. */
export function taskKey(providerId: string, taskId: string): string {
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(taskId)}`;
}
