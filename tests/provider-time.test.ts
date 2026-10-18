import { describe, expect, it } from "vitest";
import type { Host, ProviderTimeCheckPolicy, ProviderTimeCheckResult } from "../src/index.js";
import { validateManifest, validateProviderTimeCheckPolicy, validateProviderTimeCheckRequest, validateProviderTimeCheckResult, validateProviderTimeEstimate } from "../src/validation.js";
const policy: ProviderTimeCheckPolicy = { intervalMs: 60000, timeoutMs: 3000, maxRoundTripMs: 1000, maxSampleAgeMs: 120000 };
const request = { requestId: "q1" };
const result: ProviderTimeCheckResult = { requestId: "q1", sessionId: "session", clockId: "clock", providerTime: "2026-09-11T04:00:00.000Z" };
describe("optional provider time", () => {
  it("declares clock sampling only through explicit support", () => {
    const manifest = { id: "provider", displayName: "Provider", channel: "voice", supportedProtocolVersions: [1], authenticationMethods: ["credentials"], settleMs: 5000, orgLevels: [{ id: "org", label: { en: "Your organisation" } }, { id: "site", label: { en: "Your site" } }, { id: "team", label: { en: "Your team" } }, { id: "person", label: { en: "You" } }], phones: ["softphone"] };
    expect(validateManifest(manifest)).toEqual([]);
    expect(validateManifest({ ...manifest, timestampAuthority: "provider" })).toEqual([]);
    expect(validateManifest({ ...manifest, timestampAuthority: "host" }).some(v => v.rule === "manifest.timestampAuthority")).toBe(true);
    expect(validateManifest({ ...manifest, timeCheck: true })).toEqual([]);
    for (const timeCheck of [false, "yes", {}, 1]) expect(validateManifest({ ...manifest, timeCheck }).some(v => v.rule === "manifest.timeCheck")).toBe(true);
  });
  it("requires explicit finite scheduling limits when enabled", () => {
    expect(validateProviderTimeCheckPolicy(undefined)).toEqual([]);
    expect(validateProviderTimeCheckPolicy(policy)).toEqual([]);
    for (const patch of [{ intervalMs: 0 }, { timeoutMs: Infinity }, { maxSampleAgeMs: -1 }, { maxRoundTripMs: 4000 }, { timeoutMs: 70000 }, { intervalMs: 0.5 }, { unexpected: true }])
      expect(validateProviderTimeCheckPolicy({ ...policy, ...patch })).not.toEqual([]);
    expect(validateProviderTimeCheckPolicy({ intervalMs: 1000 })).not.toEqual([]);
  });
  it("correlates a timestamped check with the outstanding request and session", () => {
    expect(validateProviderTimeCheckRequest(request)).toEqual([]);
    expect(validateProviderTimeCheckResult(result, request, "session")).toEqual([]);
    for (const patch of [{ requestId: "old" }, { sessionId: "old" }, { clockId: "" }, { providerTime: "2026-09-11T04:00:00" }, { providerTime: "invalid" }, { extra: true }])
      expect(validateProviderTimeCheckResult({ ...result, ...patch }, request, "session")).not.toEqual([]);
    expect(validateProviderTimeCheckResult(result, {}, "session")).not.toEqual([]);
    expect(validateProviderTimeCheckRequest({ requestId: "q", time: "invented" })).not.toEqual([]);
  });
  it("keeps optional host estimates scoped and explicitly unavailable", () => {
    const scope = { providerId: "provider", sessionId: "session" };
    const estimate = { ...scope, at: result.providerTime, clockId: "clock", uncertaintyMs: 50 };
    const method: NonNullable<Host["estimateProviderTime"]> = input => input.providerId === scope.providerId ? estimate : undefined;
    expect(validateProviderTimeEstimate(method(scope), scope)).toEqual([]);
    expect(validateProviderTimeEstimate(undefined, scope)).toEqual([]);
    for (const patch of [{ providerId: "other" }, { sessionId: "old" }, { uncertaintyMs: -1 }, { uncertaintyMs: NaN }, { at: "invalid" }, { guaranteed: true }])
      expect(validateProviderTimeEstimate({ ...estimate, ...patch }, scope)).not.toEqual([]);
    expect(validateProviderTimeEstimate(undefined, {})).not.toEqual([]);
  });
});
