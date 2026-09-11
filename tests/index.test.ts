import { describe, expect, it, vi } from "vitest";
import {
  BREAK_KINDS,
  BROWSER_ISOLATION_SCHEMES,
  DEFAULT_TASK_PHASE_LABELS,
  DEFAULT_TASK_TYPE_PRESENTATION,
  DIAL_OUTCOMES,
  CAPABILITY_SOURCES,
  HOST_MUTES,
  MUTED_BY,
  LISTENING_BREAK_KINDS,
  breakKindAllowsListening,
  HISTORY_STEPS_THAT_DIAL,
  HISTORY_STEPS_WITH_A_PERSON,
  IDLE_CAPABILITIES,
  commandDialId,
  historyStepDials,
  IDLE_CAPABILITY_UI,
  OMNI_FAILURE_CODES,
  OMNI_PROTOCOL_VERSION,
  OMNI_SUPPORTED_PROTOCOL_VERSIONS,
  browserSessionKey,
  sameCapabilities,
  defineAdapter,
  historyStepExpectsAPerson,
  isAllowedBrowserUrl,
  negotiateProtocolVersion,
  normalizeContactEmail,
  normalizeContactNumber,
  assignmentKey,
  userKey,
  type BrowserSessionKeyInput,
  type HistoryStep,
  type ProviderEvent,
  type TaskBrowser,
  type TaskPhase,
} from "../src/index.js";
import { exerciseAdapter, memoryStore, stillHost } from "../src/testing.js";

