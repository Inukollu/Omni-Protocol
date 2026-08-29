import {
  browserSessionKey,
  sameCapabilities,
  type Adapter,
  type AuthenticationState,
  type ProviderEventEnvelope,
  type Connection,
  type Snapshot,
  type TaskCompletion,
  type BreakApproval,
  type BrowserSessionKeyInput,
  type Channel,
  type ConnectContext,
  type Host,
  type HostReport,
  type Manifest,
  type ProviderEvent,
  type SessionCapabilities,
} from "./index.js";
import {
  assertNoViolations,
  validateAuthenticationState,
  validateEventEnvelope,
  validateHostReport,
  validateManifest,
  validateResult,
  validateSnapshot,
  type ProtocolViolation,
  type ReaderContext,
} from "./validation.js";

export { ProtocolConformanceError, assertNoViolations, type ProtocolViolation } from "./validation.js";

/** A state that knows who the agent is and what they may do. */
type Login = Extract<AuthenticationState, { status: "authenticated" }>;

/**
 * A part of the contract a run may never reach: state nothing obliges an adapter to publish, so
 * a fixture without it exercises none of its rules and passes clean. One subject per family of
 * rules -- each optional part of a task, each optional part of the break state and roster, each
 * declared contribution, and each event type.
 */
const STATE_SUBJECTS = [
  "tasks",
  "task.browsers",
  "task.attributes",
  "task.handlingHistory",
  "task.consultation",
  "task.lead",
  "task.assisting",
  "task.dispositions",
  "task.destinations",
  "task.custom",
  "break.reasons",
  "break.imposed",
  "team.members",
  "team.requests",
  "contacts",
  "scheduledActivities",
] as const;
// Pinned to the event union the way validation pins its closed sets: a type added to
// `ProviderEvent` without a row here, or a row it lacks, is a compile error.
const EVENT_TYPES: Record<ProviderEvent["type"], true> = {
  snapshot: true, "provider-status": true, "break-state": true, "task-offered": true, "task-updated": true,
  "task-media-ended": true, "task-ended": true, announcement: true, "provider-summary": true,
  "team-updated": true, "contacts-updated": true, "calendar-updated": true,
};
export type ContractSubject = (typeof STATE_SUBJECTS)[number] | `event.${ProviderEvent["type"]}`;
const CONTRACT_SUBJECTS: readonly ContractSubject[] = [
  ...STATE_SUBJECTS,
  ...(Object.keys(EVENT_TYPES) as ProviderEvent["type"][]).map(type => `event.${type}` as const),
];

// What the run observed. The input is untrusted and has already been reported on, so nothing
// here assumes its shape; a subject is reached only by something the element rules would see.
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const some = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

function observeTask(value: unknown, seen: Set<ContractSubject>): void {
  if (!isRecord(value)) return;
  seen.add("tasks");
  if (some(value.browsers)) seen.add("task.browsers");
  if (some(value.attributes)) seen.add("task.attributes");
  if (some(value.handlingHistory)) seen.add("task.handlingHistory");
  if (value.consultation !== undefined) seen.add("task.consultation");
  if (value.lead !== undefined) seen.add("task.lead");
  if (value.assisting !== undefined) seen.add("task.assisting");
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  if (isRecord(capabilities.dispositions)) seen.add("task.dispositions");
  for (const directory of ["blindTransfer", "consultTransfer", "conference"]) {
    const declared = capabilities[directory];
    if (isRecord(declared) && some(declared.destinations)) seen.add("task.destinations");
  }
  if (some(capabilities.custom)) seen.add("task.custom");
}

function observeBreak(value: unknown, seen: Set<ContractSubject>): void {
  if (!isRecord(value)) return;
  if (some(value.reasons)) seen.add("break.reasons");
  if (value.imposed !== undefined) seen.add("break.imposed");
}

function observeTeam(value: unknown, seen: Set<ContractSubject>): void {
  if (!isRecord(value)) return;
  if (some(value.members)) seen.add("team.members");
  if (some(value.requests)) seen.add("team.requests");
}

function observeSnapshot(value: unknown, seen: Set<ContractSubject>): void {
  if (!isRecord(value)) return;
  if (Array.isArray(value.tasks)) value.tasks.forEach(task => observeTask(task, seen));
  observeBreak(value.break, seen);
  observeTeam(value.team, seen);
  if (some(value.contacts)) seen.add("contacts");
  if (some(value.scheduledActivities)) seen.add("scheduledActivities");
}

function observeEvent(envelope: unknown, seen: Set<ContractSubject>): void {
  const event = isRecord(envelope) ? envelope.event : undefined;
  if (!isRecord(event)) return;
  if (typeof event.type === "string" && event.type in EVENT_TYPES) seen.add(`event.${event.type as ProviderEvent["type"]}`);
  switch (event.type) {
    case "snapshot": observeSnapshot(event.snapshot, seen); break;
    case "break-state": observeBreak(event.break, seen); break;
    case "task-offered":
    case "task-updated": observeTask(event.task, seen); break;
    case "team-updated": observeTeam(event.team, seen); break;
    case "contacts-updated": if (some(event.contacts)) seen.add("contacts"); break;
    case "calendar-updated": if (some(event.scheduledActivities)) seen.add("scheduledActivities"); break;
    default: break;
  }
}

