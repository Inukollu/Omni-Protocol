import {
  browserSessionKey,
  type BackendAdapter,
  type BackendAuthenticationState,
  type BackendEventEnvelope,
  type BackendConnection,
  type BackendSnapshot,
  type BackendTask,
  type BreakApproval,
  type ChannelKind,
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
  events: BackendEventEnvelope[];
  authenticationState: BackendAuthenticationState;
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
export async function exerciseAdapter<C extends ChannelKind>(
  adapter: BackendAdapter<C>,
  context: ConnectContext,
  options: ExerciseAdapterOptions = {},
): Promise<AdapterContractResult> {
  const violations: ProtocolViolation[] = [...validateManifest(adapter.manifest)];
  const events: BackendEventEnvelope<C>[] = [];

  const storedSecrets = new Map<string, string>();
  const authentication = await adapter.createAuthenticationSession({
    ...context,
    secrets: {
      get: async key => storedSecrets.get(key),
      set: async (key, value) => { storedSecrets.set(key, value); },
      delete: async key => { storedSecrets.delete(key); },
    },
  });

  let connection: BackendConnection<C> | undefined;
  let unsubscribe: (() => void) | undefined;
  let authenticationState: BackendAuthenticationState | undefined;
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
      violations.push(...validateEventEnvelope(envelope as BackendEventEnvelope, adapter.manifest));
      if (typeof envelope?.id === "string") {
        if (eventIds.has(envelope.id)) return;
        eventIds.add(envelope.id);
      }
      events.push(envelope);
    });

    violations.push(...validateSnapshot(await connection.snapshot() as BackendSnapshot, adapter.manifest));

    const capacity = await connection.requestWork({ count: 0, composite: [] });
    if (capacity.status === "rejected") {
      violations.push({
        rule: "connection.requestWork.rejected",
        path: "connection.requestWork",
        message: `backend rejected a zero-capacity signal: ${capacity.failure.code}`,
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
    events: events as BackendEventEnvelope[],
    authenticationState: authenticationState as BackendAuthenticationState,
    disconnectWasClean,
    violations,
  };
}

/** Verifies the at-most-once contract by issuing the same command twice. */
export async function assertCommandIdempotency(
  connection: Pick<BackendConnection, "execute">,
  request: TaskCommandRequest,
): Promise<void> {
  const first = await connection.execute(request);
  if (first.commandId !== request.commandId) throw new Error("Command result id mismatch");
  if (first.status === "rejected") {
    throw new Error(`Command was rejected: ${first.failure.code}`);
  }

  const retry = await connection.execute(request);
  if (retry.commandId !== request.commandId) throw new Error("Retried command result id mismatch");
  if (retry.status !== "already-applied") {
    throw new Error(`Retried command must return already-applied, received ${retry.status}`);
  }
}

/** Validates restored authentication followed by a refresh failure or expiry. */
export function assertAuthenticationRestoreAndExpiry(
  states: readonly BackendAuthenticationState[],
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
export function assertDuplicateEventDelivery<C extends ChannelKind>(
  envelopes: readonly BackendEventEnvelope<C>[],
): BackendEventEnvelope<C>[] {
  const byId = new Map<string, BackendEventEnvelope<C>>();
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

/**
 * Validates that a per-provider `sequence` increases by exactly one per distinct
 * event, and that redelivery repeats the original sequence. Returns the gaps found,
 * which is what tells Omni it must resync rather than apply the events it has.
 */
export function findSequenceGaps<C extends ChannelKind>(
  envelopes: readonly BackendEventEnvelope<C>[],
): Array<{ after: number; next: number }> {
  const seen = new Map<string, number>();
  const gaps: Array<{ after: number; next: number }> = [];
  let previous: number | undefined;
  for (const envelope of envelopes) {
    if (envelope.sequence === undefined) continue;
    const known = seen.get(envelope.id);
    if (known !== undefined) {
      if (known !== envelope.sequence) {
        throw new Error(`Redelivered event '${envelope.id}' changed its sequence from ${known} to ${envelope.sequence}`);
      }
      continue;
    }
    seen.set(envelope.id, envelope.sequence);
    if (previous !== undefined && envelope.sequence !== previous + 1) {
      gaps.push({ after: previous, next: envelope.sequence });
    }
    previous = envelope.sequence;
  }
  return gaps;
}

/** Validates an authoritative reconnect snapshot containing assignments missed while offline. */
export function assertReconnectWithMissedAssignments<C extends ChannelKind>(
  before: BackendSnapshot<C>,
  reconnect: BackendEventEnvelope<C>,
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

/** Validates a denied break followed by a later retry and approval. */
export function assertDeniedAndRetriedBreak(approvals: readonly BreakApproval[]): void {
  const deniedIndex = approvals.indexOf("denied");
  if (deniedIndex < 0) throw new Error("Break retry scenario requires an initial denial");
  const approvedIndex = approvals.lastIndexOf("approved");
  if (approvedIndex <= deniedIndex) throw new Error("Break retry scenario must approve after denial");
  if (approvals.at(-1) !== "approved") {
    throw new Error(`Break retry scenario must end approved, ended ${String(approvals.at(-1))}`);
  }
}

/** Verifies that retrying one dial command cannot place a second call. */
export async function assertDialIdempotency(
  connection: Pick<BackendConnection, "dial">,
  request: DialRequest,
): Promise<void> {
  if (!connection.dial) throw new Error("Dial capability requires BackendConnection.dial()");
  const first = await connection.dial(request);
  if (first.commandId !== request.commandId) throw new Error("Dial result id mismatch");
  if (first.status === "rejected") throw new Error(`Dial was rejected: ${first.failure.code}`);
  const retry = await connection.dial(request);
  if (retry.commandId !== request.commandId) throw new Error("Retried dial result id mismatch");
  if (retry.status !== "already-applied") {
    throw new Error(`Retried dial must return already-applied, received ${retry.status}`);
  }
}

/**
 * Validates the deadline derived from media end and the task's fixed wrap allowance.
 * `toleranceMs` absorbs scheduler jitter in a real implementation; pass 0 to demand
 * an exact match.
 */
export function assertWrapTimeout(
  task: Pick<BackendTask, "wrapSeconds">,
  mediaEndedAt: string,
  observedDeadline: string,
  toleranceMs = 1_000,
): void {
  const ended = Date.parse(mediaEndedAt);
  const deadline = Date.parse(observedDeadline);
  if (Number.isNaN(ended) || Number.isNaN(deadline)) throw new Error("Wrap scenario requires valid ISO-8601 times");
  const expected = ended + task.wrapSeconds * 1_000;
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

/** Validates whether two task-browser definitions should share one browser session. */
export function assertBrowserIsolationAndReuse(
  left: BrowserIsolationScenario,
  right: BrowserIsolationScenario,
  expectedReuse: boolean,
): void {
  const leftKey = browserSessionKey(left);
  const rightKey = browserSessionKey(right);
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
    const key = browserSessionKey(scenario);
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