describe("Omni protocol", () => {
  it("creates collision-safe composite task and user keys", () => {
    expect(assignmentKey("voice:west", "call/42")).toBe("voice%3Awest:call%2F42");
    expect(userKey("voice:west", "agent/7")).toBe("voice%3Awest:agent%2F7");
    // The control: a provider id containing the separator cannot forge another provider's key.
    expect(assignmentKey("a:b", "c")).not.toBe(assignmentKey("a", "b:c"));
    expect(userKey("a:b", "c")).not.toBe(userKey("a", "b:c"));
  });

  it("negotiates the highest protocol version both sides support", () => {
    expect(negotiateProtocolVersion([1])).toBe(OMNI_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion([1, 2, 3], [2, 3])).toBe(3);
    expect(negotiateProtocolVersion([3, 1, 2], [1, 2])).toBe(2);
    expect(OMNI_SUPPORTED_PROTOCOL_VERSIONS).toContain(OMNI_PROTOCOL_VERSION);
  });

  it("refuses to connect when no protocol version is shared", () => {
    expect(negotiateProtocolVersion([99])).toBeUndefined();
    expect(negotiateProtocolVersion([2])).toBeUndefined();
    expect(negotiateProtocolVersion([])).toBeUndefined();
    expect(negotiateProtocolVersion([1], [2])).toBeUndefined();
  });

  it("publishes the idle capabilities and what Omni calls them", () => {
    expect(IDLE_CAPABILITIES).toEqual(["dial", "personalBrowser", "calendar", "contacts"]);
    expect(IDLE_CAPABILITY_UI).toEqual({ dial: "Dialpad", personalBrowser: "Browser", calendar: "Calendar", contacts: "Contacts" });
  });

  it("names every phase for every channel, so no task is ever unlabelled", () => {
    const phases: TaskPhase[] = ["pending", "confirmed", "preview", "in-progress", "paused", "completing"];
    for (const channel of ["voice", "chat", "email"] as const) {
      expect(Object.keys(DEFAULT_TASK_PHASE_LABELS[channel]).sort()).toEqual([...phases].sort());
      for (const label of Object.values(DEFAULT_TASK_PHASE_LABELS[channel])) expect(label.trim()).not.toBe("");
      // A reference is shown only when both the value and its label exist, so every default names one.
      expect(DEFAULT_TASK_TYPE_PRESENTATION[channel].referenceLabel).toMatch(/ID$/);
      expect(DEFAULT_TASK_TYPE_PRESENTATION[channel].singular).not.toBe(DEFAULT_TASK_TYPE_PRESENTATION[channel].plural);
    }
    expect(DEFAULT_TASK_PHASE_LABELS.voice["in-progress"]).toBe("On Call");
    expect(DEFAULT_TASK_TYPE_PRESENTATION.email).toEqual({ singular: "Email", plural: "Emails", referenceLabel: "Email ID" });
  });

  it("names the breaks a contact centre runs, once each", () => {
    expect(BREAK_KINDS).toEqual([
      "short-break", "meal", "rest", "training", "coaching",
      "meeting", "administrative", "technical", "personal", "other",
    ]);
    expect(new Set(BREAK_KINDS).size).toBe(BREAK_KINDS.length);
  });

  it("normalizes contact indexes without changing display values", () => {
    expect(normalizeContactNumber(" +91 (98765) 432-10 ")).toBe("+919876543210");
    expect(normalizeContactEmail(" Asha@Example.COM ")).toBe("asha@example.com");
  });

  it("merges the international prefixes and separators providers actually send", () => {
    const canonical = "+14155550100";
    for (const variant of [
      "+1 (415) 555-0100",
      "+1‑415‑555‑0100",
      "0014155550100",
      "+1.415.555.0100",
      "+1/415/555/0100",
    ]) {
      expect(normalizeContactNumber(variant)).toBe(canonical);
    }
  });

  it("keeps a national-format number distinct, because no country context exists here", () => {
    expect(normalizeContactNumber("4155550100")).toBe("4155550100");
    expect(normalizeContactNumber("4155550100")).not.toBe(normalizeContactNumber("+14155550100"));
  });

  it("admits only http and https into a managed browser", () => {
    expect(isAllowedBrowserUrl("https://crm.example.com/42")).toBe(true);
    expect(isAllowedBrowserUrl("http://crm.example.com/42")).toBe(true);
    expect(isAllowedBrowserUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedBrowserUrl("chrome://settings")).toBe(false);
    expect(isAllowedBrowserUrl("not a url")).toBe(false);
  });

  it("reserves the omni failure-code namespace", () => {
    for (const code of OMNI_FAILURE_CODES) expect(code.startsWith("omni.")).toBe(true);
    expect(new Set(OMNI_FAILURE_CODES).size).toBe(OMNI_FAILURE_CODES.length);
  });

  it("models rich announcements with accessible fallback and optional expiry", () => {
    const event: ProviderEvent = {
      type: "announcement",
      text: "Mailbox maintenance",
      html: `<strong data-tone="warning">Mailbox maintenance</strong>`,
      announcedAt: "2026-08-21T01:00:00Z",
      expiresAt: "2026-08-21T03:00:00Z",
    };
    expect(event.text).toBe("Mailbox maintenance");
  });

  it("keeps naming scheme serialization values readable and stable", () => {
    expect(BROWSER_ISOLATION_SCHEMES).toEqual({
      PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME: "ProviderName.AssignmentId.TabName",
      TAB_NAME: "TabName",
      PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME: "ProviderName.TaskTypeName.TabName",
      PROVIDER_NAME__TAB_NAME: "ProviderName.TabName",
      PROVIDER_NAME__TASK_TYPE_NAME: "ProviderName.TaskTypeName",
      TASK_TYPE_NAME__TAB_NAME: "TaskTypeName.TabName",
    });
  });

  it("models an authoritative reconnect snapshot", () => {
    const event: ProviderEvent = {
      type: "snapshot",
      reason: "reconnected",
      snapshot: { transport: "active", loginId: "session-1", break: { status: "starting-after-task", canRequestBreak: true }, tasks: [], taskCount: 0 },
    };
    expect(event.snapshot.break.status).toBe("starting-after-task");
  });

  it("exercises the smallest conforming adapter", async () => {
    // Channels are a closed set, so the smallest adapter is on a real channel with nothing
    // optional declared: no idle capabilities, no breaks, no team member list, no tasks -- and so no
    // optional method is required of it.
    const disconnect = vi.fn(async () => undefined);
    const adapter = defineAdapter({
      manifest: {
        id: "test-provider",
        displayName: "Test Provider",
        channel: "chat",
        supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
        completionSettleMs: 5000,
        authenticationMethods: ["browser-sso"],
      },
      async createAuthenticationSession() {
        return {
          state: () => ({ status: "authenticated" as const, identity: { id: "agent-1", displayName: "Agent One", timeZone: "Pacific/Chatham" }, capabilities: {} }),
          subscribe: () => () => undefined,
          start: async () => ({ status: "rejected" as const, failure: { code: "already-authenticated", message: "Already authenticated", retryable: false } }),
          complete: async () => ({ status: "rejected" as const, failure: { code: "no-flow", message: "No authentication flow", retryable: false } }),
          cancelAuthentication: async () => ({ status: "applied" as const }),
          signOut: async () => ({ status: "applied" as const }),
          close: async () => undefined,
        };
      },
      async connect() {
        return {
          snapshot: () => ({ transport: "active" as const, loginId: "session-1", break: { status: "not-requested" as const, canRequestBreak: true }, tasks: [], taskCount: 0 }),
          subscribe: listener => {
            listener({ id: "event-1", loginId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "transport-status", status: "active" } });
            return () => undefined;
          },
          setCapacity: async capacity => (expect(capacity.count).toBeGreaterThanOrEqual(0), { status: "applied" as const }),
          execute: async () => ({ status: "applied" as const }),
          refused: () => undefined,
          disconnect,
        };
      },
    });

    const result = await exerciseAdapter(adapter, { protocolVersion: OMNI_PROTOCOL_VERSION, loginId: "session-1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, host: stillHost(), store: memoryStore() });
    expect(result.violations).toEqual([]);
    expect(result.events.map(item => item.event)).toEqual([{ type: "transport-status", status: "active" }]);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("sameCapabilities", () => {
  it("compares field by field, whatever the key order, and tells {} from absent", () => {
    expect(sameCapabilities({ breaks: true, team: { breakControl: true } }, { team: { breakControl: true }, breaks: true })).toBe(true);
    expect(sameCapabilities({}, {})).toBe(true);
    expect(sameCapabilities({ team: {} }, { team: {} })).toBe(true);
    // Each field on its own moves the answer: a lead with no controls is still a lead.
    expect(sameCapabilities({ team: {} }, {})).toBe(false);
    expect(sameCapabilities({ breaks: true }, {})).toBe(false);
    expect(sameCapabilities({ team: { breakControl: true } }, { team: {} })).toBe(false);
    expect(sameCapabilities({ team: { leadAssistControl: true } }, { team: { breakControl: true } })).toBe(false);
    // The listen modes are a set: order is not a difference, a missing mode is.
    expect(sameCapabilities({ team: { listeningControl: ["listen", "coach"] } }, { team: { listeningControl: ["coach", "listen"] } })).toBe(true);
    expect(sameCapabilities({ team: { listeningControl: ["listen", "coach"] } }, { team: { listeningControl: ["listen"] } })).toBe(false);
    expect(sameCapabilities({ team: { listeningControl: ["listen"] } }, { team: {} })).toBe(false);
    // Every field: a lead's policy control, and the preferences the login declares, by id, label, enabled and who set or locked them.
    expect(sameCapabilities({ team: { policyControl: true } }, { team: {} })).toBe(false);
    expect(sameCapabilities({ team: { policyControl: true } }, { team: { policyControl: true } })).toBe(true);
    const hold = { id: "hold" as const, label: "Hold", enabled: true, setBy: "team" as const };
    expect(sameCapabilities({ preferences: [hold] }, { preferences: [hold] })).toBe(true);
    expect(sameCapabilities({ preferences: [hold] }, {})).toBe(false);
    expect(sameCapabilities({ preferences: [hold] }, { preferences: [{ ...hold, enabled: false }] })).toBe(false);
    expect(sameCapabilities({ preferences: [hold] }, { preferences: [{ ...hold, setBy: "person" }] })).toBe(false);
    expect(sameCapabilities({ preferences: [hold] }, { preferences: [{ ...hold, lockedBy: "team", reason: "Policy" }] })).toBe(false);
  });
});

describe("browserSessionKey", () => {
  // The guide's own example: provider `mailflow`, task `EMAIL-829102`, type `Support`, tab `CRM`.
  const base = { id: "crm", name: "CRM", purpose: "Contact record", url: "https://crm.example.com/contact/42" };
  const input = (browser: TaskBrowser): BrowserSessionKeyInput =>
    ({ providerId: "mailflow", assignmentId: "EMAIL-829102.a1", taskType: "Support", browser });
  const reusing = (isolationScheme: TaskBrowser["isolationScheme"]) =>
    ({ ...base, sharedSession: true, isolationScheme } as TaskBrowser);

  it("keys each scheme exactly as the guide documents it", () => {
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__ASSIGNMENT_ID__TAB_NAME)))).toBe("mailflow.EMAIL-829102%2Ea1.CRM");
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.TAB_NAME)))).toBe("CRM");
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME)))).toBe("mailflow.Support.CRM");
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TAB_NAME)))).toBe("mailflow.CRM");
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME)))).toBe("mailflow.Support");
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.TASK_TYPE_NAME__TAB_NAME)))).toBe("Support.CRM");
  });

  it("fails closed: a browser that does not reuse, or reuses under no declared scheme, shares nothing", () => {
    expect(browserSessionKey(input({ ...base, sharedSession: false }))).toBeUndefined();
    // The type forbids these, but an adapter compiled against another version can still send
    // them, and the safe reading is "do not share", never "share with everyone named the same".
    expect(browserSessionKey(input(reusing(undefined)))).toBeUndefined();
    expect(browserSessionKey(input(reusing("ProviderName.Whatever" as TaskBrowser["isolationScheme"])))).toBeUndefined();
    // The control that makes the three above meaningful: a declared scheme does share.
    expect(browserSessionKey(input(reusing(BROWSER_ISOLATION_SCHEMES.TAB_NAME)))).toBe("CRM");
  });

  it("does not let a value containing the separator forge another key", () => {
    // `encodeURIComponent` leaves `.` unescaped, so a raw join once made provider "Acme.Voice"
    // with type "Support" collide with "Acme" and "Voice.Support".
    const scheme = BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME;
    const left = browserSessionKey({ providerId: "Acme.Voice", assignmentId: "t1-a", taskType: "Support", browser: reusing(scheme) });
    const right = browserSessionKey({ providerId: "Acme", assignmentId: "t1-a", taskType: "Voice.Support", browser: reusing(scheme) });
    expect(left).not.toBe(right);
    // And the same two inputs do collide when they genuinely are the same, or the test above
    // would pass for a function that returned something different every time.
    expect(browserSessionKey({ providerId: "Acme", assignmentId: "t1-a", taskType: "Support", browser: reusing(scheme) }))
      .toBe(browserSessionKey({ providerId: "Acme", assignmentId: "t2-a", taskType: "Support", browser: reusing(scheme) }));
  });
});

