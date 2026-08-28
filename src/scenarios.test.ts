import { describe, expect, it, vi } from "vitest";
import {
  BrowserIsolationScheme,
  browserSessionKey,
  type BackendEventEnvelope,
  type BackendSnapshot,
  type BackendTask,
  type DialRequest,
} from "./index.js";
import {
  assertAuthenticationRestoreAndExpiry,
  assertBrowserIsolationAndReuse,
  assertDeniedAndRetriedBreak,
  assertDialIdempotency,
  assertDuplicateEventDelivery,
  assertNoBrowserSessionKeyCollisions,
  assertReconnectWithMissedAssignments,
  assertWrapTimeout,
  findSequenceGaps,
} from "./testing.js";

const voiceTask = {
  id: "call-42",
  title: "Customer call",
  channel: "voice",
  taskType: "Customer Support",
  capabilities: { browsers: true, hold: true },
  phase: "active",
  browsers: [],
  wrapSeconds: 60,
} satisfies BackendTask<"voice">;

const statusEvent = {
  id: "event-1",
  occurredAt: "2026-08-21T01:00:00Z",
  event: { type: "provider-status", status: "active" },
} as const satisfies BackendEventEnvelope<"voice">;

describe("assertAuthenticationRestoreAndExpiry", () => {
  it("accepts a restored session that refreshes and then expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" } },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" } },
      { status: "expired", identity: { id: "A-1", displayName: "Ada" }, failure: { code: "expired", message: "Sign in again", retryable: true } },
    ])).not.toThrow();
  });

  it("rejects a sequence that never expires", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" } },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" } },
    ])).toThrow(/must end in an expired state/);
  });

  it("rejects a sequence that does not start authenticated", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "signed-out" },
      { status: "expired" },
    ])).toThrow(/restored authenticated state/);
  });

  it("rejects a refresh reported after expiry", () => {
    expect(() => assertAuthenticationRestoreAndExpiry([
      { status: "authenticated", identity: { id: "A-1", displayName: "Ada" } },
      { status: "expired" },
      { status: "refreshing", identity: { id: "A-1", displayName: "Ada" } },
      { status: "expired" },
    ])).toThrow(/must occur before expiry/);
  });
});

describe("assertDuplicateEventDelivery", () => {
  it("applies a repeated event id exactly once", () => {
    expect(assertDuplicateEventDelivery([statusEvent, statusEvent])).toEqual([statusEvent]);
  });

  it("rejects a scenario with no duplicate to test", () => {
    expect(() => assertDuplicateEventDelivery([statusEvent])).toThrow(/requires a repeated event ID/);
  });

  it("rejects a reused id whose payload changed", () => {
    const mutated = { ...statusEvent, event: { type: "provider-status", status: "error" } } as BackendEventEnvelope<"voice">;
    expect(() => assertDuplicateEventDelivery([statusEvent, mutated])).toThrow(/changed its payload/);
  });
});

describe("findSequenceGaps", () => {
  const at = (id: string, sequence: number) => ({ ...statusEvent, id, sequence }) as BackendEventEnvelope<"voice">;

  it("finds no gap in a contiguous stream", () => {
    expect(findSequenceGaps([at("a", 1), at("b", 2), at("c", 3)])).toEqual([]);
  });

  it("ignores redelivery of an event it already counted", () => {
    expect(findSequenceGaps([at("a", 1), at("b", 2), at("a", 1), at("c", 3)])).toEqual([]);
  });

  it("reports the gap left by a dropped event", () => {
    expect(findSequenceGaps([at("a", 1), at("c", 4)])).toEqual([{ after: 1, next: 4 }]);
  });

  it("rejects redelivery that changed its sequence", () => {
    expect(() => findSequenceGaps([at("a", 1), at("a", 9)])).toThrow(/changed its sequence/);
  });
});

describe("assertReconnectWithMissedAssignments", () => {
  const before: BackendSnapshot<"voice"> = { status: "active", break: { approval: "not-requested", accepting: true }, tasks: [] };
  const reconnect = {
    id: "event-2",
    occurredAt: "2026-08-21T01:01:00Z",
    event: { type: "snapshot", reason: "reconnected", snapshot: { status: "active", break: { approval: "not-requested", accepting: true }, tasks: [voiceTask] } },
  } as const satisfies BackendEventEnvelope<"voice">;

  it("accepts a reconnect snapshot carrying the missed assignment", () => {
    expect(() => assertReconnectWithMissedAssignments(before, reconnect, [voiceTask.id])).not.toThrow();
  });

  it("rejects a reconnect snapshot that lost the missed assignment", () => {
    const empty = { ...reconnect, event: { ...reconnect.event, snapshot: before } } as BackendEventEnvelope<"voice">;
    expect(() => assertReconnectWithMissedAssignments(before, empty, [voiceTask.id])).toThrow(/missing task/);
  });

  it("rejects a task that was already present and therefore never missed", () => {
    const populated: BackendSnapshot<"voice"> = { ...before, tasks: [voiceTask] };
    expect(() => assertReconnectWithMissedAssignments(populated, reconnect, [voiceTask.id])).toThrow(/was not missed/);
  });

  it("rejects an event that is not a reconnect snapshot", () => {
    expect(() => assertReconnectWithMissedAssignments(before, statusEvent, [])).toThrow(/requires a reconnected snapshot/);
  });
});

