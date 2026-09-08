import {
  browserSessionKey,
  effectiveLevels,
  sameCapabilities,
  type Adapter,
  type AuthenticationState,
  type ProviderEventEnvelope,
  type Connection,
  type Snapshot,
  type Task,
  type TaskCompletion,
  type BreakApproval,
  type BrowserSessionKeyInput,
  type Channel,
  type ConnectContext,
  type Host,
  type HostGuarantees,
  type HostMute,
  type LoginStore,
  type Refusal,
  type UserId,
  type SecretStore,
  type HostReport,
  type Manifest,
  type ProviderEvent,
  type UserCapabilities,
} from "./index.js";
import {
  assertNoViolations,
  validateAuthenticationState,
  validateEventEnvelope,
  validateHostGuarantees,
  validateHostReport,
  validateDescribedUsers,
  observeRules,
  ruleEvaluated,
  validateHostMute,
  validateLoginStore,
  validateHandlingReport,
  validateManifest,
  validateResult,
  validateSnapshot,
  validateTask,
  validateTimeZone,
  validatePhone,
  validateTaskCommand,
  isTimeZone,
  sameTimeZone,
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
  "task.onCall",
  "task.leadAssist",
  "task.assisting",
  "task.monitoring",
  "task.media",
  "task.acceptance",
  "task.dispositions",
  "task.destinations",
  "task.custom",
  "task.locked",
  "break.reasons",
  "break.imposed",
  "team.members",
  "team.requests",
  "contacts",
  "scheduledActivities",
  "team.policies",
] as const;
// Pinned to the event union the way validation pins its closed sets: a type added to
// `ProviderEvent` without a row here, or a row it lacks, is a compile error.
const EVENT_TYPES: Record<ProviderEvent["type"], true> = {
  snapshot: true, "transport-status": true, "break-state": true, "task-offered": true, "task-updated": true,
  "task-media-started": true, "task-media-ended": true, "task-ended": true, "dial-outcome": true, announcement: true, "queue-summary": true, diagnostic: true,
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
  if (isRecord(value.handlingHistory) && some(value.handlingHistory.steps)) seen.add("task.handlingHistory");
  if (some(value.onCall)) seen.add("task.onCall");
  if (value.leadAssist !== undefined) seen.add("task.leadAssist");
  if (value.assisting !== undefined) seen.add("task.assisting");
  if (value.monitoring !== undefined) seen.add("task.monitoring");
  if (value.media !== undefined) seen.add("task.media");
  if (value.acceptance !== undefined) seen.add("task.acceptance");
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  if (isRecord(capabilities.dispositions)) seen.add("task.dispositions");
  for (const directory of ["coldTransfer", "warmTransfer", "conference"]) {
    const declared = capabilities[directory];
    if (isRecord(declared) && some(declared.destinations)) seen.add("task.destinations");
  }
  if (some(capabilities.custom)) seen.add("task.custom");
  if (Object.values(capabilities).some(declared => isRecord(declared) && declared.lockedBy !== undefined)) seen.add("task.locked");
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
  if (isRecord(value.policies) && Object.keys(value.policies).length > 0) seen.add("team.policies");
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
  /**
   * Every rule the run evaluated, pass or fail: the validators' as each was applied, the stream's
   * and the drive's as each case was considered. A rule absent here was never looked at, which a
   * clean `violations` says nothing about; a test that needs a rule to have run asserts it here.
   */
  rulesEvaluated: ReadonlySet<string>;
}

export interface ExerciseAdapterOptions {
  /** Return violations in the result instead of throwing. Defaults to `false`. */
  collectOnly?: boolean;
  /**
   * Drive one ordinary lifecycle on the first task the provider offers -- accept it, open its
   * media on a softphone, hold and resume where offered, end the call where offered, complete it
   * where the agent completes -- so the rules about a live call are reached rather than listed
   * under `notExercised`. Off by default, since it issues commands against whatever platform the
   * adapter is connected to: turn it on against a test backend.
   */
  drive?: boolean;
  /** How long the drive waits for each thing the provider owes it. Defaults to 5000. */
  driveTimeoutMs?: number;
  /**
   * Builds the adapter again, as a host reload does: a new object with no memory, for the same
   * login. Given it, the drive -- once the host's muted leg is recorded -- connects a second adapter
   * with the same context and the same store and expects its snapshot to carry the task with that
   * leg. A platform that holds the record hands it back; an adapter that composed the record in
   * memory has nothing, and is named. Without it the store is required and never read.
   */
  rebuild?: () => Adapter<Channel>;
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
  const rulesEvaluated = new Set<string>();
  const stopObserving = observeRules(rule => { rulesEvaluated.add(rule); });
  const violations: ProtocolViolation[] = [...validateManifest(adapter.manifest)];
  const events: ProviderEventEnvelope<C>[] = [];
  const seen = new Set<ContractSubject>();
  const stream = new TaskStream();
  const breaks = new BreakStream();
  let seeded = false;
  const duringRead: ProviderEventEnvelope<C>[] = [];

  const storedSecrets = new Map<string, string>();
  const authenticationSecrets: SecretStore = {
    get: async key => storedSecrets.get(key),
    set: async (key, value) => { storedSecrets.set(key, value); },
    delete: async key => { storedSecrets.delete(key); },
  };
  let authentication = await adapter.createAuthenticationSession({ ...context, secrets: authenticationSecrets });

  let connection: Connection<C> | undefined;
  /** Whether the run holds a client at all: false between a reload's first client going down and its second standing, and after a reload that failed. */
  let clientLive = true;
  let unsubscribe: (() => void) | undefined;
  let unsubscribeAuthentication: (() => void) | undefined;
  let unsubscribeHost: (() => void) | undefined;
  let authenticationState: AuthenticationState | undefined;
  let login: Login | undefined;
  let disconnectWasClean = false;

