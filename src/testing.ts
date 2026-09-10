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
  validateBreakTransition,
  validateEventEnvelope,
  validateHostGuarantees,
  validateHostReport,
  validateDescribedUsers,
  observeRules,
  ruleEvaluated,
  validateHostMute,
  validateHostRecording,
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
  /**
   * The values the queue locks on this login's tasks -- a party's number or email -- as the run's
   * author knows them. A task whose party stands locked may carry none of them anywhere else
   * (`task.locked.leak`). Required once any task locks a party field: a run that cannot ask the
   * question is not a pass, and says so by throwing rather than passing.
   */
  lockedValues?: readonly string[];
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
  let lockedPartySeen = false;

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
      locked: options.lockedValues,
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

    const onAuthenticationState = (state: AuthenticationState): void => {
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
    };
    unsubscribeAuthentication = authentication.subscribe(onAuthenticationState);

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
    violations.push(...validateHostRecording(context.host.recording, softphone));
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
    const watched = storeShape.length === 0 ? watchStore(context.store) : { store: context.store, held: new Set<string>(), everHeld: new Set<string>() };
    unsubscribeHost = context.host.subscribe(report => {
      violations.push(...validateHostReport(report, "context.host"));
    });
    const consulted = { report: false, subscribe: false };
    // The wrapped host carries the mute kind the test's host stated, so the arms of ConnectContext still hold.
    const host = {
      guarantees: context.host.guarantees,
      ...(context.host.recording === undefined ? {} : { recording: context.host.recording }),
      ...(context.host.mute === undefined ? {} : { mute: context.host.mute }),
      report: () => { consulted.report = true; return context.host.report(); },
      subscribe: listener => { consulted.subscribe = true; return context.host.subscribe(listener); },
    } as ConnectContext["host"];

    const connected = { ...context, host, store: watched.store } as ConnectContext;
    connection = await adapter.connect(connected);
    // The standing client: the first connection, then the second after a hand-over. Everything the
    // harness asks of a connection it asks of the one that stands.
    let live = connection;
    // What every connection owes on connect, the first and a reloaded second alike.
    const connectObligations = (on: Connection<C>): void => {
      // A refusal is visible on both sides: what the host would not take, the adapter is told, with the rules.
      requireMethod(on, "refused", "every connection is told what the host refused");
      // Dial is declared by presence: the capability object carries a destination policy rather
      // than an `enabled` flag, so its presence is the declaration.
      if (adapter.manifest.idleCapabilities?.dial !== undefined) requireMethod(on, "dial", "the manifest declares dial");
      // On a softphone the call's audio lands in Omni, so the adapter has to open it; on a desk phone the host opens nothing.
      if (softphone) requireMethod(on, "openMedia", "the login is on a softphone");
      // The microphone is the host's, so on a softphone every call can be muted by it, and the
      // record of that leg is the provider's to take; on a desk phone the host holds no microphone.
      if (softphone) requireMethod(on, "recordStep", "the login is on a softphone, whose microphone the host mutes");
    };
    connectObligations(live);
    const tellRefused = (report: Refusal): void => {
      if (typeof live.refused !== "function") return;
      ruleEvaluated("connection.refused.rejected");
      try {
        live.refused(report);
      } catch (error) {
        violations.push({ rule: "connection.refused.rejected", path: "connection.refused", message: `told of a refusal, the adapter threw: ${String(error)}` });
      }
    };

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
      lockedPartySeen ||= eventTasks(envelope).some(locksParty);
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
      up: async (session: Awaited<ReturnType<Adapter<C>["createAuthenticationSession"]>>, second: Connection<C>): Promise<void> => {
        authentication = session;
        connection = second;
        live = second;
        // The second client is held to everything the first was on connect: its methods, its login's
        // methods, the login it publishes from here, and a capacity stated to it, since the first's
        // statement died with the first and nothing may be allocated against a count nobody stated to it.
        connectObligations(second);
        requireCapabilityMethods(second, current().capabilities);
        try { unsubscribeAuthentication?.(); } catch { /* the closed first session's subscription */ }
        unsubscribeAuthentication = session.subscribe(onAuthenticationState);
        unsubscribe = second.subscribe(onEnvelope);
        clientLive = true;
        const restated = await second.setCapacity({ count: capacityStated ?? 1 });
        violations.push(...validateResult(restated, "setCapacity", "drive.reload.setCapacity"));
      },
    };

    // Every snapshot the run reads, the connect snapshot and a reloaded client's, is read the same
    // way: observed, validated and refused back, its terms and locks noted, and every user it names
    // looked up and the answer held to the shape.
    const snapshotRead = async (source: Connection<C>, read: unknown, path: string): Promise<void> => {
      observeSnapshot(read as Snapshot, seen);
      const broken = validateSnapshot(read, adapter.manifest, path, reader());
      violations.push(...broken);
      if (broken.length > 0) tellRefused({ artefact: "snapshot", violations: broken });
      const tasks = isRecord(read) && Array.isArray(read.tasks) ? read.tasks : [];
      violations.push(...undeterminedTasks(tasks, `${path}.tasks`));
      lockedPartySeen ||= tasks.some(locksParty);
      if (publishesUserIds(read as Snapshot)) {
        requireMethod(source, "describeUsers", "the snapshot publishes a UserId");
        // Required by presence is not enough: the names the snapshot published are looked up, and what
        // comes back is held to the shape -- an empty answer to a roster of colleagues is named.
        const named = userIdsIn(read as Snapshot);
        if (typeof source.describeUsers === "function" && named.length > 0) {
          let described: unknown;
          try {
            described = await source.describeUsers(named as UserId[]);
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
    };
    const snapshot = await connection.snapshot() as Snapshot;
    await snapshotRead(live, snapshot, "snapshot");
    stream.seed(snapshot);
    breaks.seed(snapshot);
    seeded = true;
    // A snapshot supersedes what it restates and nothing else. Of the events held during the read,
    // a state-replacing kind is dropped, since the snapshot carries that state and must account for
    // it; the rest -- a dial's outcome, a diagnostic, an announcement, a queue summary -- report
    // transactions no snapshot carries, and are applied after it, in order.
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
      // Evaluated where a superseded event was held: with none, the question was never asked.
      ruleEvaluated("snapshot.accounts.task", "snapshot.accounts.ended");
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

    // Capacity is stated, not requested: nothing may be allocated until it is, so a connection
    // that will not accept one is a connection nothing can be given to.
    // The guide's obligation on a voice adapter: consult the host before declaring the agent
    // ready, and on every change. An adapter that never asked cannot have.
    // The obligation has two halves: read the report before declaring the agent ready, and hear of
    // every change after. An adapter that did one and not the other consulted the host once, or never.
    ruleEvaluated("connection.host.consulted", "connection.host.subscribed");
    if (adapter.manifest.channel === "voice" && !consulted.report) {
      violations.push({ rule: "connection.host.consulted", path: "connection.host",
        message: "a voice adapter reads the host's report before it declares the agent ready to its platform, and this one never asked" });
    }
    if (adapter.manifest.channel === "voice" && !consulted.subscribe) {
      violations.push({ rule: "connection.host.subscribed", path: "connection.host",
        message: "a voice adapter subscribes to the host's report so it hears of every change, and this one never did" });
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

    if (options.drive) {
      const localAudio = isRecord(first) && isRecord(first.audio) && isRecord(first.audio.input) && first.audio.input.status === "available"
        ? first.audio.input.localAudio as MediaStream : undefined;
      violations.push(...await driveOneCall({
        connection: live, manifest: adapter.manifest, channel: adapter.manifest.channel, softphone, snapshot, events, waiters, stream, localAudio,
        everHeldForTask: (taskId: string) => [...watched.everHeld].some(key => namesTask(key, taskId)), snapshotRead,
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
    // A capacity is taken, never refused: each restatement is answered applied and nothing else
    // (validateResult), and any offer after a lower count is caught against it.
    for (const count of clientLive ? [2, 1, 0] : []) {
      capacityStated = count;
      const restated = await connection.setCapacity({ count });
      violations.push(...validateResult(restated, "setCapacity", "connection.setCapacity"));
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
  // A task locked a party field and the run was not told the value: task.locked.leak was never
  // asked, and a result that cannot say is not returned as one that passed.
  if (lockedPartySeen && options.lockedValues === undefined) {
    stopObserving();
    throw new TypeError("a task locks its party's number or email and the run states no lockedValues: task.locked.leak cannot be evaluated; pass the values the queue locked in options.lockedValues");
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
/** Whether a store key names the task: the id as a delimited token, never as a run of characters inside another id. */
function namesTask(key: string, taskId: string): boolean {
  return key.split(/[^A-Za-z0-9_-]+/).includes(taskId);
}

/** Whether a task's party stands locked on its number or email, which is what obliges a run to state the locked values. */
function locksParty(task: unknown): boolean {
  if (!isRecord(task) || !isRecord(task.party)) return false;
  const locked = (value: unknown) => isRecord(value) && value.lockedBy !== undefined;
  return locked(task.party.number) || locked(task.party.email);
}

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
    (before.team?.monitorControl !== undefined && after.team?.monitorControl === undefined) ||
    (before.team?.policyControl === true && after.team?.policyControl !== true) ||
    (before.preferences ?? []).some(was => !(after.preferences ?? []).some(now => now.id === was.id));
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
  const before = validateTaskCommand(command, first, "command", context);
  if (before.length > 0) {
    throw new Error(`Task capability withdrawal: the command must be issuable against the task as offered, or its later refusal proves nothing (${before.map(v => v.rule).join(", ")})`);
  }
  const after = validateTaskCommand(command, last, "command", context);
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
  private readonly tasks = new Map<string, ReturnType<typeof TaskStream.stated>>();
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

  /**
   * Whether the update shows the party being dialled again -- a connect-back, a platform's callback --
   * the one thing that brings a completing task back: the party ringing, or joined by a dial whose
   * answered outcome this stream saw. A stale copy carrying `joined` from a dial long over is not that.
   */
  private partyDialled(task: unknown): boolean {
    if (!isRecord(task) || !Array.isArray(task.onCall)) return false;
    return task.onCall.some(entry => isRecord(entry) && entry.role === "party"
      && (entry.stage === "ringing" || (entry.stage === "joined" && typeof entry.dialId === "string" && this.dials.get(entry.dialId) === "answered")));
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

  private static stated(task: unknown): { phase: string; media: string; source: string; stages: Map<string, string>; record: Set<string> | undefined; allocation: string; channel: string; completionMode: string; wrapAllowance: number | undefined; partyRingingByHost: boolean } {
    const media = isRecord(task) && (task.media === "started" || task.media === "ended") ? task.media : "none";
    // The stage of every dialled entry the room names by its dial, so an update can be held to the
    // outcome that moves it.
    const stages = new Map<string, string>();
    if (isRecord(task) && Array.isArray(task.onCall)) {
      for (const entry of task.onCall) {
        if (isRecord(entry) && typeof entry.dialId === "string" && typeof entry.stage === "string") stages.set(entry.dialId, entry.stage);
      }
    }
    const partyRingingByHost = isRecord(task) && Array.isArray(task.onCall)
      && task.onCall.some(entry => isRecord(entry) && entry.role === "party" && entry.stage === "ringing" && typeof entry.dialId === "string");
    return { partyRingingByHost, channel: String(isRecord(task) ? task.channel : undefined), completionMode: String(isRecord(task) ? task.completionMode : undefined),
      wrapAllowance: isRecord(task) && typeof task.wrapAllowance === "number" ? task.wrapAllowance : undefined,
      phase: String(isRecord(task) ? task.phase : undefined), media, source: String(isRecord(task) ? task.capabilitySource : undefined), stages, record: TaskStream.record(task), allocation: String(isRecord(task) ? task.allocationId : undefined) };
  }

  /**
   * Takes a resync snapshot -- a `snapshot` event, or the read a reloaded client makes -- as the
   * state now, and first holds it to what the stream knew. A snapshot replaces state; it does not
   * get to forget it. A task it carries that the stream already held may not go backwards, lose an
   * entry of its record, return to undetermined terms, or be at work without the audio the stream
   * held up: media ends on task-media-ended and the call moves on, so a task still in-progress or
   * paused without its media is a snapshot that lost state, not a call that ended.
   */
  resync(snapshot: unknown, at: string): ProtocolViolation[] {
    const found: ProtocolViolation[] = [];
    const refuse = (rule: string, where: string, message: string) => found.push({ rule, path: where, message });
    ruleEvaluated("stream.snapshot.capabilitySource", "stream.snapshot.handlingHistory", "stream.snapshot.phase", "stream.snapshot.media");
    if (isRecord(snapshot) && Array.isArray(snapshot.tasks)) {
      snapshot.tasks.forEach((task, index) => {
        if (!isRecord(task) || typeof task.id !== "string") return;
        const was = this.tasks.get(task.id);
        if (was === undefined || was.allocation !== String(task.allocationId)) return;
        if ((was.source === "queue" || was.source === "ungoverned") && task.capabilitySource === "undetermined") {
          refuse("stream.snapshot.capabilitySource", `${at}.tasks[${index}].capabilitySource`,
            `${task.id} was published under ${was.source} terms and the snapshot says undetermined: terms once read stay read`);
        }
        // A record once read is not unread: a resync restates it whole, or with more, never with less.
        const lost = TaskStream.lost(was.record, TaskStream.record(task));
        if (lost.length > 0) {
          refuse("stream.snapshot.handlingHistory", `${at}.tasks[${index}].handlingHistory`,
            `${task.id}'s record lost ${lost.join(", ")} on the snapshot: an entry read by the host stays in the record until the task ends`);
        }
        const to = String(task.phase);
        const reachable = REACHABLE_PHASES[was.phase];
        if (reachable !== undefined && (TASK_PHASES_ORDERED as readonly string[]).includes(to) && !reachable.has(to)) {
          const connectingBack = was.phase === "completing" && this.partyDialled(task) && (to === "in-progress" || to === "paused");
          if (!connectingBack) {
            refuse("stream.snapshot.phase", `${at}.tasks[${index}].phase`,
              `${task.id} was ${was.phase} and the snapshot says ${to}: a task does not go backwards, on an update or on a resync`);
          }
        }
        if (was.media === "started" && (to === "in-progress" || to === "paused") && task.media !== "started") {
          refuse("stream.snapshot.media", `${at}.tasks[${index}].media`,
            `${task.id}'s audio was up and the snapshot carries it ${to} without it: media ends on task-media-ended and the call moves on, so a snapshot that forgets the audio lost state`);
        }
      });
    }
    this.seed(snapshot);
    return found;
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
        found.push(...this.resync(event.snapshot, `${at}.snapshot`));
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
        ruleEvaluated("stream.taskUpdated.unknown");
        if (known === undefined) {
          refuse("stream.taskUpdated.unknown", `${at}.task.id`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        // The rules about a known task are evaluated only once there is one.
        ruleEvaluated("stream.taskUpdated.capabilitySource", "stream.taskUpdated.phase", "stream.taskUpdated.allocation", "stream.taskUpdated.mediaOpen",
          "stream.taskUpdated.handlingHistory", "stream.taskMediaEnded.follow", "stream.taskUpdated.media", "stream.taskUpdated.stage", "stream.taskUpdated.stage.lingering");
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
            const connectingBack = from === "completing" && this.partyDialled(event.task) && (to === "in-progress" || to === "paused");
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
        // The connect-back that brings a completing task back is the one exception here too.
        if (known.media === "ended") {
          const phase = isRecord(event.task) ? String(event.task.phase) : "";
          if (phase !== "completing" && !(known.phase === "completing" && this.partyDialled(event.task))) {
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
            // joined is transient: it appears on the publication that follows the answered outcome and
            // on no later one, so a stale copy still carrying it cannot pass as a connect-back.
            if (stage === "joined" && known.stages.get(dialId) === "joined") {
              refuse("stream.taskUpdated.stage.lingering", `${at}.task.onCall`,
                `${dialId} was already published joined and the update says it again: joined is transient, stated once on the publication after the answered outcome, and a party with no stage is on the call`);
            }
          }
          this.tasks.set(id, next);
        }
        this.noteDials(event.task);
        break;
      case "task-media-started":
        ruleEvaluated("stream.taskMediaStarted.unknown", "stream.taskMediaStarted.beforeWork", "stream.taskMediaStarted.duplicate", "stream.taskMedia.channel", "stream.allocation.ended", "stream.allocation.unknown");
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskMediaStarted.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (!this.namesTheOpenLife(event, known, at, refuse)) break;
        // Ring-back is audio: a task whose party the host is dialling has media from dialling on,
        // whatever its phase; every other task not at work has none.
        if (known.channel !== "voice") {
          refuse("stream.taskMedia.channel", `${at}.type`, "only a voice task has media transitions");
          break;
        }
        if (!AT_WORK.has(known.phase) && !known.partyRingingByHost) {
          refuse("stream.taskMediaStarted.beforeWork", `${at}.taskId`,
            `media cannot arrive on ${id} while it is ${known.phase}: a task is never its audio, and its work has not begun`);
        }
        if (known.media === "started") {
          refuse("stream.taskMediaStarted.duplicate", `${at}.taskId`, `media already started on ${id}; started and ended alternate`);
        }
        known.media = "started";
        break;
      case "task-media-ended":
        ruleEvaluated("stream.taskMediaEnded.unknown", "stream.taskMediaEnded.beforeWork", "stream.taskMediaEnded.silent", "stream.taskMedia.channel", "stream.allocation.ended", "stream.allocation.unknown");
        if (id === undefined) break;
        if (known === undefined) {
          refuse("stream.taskMediaEnded.unknown", `${at}.taskId`, `${id} was never offered or carried on a snapshot`);
          break;
        }
        if (!this.namesTheOpenLife(event, known, at, refuse)) break;
        if (known.channel !== "voice") {
          refuse("stream.taskMedia.channel", `${at}.type`, "only a voice task has media transitions");
          break;
        }
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
        // A voice task ends after its audio ends, never around it, whatever the outcome: a take-over
        // and a lead leaving included. An ending with the audio still up leaves the host holding an
        // open media session and an open leg on a task that no longer exists.
        ruleEvaluated("stream.taskEnded.mediaOpen");
        if (known.media === "started") {
          refuse("stream.taskEnded.mediaOpen", `${at}.taskId`,
            `${id} ended with its media still started: the audio ends first, on task-media-ended, whatever the outcome`);
        }
        // Off voice there is no media event, so the update that moves a task to completing is the
        // provider's word that handling ended and the moment the wrap allowance starts. A provider
        // that completes the task itself with an allowance to run has to have started the clock:
        // completed from in-progress, the allowance it stated was never given.
        ruleEvaluated("stream.taskEnded.unwrapped");
        if (known.channel !== "voice" && known.completionMode === "provider-automatic" && known.wrapAllowance !== undefined && known.wrapAllowance > 0
          && known.phase !== "completing" && isRecord(event.outcome) && event.outcome.type === "completed") {
          refuse("stream.taskEnded.unwrapped", `${at}.outcome`,
            `${id} was completed from ${known.phase} with a wrap allowance of ${known.wrapAllowance}s under provider-automatic: off voice, completing is the provider's word that handling ended and the allowance's start, and it was never published`);
        }
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
  /** Whether the store was ever seen to hold a key naming the task, which is what makes drive.store.retained evaluable. */
  everHeldForTask: (taskId: string) => boolean;
  /** Takes the first client down and brings the second up in its place: what a host reload is. Coming up holds the second to everything the first was on connect. */
  handOver: { isLive: () => boolean; down: () => Promise<boolean>; up: (session: Awaited<ReturnType<Adapter<C>["createAuthenticationSession"]>>, second: Connection<C>) => Promise<void> };
  /** Reads a snapshot as the connect snapshot was read: observed, validated, its users described, its locks and terms noted. */
  snapshotRead: (source: Connection<C>, snapshot: unknown, path: string) => Promise<void>;
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

  // The call's media session, opened on the first client and opened again on a reloaded second.
  let session: Record<string, unknown> | undefined;
  const recordSurvivesReload = async (at: string): Promise<void> => {
    // Each reload rule is marked where it is decided, never up front: a rebuild that throws has looked at nothing else.
    ruleEvaluated("drive.reload.rejected");
    let again: Adapter<C>;
    try {
      again = drive.rebuild!() as Adapter<C>;
    } catch (error) {
      refuse("drive.reload.rejected", "drive.reload", `building the adapter again threw: ${String(error)}`);
      return;
    }
    // The same provider, built again: a different manifest is a different adapter, and proves nothing about this one.
    ruleEvaluated("drive.reload.manifest");
    if (again.manifest.id !== drive.manifest.id) {
      refuse("drive.reload.manifest", "drive.reload.manifest",
        `rebuild returned an adapter for ${String(again.manifest.id)}; the reload is of ${String(drive.manifest.id)}`);
      return;
    }
    // The first client dies first, as it does on a reload: from here the run has no connection until the second stands.
    ruleEvaluated("drive.reload.handover");
    if (!await drive.handOver.down()) {
      refuse("drive.reload.handover", "drive.reload", "taking the first client down threw: an unsubscribe, disconnect() or close() failed");
    }
    try {
      const restoredSession = await again.createAuthenticationSession({ ...drive.context, secrets: drive.secrets });
      // The reload is a restore before it is anything else: the second session stands authenticated
      // as the same person, from the secrets alone, or nothing it reads afterwards is this login's.
      const restored = await (restoredSession as unknown as { state(): Promise<unknown> }).state();
      found.push(...validateAuthenticationState(restored, "drive.reload.login"));
      ruleEvaluated("drive.reload.login");
      const same = isRecord(restored) && restored.status === "authenticated" && isRecord(restored.identity) && restored.identity.id === drive.reader().self;
      if (!same) {
        refuse("drive.reload.login", "drive.reload.login",
          `a second adapter built from the same login and secrets did not restore it: the session says ${String(isRecord(restored) ? restored.status : restored)}${isRecord(restored) && isRecord(restored.identity) ? ` as ${String(restored.identity.id)}` : ""}, and the login is ${String(drive.reader().self)}`);
        // A reload that cannot restore the login is a sign-in screen, not a connection: the run ends here.
        try { await restoredSession.close(); } catch { /* the session that would not restore is closed as far as it can be */ }
        return;
      }
      const second = await again.connect(drive.context);
      // From here the second client is the run's connection, held to everything the first was on
      // connect: what it publishes is validated as before.
      await drive.handOver.up(restoredSession, second);
      drive.connection = second;
      const snapshot = await second.snapshot() as unknown;
      // The second adapter's snapshot is read as the connect snapshot was, and the streams take it
      // as the state now the way they take any resync: held to what they knew, then replaced. A reload
      // is a place the stream's rules keep working, not one where they all stop.
      await drive.snapshotRead(second, snapshot, "drive.reload.snapshot");
      found.push(...drive.streams.stream.resync(snapshot, "drive.reload.snapshot"));
      drive.streams.breaks.seed(snapshot);
      const carried = isRecord(snapshot) && Array.isArray(snapshot.tasks)
        ? snapshot.tasks.find(task => isRecord(task) && task.id === taskId) as Record<string, unknown> | undefined : undefined;
      ruleEvaluated("drive.reload.snapshot");
      if (carried === undefined) {
        refuse("drive.reload.snapshot", "drive.reload.snapshot",
          `a second adapter built from the same login does not carry ${taskId} on its snapshot, and the task is still open`);
        return;
      }
      // The allocation is part of the task, not memory beside it: a reload brings the same life back.
      ruleEvaluated("drive.reload.allocation", "drive.reload.history");
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
      // The drive goes on with the task as the reloaded client holds it. The first client's media
      // session died with it: a host opens media on a task arriving with media started on a
      // snapshot, so the drive opens it again on the second and holds the answer as it held the first.
      task = carried;
      if (drive.softphone && carried.media === "started") {
        if (session !== undefined && typeof session.close === "function") {
          try { (session.close as () => void)(); } catch { refuse("drive.openMedia.close", "drive.openMedia", "the first client's media session threw on close"); }
        }
        session = undefined;
        ruleEvaluated("drive.reload.openMedia");
        const reopened = await second.openMedia?.({ taskId, allocationId: allocationOf(), localAudio: drive.localAudio });
        const malformed = validateResult(reopened, "openMedia", "drive.reload.openMedia");
        found.push(...malformed);
        if (malformed.length === 0 && isRecord(reopened) && reopened.status === "opened") session = reopened.session as unknown as Record<string, unknown>;
        else if (malformed.length === 0) refuse("drive.reload.openMedia", "drive.reload.openMedia",
          `a second adapter built from the same login could not open the audio of ${taskId}, which its own snapshot carries with media started`);
      }
    } catch (error) {
      refuse("drive.reload.rejected", "drive.reload", `the second adapter rejected rather than answered: ${String(error)}`);
    }
  };

  // A task's keys are gone with the task. A task-scoped key carries the task id, so the watched
  // store says which keys were the task's; one still held after task-ended is a key about to be
  // inherited by the next offer of the same id, since a platform retires an id minutes after closing it.
  let retainedAtEnd: Set<string> | undefined;
  const storeReleased = async (): Promise<void> => {
    await Promise.resolve(); await Promise.resolve();
    // A task's key names the task delimited, not as a run of characters inside another id, and the
    // rule is evaluated only where the store was ever seen to hold such a key: an adapter whose keys
    // name nothing the harness can see leaves the rule unasked, which the result says.
    const retained = [...drive.held].filter(key => namesTask(key, taskId));
    retainedAtEnd = new Set(retained);
    if (drive.everHeldForTask(taskId)) ruleEvaluated("drive.store.retained");
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
    const late = [...drive.held].filter(key => namesTask(key, taskId) && !retainedAtEnd!.has(key));
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
    const own = validateTaskCommand(command, latestTask(), `drive.command.${String(command.type)}`, {
      levels: effectiveLevels(drive.manifest.orgLevels).map(level => level.id),
      dialOutcomesDeclared: drive.manifest.dialOutcomes !== undefined,
      autoAcceptTasks: drive.context.autoAcceptTasks,
    });
    found.push(...own);
    if (own.length > 0) return undefined;
    ruleEvaluated("drive.command.rejected");
    let result: unknown;
    try {
      result = await drive.connection.execute({ taskId, allocationId: allocationOf(), command } as never);
    } catch (error) {
      refuse("drive.command.rejected", `drive.command.${String(command.type)}`, `execute rejected rather than answered: ${String(error)}`);
      return undefined;
    }
    ruleEvaluated("drive.command.failed");
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
    const malformed = validateResult(opened, "openMedia", "drive.openMedia");
    found.push(...malformed);
    if (malformed.length === 0 && isRecord(opened) && opened.status === "opened") session = opened.session as unknown as Record<string, unknown>;
    else if (malformed.length === 0 && isRecord(opened)) refuse("drive.openMedia.unavailable", "drive.openMedia", "a softphone login's adapter could not open the call's audio");
  }
  // 3b. The microphone is the host's. With the audio open, the drive mutes it for a moment and
  // reports the leg the provider's record would otherwise miss -- begun, then ended -- and
  // expects each report recorded. If the provider restates the task's record afterwards, the leg is in it.
  const reportedLegs: { at: string; task: Record<string, unknown>; closedAs?: number }[] = [];
  /** The duration the provider's record states for the leg at `at`, as the task stands now. */
  const closedAs = (at: string): number | undefined => {
    const history = latestTask().handlingHistory;
    const leg = isRecord(history) && Array.isArray(history.steps)
      ? history.steps.find(entry => isRecord(entry) && entry.step === "muted" && entry.at === at) as Record<string, unknown> | undefined : undefined;
    return typeof leg?.seconds === "number" ? leg.seconds : undefined;
  };
  const canRecordMute = session !== undefined && typeof session.setMuted === "function" && typeof drive.connection.recordStep === "function";
  const report = async (body: Record<string, unknown>): Promise<void> => {
      ruleEvaluated("drive.recordStep.rejected", "drive.recordStep.failed");
      // The drive holds its own report to the contract before it crosses, as a host must.
      const leg = { taskId, allocationId: allocationOf(), step: "muted", mutedBy: "host", ...body };
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
      // No session, nothing to mute: a reload whose second client could not open the audio has been named already.
      if (session === undefined) return;
      try { (session.setMuted as (muted: boolean) => void)(muted); }
      catch { refuse("drive.openMedia.setMuted", "drive.openMedia", `the media session threw on setMuted(${String(muted)})`); }
    };
  if (canRecordMute) {
    const at = new Date().toISOString();
    const began = Date.now();
    setMuted(true);
    await report({ at });
    // A leg's duration is whole seconds and a leg shorter than one cannot be stated, so the mute holds for one.
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    setMuted(false);
    await report({ at, seconds: Math.round((Date.now() - began) / 1000), ended: true });
    reportedLegs.push({ at, task: latestTask() });
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
  // 5. End the call, where the agent may -- with the microphone muted, as agents do. The leg left
  // open at media end is the provider's to close, since the provider knows the instant the media
  // ended; the host's own closing report can only follow what it hears, is answered recorded, and
  // changes nothing. So the drive mutes, does not report the end before end-call, and reports it
  // after the media has ended.
  if (drive.channel === "voice" && latestTask().phase === "in-progress" && offers("endCall")) {
    let openLeg: { at: string; began: number; task: Record<string, unknown> } | undefined;
    if (canRecordMute && session !== undefined) {
      // The task as published before the call ends: the completing publication that follows is the restatement held to carrying this leg.
      openLeg = { at: new Date().toISOString(), began: Date.now(), task: latestTask() };
      setMuted(true);
      await report({ at: openLeg.at });
    }
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
      const completing = await updated(t => t.phase === "completing", "the task completing after its media ended");
      if (openLeg !== undefined) {
        setMuted(false);
        // The provider closed this leg at media end, in the completing publication; the host's report,
        // stated at the record's grain (a leg that rounds to nought is 1), changes nothing, and the
        // record as it stands now is what every later restatement is held to.
        const before = closedAs(openLeg.at);
        await report({ at: openLeg.at, seconds: Math.max(1, Math.round((Date.now() - openLeg.began) / 1000)), ended: true });
        reportedLegs.push({ at: openLeg.at, task: openLeg.task, closedAs: before });
      }
      if (completing !== undefined && offers("hold")) {
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
  // The record kept by the provider has every leg the host reported, wherever the provider restated it:
  // the last publication of the task is read, whether or not the drive was waiting on it.
  const lastPublished = (): Record<string, unknown> => {
    for (let index = drive.events.length - 1; index >= 0; index -= 1) {
      const event = drive.events[index]!.event as Record<string, unknown>;
      if ((event.type === "task-updated" || event.type === "task-offered") && isTask(event.task) && event.task.id === taskId) return event.task;
    }
    return latestTask();
  };
  for (const reported of reportedLegs) {
    const published = lastPublished();
    if (published === reported.task) continue;
    const history = published.handlingHistory;
    if (isRecord(history) && Array.isArray(history.steps)) {
      const { at } = reported;
      const leg = history.steps.find(entry => isRecord(entry) && entry.step === "muted" && entry.at === at) as Record<string, unknown> | undefined;
      if (leg === undefined) {
        refuse("drive.recordStep.history", "drive.recordStep",
          `the provider restated the task's record after the host reported a muted leg at ${at}, and the leg is not in it`);
      } else if (leg.mutedBy !== "host") {
        refuse("drive.recordStep.history", "drive.recordStep",
          `the record's muted leg at ${at} says mutedBy ${String(leg.mutedBy)}; the host reported host, and the record keeps the host's word`);
      } else if (reported.closedAs !== undefined) {
        ruleEvaluated("drive.recordStep.overwritten");
        if (leg.seconds !== reported.closedAs) {
          refuse("drive.recordStep.overwritten", "drive.recordStep",
            `the provider closed the leg at ${at} with ${reported.closedAs}s at media end and the record now says ${String(leg.seconds)}s: the host's closing report changes nothing`);
        }
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
    if (from !== undefined) {
      found.push(...validateBreakTransition({ approval: from, mayAsk: true }, event.break, `${path}.event.break`));
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
function watchStore(store: LoginStore): { store: LoginStore; held: Set<string>; everHeld: Set<string> } {
  const held = new Set<string>();
  const everHeld = new Set<string>();
  return {
    held,
    everHeld,
    store: {
      get: key => store.get(key),
      set: async (key, value) => { await store.set(key, value); held.add(key); everHeld.add(key); },
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
export function stillHost(report?: HostReport, guarantees?: HostGuarantees): Host & { mute?: never; recording?: never };
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