export interface AdapterContractResult {
  events: ProviderEventEnvelope[];
  /** The state the session was restored with at sign-in. */
  authenticationState: AuthenticationState;
  /**
   * The latest login the session published during the run. Equal to `authenticationState` unless
   * the adapter republished `authenticated` -- capabilities are current, not fixed.
   */
  login: AuthenticationState;
  /** True only when every unsubscribe, `disconnect()`, and `close()` settled without throwing. */
  disconnectWasClean: boolean;
  /**
   * What the run never reached, and so what a clean `violations` says nothing about. Nothing here
   * is a violation -- an adapter with no team has nothing to exercise -- but a fixture with no
   * tasks exercises no task rule, and an adapter's own test asserts that the subjects it meant to
   * reach are absent from this list.
   */
  notExercised: readonly ContractSubject[];
  /** Every violation observed. Non-empty only when `collectOnly` suppressed the throw. */
  violations: readonly ProtocolViolation[];
}

export interface ExerciseAdapterOptions {
  /** Return violations in the result instead of throwing. Defaults to `false`. */
  collectOnly?: boolean;
}

/**
 * Adapter conformance exercise: validates the manifest, opens an authenticated session,
 * connects, checks that every method the declarations require is implemented, subscribes,
 * validates the snapshot, every delivered event, and every authentication state the session
 * publishes during the run -- against the latest login, since capabilities are current, not
 * fixed -- states a capacity, then unsubscribes and disconnects.
 *
 * Violations are collected rather than thrown from inside the adapter's own
 * dispatch path. Throwing from a subscribe listener unwinds through the provider
 * for a synchronous emitter, and is swallowed as an unhandled rejection for an
 * asynchronous one — which would let a non-conforming async adapter pass.
 */