describe("historyStepExpectsAPerson", () => {
  it("says which steps have a person, so an absent agent can be read correctly", () => {
    // queued is the only step nobody takes part in: an absent agent there is not a gap.
    expect(historyStepExpectsAPerson("queued")).toBe(false);
    // The control that matters: every other step does expect one, so an absent agent on any
    // of them means "handled, could not attribute" rather than "nobody involved".
    const everyStep: HistoryStep[] = ["queued", "offered", "answered", "held", "muted", "transferred", "conferenced", "unanswered"];
    for (const step of everyStep.filter(step => step !== "queued")) {
      expect(historyStepExpectsAPerson(step)).toBe(true);
    }
    expect(HISTORY_STEPS_WITH_A_PERSON).toEqual(everyStep.filter(step => step !== "queued"));
  });
});

describe("listening during a break", () => {
  it("allows the working kinds of break and no other", () => {
    expect(LISTENING_BREAK_KINDS).toEqual(["coaching", "administrative", "training"]);
    for (const kind of LISTENING_BREAK_KINDS) expect(breakKindAllowsListening(kind)).toBe(true);
    for (const kind of ["short-break", "meal", "rest", "meeting", "technical", "personal", "other"] as const) expect(breakKindAllowsListening(kind)).toBe(false);
    expect(breakKindAllowsListening(undefined)).toBe(false);
  });
});

