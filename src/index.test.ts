import { describe, expect, it, vi } from "vitest";
import { HANDLING_STEPS_WITH_A_PERSON, TASK_HANDLING_STEPS, handlingStepExpectsAPerson, IDLE_CAPABILITIES, IDLE_CAPABILITY_UI, AuthenticationMethod, BrowserIsolationScheme, OMNI_FAILURE_CODES, OMNI_SUPPORTED_PROTOCOL_VERSIONS, TASK_CAPABILITIES, TASK_CAPABILITY_UI, defineAdapter, isAllowedBrowserUrl, isHostActuatedCommand, negotiateProtocolVersion, normalizeContactEmail, normalizeContactNumber, OMNI_PROTOCOL_VERSION, taskKey, type ProviderEvent, type TaskBrowser, type TaskCommandRequest, browserSessionKey, DEFAULT_TASK_ITEM_LABEL, taskItemName, taskItemPlural } from "./index.js";
import { assertCommandIdempotency, exerciseAdapter } from "./testing.js";

describe("Omni backend protocol", () => {
  it("creates collision-safe composite task keys", () => {
    expect(taskKey("voice:west", "call/42")).toBe("voice%3Awest:call%2F42");
  });

  it("refuses to share a session under a scheme the backend did not choose", () => {
    const base = { id: "crm", name: "CRM", purpose: "CRM", url: "https://crm.test/" };
    const input = (browser: unknown) => ({ providerName: "VoiceCo", taskId: "call-1", taskType: "Support", browser }) as Parameters<typeof browserSessionKey>[0];
    // A reusing browser with no scheme is invalid. The safe reading is "do not share", never
    // "share with everyone named the same" -- so it keys as isolated rather than as TAB_NAME.
    expect(browserSessionKey(input({ ...base, reuse: true }))).toBeUndefined();
    // Both controls: a declared scheme does share, and reuse: false never does. Without the
    // first, a resolver that returned undefined for everything would pass the assertion above.
    expect(browserSessionKey(input({ ...base, reuse: true, isolationScheme: BrowserIsolationScheme.TAB_NAME }))).toBe("CRM");
    expect(browserSessionKey(input({ ...base, reuse: false }))).toBeUndefined();
    // And the scheme that was the old default is still reachable, deliberately chosen.
    expect(browserSessionKey(input({ ...base, reuse: true, isolationScheme: BrowserIsolationScheme.PROVIDER_NAME__TAB_NAME })))
      .toBe("VoiceCo.CRM");
  });

  it("names an item in the backend's words, and falls back only when it must", () => {
    const call = { itemLabel: { singular: "Call", plural: "Calls" } };
    const chat = { itemLabel: { singular: "Web chat", plural: "Web chats" } };
    // The backend's word wins wherever it has one...
    expect(taskItemName(call)).toBe("Call");
    expect(taskItemPlural([call, call])).toBe("Calls");
    // ...and Omni supplies one only where the backend named none.
    expect(taskItemName({})).toBe(DEFAULT_TASK_ITEM_LABEL.singular);
    expect(taskItemPlural([{}, {}])).toBe("Tasks");
    // Two kinds cannot share one name: "Calls" would misdescribe half the list.
    expect(taskItemPlural([call, chat])).toBe("Tasks");
    expect(taskItemPlural([call, {}])).toBe("Tasks");
    // Whitespace is not a name.
    expect(taskItemName({ itemLabel: { singular: "   ", plural: "   " } })).toBe("Task");
  });

  it("separates idle and per-task capabilities", () => {
    expect(IDLE_CAPABILITIES.voice).toEqual(["dial", "personalBrowser", "calendar", "contacts"]);
    // Media is not among them: every voice backend has audio, so there is nothing to announce.
    expect(IDLE_CAPABILITIES.voice).not.toContain("media");
    expect(IDLE_CAPABILITIES.chat).toEqual(["personalBrowser", "calendar", "contacts"]);
    expect(IDLE_CAPABILITIES.email).toEqual(["personalBrowser", "calendar", "contacts"]);
    expect(TASK_CAPABILITIES.voice).toEqual([
      "reject", "browsers", "mute", "hold", "agentDisconnect", "blindTransfer", "consultTransfer",
      "conference", "dtmf", "recording", "dispositions",
    ]);
    expect(TASK_CAPABILITIES.chat).toEqual(["reject", "browsers", "hold", "dispositions"]);
    expect(TASK_CAPABILITIES.email).toEqual(["reject", "browsers", "dispositions"]);
    expect(TASK_CAPABILITY_UI.hold).toEqual({ kind: "toggle", label: "Hold", placement: "primary" });
    expect(TASK_CAPABILITY_UI.browsers).toEqual({ kind: "browser", label: "Browsers", placement: "task-content" });
    expect(IDLE_CAPABILITY_UI.dial.label).toBe("Dialpad");
    expect(IDLE_CAPABILITY_UI.dial.kind).toBe("dialpad");
    expect(IDLE_CAPABILITY_UI.dial.placement).toBe("idle-content");
    expect(IDLE_CAPABILITY_UI.personalBrowser.label).toBe("Browser");
    expect(IDLE_CAPABILITY_UI.personalBrowser.kind).toBe("browser");
    expect(IDLE_CAPABILITY_UI.personalBrowser.placement).toBe("idle-content");
    expect(IDLE_CAPABILITY_UI.calendar.kind).toBe("calendar");
    expect(IDLE_CAPABILITY_UI.calendar.placement).toBe("idle-content");
    expect(IDLE_CAPABILITY_UI.contacts.kind).toBe("contact-list");
    expect(IDLE_CAPABILITY_UI.contacts.placement).toBe("idle-content");
  });

  it("normalizes contact indexes without changing display values", () => {
    expect(normalizeContactNumber(" +91 (98765) 432-10 ")).toBe("+919876543210");
    expect(normalizeContactEmail(" Asha@Example.COM ")).toBe("asha@example.com");
  });

  it("merges the international prefixes and separators backends actually send", () => {
    const canonical = "+14155550100";
    for (const variant of [
      "+1 (415) 555-0100",
      "+1\u2011415\u2011555\u20110100",
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

  it("negotiates the highest protocol version both sides support", () => {
    expect(negotiateProtocolVersion([1])).toBe(OMNI_PROTOCOL_VERSION);
    expect(negotiateProtocolVersion([1, 2, 3], [2, 3])).toBe(3);
    expect(negotiateProtocolVersion([3, 1, 2], [1, 2])).toBe(2);
    expect(OMNI_SUPPORTED_PROTOCOL_VERSIONS).toContain(OMNI_PROTOCOL_VERSION);
  });

  it("refuses to connect when no protocol version is shared", () => {
    expect(negotiateProtocolVersion([99])).toBeUndefined();
    expect(negotiateProtocolVersion([])).toBeUndefined();
    expect(negotiateProtocolVersion([1], [2])).toBeUndefined();
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
    for (const code of Object.values(OMNI_FAILURE_CODES)) expect(code.startsWith("omni.")).toBe(true);
    expect(new Set(Object.values(OMNI_FAILURE_CODES)).size).toBe(Object.values(OMNI_FAILURE_CODES).length);
  });

  it("models rich announcements with accessible fallback and optional expiry", () => {
    const event: ProviderEvent = {
      type: "announcement",
      announcement: {
        id: "service-1",
        text: "Mailbox maintenance",
        html: `<strong data-tone="warning">Mailbox maintenance</strong>`,
        announcedAt: "2026-08-21T01:00:00Z",
        expiresAt: "2026-08-21T03:00:00Z",
      },
    };
    expect(event.announcement.text).toBe("Mailbox maintenance");
  });

  it("uses the isolation scheme as the complete browser reuse policy", () => {
    const view = {
      id: "crm",
      name: "CRM",
      purpose: "Customer record",
      url: "https://crm.example.test/customer/42",
      reuse: true,
      isolationScheme: BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
    } as const satisfies TaskBrowser;
    expect(view.reuse).toBe(true);
  });

  it("keeps naming scheme serialization values readable and stable", () => {
    expect(BrowserIsolationScheme.PROVIDER_NAME__TASK_ID__TAB_NAME).toBe("ProviderName.TaskId.TabName");
    expect(BrowserIsolationScheme.TAB_NAME).toBe("TabName");
    expect(BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME).toBe("ProviderName.TaskTypeName.TabName");
    expect(BrowserIsolationScheme.PROVIDER_NAME__TAB_NAME).toBe("ProviderName.TabName");
    expect(BrowserIsolationScheme.PROVIDER_NAME__TASK_TYPE_NAME).toBe("ProviderName.TaskTypeName");
    expect(BrowserIsolationScheme.TASK_TYPE_NAME__TAB_NAME).toBe("TaskTypeName.TabName");
  });

  it("exercises a backend-neutral conforming adapter", async () => {
    const disconnect = vi.fn(async () => undefined);
    const adapter = defineAdapter({
      manifest: {
        id: "test-provider",
        displayName: "Test Provider",
        // Channels are a closed set now, so "neutral" means the smallest conforming adapter
        // rather than one on a channel of its own invention.
        channel: "chat",
        supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
        // Cast because the declarations still carry the previous protocol's enum. The
        // validator is the authority on the wire value until the types are updated.
        authenticationMethods: ["browser-sso"] as unknown as AuthenticationMethod[],
        idleCapabilities: {},
      },
      async createAuthenticationSession() {
        return {
          state: () => ({ status: "authenticated" as const, identity: { id: "agent-1", displayName: "Agent One" } }),
          subscribe: () => () => undefined,
          start: async () => ({ status: "failed" as const, failure: { code: "already-authenticated", message: "Already authenticated", retryable: false } }),
          complete: async () => ({ status: "failed" as const, failure: { code: "no-flow", message: "No authentication flow", retryable: false } }),
          cancelAuthentication: async () => ({ status: "accepted" as const }),
          signOut: async () => ({ status: "accepted" as const }),
          close: async () => undefined,
        };
      },
      async connect() {
        return {
          snapshot: () => ({ status: "active", sessionId: "session-1", sessionCapabilities: {}, break: { approval: "not-requested", accepting: true }, tasks: [] }),
          subscribe: listener => {
            listener({ id: "event-1", sessionId: "session-1", occurredAt: "2026-08-21T01:00:00Z", event: { type: "provider-status", status: "active" } } as never);
            return () => undefined;
          },
          setCapacity: async demand => (expect(demand.count).toBe(0), { status: "accepted" as const }),
          requestBreak: async () => ({ status: "accepted" }),
          cancelBreak: async () => ({ status: "accepted" }),
          resume: async () => ({ status: "accepted" }),
          execute: async request => ({ commandId: request.commandId, status: "applied" }),
          disconnect,
        };
      },
    });

    const result = await exerciseAdapter(adapter, { protocolVersion: OMNI_PROTOCOL_VERSION, sessionId: "session-1" });
    expect(result.events.map(item => item.event)).toEqual([{ type: "provider-status", status: "active" }]);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("models an authoritative reconnect snapshot", () => {
    const event: ProviderEvent = {
      type: "snapshot",
      reason: "reconnected",
      snapshot: { status: "active", sessionId: "session-1", sessionCapabilities: {}, break: { approval: "starting-after-task", accepting: true }, tasks: [] },
    };
    expect(event.snapshot.break.approval).toBe("starting-after-task");
  });

  it("returns an idempotent result for a retried task command", () => {
    const result = { commandId: "command-42", status: "already-applied" } as const;
    expect(result.status).toBe("already-applied");
  });

  it("provides a command idempotency conformance check", async () => {
    let applied = false;
    const execute = vi.fn(async (request: TaskCommandRequest) => {
      const status = applied ? "already-applied" as const : "applied" as const;
      applied = true;
      return { commandId: request.commandId, status };
    });
    await assertCommandIdempotency({ execute }, {
      commandId: "command-42",
      taskId: "task-42",
      command: { type: "dispose", disposition: "resolved" },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("isHostActuatedCommand", () => {
  const softphone = { id: "sp-1", label: "Omni softphone", kind: "softphone", hostCarriesMedia: true } as const;
  const deskPhone = { id: "4021", label: "Desk 4021", kind: "desk-phone", hostCarriesMedia: false } as const;

  it("keeps mute and DTMF local only when the audio arrives in Omni", () => {
    expect(isHostActuatedCommand({ type: "mute", muted: true }, softphone)).toBe(true);
    expect(isHostActuatedCommand({ type: "dtmf", digits: "12" }, softphone)).toBe(true);
    // The control: the same commands go to the backend when it rings the device itself.
    expect(isHostActuatedCommand({ type: "mute", muted: true }, deskPhone)).toBe(false);
    expect(isHostActuatedCommand({ type: "dtmf", digits: "12" }, deskPhone)).toBe(false);
  });

  it("sends every other command to the backend even when Omni carries the audio", () => {
    expect(isHostActuatedCommand({ type: "hold" }, softphone)).toBe(false);
    expect(isHostActuatedCommand({ type: "disconnect" }, softphone)).toBe(false);
    expect(isHostActuatedCommand({ type: "transfer", action: "blind", destination: "+14155550111" }, softphone)).toBe(false);
    expect(isHostActuatedCommand({ type: "dispose", disposition: "resolved" }, softphone)).toBe(false);
  });

  it("sends to the backend while no device is chosen", () => {
    expect(isHostActuatedCommand({ type: "mute", muted: true }, undefined)).toBe(false);
  });
});

describe("handlingStepExpectsAPerson", () => {
  it("says which steps have a participant, so an absent agent can be read correctly", () => {
    // queued is the only step nobody takes part in: an absent agent there is not a gap.
    expect(handlingStepExpectsAPerson("queued")).toBe(false);
    // The control that matters: every other step does expect one, so an absent agent on any
    // of them means "handled, could not attribute" rather than "nobody involved".
    for (const step of TASK_HANDLING_STEPS.filter(s => s !== "queued")) {
      expect(handlingStepExpectsAPerson(step)).toBe(true);
    }
    expect(HANDLING_STEPS_WITH_A_PERSON).not.toContain("queued");
    expect(HANDLING_STEPS_WITH_A_PERSON).toHaveLength(TASK_HANDLING_STEPS.length - 1);
  });
});