export async function exerciseAdapter<C extends Channel>(
  adapter: Adapter<C>,
  context: ConnectContext,
  options: ExerciseAdapterOptions = {},
): Promise<AdapterContractResult> {
  const violations: ProtocolViolation[] = [...validateManifest(adapter.manifest)];
  const events: ProviderEventEnvelope<C>[] = [];
  const seen = new Set<ContractSubject>();
  const stream = new TaskStream();
  const breaks = new BreakStream();
  let seeded = false;

  const storedSecrets = new Map<string, string>();
  const authentication = await adapter.createAuthenticationSession({
    ...context,
    secrets: {
      get: async key => storedSecrets.get(key),
      set: async (key, value) => { storedSecrets.set(key, value); },
      delete: async key => { storedSecrets.delete(key); },
    },
  });

  let connection: Connection<C> | undefined;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeAuthentication: (() => void) | undefined;
  let unsubscribeHost: (() => void) | undefined;
  let authenticationState: AuthenticationState | undefined;
  let login: Login | undefined;
  let disconnectWasClean = false;

  try {
    authenticationState = await authentication.state();
    violations.push(...validateAuthenticationState(authenticationState));
    if (authenticationState.status !== "authenticated") {
      throw new Error(
        `Adapter contract exercise requires authenticated test state, received ${authenticationState.status}`,
      );
    }

    // The harness knows who is signed in and what their login declares, so it can hold the
    // adapter to rules the structural validators cannot check alone: a roster never carries the
    // agent it is published to, a lead's snapshot always carries one, nobody else's ever does.
    // Capabilities are current, not fixed, so the login is read when something is validated,
    // never captured at sign-in: a provider that withdraws one republishes `authenticated`, and
    // everything published after that is held to the new set. A published state that fails
    // validation is reported and not adopted -- the harness keeps the last login it could trust.
    login = authenticationState;
    const current = (): Login => {
      if (login === undefined) throw new Error("unreachable: the exercise has an authenticated login");
      return login;
    };
    const reader = (): ReaderContext => ({
      self: current().identity.id,
      capabilities: current().capabilities,
      sessionId: context.sessionId,
      autoAcceptTasks: context.autoAcceptTasks ?? true,
    });

    // The optional methods are optional only until something declares a need for them. Each
    // check pairs a method with the declaration that requires it, as the guide's Live-connection
    // table does; a missing one is a control the agent would be shown and could never use.
    const reported = new Set<string>();
    const requireMethod = (on: Connection<C>, name: keyof Connection<C>, because: string) => {
      if (typeof on[name] === "function" || reported.has(name)) return;
      reported.add(name);
      violations.push({
        rule: `connection.${name}.required`,
        path: `connection.${name}`,
        message: `${because}, but the connection does not implement ${name}()`,
      });
    };
    const requireCapabilityMethods = (on: Connection<C>, capabilities: SessionCapabilities) => {
      if (capabilities.breaks === true) {
        // The four stand or fall together: `granted` is a promise to honour a later commit, and
        // an adapter with requestBreak but no commitBreak leaves an agent a break that never starts.
        for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
          requireMethod(on, method, "the login declares capabilities.breaks");
        }
      }
      if (capabilities.team?.breakControl === true) requireMethod(on, "executeTeamBreak", "the login declares capabilities.team.breakControl");
      if (capabilities.team?.consultControl === true) requireMethod(on, "executeTeamConsult", "the login declares capabilities.team.consultControl");
    };

    unsubscribeAuthentication = authentication.subscribe(state => {
      const own = validateAuthenticationState(state);
      violations.push(...own);
      if (own.length > 0) return;
      if (state.status === "refreshing") {
        violations.push(...refreshingCarriesOver(current(), state, "authentication"));
      } else if (state.status === "authenticated") {
        login = state;
        // A capability granted later requires its methods just as one declared at sign-in does.
        if (connection !== undefined) requireCapabilityMethods(connection, state.capabilities);
      }
    });

    // The host's report is Omni's output, and a test that hands the adapter a malformed one is
    // testing a host that cannot exist. Its first report and every later one are validated, a
    // voice connection's host reports its audio and no other does, and the host the adapter
    // receives is wrapped so the harness can tell whether the adapter ever asked.
    const first = context.host.report();
    violations.push(...validateHostReport(first, "context.host"));
    const hasAudio = isRecord(first) && first.audio !== undefined;
    if (adapter.manifest.channel === "voice" && !hasAudio) {
      violations.push({ rule: "context.host.audio.required", path: "context.host.audio", message: "a voice connection's host reports its audio" });
    }
    if (adapter.manifest.channel !== "voice" && hasAudio) {
      violations.push({ rule: "context.host.audio.unexpected", path: "context.host.audio", message: `a ${adapter.manifest.channel} connection has no audio for the host to report` });
    }
    unsubscribeHost = context.host.subscribe(report => {
      violations.push(...validateHostReport(report, "context.host"));
    });
    let consulted = false;
    const host: Host = {
      report: () => { consulted = true; return context.host.report(); },
      subscribe: listener => { consulted = true; return context.host.subscribe(listener); },
    };

    connection = await adapter.connect({ ...context, host });
    const live = connection;
    // Dial is declared by presence: the capability object carries a destination policy rather
    // than an `enabled` flag, so its presence is the declaration.
    if (adapter.manifest.idleCapabilities?.dial !== undefined) requireMethod(live, "dial", "the manifest declares dial");
    // Every voice task's audio lands in Omni, so there is no voice adapter that does not open it.
    if (adapter.manifest.channel === "voice") requireMethod(live, "openMedia", "the manifest channel is voice");

    const eventIds = new Set<string>();
    unsubscribe = connection.subscribe(envelope => {
      observeEvent(envelope, seen);
      violations.push(...validateEventEnvelope(envelope as ProviderEventEnvelope, adapter.manifest, "event", reader()));
      if (eventNamesUsers(envelope)) requireMethod(live, "describeUsers", "an event publishes a UserId");
      // Cross-event rules apply once the stream has a beginning: the connect snapshot.
      if (seeded) violations.push(...stream.apply(envelope), ...breaks.apply(envelope));
      if (typeof envelope?.id === "string") {
        if (eventIds.has(envelope.id)) return;
        eventIds.add(envelope.id);
      }
      events.push(envelope);
    });

    const snapshot = await connection.snapshot() as Snapshot;
    observeSnapshot(snapshot, seen);
    violations.push(...validateSnapshot(snapshot, adapter.manifest, "snapshot", reader()));
    stream.seed(snapshot);
    breaks.seed(snapshot);
    seeded = true;
    requireCapabilityMethods(live, current().capabilities);
    if (publishesUserIds(snapshot)) requireMethod(live, "describeUsers", "the snapshot publishes a UserId");

    // Capacity is stated, not requested: nothing may be allocated until it is, so a connection
    // that will not accept one is a connection nothing can be given to.
    // The guide's obligation on a voice adapter: consult the host before declaring the agent
    // ready, and on every change. An adapter that never asked cannot have.
    if (adapter.manifest.channel === "voice" && !consulted) {
      violations.push({
        rule: "connection.host.consulted",
        path: "connection.host",
        message: "a voice adapter consults the host's report before declaring the agent ready, and this one never asked",
      });
    }
    const capacity = await connection.setCapacity({ count: 1 });
    const malformed = validateResult(capacity, "setCapacity", "connection.setCapacity");
    violations.push(...malformed);
    // A refusal is read only from a result that has the shape of one.
    if (malformed.length === 0 && capacity.status === "failed") {
      violations.push({
        rule: "connection.setCapacity.failed",
        path: "connection.setCapacity",
        message: `the provider would not accept a capacity: ${capacity.failure.code}`,
      });
    }
  } finally {
    let clean = true;
    try { unsubscribe?.(); } catch { clean = false; }
    try { unsubscribeAuthentication?.(); } catch { clean = false; }
    try { unsubscribeHost?.(); } catch { clean = false; }
    try { await connection?.disconnect(); } catch { clean = false; }
    try { await authentication.close(); } catch { clean = false; }
    disconnectWasClean = clean;
  }

  if (!disconnectWasClean) {
    violations.push({
      rule: "connection.disconnect.clean",
      path: "connection.disconnect",
      message: "an unsubscribe, disconnect(), or close() threw during shutdown",
    });
  }
  if (!options.collectOnly) assertNoViolations(violations);

  return {
    events: events as ProviderEventEnvelope[],
    authenticationState: authenticationState as AuthenticationState,
    login: (login ?? authenticationState) as AuthenticationState,
    notExercised: CONTRACT_SUBJECTS.filter(subject => !seen.has(subject)),
    disconnectWasClean,
    violations,
  };
}

