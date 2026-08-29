import {
  browserSessionKey,
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
  type Manifest,
  type ProviderEvent,
  type SessionCapabilities,
} from "./index.js";
import {
  assertNoViolations,
  validateAuthenticationState,
  validateEventEnvelope,
  validateManifest,
  validateSnapshot,
  type ProtocolViolation,
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
  if (isRecord(capabilities.blindTransfer) && some(capabilities.blindTransfer.destinations)) seen.add("task.destinations");
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
    const reader = () => ({ self: current().identity.id, capabilities: current().capabilities });

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

    connection = await adapter.connect(context);
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
      if (typeof envelope?.id === "string") {
        if (eventIds.has(envelope.id)) return;
        eventIds.add(envelope.id);
      }
      events.push(envelope);
    });

    const snapshot = await connection.snapshot() as Snapshot;
    observeSnapshot(snapshot, seen);
    violations.push(...validateSnapshot(snapshot, adapter.manifest, "snapshot", reader()));
    requireCapabilityMethods(live, current().capabilities);
    if (publishesUserIds(snapshot)) requireMethod(live, "describeUsers", "the snapshot publishes a UserId");

    // Capacity is stated, not requested: nothing may be allocated until it is, so a connection
    // that will not accept one is a connection nothing can be given to.
    const capacity = await connection.setCapacity({ count: 1 });
    if (capacity.status === "failed") {
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
  if (Array.isArray(snapshot?.team?.members) && snapshot.team.members.length > 0) return true;
  if (!Array.isArray(snapshot?.tasks)) return false;
  return snapshot.tasks.some(task =>
    Array.isArray(task?.handlingHistory) && task.handlingHistory.some(step => step?.by !== undefined));
}

const sameCapabilities = (a: SessionCapabilities, b: SessionCapabilities): boolean =>
  a.breaks === b.breaks &&
  (a.team === undefined) === (b.team === undefined) &&
  a.team?.breakControl === b.team?.breakControl &&
  a.team?.consultControl === b.team?.consultControl;

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