describe("every dial has an outcome", () => {
  it("names the dial a command places, and none for a command that dials nothing", () => {
    expect(commandDialId({ type: "connect-back", dialId: "dial-1" })).toBe("dial-1");
    expect(commandDialId({ type: "call", dialId: "dial-5" })).toBe("dial-5");
    expect(commandDialId({ type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" })).toBe("dial-2");
    expect(commandDialId({ type: "transfer", action: "warm", dialId: "dial-3", destinationId: "tier2" })).toBe("dial-3");
    expect(commandDialId({ type: "conference", action: "add", dialId: "dial-4", destinationId: "tier2" })).toBe("dial-4");
    // The control: the consult steps, a remove, and a hold dial nowhere.
    expect(commandDialId({ type: "transfer", action: "complete" })).toBeUndefined();
    expect(commandDialId({ type: "transfer", action: "cancel" })).toBeUndefined();
    expect(commandDialId({ type: "conference", action: "remove", destinationId: "tier2" })).toBeUndefined();
    expect(commandDialId({ type: "conference", action: "remove", party: true })).toBeUndefined();
    expect(commandDialId({ type: "end-call" })).toBeUndefined();
    expect(commandDialId({ type: "hold" })).toBeUndefined();
  });

  it("closes the set of outcomes, and says which record steps a dial writes", () => {
    expect(DIAL_OUTCOMES).toEqual(["answered", "busy", "no-answer", "unreachable", "rejected", "cancelled", "unexplained"]);
    expect(CAPABILITY_SOURCES).toEqual(["queue", "ungoverned", "undetermined"]);
    expect(HOST_MUTES).toEqual(["stream", "station"]);
    expect(MUTED_BY).toEqual(["host", "station"]);
    expect(HISTORY_STEPS_THAT_DIAL).toEqual(["transferred", "conferenced", "unanswered"]);
    for (const step of HISTORY_STEPS_THAT_DIAL) expect(historyStepDials(step)).toBe(true);
    for (const step of ["queued", "offered", "answered", "held", "muted"] as const) expect(historyStepDials(step)).toBe(false);
  });
});