/**
 * Whether a snapshot carries any `UserId`, which is what obliges an adapter to describe users.
 * The snapshot is untrusted input that has already been reported on, so nothing here assumes
 * its shape.
 */
function publishesUserIds(snapshot: Snapshot | undefined): boolean {
  if (snapshot?.break?.imposed?.by !== undefined) return true;
  if (teamNamesUsers(snapshot?.team)) return true;
  if (!Array.isArray(snapshot?.tasks)) return false;
  return snapshot.tasks.some(taskNamesUsers);
}

const teamNamesUsers = (team: unknown): boolean =>
  isRecord(team) && (some(team.members) || some(team.requests));

const taskNamesUsers = (task: unknown): boolean =>
  isRecord(task) && (
    (Array.isArray(task.handlingHistory) && task.handlingHistory.some(step => isRecord(step) && step.by !== undefined)) ||
    (isRecord(task.lead) && task.lead.leadId !== undefined) ||
    isRecord(task.assisting));

/** Whether an event publishes a `UserId`, on a roster, a task, or the snapshot a reconnect carries. */
function eventNamesUsers(envelope: unknown): boolean {
  const event = isRecord(envelope) ? envelope.event : undefined;
  if (!isRecord(event)) return false;
  switch (event.type) {
    case "snapshot": return publishesUserIds(event.snapshot as Snapshot);
    case "break-state": return isRecord(event.break) && isRecord(event.break.imposed) && event.break.imposed.by !== undefined;
    case "task-offered":
    case "task-updated": return taskNamesUsers(event.task);
    case "team-updated": return teamNamesUsers(event.team);
    default: return false;
  }
}

/**
 * `refreshing` carries the identity and capabilities of the login it refreshes. A change to
 * either is published as `authenticated`; a different identity is a new login.
 */
function refreshingCarriesOver(
  login: Login,
  state: Extract<AuthenticationState, { status: "refreshing" }>,
  path: string,
): ProtocolViolation[] {
  const found: ProtocolViolation[] = [];
  if (state.identity.id !== login.identity.id) {
    found.push({
      rule: "authentication.refreshing.identity",
      path: `${path}.identity.id`,
      message: "refreshing carries the identity of the login it refreshes; a different identity is a new login",
    });
  }
  if (!sameCapabilities(state.capabilities, login.capabilities)) {
    found.push({
      rule: "authentication.refreshing.capabilities",
      path: `${path}.capabilities`,
      message: "refreshing carries the capabilities of the login it refreshes; a change is published as authenticated",
    });
  }
  return found;
}

/** Validates each state of a published sequence, and that every `refreshing` carries over the login before it. */
function assertLoginSequence(states: readonly AuthenticationState[], summary: string): void {
  const found: ProtocolViolation[] = [];
  let login: Login | undefined;
  states.forEach((state, index) => {
    const path = `states[${index}]`;
    const own = validateAuthenticationState(state, path);
    found.push(...own);
    if (own.length > 0) return;
    if (state.status === "authenticated") login = state;
    else if (state.status === "refreshing" && login !== undefined) found.push(...refreshingCarriesOver(login, state, path));
  });
  assertNoViolations(found, summary);
}

/**
 * Validates restored authentication followed by a refresh failure or expiry. Every state is
 * validated, and a `refreshing` state must carry over the login it refreshes.
 */
export function assertAuthenticationRestoreAndExpiry(
  states: readonly AuthenticationState[],
): void {
  assertLoginSequence(states, "Authentication scenario");
  if (states.length < 2 || states[0]?.status !== "authenticated") {
    throw new Error("Authentication scenario must start with a restored authenticated state");
  }
  const expiredIndex = states.findIndex(state => state.status === "expired");
  if (expiredIndex < 1 || states.at(-1)?.status !== "expired") {
    throw new Error("Authentication scenario must end in an expired state");
  }
  const refreshingIndex = states.findIndex(state => state.status === "refreshing");
  if (refreshingIndex >= 0 && refreshingIndex > expiredIndex) {
    throw new Error("Refreshing state must occur before expiry");
  }
}

/**
 * Capabilities are current, not fixed. A provider that withdraws one republishes `authenticated`
 * with the new set, and the next snapshot agrees with it. `states` is what the authentication
 * session published, first to last: beginning and ending `authenticated` for the same identity,
 * passing only through usable states (`expired` or `signed-out` ends the login instead), with at
 * least one capability gone by the end. `snapshot` is the first snapshot published after the last
 * state, validated against that login -- so a roster still published to a login that no longer
 * leads, or requests to one that may no longer join, is the failure.
 */