  try {
    authenticationState = await authentication.state();
    const levels = effectiveLevels(adapter.manifest.orgLevels).map(level => level.id);
    violations.push(...validateAuthenticationState(authenticationState, "authentication", { levels }));
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
      loginId: context.loginId,
      autoAcceptTasks: context.autoAcceptTasks,
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
    const requireCapabilityMethods = (on: Connection<C>, capabilities: UserCapabilities) => {
      if (capabilities.breaks === true) {
        // The four stand or fall together: `granted` is a promise to honour a later commit, and
        // an adapter with requestBreak but no commitBreak leaves an agent a break that never starts.
        for (const method of ["requestBreak", "commitBreak", "cancelBreak", "endBreak"] as const) {
          requireMethod(on, method, "the login declares capabilities.breaks");
        }
      }
      if (capabilities.team?.breakControl === true) requireMethod(on, "executeTeamBreak", "the login declares capabilities.team.breakControl");
      if (capabilities.team?.leadAssistControl === true) requireMethod(on, "executeTeamLeadAssist", "the login declares capabilities.team.leadAssistControl");
      if (capabilities.team?.monitorControl !== undefined) requireMethod(on, "executeTeamMonitor", "the login declares capabilities.team.monitorControl");
      if (capabilities.team?.policyControl === true) requireMethod(on, "executeTeamPolicy", "the login declares capabilities.team.policyControl");
      if (some(capabilities.preferences)) requireMethod(on, "setPreference", "the login declares capabilities.preferences");
    };

    unsubscribeAuthentication = authentication.subscribe(state => {
      const own = validateAuthenticationState(state, "authentication", { levels });
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
    violations.push(...validateHostGuarantees(context.host.guarantees, "context.host.guarantees"));
    // The zone is the host's to state, so a context without one is a host that cannot exist.
    violations.push(...validateTimeZone(context.timeZone, "context.timeZone"));
    // How the agent hears the call decides what the host owns: on a softphone the host has the
    // audio and reports it; on a desk phone, or off voice, there is none for it to report.
    violations.push(...validatePhone(context.phone, adapter.manifest, "context.phone"));
    const softphone = adapter.manifest.channel === "voice" && context.phone === "softphone";
    const first = context.host.report();
    violations.push(...validateHostReport(first, "context.host"));
    const hasAudio = isRecord(first) && first.audio !== undefined;
    if (softphone && !hasAudio) {
      violations.push({ rule: "context.host.audio.required", path: "context.host.audio", message: "a softphone login's host reports its audio" });
    }
    if (!softphone && hasAudio) {
      violations.push({ rule: "context.host.audio.unexpected", path: "context.host.audio",
        message: adapter.manifest.channel === "voice" ? "a desk-phone login has no audio in the host to report" : `a ${adapter.manifest.channel} connection has no audio for the host to report` });
    }
    // What the host's Mute does is stated where the host holds a microphone, and nowhere else.
    violations.push(...validateHostMute(context.host.mute, softphone, "context.host.mute"));
    // The login's store is the host's to provide: an adapter that composes a record keeps in it what its platform cannot.
    const storeShape = validateLoginStore((context as { store?: unknown }).store, "context.store");
    violations.push(...storeShape);
    // The harness watches the store it hands over, so what an adapter leaves behind is seen rather than asked for.
    const watched = storeShape.length === 0 ? watchStore(context.store) : { store: context.store, held: new Set<string>() };
    unsubscribeHost = context.host.subscribe(report => {
      violations.push(...validateHostReport(report, "context.host"));
    });
    let consulted = false;
    // The wrapped host carries the mute kind the test's host stated, so the arms of ConnectContext still hold.
    const host = {
      guarantees: context.host.guarantees,
      ...(context.host.mute === undefined ? {} : { mute: context.host.mute }),
      report: () => { consulted = true; return context.host.report(); },
      subscribe: listener => { consulted = true; return context.host.subscribe(listener); },
    } as ConnectContext["host"];

    const connected = { ...context, host, store: watched.store } as ConnectContext;
    connection = await adapter.connect(connected);
    const live = connection;
    // A refusal is visible on both sides: what the host would not take, the adapter is told, with the rules.
    requireMethod(live, "refused", "every connection is told what the host refused");
    const tellRefused = (report: Refusal): void => {
      if (typeof live.refused !== "function") return;
      ruleEvaluated("connection.refused.rejected");
      try {
        live.refused(report);
      } catch (error) {
        violations.push({ rule: "connection.refused.rejected", path: "connection.refused", message: `told of a refusal, the adapter threw: ${String(error)}` });
      }
    };
    // Dial is declared by presence: the capability object carries a destination policy rather
    // than an `enabled` flag, so its presence is the declaration.
    if (adapter.manifest.idleCapabilities?.dial !== undefined) requireMethod(live, "dial", "the manifest declares dial");
    // On a softphone the call's audio lands in Omni, so the adapter has to open it; on a desk phone the host opens nothing.
    if (softphone) requireMethod(live, "openMedia", "the login is on a softphone");
    // The microphone is the host's, so on a softphone every call can be muted by it, and the
    // record of that leg is the provider's to take; on a desk phone the host holds no microphone.
    if (softphone) requireMethod(live, "recordStep", "the login is on a softphone, whose microphone the host mutes");

    const eventPayloads = new Map<string, string>();
    let capacityStated: number | undefined;
    // The drive waits on events: each waiter is offered every envelope as it lands.
    const waiters = new Set<(envelope: ProviderEventEnvelope<C>) => void>();
    const onEnvelope = (envelope: ProviderEventEnvelope<C>): void => {
      observeEvent(envelope, seen);
      const broken = validateEventEnvelope(envelope as ProviderEventEnvelope, adapter.manifest, "event", reader());
      violations.push(...broken);
      if (broken.length > 0) tellRefused({ artefact: "event", envelopeId: typeof envelope?.id === "string" ? envelope.id : undefined, violations: broken });
      // A diagnostic is informational to a host and a failure to a conformance run: the platform
      // under test broke a rule the adapter relies on, and a green result must not paper over it.
      // A reload in life has no first connection: the page is gone. The drive keeps its first
      // connection up while the second reads, so a platform that pushes the open task to the new
      // client pushes it to the old one too, and an adapter that calls a re-offer of answered work a
      // defect is right to. That diagnostic is the drive's own artefact, and is not counted while the
      // second adapter is up; every other moment it is.
      if (isRecord(envelope?.event) && envelope.event.type === "diagnostic") {
        violations.push({ rule: "diagnostic.raised", path: "event.diagnostic",
          message: `the provider reported a diagnostic: expected ${String(envelope.event.expected)}; observed ${String(envelope.event.observed)}` });
      }
      violations.push(...undeterminedTasks(eventTasks(envelope), "event"));
      if (eventNamesUsers(envelope)) requireMethod(live, "describeUsers", "an event publishes a UserId");
      // Work is pulled, never pushed: an offer before the host stated capacity is an allocation
      // against nothing, and an offer beyond the count is one too many -- unless the task is the
      // host's own dial arriving, which counts against nothing.
      if (isRecord(envelope?.event) && envelope.event.type === "task-offered") {
        if (capacityStated === undefined) {
          violations.push({ rule: "stream.taskOffered.beforeCapacity", path: "event.task",
            message: "a task was offered before the host stated any capacity: work is pulled, and nothing is allocated against a capacity nobody stated" });
        } else if (seeded && stream.openCount() >= capacityStated && !TaskStream.carriesDial(envelope.event.task)) {
          violations.push({ rule: "stream.taskOffered.overCapacity", path: "event.task",
            message: `a task was offered with ${stream.openCount()} already open against a stated capacity of ${capacityStated}` });
        }
      }
      // A re-delivered envelope is harmless and applied once; the same id carrying a different
      // payload is a reused id, which no dedupe can make harmless, and is named.
      if (typeof envelope?.id === "string") {
        const payload = JSON.stringify(envelope.event);
        const earlier = eventPayloads.get(envelope.id);
        if (earlier !== undefined) {
          if (earlier !== payload) {
            violations.push({ rule: "event.id.reused", path: "event.id",
              message: `envelope ${envelope.id} was delivered again with a different event: an id names one event for the life of the login` });
          }
          return;
        }
        eventPayloads.set(envelope.id, payload);
      }
      // Cross-event rules apply once the stream has a beginning: the connect snapshot. An event
      // delivered while that snapshot is read is held until it lands, and read then against it.
      if (seeded) violations.push(...stream.apply(envelope), ...breaks.apply(envelope));
      else duringRead.push(envelope);
      events.push(envelope);
      for (const waiter of waiters) waiter(envelope);
    };
    unsubscribe = connection.subscribe(onEnvelope);
    // A host reload is the first client dying and a second coming up in its place. The drive hands
    // the run over: the first connection is unsubscribed, disconnected and its session closed before
    // the second connects, and the run continues on the second -- so there is no first client for a
    // platform to push the open task back to, and nothing to exempt.
    const handOver = {
      isLive: (): boolean => clientLive,
      down: async (): Promise<boolean> => {
        let clean = true;
        try { unsubscribe?.(); } catch { clean = false; }
        unsubscribe = undefined;
        try { await connection?.disconnect(); } catch { clean = false; }
        try { await authentication.close(); } catch { clean = false; }
        clientLive = false;
        return clean;
      },
      up: (session: Awaited<ReturnType<Adapter<C>["createAuthenticationSession"]>>, second: Connection<C>): void => {
        authentication = session;
        connection = second;
        unsubscribe = second.subscribe(onEnvelope);
        clientLive = true;
      },
    };

    const snapshot = await connection.snapshot() as Snapshot;
    observeSnapshot(snapshot, seen);
    {
      const broken = validateSnapshot(snapshot, adapter.manifest, "snapshot", reader());
      violations.push(...broken);
      if (broken.length > 0) tellRefused({ artefact: "snapshot", violations: broken });
    }
    violations.push(...undeterminedTasks(Array.isArray(snapshot?.tasks) ? snapshot.tasks : [], "snapshot.tasks"));
    stream.seed(snapshot);
    breaks.seed(snapshot);
    seeded = true;
    // A snapshot supersedes what it restates and nothing else. Of the events held during the read,
    // a state-replacing kind is dropped, since the snapshot carries that state and must account for
    // it; the rest -- a dial's outcome, a diagnostic, an announcement, a queue summary -- report
    // transactions no snapshot carries, and are applied after it, in order.
    ruleEvaluated("snapshot.accounts.task", "snapshot.accounts.ended");
    const carried = new Set<string>();
    for (const task of Array.isArray(snapshot?.tasks) ? snapshot.tasks : []) {
      if (isRecord(task) && typeof task.allocationId === "string") carried.add(task.allocationId);
    }
    for (const held of duringRead) {
      const event = held.event as Record<string, unknown>;
      if (!SUPERSEDED_BY_A_SNAPSHOT.has(String(event.type))) {
        violations.push(...stream.apply(held), ...breaks.apply(held));
        continue;
      }
      if ((event.type === "task-offered" || event.type === "task-updated") && isRecord(event.task) && typeof event.task.allocationId === "string" && !carried.has(event.task.allocationId)) {
        violations.push({ rule: "snapshot.accounts.task", path: "snapshot.tasks",
          message: `${String(event.task.id)} (${event.task.allocationId}) was published while the snapshot was read and the snapshot does not carry it: a snapshot accounts for everything the adapter emitted before it resolved` });
      }
      if (event.type === "task-ended" && typeof event.allocationId === "string" && carried.has(event.allocationId)) {
        violations.push({ rule: "snapshot.accounts.ended", path: "snapshot.tasks",
          message: `${String(event.taskId)} (${event.allocationId}) ended while the snapshot was read and the snapshot still carries it: a snapshot accounts for everything the adapter emitted before it resolved` });
      }
    }
    duringRead.length = 0;
    requireCapabilityMethods(live, current().capabilities);
    if (publishesUserIds(snapshot)) {
      requireMethod(live, "describeUsers", "the snapshot publishes a UserId");
      // Required by presence is not enough: the names the snapshot published are looked up, and what
      // comes back is held to the shape -- an empty answer to a roster of colleagues is named.
      const named = userIdsIn(snapshot);
      if (typeof live.describeUsers === "function" && named.length > 0) {
        let described: unknown;
        try {
          described = await live.describeUsers(named as UserId[]);
          violations.push(...validateDescribedUsers(described, named, "connection.describeUsers"));
          if (Array.isArray(described) && described.length === 0) {
            violations.push({ rule: "connection.describeUsers.empty", path: "connection.describeUsers",
              message: `asked about ${named.join(", ")}, whom the snapshot itself named, the provider described nobody` });
          }
        } catch (error) {
          violations.push({ rule: "connection.describeUsers.rejected", path: "connection.describeUsers", message: `describeUsers rejected rather than answered: ${String(error)}` });
        }
      }
    }

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
    capacityStated = 1;
    const capacity = await connection.setCapacity({ count: capacityStated });
    const malformed = validateResult(capacity, "setCapacity", "connection.setCapacity");
    violations.push(...malformed);
    // The provider republishes the agent's day: once connected, the identity carries the zone the
    // host sent. That proves the round trip, not the store -- an echo passes it -- and the name
    // says only what it tests; storage is proved by a colleague's zone arriving from describeUsers().
    // A zone is judged by what it denotes: Asia/Kolkata and Asia/Calcutta are one zone, and a
    // provider that keeps the canonical name has kept the zone.
    if (isTimeZone(context.timeZone) && !sameTimeZone(current().identity.timeZone, context.timeZone)) {
      violations.push({
        rule: "authentication.identity.timeZone.republished",
        path: "authentication.identity.timeZone",
        message: `the host sent ${context.timeZone} at connect and the identity says ${String(current().identity.timeZone)}: the provider republishes the agent's time zone on the identity`,
      });
    }
    // A refusal is read only from a result that has the shape of one.
    if (malformed.length === 0 && capacity.status === "failed") {
      violations.push({
        rule: "connection.setCapacity.failed",
        path: "connection.setCapacity",
        message: `the provider would not accept a capacity: ${capacity.failure.code}`,
      });
    }

    if (options.drive) {
      const localAudio = isRecord(first) && isRecord(first.audio) && isRecord(first.audio.input) && first.audio.input.status === "available"
        ? first.audio.input.localAudio as MediaStream : undefined;
      violations.push(...await driveOneCall({
        connection: live, manifest: adapter.manifest, channel: adapter.manifest.channel, softphone, snapshot, events, waiters, stream, localAudio,
        timeoutMs: options.driveTimeoutMs ?? 5000,
        context: connected, secrets: authenticationSecrets, reader, rebuild: options.rebuild, held: watched.held, handOver,
        streams: { stream, breaks },
      }));
    }
    // Capacity supersedes rather than accumulates, so a decrease is as ordinary as an increase: the
    // host raises it, lowers it, and takes it away, and the provider takes each as the ceiling it is.
    // A provider whose ceiling can only rise passes a zero it special-cases and still cannot go from
    // five to three, so the exercise moves the axis both ways. Zero is host-stopped: the agent's
    // capacity is elsewhere, and the provider allocates nothing and refuses nothing for it. Any offer
    // after a lower count is caught against it (stream.taskOffered.overCapacity).
    ruleEvaluated("connection.setCapacity.lowered", "connection.setCapacity.zero");
    for (const count of clientLive ? [2, 1, 0] : []) {
      capacityStated = count;
      const restated = await connection.setCapacity({ count });
      const shape = validateResult(restated, "setCapacity", "connection.setCapacity");
      violations.push(...shape);
      if (shape.length === 0 && restated.status === "failed") {
        violations.push({ rule: count === 0 ? "connection.setCapacity.zero" : "connection.setCapacity.lowered", path: "connection.setCapacity",
          message: count === 0
            ? `the provider would not take a capacity of zero: ${restated.failure.code}; zero is host-stopped, the agent's capacity being elsewhere, and a provider allocates nothing and refuses nothing for it`
            : `the provider would not take a capacity of ${count} after a higher one: ${restated.failure.code}; capacity supersedes, and a decrease is as ordinary as an increase` });
        break;
      }
    }
  } finally {
    let clean = true;
    try { unsubscribe?.(); } catch { clean = false; }
    try { unsubscribeAuthentication?.(); } catch { clean = false; }
    try { unsubscribeHost?.(); } catch { clean = false; }
    // A run whose reload took the first client down and stood no second holds nothing to close.
    if (clientLive) {
      try { await connection?.disconnect(); } catch { clean = false; }
      try { await authentication.close(); } catch { clean = false; }
    }
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

  stopObserving();
  return {
    events: events as ProviderEventEnvelope[],
    authenticationState: authenticationState as AuthenticationState,
    login: (login ?? authenticationState) as AuthenticationState,
    notExercised: CONTRACT_SUBJECTS.filter(subject => !seen.has(subject)),
    disconnectWasClean,
    violations,
    rulesEvaluated,
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

/** Every UserId a snapshot publishes: on the record, the room, a lead request, an imposed break, the roster. */
function userIdsIn(snapshot: Snapshot | undefined): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => { if (typeof value === "string" && value.length > 0) ids.add(value); };
  add(snapshot?.break?.imposed?.by);
  const team = snapshot?.team as Record<string, unknown> | undefined;
  if (isRecord(team)) {
    for (const member of Array.isArray(team.members) ? team.members : []) if (isRecord(member)) add(member.id);
    for (const request of Array.isArray(team.requests) ? team.requests : []) if (isRecord(request)) add(request.memberId);
  }
  for (const task of Array.isArray(snapshot?.tasks) ? snapshot.tasks : []) {
    const t = task as unknown as Record<string, unknown>;
    if (isRecord(t.handlingHistory) && Array.isArray(t.handlingHistory.steps)) for (const step of t.handlingHistory.steps) if (isRecord(step)) add(step.by);
    if (Array.isArray(t.onCall)) for (const entry of t.onCall) if (isRecord(entry)) add(entry.userId);
    if (isRecord(t.leadAssist)) add(t.leadAssist.leadId);
    if (isRecord(t.assisting)) add(t.assisting.memberId);
    if (isRecord(t.monitoring)) { add(t.monitoring.memberId); add(t.monitoring.agentId); }
  }
  return [...ids];
}

const teamNamesUsers = (team: unknown): boolean =>
  isRecord(team) && (some(team.members) || some(team.requests));

const taskNamesUsers = (task: unknown): boolean =>
  isRecord(task) && (
    (isRecord(task.handlingHistory) && Array.isArray(task.handlingHistory.steps) && task.handlingHistory.steps.some(step => isRecord(step) && step.by !== undefined)) ||
    (isRecord(task.leadAssist) && task.leadAssist.leadId !== undefined) ||
    isRecord(task.assisting) ||
    isRecord(task.monitoring));


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

/** The tasks an envelope carries: the one a task event names, or a snapshot event's list. */
function eventTasks(envelope: unknown): unknown[] {
  if (!isRecord(envelope) || !isRecord(envelope.event)) return [];
  const event = envelope.event;
  if (event.type === "task-offered" || event.type === "task-updated") return [event.task];
  if (event.type === "snapshot" && isRecord(event.snapshot) && Array.isArray(event.snapshot.tasks)) return event.snapshot.tasks;
  return [];
}

/**
 * A task published under `undetermined` terms is a fact to a host and a failure to a conformance
 * run, as a diagnostic is: the platform under test could not say what it permits, and a green
 * result must not paper over it.
 */
function undeterminedTasks(tasks: readonly unknown[], path: string): ProtocolViolation[] {
  return tasks.flatMap((task, index) => isRecord(task) && task.capabilitySource === "undetermined"
    ? [{ rule: "capabilitySource.undetermined", path: `${path}[${index}].capabilitySource`,
        message: `task ${String(task.id)} was published under terms the provider could not determine` }]
    : []);
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
    (before.team?.leadAssistControl === true && after.team?.leadAssistControl !== true) ||
    (before.team?.monitorControl !== undefined && after.team?.monitorControl === undefined);
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
 * A task's capabilities are current, not fixed. A provider whose platform withdraws a permission
 * mid-task republishes the task with the set as it now stands, and a command under the withdrawn
 * capability is refused from then on. `tasks` is what the provider published for one task, first
 * to last -- the offer, then each republish -- every one validated against the manifest, all the
 * same id, with at least one capability offered by the first absent from the last. A locked
 * control is present without permission, not withdrawn: it is still drawn, so it does not count.
 * `command` is the command a host issues under a withdrawn capability: it must be clean against
 * the first task and refused against the last for want of that capability and for nothing else.
 * That pairing is what proves the refusal comes from the withdrawal rather than from a command
 * that was never issuable. Pair it with `assertCommandRefusedAfterWithdrawal` on the provider's
 * answer to the same command.
 */
export function assertTaskCapabilityWithdrawal(
  tasks: readonly Task[],
  manifest: Manifest,
  command: Record<string, unknown>,
): void {
  const first = tasks[0];
  const last = tasks.at(-1);
  if (tasks.length < 2 || first === undefined || last === undefined) {
    throw new Error("Task capability withdrawal needs the task as offered and at least one republish of it");
  }
  const context = {
    channel: manifest.channel,
    levels: effectiveLevels(manifest.orgLevels).map(level => level.id),
    dialOutcomesDeclared: manifest.dialOutcomes !== undefined,
  };
  tasks.forEach((task, index) => {
    assertNoViolations(validateTask(task, context, `tasks[${index}]`), `Task capability withdrawal: tasks[${index}] must be a task the wire could carry`);
    if (task.id !== first.id) {
      throw new Error(`Task capability withdrawal must keep the task: tasks[${index}] is ${task.id}, and the offer was ${first.id}`);
    }
  });
  const withdrawn = Object.keys(first.capabilities).filter(name => (last.capabilities as Record<string, unknown>)[name] === undefined);
  if (withdrawn.length === 0) {
    throw new Error("Task capability withdrawal must end with at least one capability the offer declared withdrawn; a locked control is present without permission, not withdrawn");
  }
  const before = validateTaskCommand(command, first, "command");
  if (before.length > 0) {
    throw new Error(`Task capability withdrawal: the command must be issuable against the task as offered, or its later refusal proves nothing (${before.map(v => v.rule).join(", ")})`);
  }
  const after = validateTaskCommand(command, last, "command");
  const forWant = after.filter(v => withdrawn.some(name => v.rule === `command.capability.${name}`));
  if (forWant.length === 0) {
    throw new Error(`Task capability withdrawal: the command must be refused against the republished task for want of ${withdrawn.join(" or ")}; it was ${after.length === 0 ? "accepted" : `refused for ${after.map(v => v.rule).join(", ")}`}`);
  }
  const other = after.filter(v => !forWant.includes(v));
  if (other.length > 0) {
    throw new Error(`Task capability withdrawal: the republished task refuses the command for more than the withdrawal (${other.map(v => v.rule).join(", ")}); change one thing at a time`);
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
// provider to it. A task is never its audio: media arrives on the provider's word, ends only
// where it arrived and on work that has begun, and what follows the media ending is the work
// completing or ending, never a phase the audio decided.
// ---------------------------------------------------------------------------

const WORK_BEGUN = new Set(["in-progress", "paused", "completing"]);
/** Where audio can arrive: a task at work. A completing task's call is over; a connect-back returns it to in-progress before any media. */
const AT_WORK = new Set(["in-progress", "paused"]);

/** What a stream has said about the tasks it carries, and the rules across events. */
const TASK_PHASES_ORDERED = ["pending", "confirmed", "preview", "in-progress", "paused", "completing"] as const;
/** Where a task may be next, by the guide's transition table, closed over the phases between two publications. */
const REACHABLE_PHASES: Record<string, Set<string>> = {
  pending: new Set(["pending", "confirmed", "preview", "in-progress", "paused", "completing"]),
  confirmed: new Set(["confirmed", "preview", "in-progress", "paused", "completing"]),
  preview: new Set(["preview", "in-progress", "paused", "completing"]),
  "in-progress": new Set(["in-progress", "paused", "completing"]),
  paused: new Set(["paused", "in-progress", "completing"]),
  completing: new Set(["completing"]),
};

/**
 * The event kinds a snapshot restates, and so supersedes when delivered while it is read. Every
 * other kind reports a transaction no snapshot carries, and a host applies it after the snapshot.
 */
export const SUPERSEDED_BY_A_SNAPSHOT: ReadonlySet<string> = new Set([
  "snapshot", "transport-status", "break-state", "task-offered", "task-updated", "task-ended",
  "task-media-started", "task-media-ended", "team-updated", "contacts-updated", "calendar-updated",
]);

export class TaskStream {
  private readonly tasks = new Map<string, { phase: string; media: string; source: string; stages: Map<string, string>; record: Set<string> | undefined; allocation: string }>();
  // Every allocation this login has seen, and the ones whose task has ended: an offer never reuses
  // one, an event about a task names the life that is open, and a late event for a life that ended
  // is recognised as that rather than landing on the next customer under the same id.
  private readonly allocations = new Set<string>();
  private readonly endedAllocations = new Set<string>();
  // Every dial the stream can place an outcome against: one the host said it placed, or one a
  // task carried on `onCall` or in its record -- which is how a dial made before a transfer is known
  // to whoever holds the task now. `answered` or `ended` once its outcome arrived, since it comes once.
  private readonly dials = new Map<string, "placed" | "answered" | "ended">();

  /** The host placed a dial: its outcome, whenever it arrives, is one the stream expects. */
  dialled(dialId: string): void {
    if (!this.dials.has(dialId)) this.dials.set(dialId, "placed");
  }

  private noteDials(task: unknown): void {
    if (!isRecord(task)) return;
    const entries = [
      ...(Array.isArray(task.onCall) ? task.onCall : []),
      ...(isRecord(task.handlingHistory) && Array.isArray(task.handlingHistory.steps) ? task.handlingHistory.steps : []),
    ];
    for (const entry of entries) {
      if (isRecord(entry) && typeof entry.dialId === "string") this.dialled(entry.dialId);
    }
  }

  /**
   * Whether an event about a task names the life that is open under its id. One naming a life that
   * has ended is the late event the allocation exists to catch; one naming a life nobody has seen is
   * a different fault. Either way it is not applied to the open task.
   */
  private namesTheOpenLife(event: Record<string, unknown>, known: { allocation: string }, at: string, refuse: (rule: string, where: string, message: string) => void): boolean {
    const named = event.allocationId;
    if (typeof named !== "string" || named === known.allocation) return true;
    if (this.endedAllocations.has(named)) {
      refuse("stream.allocation.ended", `${at}.allocationId`,
        `${String(event.type)} names allocation ${named}, a life of ${String(event.taskId)} that has ended; the life open under that id is ${known.allocation}, and a late event lands on the life it names, never the next`);
    } else {
      refuse("stream.allocation.unknown", `${at}.allocationId`, `${named} is not an allocation this login has seen`);
    }
    return false;
  }

  /** How many tasks the stream currently holds open. */
  openCount(): number { return this.tasks.size; }

  /** Whether an offered task is a dial arriving -- the host's own call, a connect-back -- which counts against no capacity: an entry on its call carrying a dial. */
  static carriesDial(task: unknown): boolean {
    if (!isRecord(task) || !Array.isArray(task.onCall)) return false;
    return task.onCall.some(entry => isRecord(entry) && typeof entry.dialId === "string");
  }

  /** Whether the update shows the party being dialled again -- a connect-back, a platform's callback -- the one thing that brings a completing task back. */
  private static partyDialled(task: unknown): boolean {
    return isRecord(task) && Array.isArray(task.onCall)
      && task.onCall.some(entry => isRecord(entry) && entry.role === "party" && typeof entry.stage === "string");
  }

  /** The entries of a task's record, each by step and instant, or undefined where the task carries no record. */
  private static record(task: unknown): Set<string> | undefined {
    if (!isRecord(task) || !isRecord(task.handlingHistory) || !Array.isArray(task.handlingHistory.steps)) return undefined;
    return new Set(task.handlingHistory.steps.filter(isRecord).map(entry => `${String(entry.step)}@${String(entry.at)}`));
  }

  /** What a restated record lost of the one read before it: nothing, or the entries by step and instant. */
  private static lost(was: Set<string> | undefined, now: Set<string> | undefined): string[] {
    if (was === undefined || was.size === 0) return [];
    if (now === undefined) return [...was];
    return [...was].filter(key => !now.has(key));
  }

  private static stated(task: unknown): { phase: string; media: string; source: string; stages: Map<string, string>; record: Set<string> | undefined; allocation: string } {
    const media = isRecord(task) && (task.media === "started" || task.media === "ended") ? task.media : "none";
    // The stage of every dialled entry the room names by its dial, so an update can be held to the
    // outcome that moves it.
    const stages = new Map<string, string>();
    if (isRecord(task) && Array.isArray(task.onCall)) {
      for (const entry of task.onCall) {
        if (isRecord(entry) && typeof entry.dialId === "string" && typeof entry.stage === "string") stages.set(entry.dialId, entry.stage);
      }
    }
    return { phase: String(isRecord(task) ? task.phase : undefined), media, source: String(isRecord(task) ? task.capabilitySource : undefined), stages, record: TaskStream.record(task), allocation: String(isRecord(task) ? task.allocationId : undefined) };
  }

  /** Replaces what is known with a snapshot's tasks, as a snapshot replaces Omni's state. */
  seed(snapshot: unknown): void {
    this.tasks.clear();
    if (!isRecord(snapshot) || !Array.isArray(snapshot.tasks)) return;
    for (const task of snapshot.tasks) {
      if (isRecord(task) && typeof task.id === "string") {
        this.tasks.set(task.id, TaskStream.stated(task));
        if (typeof task.allocationId === "string") this.allocations.add(task.allocationId);
      }
      this.noteDials(task);
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
        ruleEvaluated("stream.snapshot.capabilitySource", "stream.snapshot.handlingHistory");
        // A snapshot replaces what is known, and still may not say a task lost terms it had read.
        if (isRecord(event.snapshot) && Array.isArray(event.snapshot.tasks)) {
          event.snapshot.tasks.forEach((task, index) => {
            if (!isRecord(task) || typeof task.id !== "string") return;
            const was = this.tasks.get(task.id);
            if (was !== undefined && (was.source === "queue" || was.source === "ungoverned") && task.capabilitySource === "undetermined") {
              refuse("stream.snapshot.capabilitySource", `${at}.snapshot.tasks[${index}].capabilitySource`,
                `${task.id} was published under ${was.source} terms and the snapshot says undetermined: terms once read stay read`);
            }
            // A record once read is not unread: a resync restates it whole, or with more, never with less.
            const lost = TaskStream.lost(was?.record, TaskStream.record(task));
            if (lost.length > 0) {
              refuse("stream.snapshot.handlingHistory", `${at}.snapshot.tasks[${index}].handlingHistory`,
                `${task.id}'s record lost ${lost.join(", ")} on the snapshot: an entry read by the host stays in the record until the task ends`);
            }
          });
        }
        this.seed(event.snapshot);
        break;
      case "task-offered": {
        ruleEvaluated("stream.taskOffered.duplicate", "stream.taskOffered.allocation");
        if (id === undefined) break;
        if (known !== undefined) refuse("stream.taskOffered.duplicate", `${at}.task.id`, `${id} is already on the stream; an offer introduces a task once`);
        const allocation = isRecord(event.task) ? event.task.allocationId : undefined;
        if (typeof allocation === "string") {
          if (this.allocations.has(allocation)) {
            refuse("stream.taskOffered.allocation", `${at}.task.allocationId`,
              `${allocation} was already an allocation on this login: an allocation is minted once per offer and never reused, whatever the task id does`);
          }
          this.allocations.add(allocation);
        }
        this.tasks.set(id, TaskStream.stated(event.task));
        this.noteDials(event.task);
        break;
      }
      case "task-updated":
        if (id === undefined) break;
        ruleEvaluated("stream.taskUpdated.unknown", "stream.taskUpdated.capabilitySource", "stream.taskUpdated.phase", "stream.taskUpdated.allocation", "stream.taskUpdated.mediaOpen",
          "stream.taskUpdated.handlingHistory", "stream.taskMediaEnded.follow", "stream.taskUpdated.media", "stream.taskUpdated.stage");
        if (known === undefined) {
          refuse("stream.taskUpdated.unknown", `${at}.task.id`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        // Terms once read stay read. A re-read that fails is not a new fact about the task, so the
        // last statement stands and the failure is a diagnostic; undetermined is a place a task
        // starts from, never one it returns to.
        if ((known.source === "queue" || known.source === "ungoverned") && isRecord(event.task) && event.task.capabilitySource === "undetermined") {
          refuse("stream.taskUpdated.capabilitySource", `${at}.task.capabilitySource`,
            `${id} was published under ${known.source} terms and now says undetermined: terms once read stay read, and a re-read that fails is a diagnostic, not a republish`);
        }
        // An update is of the life that is open. One carrying another allocation is a copy of a
        // different life of this id -- a stale republish of the last customer's call, or the next one's.
        if (isRecord(event.task) && String(event.task.allocationId) !== known.allocation) {
          refuse("stream.taskUpdated.allocation", `${at}.task.allocationId`,
            `${id} is open as allocation ${known.allocation} and the update says ${String(event.task.allocationId)}: an update restates the life that is open, never another`);
        }
        // A task does not go backwards. The stream sees publications, not transitions, and a task may
        // pass through a phase between two, so what is refused is a phase unreachable from the last
        // one read by the guide's table: back to pending, back to confirmed once work began, out of
        // completing except through a connect-back -- which the update itself shows, the party
        // carrying the host's dial.
        {
          const from = known.phase;
          const to = isRecord(event.task) ? String(event.task.phase) : "";
          const reachable = REACHABLE_PHASES[from];
          if (reachable !== undefined && (TASK_PHASES_ORDERED as readonly string[]).includes(to) && !reachable.has(to)) {
            const connectingBack = from === "completing" && TaskStream.partyDialled(event.task) && (to === "in-progress" || to === "paused");
            if (!connectingBack) {
              refuse("stream.taskUpdated.phase", `${at}.task.phase`,
                `${id} was ${from} and the update says ${to}: a task does not go backwards, and ${from === "completing" ? "only the party being dialled again, a connect-back or a callback, with its stage on the call, brings a completing task back" : `${to} is not reachable from ${from}`}`);
            }
          }
        }
        // A record once read is not unread: an update restates it whole, or with more, never with less.
        {
          const lost = TaskStream.lost(known.record, TaskStream.record(event.task));
          if (lost.length > 0) {
            refuse("stream.taskUpdated.handlingHistory", `${at}.task.handlingHistory`,
              `${id}'s record lost ${lost.join(", ")} on the update: an entry read by the host stays in the record until the task ends`);
          }
        }
        // A task completes after its media ends, never around it: an update that moves a task to
        // completing while the stream holds its audio as started is a call whose audio never ended,
        // whoever caused the ending -- the drive's end-call, a transfer, the provider's own hand.
        {
          const to = isRecord(event.task) ? String(event.task.phase) : "";
          if (to === "completing" && known.media === "started" && known.phase !== "completing") {
            refuse("stream.taskUpdated.mediaOpen", `${at}.task.phase`,
              `${id} moves to completing with its media still started: the audio ends first, on task-media-ended, and a wrap-up with the call still up is audio that never ended`);
          }
        }
        if (known.media === "ended") {
          const phase = isRecord(event.task) ? String(event.task.phase) : "";
          if (phase !== "completing") {
            refuse("stream.taskMediaEnded.follow", `${at}.task.phase`,
              `after its media ended, ${id} completes or ends; ${phase} is a phase the audio does not decide`);
          }
        }
        // A task replaces the task, and an update re-states media without moving it: the
        // transitions belong to task-media-started and task-media-ended. Releasing ended is the
        // one move an update may make, since wrapped audio has nothing left to end.
        {
          const next = TaskStream.stated(event.task);
          if (known.media !== next.media && !(known.media === "ended" && next.media === "none")) {
            refuse("stream.taskUpdated.media", `${at}.task.media`,
              `a task-updated re-states media, it does not move it: ${id} held ${known.media} and the update says ${next.media}; audio arrives on task-media-started and ends on task-media-ended`);
          }
          // The same pairing for a dialled entry: the dial-outcome is the transition, the stage is
          // the state, and the outcome comes first. An update that joins an entry on its own is
          // moving what only an answered outcome moves.
          for (const [dialId, stage] of next.stages) {
            if (stage === "joined" && known.stages.get(dialId) === "ringing" && this.dials.get(dialId) !== "answered") {
              refuse("stream.taskUpdated.stage", `${at}.task.onCall`,
                `a task-updated re-states a stage, it does not move it: ${dialId} was ringing and the update says joined before any answered dial-outcome for it`);
            }
          }
          this.tasks.set(id, next);
        }
        this.noteDials(event.task);
        break;
      case "task-media-started":
        ruleEvaluated("stream.taskMediaStarted.unknown", "stream.taskMediaStarted.beforeWork", "stream.taskMediaStarted.duplicate", "stream.allocation.ended", "stream.allocation.unknown");
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskMediaStarted.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (!this.namesTheOpenLife(event, known, at, refuse)) break;
        if (!AT_WORK.has(known.phase)) {
          refuse("stream.taskMediaStarted.beforeWork", `${at}.taskId`,
            `media cannot arrive on ${id} while it is ${known.phase}: a task is never its audio, and its work has not begun`);
        }
        if (known.media === "started") {
          refuse("stream.taskMediaStarted.duplicate", `${at}.taskId`, `media already started on ${id}; started and ended alternate`);
        }
        known.media = "started";
        break;
      case "task-media-ended":
        ruleEvaluated("stream.taskMediaEnded.unknown", "stream.taskMediaEnded.beforeWork", "stream.taskMediaEnded.silent", "stream.allocation.ended", "stream.allocation.unknown");
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskMediaEnded.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (!this.namesTheOpenLife(event, known, at, refuse)) break;
        if (!WORK_BEGUN.has(known.phase)) {
          refuse("stream.taskMediaEnded.beforeWork", `${at}.taskId`,
            `media cannot end on ${id} while it is ${known.phase}: a task is never its audio, and its work has not begun`);
        }
        if (known.media !== "started") {
          refuse("stream.taskMediaEnded.silent", `${at}.taskId`,
            `media cannot end on ${id} where none arrived: audio attaches on task-media-started, or on a task carried with media started`);
        }
        known.media = "ended";
        break;
      case "task-ended":
        ruleEvaluated("stream.taskEnded.unknown", "stream.allocation.ended", "stream.allocation.unknown");
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskEnded.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        // A late ending for a life that is over must not end the life that is open under the same id.
        if (!this.namesTheOpenLife(event, known, at, refuse)) break;
        this.endedAllocations.add(known.allocation);
        this.tasks.delete(id);
        break;
      case "dial-outcome": {
        // An outcome ends a dial somebody placed, once. The task it names may already have ended;
        // a dial placed late routinely outlives its call, which is why the dial has its own identity,
        // and why the outcome names the allocation: the host routes it to that life, ended or not.
        ruleEvaluated("stream.allocation.unknown");
        if (typeof event.allocationId === "string" && !this.allocations.has(event.allocationId)) {
          refuse("stream.allocation.unknown", `${at}.allocationId`, `${event.allocationId} is not an allocation this login has seen`);
        }
        if (typeof event.dialId !== "string") break;
        const dial = this.dials.get(event.dialId);
        if (dial === undefined) {
          refuse("stream.dialOutcome.unknown", `${at}.dialId`,
            `${event.dialId} is not a dial the host placed or a task carried: an outcome ends a dial somebody made`);
        } else if (dial !== "placed") {
          refuse("stream.dialOutcome.duplicate", `${at}.dialId`, `${event.dialId} already has its outcome; a dial ends once`);
        }
        this.dials.set(event.dialId, event.outcome === "answered" ? "answered" : "ended");
        break;
      }
      default:
        break;
    }
    return found;
  }
}

// ---------------------------------------------------------------------------
// Driving one call.
// ---------------------------------------------------------------------------

interface Drive<C extends Channel> {
  connection: Connection<C>;
  manifest: Manifest<C>;
  context: ConnectContext;
  secrets: SecretStore;
  reader: () => ReaderContext;
  rebuild: (() => Adapter<Channel>) | undefined;
  /** Every key the watched store currently holds. */
  held: ReadonlySet<string>;
  /** Takes the first client down and brings the second up in its place: what a host reload is. */
  handOver: { isLive: () => boolean; down: () => Promise<boolean>; up: (session: Awaited<ReturnType<Adapter<C>["createAuthenticationSession"]>>, second: Connection<C>) => void };
  /** The streams the run holds its events to, re-seeded from the reloaded client's snapshot. */
  streams: { stream: TaskStream; breaks: BreakStream };
  channel: Channel;
  softphone: boolean;
  snapshot: unknown;
  events: readonly ProviderEventEnvelope<C>[];
  waiters: Set<(envelope: ProviderEventEnvelope<C>) => void>;
  stream: TaskStream;
  localAudio: MediaStream | undefined;
  timeoutMs: number;
}

/**
 * One ordinary lifecycle on the first task offered, each step held to the rules a host holds a
 * provider to: the command validated against the task as published, the result validated for the
 * method, and the event the provider owes in return awaited -- a step that never arrives is a
 * violation naming what was owed. The drive stops where the task offers no way on (no `endCall`,
 * a provider that completes for itself) and says nothing about what it could not reach.
 */
async function driveOneCall<C extends Channel>(drive: Drive<C>): Promise<ProtocolViolation[]> {
  const found: ProtocolViolation[] = [];
  const refuse = (rule: string, path: string, message: string) => found.push({ rule, path, message });
  const isTask = (value: unknown): value is Record<string, unknown> => isRecord(value) && typeof value.id === "string";

  // Wait for an envelope that satisfies `matches`, looking first at what already arrived.
  const waitFor = <T>(what: string, matches: (envelope: ProviderEventEnvelope<C>) => T | undefined, from: number,
    within: { ms: number; onExpiry: () => void } = { ms: drive.timeoutMs, onExpiry: () => refuse("drive.timeout", "drive", `the provider owed ${what} within ${drive.timeoutMs}ms and it never arrived`) }): Promise<{ found: T; at: number } | undefined> =>
    new Promise(resolve => {
      for (let index = from; index < drive.events.length; index += 1) {
        const hit = matches(drive.events[index]!);
        if (hit !== undefined) { resolve({ found: hit, at: index + 1 }); return; }
      }
      const timer = setTimeout(() => {
        drive.waiters.delete(waiter);
        within.onExpiry();
        resolve(undefined);
      }, within.ms);
      const waiter = (envelope: ProviderEventEnvelope<C>) => {
        const hit = matches(envelope);
        if (hit === undefined) return;
        clearTimeout(timer);
        drive.waiters.delete(waiter);
        resolve({ found: hit, at: drive.events.length });
      };
      drive.waiters.add(waiter);
    });

  const recordSurvivesReload = async (at: string): Promise<void> => {
    ruleEvaluated("drive.reload.rejected", "drive.reload.manifest", "drive.reload.login", "drive.reload.snapshot", "drive.reload.allocation", "drive.reload.history", "drive.reload.handover");
    let again: Adapter<C>;
    try {
      again = drive.rebuild!() as Adapter<C>;
    } catch (error) {
      refuse("drive.reload.rejected", "drive.reload", `building the adapter again threw: ${String(error)}`);
      return;
    }
    // The same provider, built again: a different manifest is a different adapter, and proves nothing about this one.
    if (again.manifest.id !== drive.manifest.id) {
      refuse("drive.reload.manifest", "drive.reload.manifest",
        `rebuild returned an adapter for ${String(again.manifest.id)}; the reload is of ${String(drive.manifest.id)}`);
      return;
    }
    // The first client dies first, as it does on a reload: from here the run has no connection until the second stands.
    if (!await drive.handOver.down()) {
      refuse("drive.reload.handover", "drive.reload", "taking the first client down threw: an unsubscribe, disconnect() or close() failed");
    }
    try {
      const session = await again.createAuthenticationSession({ ...drive.context, secrets: drive.secrets });
      // The reload is a restore before it is anything else: the second session stands authenticated
      // as the same person, from the secrets alone, or nothing it reads afterwards is this login's.
      const restored = await (session as unknown as { state(): Promise<unknown> }).state();
      found.push(...validateAuthenticationState(restored, "drive.reload.login"));
      const same = isRecord(restored) && restored.status === "authenticated" && isRecord(restored.identity) && restored.identity.id === drive.reader().self;
      if (!same) {
        refuse("drive.reload.login", "drive.reload.login",
          `a second adapter built from the same login and secrets did not restore it: the session says ${String(isRecord(restored) ? restored.status : restored)}${isRecord(restored) && isRecord(restored.identity) ? ` as ${String(restored.identity.id)}` : ""}, and the login is ${String(drive.reader().self)}`);
        // A reload that cannot restore the login is a sign-in screen, not a connection: the run ends here.
        try { await session.close(); } catch { /* the session that would not restore is closed as far as it can be */ }
        return;
      }
      const second = await again.connect(drive.context);
      // From here the second client is the run's connection: what it publishes is validated as before.
      drive.handOver.up(session, second);
      drive.connection = second;
      const snapshot = await second.snapshot() as unknown;
      // The second adapter's snapshot is held to everything a first one is, and the streams take it as the state now.
      found.push(...validateSnapshot(snapshot, again.manifest, "drive.reload.snapshot", drive.reader()));
      drive.streams.stream.seed(snapshot);
      drive.streams.breaks.seed(snapshot);
      const carried = isRecord(snapshot) && Array.isArray(snapshot.tasks)
        ? snapshot.tasks.find(task => isRecord(task) && task.id === taskId) as Record<string, unknown> | undefined : undefined;
      if (carried === undefined) {
        refuse("drive.reload.snapshot", "drive.reload.snapshot",
          `a second adapter built from the same login does not carry ${taskId} on its snapshot, and the task is still open`);
        return;
      }
      // The allocation is part of the task, not memory beside it: a reload brings the same life back.
      if (carried.allocationId !== allocationOf()) {
        refuse("drive.reload.allocation", "drive.reload.allocation",
          `a second adapter built from the same login carries ${taskId} as allocation ${String(carried.allocationId)}; the first published ${allocationOf()}, and a life does not change its name on a reload`);
      }
      const history = carried.handlingHistory;
      const steps: unknown[] = isRecord(history) && Array.isArray(history.steps) ? history.steps : [];
      // A record once read is not unread across a reload either: every entry the first adapter published is here.
      const before = latestTask().handlingHistory;
      const wasRead = isRecord(before) && Array.isArray(before.steps) ? before.steps.filter(isRecord) : [];
      const lost = wasRead.filter(entry => !steps.some(now => isRecord(now) && now.step === entry.step && now.at === entry.at))
        .map(entry => `${String(entry.step)}@${String(entry.at)}`);
      if (lost.length > 0) {
        refuse("drive.reload.history", "drive.reload.history",
          `a second adapter built from the same login carries ${taskId} without ${lost.join(", ")}, which the first had published: a record once read is not unread`);
      }
      const leg = steps.find(entry => isRecord(entry) && entry.step === "muted" && entry.at === at) as Record<string, unknown> | undefined;
      if (leg === undefined) {
        refuse("drive.reload.history", "drive.reload.history",
          `a second adapter built from the same login carries ${taskId} without the muted leg at ${at}: the record was composed in memory and died with the adapter; the login's store is where it lives`);
      } else if (leg.mutedBy !== "host") {
        refuse("drive.reload.history", "drive.reload.history",
          `the reloaded record's muted leg at ${at} says mutedBy ${String(leg.mutedBy)}; the host reported host`);
      }
      // The drive goes on with the task as the reloaded client holds it.
      task = carried;
    } catch (error) {
      refuse("drive.reload.rejected", "drive.reload", `the second adapter rejected rather than answered: ${String(error)}`);
    }
  };

  // A task's keys are gone with the task. A task-scoped key carries the task id, so the watched
  // store says which keys were the task's; one still held after task-ended is a key about to be
  // inherited by the next offer of the same id, since a platform retires an id minutes after closing it.
  let retainedAtEnd: Set<string> | undefined;
  const storeReleased = async (): Promise<void> => {
    ruleEvaluated("drive.store.retained");
    await Promise.resolve(); await Promise.resolve();
    const retained = [...drive.held].filter(key => key.includes(taskId));
    retainedAtEnd = new Set(retained);
    if (retained.length > 0) {
      refuse("drive.store.retained", "drive.store",
        `${taskId} has ended and the login's store still holds ${retained.join(", ")}: a task's keys go with the task, or the next offer of the same id inherits them`);
    }
  };
  // A key written about the task after its end -- a persist hung off a timer, a late command -- is the
  // same hazard arriving later, so the store is read once more when the drive is done.
  const nothingLate = (): void => {
    if (retainedAtEnd === undefined) return;
    ruleEvaluated("drive.store.late");
    const late = [...drive.held].filter(key => key.includes(taskId) && !retainedAtEnd!.has(key));
    if (late.length > 0) {
      refuse("drive.store.late", "drive.store",
        `${taskId} had ended with its keys gone, and the login's store now holds ${late.join(", ")}: something wrote about the task after its end`);
    }
  };

  // The task, as first seen: on the snapshot, or on the first offer.
  let cursor = 0;
  let task: Record<string, unknown> | undefined =
    isRecord(drive.snapshot) && Array.isArray(drive.snapshot.tasks) ? drive.snapshot.tasks.find(isTask) : undefined;
  if (task === undefined) {
    const offered = await waitFor("a task-offered", envelope => {
      const event = envelope.event as Record<string, unknown>;
      return event.type === "task-offered" && isTask(event.task) ? event.task : undefined;
    }, 0);
    if (offered === undefined) return found;
    task = offered.found; cursor = offered.at;
  }
  const taskId = task.id as string;
  const allocationOf = (): string => String(latestTask().allocationId);
  const latestTask = (): Record<string, unknown> => task!;
  const updated = (until: (task: Record<string, unknown>) => boolean, what: string) =>
    waitFor(what, envelope => {
      const event = envelope.event as Record<string, unknown>;
      if ((event.type === "task-updated" || event.type === "task-offered") && isTask(event.task) && event.task.id === taskId) {
        task = event.task;
        return until(event.task) ? event.task : undefined;
      }
      return undefined;
    }, cursor).then(hit => { if (hit) cursor = hit.at; return hit; });
  const ended = (within?: { ms: number; onExpiry: () => void }) => waitFor("a task-ended for the driven task", envelope => {
    const event = envelope.event as Record<string, unknown>;
    return event.type === "task-ended" && event.taskId === taskId ? event : undefined;
  }, cursor, within);

  // Every command the drive sends is validated against the task as published, and its answer for its method.
  ruleEvaluated("drive.timeout");
  const send = async (command: Record<string, unknown>, dialId?: string): Promise<Record<string, unknown> | undefined> => {
    ruleEvaluated("drive.command.rejected", "drive.command.failed");
    const own = validateTaskCommand(command, latestTask(), `drive.command.${String(command.type)}`);
    found.push(...own);
    if (own.length > 0) return undefined;
    let result: unknown;
    try {
      result = await drive.connection.execute({ taskId, allocationId: allocationOf(), command } as never);
    } catch (error) {
      refuse("drive.command.rejected", `drive.command.${String(command.type)}`, `execute rejected rather than answered: ${String(error)}`);
      return undefined;
    }
    found.push(...validateResult(result, "execute", `drive.command.${String(command.type)}.result`, dialId));
    if (isRecord(result) && result.status === "failed") {
      refuse("drive.command.failed", `drive.command.${String(command.type)}`,
        `the provider refused ${String(command.type)} on a task that offered it: ${String(isRecord(result.failure) ? result.failure.code : result.failure)}`);
      return undefined;
    }
    return isRecord(result) ? result : undefined;
  };
  const offers = (name: string): boolean => {
    const capabilities: Record<string, unknown> = isRecord(latestTask().capabilities) ? latestTask().capabilities as Record<string, unknown> : {};
    const declared = capabilities[name];
    return declared !== undefined && !(isRecord(declared) && declared.lockedBy !== undefined);
  };

  // Media may arrive any time after the accept, before or after the task's own update says
  // in-progress: the event is the provider's word that the audio should attach, never a reply to
  // openMedia, so the drive looks for it from the accept rather than from the last update it read.
  const acceptedAt = drive.events.length;
  // 1. Accept the offer, if it is one.
  if (latestTask().phase === "pending") {
    if (await send({ type: drive.channel === "voice" ? "answer" : "accept" }) === undefined) return found;
    if (await updated(t => t.phase !== "pending", "the task leaving pending after it was accepted") === undefined) return found;
  }
  // 2. A preview: press Call, which is a dial.
  if (latestTask().phase === "preview") {
    const dialId = `drive-${taskId}`;
    drive.stream.dialled(dialId);
    if (await send({ type: "call", dialId }, dialId) === undefined) return found;
    if (await updated(t => t.phase === "in-progress" || t.phase === "completing", "the task leaving preview after Call") === undefined) return found;
  }
  // The other direction of step 4, wherever the task stands outside the handling phases with the
  // control still declared: a host holds it back (command.phase.handling), and an adapter that
  // receives it anyway must refuse it -- so the drive sends it past the validator and expects failed.
  const holdRefusedOutsideHandling = async (): Promise<void> => {
    ruleEvaluated("drive.command.rejected", "drive.command.handling");
    const phase = String(latestTask().phase);
    let answer: unknown;
    try {
      answer = await drive.connection.execute({ taskId, allocationId: allocationOf(), command: { type: "hold" } } as never);
    } catch (error) {
      refuse("drive.command.rejected", "drive.command.hold", `execute rejected rather than answered: ${String(error)}`);
    }
    if (isRecord(answer) && answer.status !== "failed") {
      refuse("drive.command.handling", "drive.command.hold",
        `the provider applied hold on a ${phase} task: a control on the contact belongs to in-progress or paused, and the adapter is the second gate`);
    }
  };
  if (latestTask().phase === "confirmed") {
    if (offers("hold")) await holdRefusedOutsideHandling();
    if (await updated(t => t.phase !== "confirmed", "the task leaving confirmed") === undefined) return found;
  }
  // 3. On a softphone, the audio arrives and the host opens it.
  let session: Record<string, unknown> | undefined;
  if (drive.softphone && latestTask().phase === "in-progress") {
    if (latestTask().media !== "started") {
      const started = await waitFor("task-media-started for the driven task", envelope => {
        const event = envelope.event as Record<string, unknown>;
        return event.type === "task-media-started" && event.taskId === taskId ? event : undefined;
      }, acceptedAt);
      if (started === undefined) return found;
      cursor = Math.max(cursor, started.at);
    }
    const opened = await drive.connection.openMedia?.({ taskId, allocationId: allocationOf(), localAudio: drive.localAudio });
    found.push(...validateResult(opened, "openMedia", "drive.openMedia"));
    if (isRecord(opened) && opened.status === "opened") session = opened.session as unknown as Record<string, unknown>;
    else if (isRecord(opened)) refuse("drive.openMedia.unavailable", "drive.openMedia", "a softphone login's adapter could not open the call's audio");
  }
  // 3b. The microphone is the host's. With the audio open, the drive mutes it for a moment and
  // reports the leg the provider's record would otherwise miss -- begun, then ended -- and
  // expects each report recorded. If the provider restates the task's record afterwards, the leg is in it.
  let mutedLeg: { at: string; task: Record<string, unknown> } | undefined;
  if (session !== undefined && typeof session.setMuted === "function" && typeof drive.connection.recordStep === "function") {
    const at = new Date().toISOString();
    const report = async (body: Record<string, unknown>): Promise<void> => {
      ruleEvaluated("drive.recordStep.rejected", "drive.recordStep.failed");
      // The drive holds its own report to the contract before it crosses, as a host must.
      const leg = { taskId, allocationId: allocationOf(), step: "muted", at, mutedBy: "host", ...body };
      const own = validateHandlingReport(leg, "drive.recordStep.report", drive.manifest);
      found.push(...own);
      if (own.length > 0) return;
      let answer: unknown;
      try {
        answer = await drive.connection.recordStep!(leg as never);
      } catch (error) {
        refuse("drive.recordStep.rejected", "drive.recordStep", `recordStep rejected rather than answered: ${String(error)}`);
        return;
      }
      found.push(...validateResult(answer, "recordStep", "drive.recordStep.result"));
      if (isRecord(answer) && answer.status === "failed") {
        refuse("drive.recordStep.failed", "drive.recordStep",
          `the provider refused to record the host's muted leg: ${String(isRecord(answer.failure) ? answer.failure.code : answer.failure)}`);
      }
    };
    const setMuted = (muted: boolean) => {
      try { (session!.setMuted as (muted: boolean) => void)(muted); }
      catch { refuse("drive.openMedia.setMuted", "drive.openMedia", `the media session threw on setMuted(${String(muted)})`); }
    };
    const began = Date.now();
    setMuted(true);
    await report({});
    // A leg's duration is whole seconds and a leg shorter than one cannot be stated, so the mute holds for one.
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    setMuted(false);
    await report({ seconds: Math.round((Date.now() - began) / 1000), ended: true });
    mutedLeg = { at, task: latestTask() };
    // 3c. A host reload destroys the adapter object and keeps the login's store. Built again from
    // the same login, a second adapter carries the task and the leg -- from its platform, or from
    // the store -- or it composed the record in memory and the record died with it.
    if (drive.rebuild !== undefined) {
      await recordSurvivesReload(at);
      // A reload that stood no client ends the run: there is nothing left to drive.
      if (!drive.handOver.isLive()) return found;
    }
  }
  // 4. Hold and resume, where offered.
  if (latestTask().phase === "in-progress" && offers("hold")) {
    if (await send({ type: drive.channel === "chat" ? "pause" : "hold" }) !== undefined) {
      if (await updated(t => t.phase === "paused", "the task pausing after hold") !== undefined) {
        if (await send({ type: "resume" }) !== undefined) {
          await updated(t => t.phase === "in-progress", "the task resuming after resume");
        }
      }
    }
  }
  // 5. End the call, where the agent may.
  if (drive.channel === "voice" && latestTask().phase === "in-progress" && offers("endCall")) {
    if (await send({ type: "end-call" }) !== undefined) {
      // A task that completes with its audio still up is refused by the stream as it passes
      // (stream.taskUpdated.mediaOpen); the drive does not also wait out the clock for an ending
      // that is not coming, so the run reads by the rule and not by its timeout.
      const mediaEnded = await waitFor("task-media-ended after end-call", envelope => {
        const event = envelope.event as Record<string, unknown>;
        if (event.type === "task-media-ended" && event.taskId === taskId) return "ended" as const;
        if (event.type === "task-updated" && isTask(event.task) && event.task.id === taskId && event.task.phase === "completing") return "completing" as const;
        return undefined;
      }, cursor);
      if (mediaEnded?.found === "ended") cursor = mediaEnded.at;
      if (await updated(t => t.phase === "completing", "the task completing after its media ended") !== undefined && offers("hold")) {
        await holdRefusedOutsideHandling();
      }
    }
  }
  if (typeof (session as { close?: unknown } | undefined)?.close === "function") {
    try { (session as { close: () => void }).close(); } catch { refuse("drive.openMedia.close", "drive.openMedia", "the media session threw on close"); }
  }
  // 6. Complete, where the agent completes; otherwise the provider does, and the drive waits for it.
  // A conversation has no media to end and no completing phase to wait for: a chat or an email,
  // and a voice task offering no end-call, is completed from where it stands.
  const completable = latestTask().phase === "completing" || latestTask().phase === "in-progress" || latestTask().phase === "paused";
  if (latestTask().completionMode === "agent-command" && completable) {
    const command: Record<string, unknown> = { type: "complete" };
    const dispositions = isRecord(latestTask().capabilities) ? (latestTask().capabilities as Record<string, unknown>).dispositions : undefined;
    if (isRecord(dispositions) && dispositions.required === true && Array.isArray(dispositions.codes) && isRecord(dispositions.codes[0])) {
      command.disposition = (dispositions.codes[0] as Record<string, unknown>).id;
    }
    if (await send(command) !== undefined) {
      // applied says the provider has disposed of the task, and its ending follows within the bound
      // the manifest stated. Past it the host resyncs: a snapshot still carrying the task is a task
      // held open by a provider that said it was done, and the desk shows it as unsettled.
      ruleEvaluated("drive.disposal.unsettled");
      const settle = Number(drive.manifest.disposalSettleMs);
      let unsettled = false;
      const end = await ended({ ms: settle, onExpiry: () => { unsettled = true; } });
      if (end !== undefined) await storeReleased();
      else if (unsettled) {
        let resync: unknown;
        try { resync = await drive.connection.snapshot(); } catch (error) { refuse("drive.command.rejected", "drive.disposal", `snapshot() after an unsettled disposal rejected: ${String(error)}`); }
        const still = isRecord(resync) && Array.isArray(resync.tasks) && resync.tasks.some(t => isRecord(t) && t.id === taskId && t.allocationId === allocationOf());
        refuse("drive.disposal.unsettled", "drive.disposal",
          still
            ? `complete was applied and ${settle}ms later the task-ended has not come and a snapshot still carries ${taskId}: applied says the provider disposed of the task, and it has not`
            : `complete was applied and ${settle}ms later the task-ended has not come; a snapshot no longer carries ${taskId}, so the ending was owed and never sent`);
      }
    }
  } else if (latestTask().phase === "completing") {
    if (await ended() !== undefined) await storeReleased();
  }
  // The record kept by the provider has the leg the host reported, wherever the provider restated it.
  if (mutedLeg !== undefined && latestTask() !== mutedLeg.task) {
    const history = latestTask().handlingHistory;
    if (isRecord(history) && Array.isArray(history.steps)) {
      const { at } = mutedLeg;
      const leg = history.steps.find(entry => isRecord(entry) && entry.step === "muted" && entry.at === at) as Record<string, unknown> | undefined;
      if (leg === undefined) {
        refuse("drive.recordStep.history", "drive.recordStep",
          `the provider restated the task's record after the host reported a muted leg at ${at}, and the leg is not in it`);
      } else if (leg.mutedBy !== "host") {
        refuse("drive.recordStep.history", "drive.recordStep",
          `the record's muted leg at ${at} says mutedBy ${String(leg.mutedBy)}; the host reported host, and the record keeps the host's word`);
      }
    }
  }
  // A timer fires after the microtasks: one turn of the loop is what a late persist needs to show itself.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  nothingLate();
  return found;
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
 * with the snapshot it began from -- every task is introduced once, `task-media-started` and
 * `task-media-ended` alternate on work that has begun, media ends only where it arrived, and what
 * follows the media ending is `completing` or `task-ended`.
 */
export function assertMediaFollowsTheTask(envelopes: readonly ProviderEventEnvelope[], snapshot?: Snapshot): void {
  const stream = new TaskStream();
  if (snapshot !== undefined) stream.seed(snapshot);
  const found: ProtocolViolation[] = [];
  envelopes.forEach((envelope, index) => found.push(...stream.apply(envelope, `envelopes[${index}]`)));
  assertNoViolations(found, "The media follows the task");
}

/** The store as handed to the adapter, and the keys it holds at any moment, seen rather than reported. */
function watchStore(store: LoginStore): { store: LoginStore; held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    store: {
      get: key => store.get(key),
      set: async (key, value) => { await store.set(key, value); held.add(key); },
      delete: async key => { await store.delete(key); held.delete(key); },
    },
  };
}

/** A login store that lives in memory for the test: what most adapter tests hand `exerciseAdapter` as `context.store`. */
export function memoryStore(): LoginStore {
  const kept = new Map<string, string>();
  return {
    get: async key => kept.get(key),
    set: async (key, value) => { kept.set(key, value); },
    delete: async key => { kept.delete(key); },
  };
}

/**
 * A host that reports one thing and never changes: what most adapter tests hand `exerciseAdapter`.
 * A softphone host states what its Mute does; a desk-phone or conversation host has no microphone and states nothing.
 */
export function stillHost(report: HostReport, guarantees: HostGuarantees, mute: HostMute): Host & { mute: HostMute };
export function stillHost(report?: HostReport, guarantees?: HostGuarantees): Host & { mute?: never };
export function stillHost(report: HostReport = { online: true }, guarantees: HostGuarantees = {}, mute?: HostMute): Host {
  return { guarantees, ...(mute === undefined ? {} : { mute }), report: () => report, subscribe: () => () => undefined };
}

/** One provider as the host sees it when freezing the providers a break attempt asks. */
export interface BreakCandidate {
  id: string;
  authentication: AuthenticationState["status"];
  /** Whether the agent can currently receive work from it: connected, with a capacity stated. */
  holdsCapacity: boolean;
}

const usableLogin = (status: AuthenticationState["status"]): boolean =>
  status === "authenticated" || status === "refreshing";

/**
 * A break attempt asks every connected provider from which the agent can currently receive work.
 * A provider whose login is not usable -- `expired` above all -- is not asked, whatever else is
 * true of it: nothing can be asked of it, and a host that waits on it stalls the break for
 * everyone. A usable provider holding capacity is asked, and cannot be left out. `refreshing` is
 * usable: identity and capabilities remain available and work continues.
 */
export function assertBreakAttemptProviders(candidates: readonly BreakCandidate[], asked: readonly string[]): void {
  const chosen = new Set(asked);
  for (const id of asked) {
    if (!candidates.some(candidate => candidate.id === id)) throw new Error(`${id} is not a provider the host knows`);
  }
  for (const candidate of candidates) {
    const expected = usableLogin(candidate.authentication) && candidate.holdsCapacity;
    if (expected && !chosen.has(candidate.id)) {
      throw new Error(`${candidate.id} can give the agent work and must be asked`);
    }
    if (!expected && chosen.has(candidate.id)) {
      const why = usableLogin(candidate.authentication) ? "holds no capacity" : `is ${candidate.authentication}`;
      throw new Error(`${candidate.id} ${why} and is not asked: nothing can be asked of it`);
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
  task: Pick<TaskCompletion, "completionMode" | "wrapAllowance">,
  mediaEndedAt: string,
  observedDeadline: string | undefined,
  toleranceMs = 1_000,
): void {
  if (task.wrapAllowance === undefined) {
    if (observedDeadline !== undefined) {
      throw new Error(`Wrap deadline mismatch: the task states no allowance, so there is no deadline, received ${observedDeadline}`);
    }
    return;
  }
  if (observedDeadline === undefined) {
    throw new Error(`Wrap deadline mismatch: the task allows ${task.wrapAllowance}s, but no deadline was observed`);
  }
  const ended = Date.parse(mediaEndedAt);
  const deadline = Date.parse(observedDeadline);
  if (Number.isNaN(ended) || Number.isNaN(deadline)) throw new Error("Wrap scenario requires valid ISO-8601 times");
  const expected = ended + task.wrapAllowance * 1_000;
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
export function assertBrowserSessionIsolation(
  left: BrowserIsolationScenario,
  right: BrowserIsolationScenario,
  expectedReuse: boolean,
): void {
  const leftKey = sessionKeyFor(left);
  const rightKey = sessionKeyFor(right);
  // A browser that does not share its session has no session key at all, so two of them never share one.
  // Treating "no key" as a match would report sharing nobody asked for.
  const actualReuse = leftKey !== undefined && leftKey === rightKey;
  if (actualReuse !== expectedReuse) {
    throw new Error(
      `Browser session sharing mismatch: expected ${expectedReuse}, received ${actualReuse} (${String(leftKey)} vs ${String(rightKey)})`,
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
