import {
  browserSessionKey,
  type Adapter,
  type AuthenticationState,
  type ProviderEventEnvelope,
  type Connection,
  type Snapshot,
  type Task,
  type BreakApproval,
  type Channel,
  type ConnectContext,
  type DialRequest,
  type TaskBrowser,
  type TaskCommandRequest,
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

export interface AdapterContractResult {
  events: ProviderEventEnvelope[];
  authenticationState: AuthenticationState;
  /** True only when `disconnect()` and `close()` both settled without throwing. */
  disconnectWasClean: boolean;
  /** Every violation observed. Non-empty only when `collectOnly` suppressed the throw. */
  violations: readonly ProtocolViolation[];
}

export interface ExerciseAdapterOptions {
  /** Return violations in the result instead of throwing. Defaults to `false`. */
  collectOnly?: boolean;
}

/**
 * Adopter conformance exercise: validates the manifest, opens an authenticated
 * session, connects, subscribes, validates the snapshot and every delivered
 * event, signals zero capacity, then unsubscribes and disconnects.
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
  let authenticationState: AuthenticationState | undefined;
  let disconnectWasClean = false;

  try {
    authenticationState = await authentication.state();
    violations.push(...validateAuthenticationState(authenticationState));
    if (authenticationState.status !== "authenticated") {
      throw new Error(
        `Adapter contract exercise requires authenticated test state, received ${authenticationState.status}`,
      );
    }

    connection = await adapter.connect(context);
    // Dial is declared by presence now: the capability object carries a destination policy
    // rather than an `enabled` flag, so its presence is the declaration.
    if (adapter.manifest.idleCapabilities?.dial !== undefined && typeof connection.dial !== "function") {
      violations.push({
        rule: "connection.dial.required",
        path: "connection.dial",
        message: "the manifest declares dial but the connection does not implement dial()",
      });
    }

    const eventIds = new Set<string>();
    unsubscribe = connection.subscribe(envelope => {
      violations.push(...validateEventEnvelope(envelope as ProviderEventEnvelope, adapter.manifest));
      if (typeof envelope?.id === "string") {
        if (eventIds.has(envelope.id)) return;
        eventIds.add(envelope.id);
      }
      events.push(envelope);
    });

    violations.push(...validateSnapshot(await connection.snapshot() as Snapshot, adapter.manifest));

    // Capacity is stated, not requested: nothing may be allocated until it is, so a
      // connection that will not accept one is a connection nothing can be given to.
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
    try { await connection?.disconnect(); } catch { clean = false; }
    try { await authentication.close(); } catch { clean = false; }
    disconnectWasClean = clean;
  }

  if (!disconnectWasClean) {
    violations.push({
      rule: "connection.disconnect.clean",
      path: "connection.disconnect",
      message: "unsubscribe(), disconnect(), or close() threw during shutdown",
    });
  }
  if (!options.collectOnly) assertNoViolations(violations);

  return {
    events: events as ProviderEventEnvelope[],
    authenticationState: authenticationState as AuthenticationState,
    disconnectWasClean,
    violations,
  };
}

/** Verifies the at-most-once contract by issuing the same command twice. */
export async function assertCommandIdempotency(
  connection: Pick<Connection, "execute">,
  request: TaskCommandRequest,
): Promise<void> {
  const first = await connection.execute(request);
  if (first.commandId !== request.commandId) throw new Error("Command result id mismatch");
  if (first.status === "failed") {
    throw new Error(`Command failed: ${first.failure.code}`);
  }

  const retry = await connection.execute(request);
  if (retry.commandId !== request.commandId) throw new Error("Retried command result id mismatch");
  if (retry.status !== "already-applied") {
    throw new Error(`Retried command must return already-applied, received ${retry.status}`);
  }
}

/** Validates restored authentication followed by a refresh failure or expiry. */
export function assertAuthenticationRestoreAndExpiry(
  states: readonly AuthenticationState[],
): void {
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
 */
export function assertDeniedAndRetriedBreak(approvals: readonly BreakApproval[]): void {
  const asked = approvals.indexOf("awaiting-decision");
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

/** Verifies that retrying one dial command cannot place a second call. */
export async function assertDialIdempotency(
  connection: Pick<Connection, "dial">,
  request: DialRequest,
): Promise<void> {
  if (!connection.dial) throw new Error("Dial capability requires Connection.dial()");
  const first = await connection.dial(request);
  if (first.commandId !== request.commandId) throw new Error("Dial result id mismatch");
  if (first.status === "failed") throw new Error(`Dial failed: ${first.failure.code}`);
  const retry = await connection.dial(request);
  if (retry.commandId !== request.commandId) throw new Error("Retried dial result id mismatch");
  // Each method answers in its own words: a retried dial says already-dialled, not
  // already-applied, because what it did was dial.
  if (retry.status !== "already-dialled") {
    throw new Error(`Retried dial must return already-dialled, received ${retry.status}`);
  }
}

/**
 * Validates the deadline derived from media end and the task's fixed wrap allowance.
 * `toleranceMs` absorbs scheduler jitter in a real implementation; pass 0 to demand
 * an exact match.
 */
export function assertWrapTimeout(
  task: Pick<Task, "completionAllowance">,
  mediaEndedAt: string,
  observedDeadline: string,
  toleranceMs = 1_000,
): void {
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

export interface BrowserIsolationScenario {
  providerName: string;
  taskId: string;
  taskType: string;
  browser: TaskBrowser;
}

/**
 * The session key one scenario derives, or `undefined` where the browser does not reuse.
 *
 * Reuse and the scheme travel together in the contract, so a browser with `reuse: false` has no
 * key and cannot share with anything.
 */
function sessionKeyFor(scenario: BrowserIsolationScenario): string | undefined {
  const browser = scenario.browser;
  if (browser.reuse !== true) return undefined;
  return browserSessionKey({
    scheme: browser.isolationScheme,
    providerName: scenario.providerName,
    taskId: scenario.taskId,
    taskTypeName: scenario.taskType,
    tabName: browser.name,
  });
}

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
        `${JSON.stringify({ provider: existing.providerName, taskType: existing.taskType, tab: existing.browser.name })} and ` +
        `${JSON.stringify({ provider: scenario.providerName, taskType: scenario.taskType, tab: scenario.browser.name })}`,
      );
    }
    byKey.set(key, scenario);
  }
}