export function assertCapabilityWithdrawal(
  states: readonly AuthenticationState[],
  snapshot: Snapshot,
  manifest: Manifest,
): void {
  assertLoginSequence(states, "Capability withdrawal");
  const stray = states.findIndex(state => state.status !== "authenticated" && state.status !== "refreshing");
  if (stray >= 0) {
    throw new Error(`Capability withdrawal passes only through usable states; states[${stray}] is ${states[stray]?.status}, which ends the login`);
  }
  const first = states[0];
  const last = states.at(-1);
  if (first?.status !== "authenticated" || last?.status !== "authenticated") {
    throw new Error("Capability withdrawal must begin and end with an authenticated login");
  }
  if (first.identity.id !== last.identity.id) {
    throw new Error("Capability withdrawal must keep the identity: a different identity is a new login");
  }
  const before = first.capabilities;
  const after = last.capabilities;
  const withdrawn =
    (before.breaks === true && after.breaks !== true) ||
    (before.team !== undefined && after.team === undefined) ||
    (before.team?.breakControl === true && after.team?.breakControl !== true) ||
    (before.team?.consultControl === true && after.team?.consultControl !== true);
  if (!withdrawn) {
    throw new Error("Capability withdrawal must end with at least one capability the first login declared withdrawn");
  }
  assertNoViolations(
    validateSnapshot(snapshot, manifest, "snapshot", { self: last.identity.id, capabilities: after }),
    "Capability withdrawal: the snapshot after the last login must agree with it",
  );
}

/**
 * A command that arrives after its capability was withdrawn is answered `failed` with
 * `omni.capability-not-enabled`: the provider names it, so Omni never has to infer from a
 * capability change it may not have rendered yet that "no longer a lead" is the message.
 * Takes any command result -- a team command, a break method -- after such a withdrawal.
 */
export function assertCommandRefusedAfterWithdrawal(result: { status: string; failure?: { code: string } }): void {
  if (result.status !== "failed") {
    throw new Error(`A command after its capability was withdrawn must fail; received ${result.status}`);
  }
  if (result.failure?.code !== "omni.capability-not-enabled") {
    throw new Error(`A command after its capability was withdrawn fails with omni.capability-not-enabled, not ${result.failure?.code}`);
  }
}

/**
 * Throws unless the run reached every subject named: the paired assertion beside a clean result,
 * so a fixture that never produced a roster cannot pass a test that meant to check one.
 */
export function assertReached(result: AdapterContractResult, subjects: readonly ContractSubject[]): void {
  const missed = subjects.filter(subject => result.notExercised.includes(subject));
  if (missed.length > 0) {
    throw new Error(`The exercise never reached ${missed.join(", ")}: its clean result says nothing about them`);
  }
}

/** Validates duplicate delivery and returns the event sequence Omni applies once per ID. */
export function assertDuplicateEventDelivery<C extends Channel>(
  envelopes: readonly ProviderEventEnvelope<C>[],
): ProviderEventEnvelope<C>[] {
  const byId = new Map<string, ProviderEventEnvelope<C>>();
  let duplicateFound = false;
  for (const envelope of envelopes) {
    const existing = byId.get(envelope.id);
    if (!existing) {
      byId.set(envelope.id, envelope);
      continue;
    }
    duplicateFound = true;
    if (JSON.stringify(existing) !== JSON.stringify(envelope)) {
      throw new Error(`Duplicate event ID '${envelope.id}' changed its payload`);
    }
  }
  if (!duplicateFound) throw new Error("Duplicate delivery scenario requires a repeated event ID");
  return [...byId.values()];
}

/** Validates an authoritative reconnect snapshot containing assignments missed while offline. */
export function assertReconnectWithMissedAssignments<C extends Channel>(
  before: Snapshot<C>,
  reconnect: ProviderEventEnvelope<C>,
  missedTaskIds: readonly string[],
): void {
  if (reconnect.event.type !== "snapshot" || reconnect.event.reason !== "reconnected") {
    throw new Error("Reconnect scenario requires a reconnected snapshot event");
  }
  const beforeIds = new Set(before.tasks.map(task => task.id));
  const refreshedIds = new Set(reconnect.event.snapshot.tasks.map(task => task.id));
  for (const taskId of missedTaskIds) {
    if (beforeIds.has(taskId)) throw new Error(`Task '${taskId}' was not missed before reconnect`);
    if (!refreshedIds.has(taskId)) throw new Error(`Reconnect snapshot is missing task '${taskId}'`);
  }
}

/**
 * Validates a refused break followed by a later request that is granted.
 *
 * There is no `denied` approval: a refusal returns the agent to `not-requested`, because a
 * pending request nobody is coming to decide is worse than none. So the scenario is a request
 * that goes back to not-requested, and a later one that is granted.
 *
 * A request shows as `awaiting-decision` where a person decides, and as `granted` at once where
 * the provider decides alone; either is the request being made, and the rule is the same for
 * both.
 */