describe("assertDeniedAndRetriedBreak", () => {
  it("accepts a denial that is retried and later approved", () => {
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "denied", "awaiting-decision", "approved"])).not.toThrow();
  });

  it("rejects a sequence that was never denied", () => {
    expect(() => assertDeniedAndRetriedBreak(["awaiting-decision", "approved"])).toThrow(/requires an initial denial/);
  });

  it("rejects an approval that came before the denial", () => {
    expect(() => assertDeniedAndRetriedBreak(["approved", "denied"])).toThrow(/must approve after denial/);
  });

  it("rejects a sequence that ends denied again", () => {
    expect(() => assertDeniedAndRetriedBreak(["denied", "approved", "denied"])).toThrow(/must end approved/);
  });
});

describe("assertDialIdempotency", () => {
  const makeDial = (retryStatus: "already-applied" | "applied") => {
    let applied = false;
    return vi.fn(async (request: DialRequest) => {
      const status = applied ? retryStatus : ("applied" as const);
      applied = true;
      return { commandId: request.commandId, status };
    });
  };
  const request: DialRequest = { commandId: "dial-1", destination: "+14155550100", source: "manual" };

  it("accepts a retry that places no second call", async () => {
    const dial = makeDial("already-applied");
    await expect(assertDialIdempotency({ dial }, request)).resolves.toBeUndefined();
    expect(dial).toHaveBeenCalledTimes(2);
  });

  it("rejects a retry that places another call", async () => {
    await expect(assertDialIdempotency({ dial: makeDial("applied") }, request)).rejects.toThrow(/must return already-applied/);
  });

  it("rejects a backend that enables dial without implementing it", async () => {
    await expect(assertDialIdempotency({}, request)).rejects.toThrow(/requires BackendConnection.dial/);
  });
});

describe("assertWrapTimeout", () => {
  it("accepts a deadline of media end plus the task allowance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.000Z")).not.toThrow();
  });

  it("accepts scheduler jitter inside the tolerance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.400Z")).not.toThrow();
  });

  it("rejects a deadline outside the tolerance", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:02:00.000Z")).toThrow(/Wrap deadline mismatch/);
  });

  it("rejects jitter when an exact match is demanded", () => {
    expect(() => assertWrapTimeout(voiceTask, "2026-08-21T01:00:00.000Z", "2026-08-21T01:01:00.400Z", 0)).toThrow(/Wrap deadline mismatch/);
  });

  it("rejects an unparseable time", () => {
    expect(() => assertWrapTimeout(voiceTask, "just now", "2026-08-21T01:01:00.000Z")).toThrow(/valid ISO-8601/);
  });
});

describe("browser isolation", () => {
  const browser = {
    id: "crm",
    name: "CRM",
    purpose: "Customer record",
    url: "https://crm.example.test/customer/42",
    reuse: true,
    isolationScheme: BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
  } as const;

  it("shares one session across tasks under a task-type scheme", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser },
      { providerName: "VoiceCo", taskId: "call-2", taskType: "Support", browser: { ...browser, id: "crm-copy" } },
      true,
    )).not.toThrow();
  });

  it("never shares a session when reuse is false", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser },
      { providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser: { ...browser, reuse: false, isolationScheme: undefined } },
      false,
    )).not.toThrow();
    expect(browserSessionKey({ providerName: "VoiceCo", taskId: "c", taskType: "Support", browser: { ...browser, reuse: false, isolationScheme: undefined } })).toBeUndefined();
  });

  it("reports a mismatch between expected and derived reuse", () => {
    expect(() => assertBrowserIsolationAndReuse(
      { providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser },
      { providerName: "OtherCo", taskId: "call-1", taskType: "Support", browser },
      true,
    )).toThrow(/Browser reuse mismatch/);
  });

  it("does not let a value containing the separator forge another key", () => {
    // `encodeURIComponent` leaves `.` unescaped, so joining raw parts once made
    // provider "Acme.Voice" + type "Support" collide with "Acme" + "Voice.Support".
    const left = browserSessionKey({ providerName: "Acme.Voice", taskId: "t1", taskType: "Support", browser });
    const right = browserSessionKey({ providerName: "Acme", taskId: "t1", taskType: "Voice.Support", browser });
    expect(left).not.toBe(right);
  });

  it("keeps every adversarial naming variant in its own session", () => {
    const variants = ["Acme.Voice", "Acme", "acme", "Acme Voice", "Acme-Voice", "Acme%2EVoice"];
    expect(() => assertNoBrowserSessionKeyCollisions(
      variants.flatMap(providerName => ["Support", "Voice.Support", "support"].map(taskType => ({
        providerName, taskId: "t1", taskType, browser,
      }))),
    )).not.toThrow();
  });

  it("detects a genuine collision when one exists", () => {
    expect(() => assertNoBrowserSessionKeyCollisions([
      { providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser },
      { providerName: "VoiceCo", taskId: "call-2", taskType: "Support", browser },
    ])).toThrow(/collision/);
  });
});