export function assertDeniedAndRetriedBreak(approvals: readonly BreakApproval[]): void {
  const asked = approvals.findIndex(approval => approval === "awaiting-decision" || approval === "granted");
  if (asked < 0) throw new Error("Break retry scenario requires an initial request");
  const refused = approvals.indexOf("not-requested", asked + 1);
  if (refused < 0) throw new Error("A refused break must return to not-requested, leaving nothing pending");
  const granted = approvals.findIndex((approval, index) =>
    index > refused && (approval === "granted" || approval === "in-effect"));
  if (granted < 0) throw new Error("Break retry scenario must grant a later request");
  const last = approvals.at(-1);
  if (last !== "granted" && last !== "in-effect") {
    throw new Error(`Break retry scenario must end granted or in effect, ended ${String(last)}`);
  }
}

// ---------------------------------------------------------------------------
// The task stream. Each event is validated on its own; what one event may say about a task
// depends on what was said before, and only something that watched the whole stream can hold a
// provider to it. A task is never its audio: media ends only on work that has begun, and what
// follows the media ending is the work completing or ending, never a phase the audio decided.
// ---------------------------------------------------------------------------

const WORK_BEGUN = new Set(["in-progress", "paused", "completing"]);

/** What a stream has said about the tasks it carries, and the rules across events. */
export class TaskStream {
  private readonly tasks = new Map<string, { phase: string; mediaEnded: boolean }>();

  /** Replaces what is known with a snapshot's tasks, as a snapshot replaces Omni's state. */
  seed(snapshot: unknown): void {
    this.tasks.clear();
    if (!isRecord(snapshot) || !Array.isArray(snapshot.tasks)) return;
    for (const task of snapshot.tasks) {
      if (isRecord(task) && typeof task.id === "string") this.tasks.set(task.id, { phase: String(task.phase), mediaEnded: false });
    }
  }

  /** Applies one envelope and returns what it may not say given what came before. */
  apply(envelope: unknown, path = "event"): ProtocolViolation[] {
    const found: ProtocolViolation[] = [];
    const event = isRecord(envelope) ? envelope.event : undefined;
    if (!isRecord(event)) return found;
    const at = `${path}.event`;
    const refuse = (rule: string, where: string, message: string) => found.push({ rule, path: where, message });
    const id = typeof event.taskId === "string" ? event.taskId : isRecord(event.task) && typeof event.task.id === "string" ? event.task.id : undefined;
    const known = id === undefined ? undefined : this.tasks.get(id);
    switch (event.type) {
      case "snapshot":
        this.seed(event.snapshot);
        break;
      case "task-offered":
        if (id === undefined) break;
        if (known !== undefined) refuse("stream.taskOffered.duplicate", `${at}.task.id`, `${id} is already on the stream; an offer introduces a task once`);
        this.tasks.set(id, { phase: String(isRecord(event.task) ? event.task.phase : undefined), mediaEnded: false });
        break;
      case "task-updated":
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskUpdated.unknown", `${at}.task.id`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (known.mediaEnded) {
          const phase = isRecord(event.task) ? String(event.task.phase) : "";
          if (phase !== "completing") {
            refuse("stream.taskMediaEnded.follow", `${at}.task.phase`,
              `after its media ended, ${id} completes or ends; ${phase} is a phase the audio does not decide`);
          }
          known.mediaEnded = phase === "completing" ? false : known.mediaEnded;
        }
        known.phase = isRecord(event.task) ? String(event.task.phase) : known.phase;
        break;
      case "task-media-ended":
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskMediaEnded.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (!WORK_BEGUN.has(known.phase)) {
          refuse("stream.taskMediaEnded.beforeWork", `${at}.taskId`,
            `media cannot end on ${id} while it is ${known.phase}: a task is never its audio, and its work has not begun`);
        }
        known.mediaEnded = true;
        break;
      case "task-ended":
        if (id === undefined) break;
        if (known === undefined) refuse("stream.taskEnded.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
        this.tasks.delete(id);
        break;
      default:
        break;
    }
    return found;
  }
}

// A request goes not-requested -> awaiting-decision | granted; a commit goes granted ->
// starting-after-task | in-effect; work ending goes starting-after-task -> in-effect; a denial,
// a cancel, an end or a release goes back to not-requested; a placed break arrives in-effect
// with `imposed`. Nothing else is a move the guide describes.
const COMMITTED = new Set(["starting-after-task", "in-effect"]);
const BACKWARDS: Record<string, readonly string[]> = {
  "in-effect": ["awaiting-decision", "granted", "starting-after-task"],
  "starting-after-task": ["awaiting-decision", "granted"],
  granted: ["awaiting-decision"],
};

/** What a stream has said about the agent's break, and the moves it may not make. */
export class BreakStream {
  private approval: string | undefined;

  /** Takes the break state a snapshot carries as the point the stream continues from. */
  seed(snapshot: unknown): void {
    const state = isRecord(snapshot) ? snapshot.break : undefined;
    this.approval = isRecord(state) && typeof state.approval === "string" ? state.approval : undefined;
  }

  /** Applies one envelope and returns the moves it may not make given where the break stood. */
  apply(envelope: unknown, path = "event"): ProtocolViolation[] {
    const found: ProtocolViolation[] = [];
    const event = isRecord(envelope) ? envelope.event : undefined;
    if (!isRecord(event)) return found;
    if (event.type === "snapshot") {
      this.seed(event.snapshot);
      return found;
    }
    if (event.type !== "break-state" || !isRecord(event.break) || typeof event.break.approval !== "string") return found;
    const from = this.approval;
    const to = event.break.approval;
    const at = `${path}.event.break.approval`;
    if (from !== undefined) {
      // A commit's states need a grant behind them. A placed break is the one arrival in a
      // committed state that nobody asked for -- in effect at once, or starting-after-task while
      // the member finishes a call -- and it says so with `imposed`.
      if (COMMITTED.has(to) && (from === "not-requested" || from === "awaiting-decision") && event.break.imposed === undefined) {
        found.push({ rule: "stream.breakState.commitBeforeGrant", path: at,
          message: `${to} follows a commit, and a commit follows granted; the break stood at ${from}` });
      }
      if ((BACKWARDS[from] ?? []).includes(to)) {
        found.push({ rule: "stream.breakState.backwards", path: at,
          message: `a break does not go from ${from} back to ${to}; a new request passes through not-requested` });
      }
    }
    this.approval = to;
    return found;
  }
}

/**
 * A break follows its requests. Given a provider's stream -- optionally seeded with the snapshot
 * it began from -- every `break-state` moves the way the guide describes: a commit's states only
 * after a grant, never backwards, and a break placed on the agent arriving in effect with `imposed`.
 */
export function assertBreakFollowsItsRequests(envelopes: readonly ProviderEventEnvelope[], snapshot?: Snapshot): void {
  const stream = new BreakStream();
  if (snapshot !== undefined) stream.seed(snapshot);
  const found: ProtocolViolation[] = [];
  envelopes.forEach((envelope, index) => found.push(...stream.apply(envelope, `envelopes[${index}]`)));
  assertNoViolations(found, "A break follows its requests");
}

/**
 * The media follows the task and never decides it. Given a provider's stream -- optionally seeded
 * with the snapshot it began from -- every task is introduced once, `task-media-ended` names a
 * task whose work has begun, and what follows it is `completing` or `task-ended`.
 */
export function assertMediaFollowsTheTask(envelopes: readonly ProviderEventEnvelope[], snapshot?: Snapshot): void {
  const stream = new TaskStream();
  if (snapshot !== undefined) stream.seed(snapshot);
  const found: ProtocolViolation[] = [];
  envelopes.forEach((envelope, index) => found.push(...stream.apply(envelope, `envelopes[${index}]`)));
  assertNoViolations(found, "The media follows the task");
}

/** A host that reports one thing and never changes: what most adapter tests hand `exerciseAdapter`. */
export function stillHost(report: HostReport = { online: true }): Host {
  return { report: () => report, subscribe: () => () => undefined };
}

/** One provider as the host sees it when freezing a break attempt's participant set. */
export interface BreakCandidate {
  id: string;
  authentication: AuthenticationState["status"];
  /** Whether the agent can currently receive work from it: connected, with a capacity stated. */
  holdsCapacity: boolean;
}

const usableLogin = (status: AuthenticationState["status"]): boolean =>
  status === "authenticated" || status === "refreshing";

/**
 * The participant set of a break attempt is every connected provider from which the agent can
 * currently receive work. A provider whose login is not usable -- `expired` above all -- is not
 * one, whatever else is true of it: nothing can be asked of it, and a host that waits on it
 * stalls the break for everyone. A usable provider holding capacity is one, and cannot be left
 * out. `refreshing` is usable: identity and capabilities remain available and work continues.
 */
export function assertBreakParticipants(candidates: readonly BreakCandidate[], participants: readonly string[]): void {
  const chosen = new Set(participants);
  for (const id of participants) {
    if (!candidates.some(candidate => candidate.id === id)) throw new Error(`${id} is not a provider the host knows`);
  }
  for (const candidate of candidates) {
    const expected = usableLogin(candidate.authentication) && candidate.holdsCapacity;
    if (expected && !chosen.has(candidate.id)) {
      throw new Error(`${candidate.id} can give the agent work and must be a participant`);
    }
    if (!expected && chosen.has(candidate.id)) {
      const why = usableLogin(candidate.authentication) ? "holds no capacity" : `is ${candidate.authentication}`;
      throw new Error(`${candidate.id} ${why} and is not a participant: nothing can be asked of it`);
    }
  }
}

/** One published moment of a break asked for on a task: the approval, and how many tasks were outstanding. */
export interface BreakOnTaskStep {
  approval: BreakApproval;
  outstanding: number;
}

/**
 * A break asked for on a task begins when the work ends. `steps` is the sequence the provider
 * published, first to last: the request is made while work is outstanding, the commit is reported
 * as `starting-after-task` while it remains, and `in-effect` arrives only once nothing is
 * outstanding -- never beside a task, and never later than the step that has none.
 */
export function assertBreakBeginsAfterTask(steps: readonly BreakOnTaskStep[]): void {
  const asked = steps.findIndex(step => step.approval === "awaiting-decision" || step.approval === "granted");
  if (asked < 0) throw new Error("Break-on-task scenario requires a request");
  if ((steps[asked]?.outstanding ?? 0) < 1) throw new Error("Break-on-task scenario requires the request to be made while a task is outstanding");
  const committed = steps.findIndex((step, index) => index > asked && step.approval === "starting-after-task");
  if (committed < 0) throw new Error("A break committed on a task is reported as starting-after-task while the work remains");
  steps.forEach((step, index) => {
    if (step.approval === "in-effect" && step.outstanding > 0) {
      throw new Error(`steps[${index}] reports in-effect with ${step.outstanding} task(s) outstanding: a break begins when the work ends`);
    }
    if (step.approval === "starting-after-task" && step.outstanding < 1) {
      throw new Error(`steps[${index}] reports starting-after-task with nothing outstanding: the break should have begun`);
    }
  });
  if (steps.at(-1)?.approval !== "in-effect") {
    throw new Error(`Break-on-task scenario must end in effect, ended ${String(steps.at(-1)?.approval)}`);
  }
}

/**
 * Validates the deadline derived from media end and the task's fixed wrap allowance.
 *
 * A task with no allowance has no deadline, so `observedDeadline` must then be `undefined`: a
 * host counting down what the provider left open is the violation, and so is a host counting
 * nothing down when the provider set a clock. `toleranceMs` absorbs scheduler jitter in a real
 * implementation; pass 0 to demand an exact match.
 */
export function assertWrapTimeout(
  task: Pick<TaskCompletion, "completionMode" | "completionAllowance">,
  mediaEndedAt: string,
  observedDeadline: string | undefined,
  toleranceMs = 1_000,
): void {
  if (task.completionAllowance === undefined) {
    if (observedDeadline !== undefined) {
      throw new Error(`Wrap deadline mismatch: the task states no allowance, so there is no deadline, received ${observedDeadline}`);
    }
    return;
  }
  if (observedDeadline === undefined) {
    throw new Error(`Wrap deadline mismatch: the task allows ${task.completionAllowance}s, but no deadline was observed`);
  }
  const ended = Date.parse(mediaEndedAt);
  const deadline = Date.parse(observedDeadline);
  if (Number.isNaN(ended) || Number.isNaN(deadline)) throw new Error("Wrap scenario requires valid ISO-8601 times");
  const expected = ended + task.completionAllowance * 1_000;
  if (Math.abs(deadline - expected) > toleranceMs) {
    throw new Error(
      `Wrap deadline mismatch: expected ${new Date(expected).toISOString()} within ${toleranceMs}ms, received ${observedDeadline}`,
    );
  }
}

/** One browser in one task of one provider. `providerId` is `Manifest.id`, never `displayName`. */
export type BrowserIsolationScenario = BrowserSessionKeyInput;

/** The session key one scenario derives, or `undefined` where the browser shares nothing. */
const sessionKeyFor = (scenario: BrowserIsolationScenario): string | undefined => browserSessionKey(scenario);

/** Validates whether two task-browser definitions should share one browser session. */
export function assertBrowserIsolationAndReuse(
  left: BrowserIsolationScenario,
  right: BrowserIsolationScenario,
  expectedReuse: boolean,
): void {
  const leftKey = sessionKeyFor(left);
  const rightKey = sessionKeyFor(right);
  // A browser that does not reuse has no session key at all, so two of them never share one.
  // Treating "no key" as a match would report reuse nobody asked for.
  const actualReuse = leftKey !== undefined && leftKey === rightKey;
  if (actualReuse !== expectedReuse) {
    throw new Error(
      `Browser reuse mismatch: expected ${expectedReuse}, received ${actualReuse} (${String(leftKey)} vs ${String(rightKey)})`,
    );
  }
}

/**
 * Asserts that no two distinct scenarios in `scenarios` derive the same session key.
 * Feed it adversarial names — a provider called `A.B` against a task type called
 * `B`, casing variants, separators — because a collision silently shares cookies,
 * storage, and permissions between two backends.
 */
export function assertNoBrowserSessionKeyCollisions(scenarios: readonly BrowserIsolationScenario[]): void {
  const byKey = new Map<string, BrowserIsolationScenario>();
  for (const scenario of scenarios) {
    const key = sessionKeyFor(scenario);
    if (key === undefined) continue;
    const existing = byKey.get(key);
    if (existing) {
      throw new Error(
        `Browser session key collision on '${key}': ` +
        `${JSON.stringify({ provider: existing.providerId, taskType: existing.taskType, tab: existing.browser.name })} and ` +
        `${JSON.stringify({ provider: scenario.providerId, taskType: scenario.taskType, tab: scenario.browser.name })}`,
      );
    }
    byKey.set(key, scenario);
  }
}
