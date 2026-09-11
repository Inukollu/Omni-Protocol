// Runtime validation for the approved protocol.
//
// An adapter is loaded from a separate package and may be compiled against a different protocol
// version, so its output is untrusted input. Every validator here takes `unknown` and returns
// every violation it found rather than throwing on the first, so a caller can report all of them
// at once.
//
// The contract's closed sets are declared as types in index.ts and needed here as runtime lists.
// Each list is pinned to its type both ways -- a member the type lacks, or a member the list
// lacks, fails to compile -- so what the validators accept cannot drift from what the
// declarations say.

import {
  RECORDING_ACTIONS,
  SHIFT_EVENT_KINDS,
  type RecordingState,
  type RecordingAction,
  ALLOWED_BROWSER_URL_SCHEMES,
  BREAK_KINDS,
  BROWSER_ISOLATION_SCHEMES,
  HISTORY_STEPS_THAT_DIAL,
  IDLE_CAPABILITIES,
  OMNI_FAILURE_CODES,
  OMNI_SUPPORTED_PROTOCOL_VERSIONS,
  TASK_COMMAND_NAMES,
  negotiateProtocolVersion,
  type AcceptanceMode,
  type AuthenticationMethod,
  type AuthenticationChallenge,
  type AuthenticationState,
  type BreakStatus,
  type BrowserAccess,
  type HostAudioUnavailableReason,
  type UrlVisibility,
  DEFAULT_LEVELS,
  effectiveLevels,
  type TeamPolicySetting,
  type TaskAudioState,
  type TransportRecovery,
  type HostGuarantees,
  type HostMute,
  type MutedBy,
  type CredentialField,
  type HostOutputUnavailableReason,
  type Channel,
  type CompletionMode,
  type TransportStatus,
  type CustomCapability,
  type DialDestinations,
  type DialOutcome,
  type CapabilitySource,
  type OnCallRole,
  type OnCallStage,
  type PreviewDeadline,
  type Phone,
  type ListeningMode,
  type OutcomeRules,
  type HistoryStep,
  type IdleCapabilities,
  type IdleCapability,
  type PersonalBrowserCapability,
  type ProtocolViolation,
  type ProviderEvent,
  type UserCapabilities,
  type TaskCapabilities,
  type TaskLeadAssist,
  type TaskOutcome,
  type TaskPhase,
  type TeamMemberAvailability,
  type UserId,
} from "./index.js";

export type { ProtocolViolation } from "./index.js";

export class ProtocolConformanceError extends Error {
  readonly violations: readonly ProtocolViolation[];

  constructor(violations: readonly ProtocolViolation[], summary = "Adapter violates the Omni protocol") {
    const detail = violations.map(violation => `  ${violation.rule} at ${violation.path}: ${violation.message}`).join("\n");
    super(`${summary} (${violations.length} violation${violations.length === 1 ? "" : "s"}):\n${detail}`);
    this.name = "ProtocolConformanceError";
    this.violations = violations;
  }
}

/** Throws `ProtocolConformanceError` when any violation is present. */
export function assertNoViolations(violations: readonly ProtocolViolation[], summary?: string): void {
  if (violations.length > 0) throw new ProtocolConformanceError(violations, summary);
}

// ---------------------------------------------------------------------------
// The contract's closed sets, as runtime lists pinned to their types.
// ---------------------------------------------------------------------------

/**
 * Every member of a contract union, as a list.
 *
 * `Record<U, true>` is what makes it complete: a key the union lacks is an excess property and a
 * union member the object lacks is a missing one, so either mistake is a compile error here
 * rather than a validator that quietly accepts or rejects the wrong thing.
 */
const membersOf = <U extends string>(members: Record<U, true>): readonly U[] =>
  Object.keys(members) as U[];

const CHANNELS = membersOf<Channel>({ voice: true, chat: true, email: true });
const TRANSPORT_RECOVERIES = membersOf<TransportRecovery>({ reconnect: true, reauthenticate: true });
const TASK_PHASES = membersOf<TaskPhase>({
  pending: true, confirmed: true, preview: true, "in-progress": true, paused: true, completing: true,
});
const COMPLETION_MODES = membersOf<CompletionMode>({ "agent-command": true, "provider-automatic": true });
const CAPABILITY_SOURCES = membersOf<CapabilitySource>({ queue: true, nobody: true, "not-yet-read": true });
const ACCEPTANCE_MODES = membersOf<AcceptanceMode>({
  "no-preference": true, "consent": true, "automatic": true,
});
const TRANSPORT_STATUSES = membersOf<TransportStatus>({ connecting: true, active: true, error: true });
const AUTHENTICATION_METHODS = membersOf<AuthenticationMethod>({ "browser-sso": true, credentials: true });
const AUTHENTICATION_BROWSERS = membersOf<Extract<AuthenticationChallenge, { method: "browser-sso" }>["browser"]>({ system: true, omni: true });
const AUTHENTICATION_STATUSES = membersOf<AuthenticationState["status"]>({
  "signed-out": true, authenticating: true, authenticated: true, refreshing: true, expired: true,
});
const BREAK_APPROVALS = membersOf<BreakStatus>({
  "not-requested": true, "awaiting-approval": true, granted: true, "starting-after-task": true, "on-break": true,
});
const TEAM_AVAILABILITIES = membersOf<TeamMemberAvailability>({
  ready: true, "on-task": true, "on-break": true, elsewhere: true, "signed-out": true,
});
const HISTORY_STEPS = membersOf<HistoryStep>({
  queued: true, offered: true, answered: true, held: true, muted: true, transferred: true, conferenced: true, unanswered: true,
});
const CUSTOM_UI_CONTROLS = membersOf<CustomCapability["ui"]["control"]>({ button: true, toggle: true, "menu-item": true });
const CUSTOM_UI_PLACEMENTS = membersOf<CustomCapability["ui"]["placement"]>({ primary: true, secondary: true, overflow: true });
const NOTES_RULES = membersOf<NonNullable<OutcomeRules["notes"]>>({ required: true, optional: true, none: true });
const ACCESS_MODES = membersOf<BrowserAccess["mode"]>({ "allow-all": true, "block-all": true });
const ACCESS_APPLIES_TO = membersOf<NonNullable<PersonalBrowserCapability["accessAppliesTo"]>>({
  "initial-url": true, "all-navigation": true,
});
const DIAL_DESTINATION_POLICIES = membersOf<DialDestinations>({ "contacts-only": true, "any-number": true });
const DIAL_OUTCOMES = membersOf<DialOutcome>({ answered: true, busy: true, "no-answer": true, unreachable: true, rejected: true, cancelled: true, unexplained: true });
/** The outcomes that name a cause. `unexplained` is declarable only beside one of these. */
const EXPLAINED_FAILURES: readonly DialOutcome[] = ["busy", "no-answer", "unreachable", "rejected", "cancelled"];
const ON_CALL_ROLES = membersOf<OnCallRole>({ party: true, agent: true, conferenced: true });
const ON_CALL_STAGES = membersOf<OnCallStage>({ ringing: true, joined: true });
/** The task capabilities under which a command dials, and so need the manifest to say how a dial ends. */
const DIALLING_CAPABILITIES = ["connectBack", "conference"] as const;
const SNAPSHOT_REASONS = membersOf<Extract<ProviderEvent, { type: "snapshot" }>["reason"]>({
  reconnected: true, "provider-requested": true,
});
const SESSION_CAPABILITIES = membersOf<keyof UserCapabilities>({ breaks: true, lead: true, preferences: true });
const MEMBER_BREAKS = membersOf<Extract<BreakStatus, "awaiting-approval" | "granted" | "starting-after-task">>({
  "awaiting-approval": true, granted: true, "starting-after-task": true,
});
const OFFERABLE_PHASES = membersOf<Extract<TaskPhase, "pending">>({
  pending: true,
});
const PREVIEW_DEADLINES = membersOf<PreviewDeadline>({ "provider-dials": true, "host-dials": true, waits: true });
const PHONES = membersOf<Phone>({ softphone: true, deskPhone: true });
const LISTENING_MODES = membersOf<ListeningMode>({ listen: true, coach: true, "join-call": true });
const COMPLETED_BY = membersOf<Extract<TaskOutcome, { type: "completed" }>["by"]>({ agent: true, provider: true });
const CANCELLED_BY = membersOf<Extract<TaskOutcome, { type: "cancelled" }>["by"]>({ agent: true, provider: true, party: true });
const EXPIRABLE_PHASES = membersOf<Extract<TaskOutcome, { type: "expired" }>["phase"]>({
  pending: true, confirmed: true, preview: true,
});

const ISOLATION_SCHEME_VALUES: readonly string[] = Object.values(BROWSER_ISOLATION_SCHEMES);

/** The capabilities each channel arm of `TaskCapabilities` declares, keyed off the type itself. */
const TASK_CAPABILITIES: Readonly<Record<Channel, readonly string[]>> = {
  voice: membersOf<keyof TaskCapabilities<"voice">>({
    browsers: true, outcomes: true, custom: true, decline: true, hold: true,
    endCall: true, terminateCall: true, connectBack: true, schedule: true, leadAssist: true, conference: true, recording: true,
  }),
  chat: membersOf<keyof TaskCapabilities<"chat">>({ browsers: true, outcomes: true, custom: true, decline: true, hold: true }),
  email: membersOf<keyof TaskCapabilities<"email">>({ browsers: true, outcomes: true, custom: true, decline: true }),
};

// The published list and the type's keys are the same set, or one of them is wrong.
true satisfies [keyof IdleCapabilities<"voice">] extends [IdleCapability]
  ? ([IdleCapability] extends [keyof IdleCapabilities<"voice">] ? true : false)
  : false;

/** Idle capabilities each channel may declare. Only voice may dial, and runtime has to say so too. */
const IDLE_CAPABILITIES_BY_CHANNEL: Readonly<Record<Channel, readonly string[]>> = {
  voice: IDLE_CAPABILITIES,
  chat: IDLE_CAPABILITIES.filter(name => name !== "dial"),
  email: IDLE_CAPABILITIES.filter(name => name !== "dial"),
};

const isChannel = (value: string): value is Channel => (CHANNELS as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Semantic types. Each is a primitive on the wire with its own validation rule.
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Error text must not invoke conversion methods supplied by an untrusted object or array. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") return Array.isArray(value) ? "an array" : "an object";
  if (typeof value === "function") return "a function";
  return String(value);
}

/**
 * An RFC-3339 timestamp carrying a zone.
 *
 * `Date.parse` accepts a timezone-less string and resolves it against whatever zone the machine
 * happens to be in, so two hosts would read the same wire value as two different instants. The
 * contract calls those invalid, and this is where that is enforced rather than assumed.
 */
const isIsoTimestamp = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // RFC 3339 sections 5.6–5.7: days depend on the month/year and hours are 00–23.
  // Date.parse alone normalizes February 30 and 24:00 into different instants.
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth
    && Number(match[4]) < 24 && !Number.isNaN(Date.parse(value));
};

/** A non-negative integer count of seconds. */
const isDurationSeconds = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Opaque, non-empty, provider-issued. Never parsed and never compared across providers. */
const isUserId = isFilled;
const isAssignmentId = isFilled;

const ruleListeners = new Set<(rule: string) => void>();

/**
 * Hears every rule a validator evaluates, pass or fail, until the returned function is called. A
 * green run can then say which rules it looked at rather than only which subjects it reached: a
 * rule never evaluated is a visible gap, not a pass. The harness registers one for each exercise.
 */
export function observeRules(listener: (rule: string) => void): () => void {
  ruleListeners.add(listener);
  return () => { ruleListeners.delete(listener); };
}

/** Says a rule was evaluated, for code that decides outside a collector: the stream, the drive. */
export function ruleEvaluated(...rules: readonly string[]): void {
  for (const rule of rules) for (const listener of ruleListeners) listener(rule);
}

class Collector {
  readonly violations: ProtocolViolation[] = [];

  add(rule: string, path: string, message: string): void {
    ruleEvaluated(rule);
    this.violations.push({ rule, path, message });
  }

  require(condition: unknown, rule: string, path: string, message: string): boolean {
    ruleEvaluated(rule);
    if (!condition) this.violations.push({ rule, path, message });
    return Boolean(condition);
  }

  filled(value: unknown, rule: string, path: string, message: string): boolean {
    return this.require(isFilled(value), rule, path, message);
  }

  timestamp(value: unknown, rule: string, path: string): boolean {
    return this.require(isIsoTimestamp(value), rule, path,
      "must be an RFC-3339 timestamp carrying a zone, such as 2026-08-21T09:00:00Z");
  }

  oneOf(value: unknown, allowed: readonly string[], rule: string, path: string): boolean {
    return this.require(typeof value === "string" && allowed.includes(value), rule, path,
      `must be one of ${allowed.join(", ")}; received ${describeValue(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Shared shapes.
// ---------------------------------------------------------------------------

function validateAttributes(value: unknown, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    into.add("attributes.shape", path, "attributes must be an array when present");
    return;
  }
  value.forEach((attribute: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(attribute)) {
      into.add("attribute.shape", at, "each attribute must be an object");
      return;
    }
    into.filled(attribute.key, "attribute.key", `${at}.key`, "an attribute needs a non-empty key");
    into.require(typeof attribute.value === "string", "attribute.value", `${at}.value`, "an attribute value must be a string");
  });
}

/** Every field is optional, so this checks what is present rather than what is missing. */
export function validateContact(contact: unknown, path = "contact"): ProtocolViolation[] {
  const into = new Collector();
  validateContactInto(contact, path, into);
  return into.violations;
}

function validateContactInto(contact: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(contact)) {
    into.add("contact.shape", path, "a contact must be an object");
    return;
  }
  for (const field of ["name", "number", "email"] as const) {
    if (contact[field] === undefined) continue;
    if ((field === "number" || field === "email") && isLocked(contact[field])) {
      validateLockedInto(contact[field] as Record<string, unknown>, `contact.${field}.locked`, `${path}.${field}`, levels, into);
      continue;
    }
    into.filled(contact[field], `contact.${field}`, `${path}.${field}`, `${field} must not be empty when present`);
  }
  validateAttributes(contact.attributes, `${path}.attributes`, into);
}

export function validateScheduledActivity(activity: unknown, path = "scheduledActivity"): ProtocolViolation[] {
  const into = new Collector();
  validateScheduledActivityInto(activity, path, into);
  return into.violations;
}

function validateScheduledActivityInto(activity: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(activity)) {
    into.add("activity.shape", path, "a scheduled activity must be an object");
    return;
  }
  into.filled(activity.id, "activity.id", `${path}.id`, "a scheduled activity needs an id");
  into.filled(activity.title, "activity.title", `${path}.title`, "a scheduled activity needs a title");
  const startValid = into.timestamp(activity.startsAt, "activity.startsAt", `${path}.startsAt`);
  if (activity.endsAt !== undefined) {
    const endValid = into.timestamp(activity.endsAt, "activity.endsAt", `${path}.endsAt`);
    if (startValid && endValid) {
      into.require(
        Date.parse(activity.endsAt as string) >= Date.parse(activity.startsAt as string),
        "activity.endsAt.order", `${path}.endsAt`, "endsAt must not precede startsAt",
      );
    }
  }
  if (activity.party !== undefined) validateContactInto(activity.party, `${path}.party`, into, levels);
  validateAttributes(activity.attributes, `${path}.attributes`, into);
}

// ---------------------------------------------------------------------------
// Manifest.
// ---------------------------------------------------------------------------

function validateBrowserAccess(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("manifest.personalBrowser.access.shape", path, "an access policy must be an object");
    return;
  }
  into.oneOf(value.mode, ACCESS_MODES, "manifest.personalBrowser.access.mode", `${path}.mode`);
  for (const list of ["allowList", "blockList"] as const) {
    if (value[list] === undefined) continue;
    if (!Array.isArray(value[list])) {
      into.add("manifest.personalBrowser.access.list", `${path}.${list}`, `${list} must be an array when present`);
      continue;
    }
    (value[list] as unknown[]).forEach((entry, index) => {
      into.filled(entry, "manifest.personalBrowser.access.host", `${path}.${list}[${index}]`, "a host pattern must not be empty");
    });
  }
}

function validateIdleCapabilities(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    into.add("manifest.idleCapabilities.shape", path, "idleCapabilities must be an object when present");
    return;
  }
  const allowed = isChannel(channel) ? IDLE_CAPABILITIES_BY_CHANNEL[channel] : IDLE_CAPABILITIES_BY_CHANNEL.voice;
  for (const [name, declared] of Object.entries(value)) {
    if (declared === undefined) continue;
    // Only voice may dial, and the channel arms are what make that a compile error. Runtime
    // has to say the same thing, or an adapter compiled against a looser version slips through.
    into.require(allowed.includes(name), "manifest.idleCapability.channel", `${path}.${name}`,
      `${channel} providers may not declare ${name}`);
  }
  if (value.personalBrowser !== undefined) {
    const browser = value.personalBrowser;
    if (!isPlainObject(browser)) {
      into.add("manifest.personalBrowser.shape", `${path}.personalBrowser`, "personalBrowser must be an object when present");
    } else {
      validateBrowserAccess(browser.access, `${path}.personalBrowser.access`, into);
      // Stated, never defaulted: an absent value read as all-navigation was a second spelling of one fact.
      into.oneOf(browser.accessAppliesTo, ACCESS_APPLIES_TO,
        "manifest.personalBrowser.accessAppliesTo", `${path}.personalBrowser.accessAppliesTo`);
    }
  }
  if (value.dial !== undefined) {
    if (!isPlainObject(value.dial)) {
      into.add("manifest.dial.shape", `${path}.dial`, "dial must be an object when present");
    } else {
      into.oneOf(value.dial.destinations, DIAL_DESTINATION_POLICIES,
        "manifest.dial.destinations", `${path}.dial.destinations`);
    }
  }
  for (const flag of ["calendar", "contacts"] as const) {
    if (value[flag] !== undefined) {
      into.require(value[flag] === true, `manifest.idleCapability.value`, `${path}.${flag}`,
        `${flag} is declared by presence: send true or omit it`);
    }
  }
}

/**
 * A provider that dials says how a dial can end, both ways: `answered`, or the desk cannot tell
 * reached from still ringing, and at least one way of not reaching, or it can never say failed.
 * Off voice nothing dials, and the idle dialpad is a dial, so declaring it is declaring this.
 */
function validateDialOutcomes(manifest: Record<string, unknown>, path: string, into: Collector): void {
  const declared = manifest.dialOutcomes;
  const dials = isPlainObject(manifest.idleCapabilities) && manifest.idleCapabilities.dial !== undefined;
  if (declared === undefined) {
    into.require(!dials, "manifest.dialOutcomes.required", path,
      "a manifest that declares dial says how a dial ends: dialOutcomes with answered and at least one way of not reaching");
    return;
  }
  if (!into.require(manifest.channel === "voice", "manifest.dialOutcomes.channel", path,
    `a ${describeValue(manifest.channel)} provider dials nothing and declares no dial outcomes`)) return;
  if (!Array.isArray(declared) || declared.length === 0) {
    into.add("manifest.dialOutcomes.shape", path, "dialOutcomes is a non-empty array of the outcomes the platform distinguishes");
    return;
  }
  declared.forEach((outcome: unknown, index: number) => {
    if (into.oneOf(outcome, DIAL_OUTCOMES, "manifest.dialOutcome", `${path}[${index}]`) && declared.indexOf(outcome) !== index) {
      into.add("manifest.dialOutcome.unique", `${path}[${index}]`, `duplicate dial outcome: ${describeValue(outcome)}`);
    }
  });
  into.require(declared.includes("answered"), "manifest.dialOutcomes.answered", path,
    "a dial that reached its destination is stated, never inferred: dialOutcomes includes answered");
  into.require(declared.some((outcome: unknown) => outcome !== "answered"), "manifest.dialOutcomes.failure", path,
    "a provider that can only say answered can never say a destination was not reached: declare at least one other outcome");
  // "The switch gave no cause" is honest only from a provider that reports the cause when there is
  // one; declared alone it is the generic failure every unsure provider would send.
  if (declared.includes("unexplained")) {
    into.require(declared.some((outcome: unknown) => (EXPLAINED_FAILURES as readonly unknown[]).includes(outcome)),
      "manifest.dialOutcomes.unexplained.alone", path,
      "unexplained says the switch gave no cause, which is a claim only a provider that reports causes can make: declare at least one of busy, no-answer, unreachable, rejected, cancelled beside it");
  }
}

/**
 * A voice platform says which phones it can put an agent on -- a softphone in the host, a desk
 * phone it rings -- and nothing off voice does, since there is no call to hear.
 */
function validatePhones(manifest: Record<string, unknown>, path: string, into: Collector): void {
  const declared = manifest.phones;
  if (manifest.channel !== "voice") {
    into.require(declared === undefined, "manifest.phones.channel", path, `a ${describeValue(manifest.channel)} provider has no call to hear and declares no phones`);
    return;
  }
  if (!Array.isArray(declared) || declared.length === 0) {
    into.add("manifest.phones.required", path, "a voice manifest lists the phones its platform can put an agent on: softphone, deskPhone, or both");
    return;
  }
  declared.forEach((phone: unknown, index: number) => {
    if (into.oneOf(phone, PHONES, "manifest.phone", `${path}[${index}]`) && declared.indexOf(phone) !== index) {
      into.add("manifest.phone.unique", `${path}[${index}]`, `duplicate phone: ${describeValue(phone)}`);
    }
  });
}

/**
 * The host's choice of phone for a login, held to the manifest: one the platform listed, required
 * on voice, absent elsewhere.
 */
export function validatePhone(value: unknown, manifest: unknown, path = "context.phone"): ProtocolViolation[] {
  const into = new Collector();
  const channel = isPlainObject(manifest) ? manifest.channel : undefined;
  const phones = isPlainObject(manifest) && Array.isArray(manifest.phones) ? manifest.phones : [];
  if (channel !== "voice") {
    into.require(value === undefined, "context.phone.unexpected", path, `a ${describeValue(channel)} login has no call to hear and chooses no phone`);
    return into.violations;
  }
  if (!into.require(value !== undefined, "context.phone.required", path, "a voice login says how the agent hears the call: one of the manifest's phones")) return into.violations;
  if (into.oneOf(value, PHONES, "context.phone", path)) {
    into.require(phones.includes(value), "context.phone.unsupported", path,
      `the host chose ${describeValue(value)} and the manifest lists ${phones.length === 0 ? "no phones" : phones.map(describeValue).join(", ")}`);
  }
  return into.violations;
}

/** Whether a manifest says how a dial ends, and so may publish tasks that dial. `undefined` where there is no manifest to ask. */
function manifestDials(manifest: unknown): boolean | undefined {
  return isPlainObject(manifest) ? Array.isArray(manifest.dialOutcomes) : undefined;
}

/** Undefined explicitly means unavailable; a returned estimate is not a clock guarantee. */
export function validateProviderTimeEstimate(value: unknown, scope: unknown, path = "estimate"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(scope)) { into.add("timeEstimate.scope", path, "provider/login scope is required"); return into.violations; }
  for (const key of ["providerId", "loginId"]) into.filled(scope[key], "timeEstimate.scope", `scope.${key}`, "explicit provider/login scope is required");
  if (value === undefined) return into.violations;
  if (!isPlainObject(value)) { into.add("timeEstimate.shape", path, "expected a provider time estimate or undefined"); return into.violations; }
  for (const key of ["providerId", "loginId"]) into.require(value[key] === scope[key], "timeEstimate.scope", `${path}.${key}`, "estimate must match the requested provider/login");
  into.timestamp(value.at, "timeEstimate.at", `${path}.at`);
  into.filled(value.clockId, "timeEstimate.clock", `${path}.clockId`, "estimate must identify its clock domain");
  if (value.uncertaintyMs !== undefined) into.require(typeof value.uncertaintyMs === "number" && Number.isFinite(value.uncertaintyMs) && value.uncertaintyMs >= 0,
    "timeEstimate.uncertainty", `${path}.uncertaintyMs`, "estimated uncertainty must be finite and nonnegative");
  for (const key of Object.keys(value)) into.require(["providerId", "loginId", "at", "clockId", "uncertaintyMs"].includes(key), "timeEstimate.field", `${path}.${key}`, "unsupported estimate field");
  return into.violations;
}

/** Validate host-local periodic clock-check configuration. Omission disables checking. */
export function validateProviderTimeCheckPolicy(value: unknown, path = "timeCheck"): ProtocolViolation[] {
  const into = new Collector();
  if (value === undefined) return into.violations;
  if (!isPlainObject(value)) { into.add("timeCheck.policy.shape", path, "expected an explicit clock-check policy"); return into.violations; }
  for (const field of ["intervalMs", "timeoutMs", "maxRoundTripMs", "maxSampleAgeMs"]) {
    into.require(typeof value[field] === "number" && Number.isSafeInteger(value[field]) && (value[field] as number) > 0,
      "timeCheck.policy.duration", `${path}.${field}`, "expected positive safe integer milliseconds");
  }
  for (const key of Object.keys(value)) into.require(["intervalMs", "timeoutMs", "maxRoundTripMs", "maxSampleAgeMs"].includes(key), "timeCheck.policy.field", `${path}.${key}`, "unsupported policy field");
  if (!into.violations.length) into.require((value.maxRoundTripMs as number) <= (value.timeoutMs as number) && (value.timeoutMs as number) <= (value.intervalMs as number),
    "timeCheck.policy.order", path, "maxRoundTripMs <= timeoutMs <= intervalMs is required");
  return into.violations;
}

export function validateProviderTimeCheckRequest(value: unknown, path = "request"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(value)) { into.add("timeCheck.request.shape", path, "expected a clock-check request"); return into.violations; }
  into.filled(value.requestId, "timeCheck.request.id", `${path}.requestId`, "a check needs a fresh request ID");
  for (const key of Object.keys(value)) into.require(key === "requestId", "timeCheck.request.field", `${path}.${key}`, "unsupported request field");
  return into.violations;
}

/** Checks response shape/correlation, not source-clock accuracy, round-trip delay or freshness. */
export function validateProviderTimeCheckResult(value: unknown, request: unknown, loginId: string, path = "result"): ProtocolViolation[] {
  const into = new Collector();
  into.violations.push(...validateProviderTimeCheckRequest(request));
  into.filled(loginId, "timeCheck.login", "loginId", "current authenticated login is required");
  if (!isPlainObject(value)) { into.add("timeCheck.result.shape", path, "expected a clock-check response"); return into.violations; }
  into.filled(value.requestId, "timeCheck.result.id", `${path}.requestId`, "response must identify its request");
  into.require(isPlainObject(request) && value.requestId === request.requestId, "timeCheck.result.request", `${path}.requestId`, "response must match the outstanding check");
  into.require(value.loginId === loginId, "timeCheck.result.login", `${path}.loginId`, "response belongs to the current login");
  into.filled(value.clockId, "timeCheck.result.clock", `${path}.clockId`, "provider clock domain/incarnation is required");
  into.timestamp(value.providerTime, "timeCheck.result.time", `${path}.providerTime`);
  for (const key of Object.keys(value)) into.require(["requestId", "loginId", "clockId", "providerTime"].includes(key), "timeCheck.result.field", `${path}.${key}`, "unsupported response field");
  return into.violations;
}

export function validateManifest(manifest: unknown, path = "manifest"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(manifest)) {
    into.add("manifest.shape", path, "a manifest must be an object");
    return into.violations;
  }
  into.filled(manifest.id, "manifest.id", `${path}.id`, "a manifest needs a stable id");
  into.filled(manifest.displayName, "manifest.displayName", `${path}.displayName`, "a manifest needs a display name");
  const channelValid = into.oneOf(manifest.channel, CHANNELS, "manifest.channel", `${path}.channel`);

  const versions = manifest.supportedProtocolVersions;
  if (!Array.isArray(versions) || versions.length === 0) {
    into.add("manifest.supportedProtocolVersions", `${path}.supportedProtocolVersions`,
      "an adapter must declare every protocol version it can speak");
  } else {
    versions.forEach((version, index) => {
      into.require(typeof version === "number" && Number.isInteger(version) && version > 0,
        "manifest.supportedProtocolVersions.value", `${path}.supportedProtocolVersions[${index}]`,
        "a protocol version must be a positive integer");
    });
    // Interoperability: the adapter must speak a version this package does, or Omni must refuse
    // to connect. Reported here so it is found with the manifest rather than at connect time.
    const declared = versions.filter((version): version is number => typeof version === "number");
    into.require(negotiateProtocolVersion(declared) !== undefined,
      "manifest.supportedProtocolVersions.interoperable", `${path}.supportedProtocolVersions`,
      `this host speaks protocol version${OMNI_SUPPORTED_PROTOCOL_VERSIONS.length === 1 ? "" : "s"} ${OMNI_SUPPORTED_PROTOCOL_VERSIONS.join(", ")}; the adapter declares none of them`);
  }

  const methods = manifest.authenticationMethods;
  if (!Array.isArray(methods) || methods.length === 0) {
    into.add("manifest.authenticationMethods", `${path}.authenticationMethods`,
      "an adapter must declare at least one authentication method");
  } else {
    methods.forEach((method, index) => {
      if (into.oneOf(method, AUTHENTICATION_METHODS, "manifest.authenticationMethod",
        `${path}.authenticationMethods[${index}]`) && methods.indexOf(method) !== index) {
        into.add("manifest.authenticationMethod.unique", `${path}.authenticationMethods[${index}]`,
          `duplicate authentication method: ${describeValue(method)}`);
      }
    });
  }

  if (channelValid) validateIdleCapabilities(manifest.idleCapabilities, manifest.channel as string, `${path}.idleCapabilities`, into);
  if (manifest.timestampAuthority !== undefined) into.require(manifest.timestampAuthority === "provider", "manifest.timestampAuthority", `${path}.timestampAuthority`, "provider timestamp authority must be explicit; omission makes no trust promise");
  if (manifest.timeCheck !== undefined) into.require(manifest.timeCheck === true, "manifest.timeCheck", `${path}.timeCheck`, "declare true or omit unsupported clock checks");
  validateDialOutcomes(manifest, `${path}.dialOutcomes`, into);
  validatePhones(manifest, `${path}.phones`, into);

  if (manifest.phaseLabels !== undefined) {
    if (!isPlainObject(manifest.phaseLabels)) {
      into.add("manifest.phaseLabels.shape", `${path}.phaseLabels`, "phaseLabels must be an object when present");
    } else {
      for (const [phase, label] of Object.entries(manifest.phaseLabels)) {
        into.oneOf(phase, TASK_PHASES, "manifest.phaseLabels.phase", `${path}.phaseLabels.${phase}`);
        into.filled(label, "manifest.phaseLabels.label", `${path}.phaseLabels.${phase}`, "a phase label must not be empty");
      }
    }
  }

  if (manifest.runningStepReports !== undefined) {
    into.require(manifest.runningStepReports === true, "manifest.runningStepReports", `${path}.runningStepReports`,
      "runningStepReports is declared by presence, as true; a provider that takes begin and end only omits it");
  }
  into.require(!Object.hasOwn(manifest, "disposalSettleMs"), "manifest.completionSettleMs.renamed", `${path}.disposalSettleMs`,
    "use completionSettleMs; the former field is not accepted");
  into.require(typeof manifest.completionSettleMs === "number" && Number.isInteger(manifest.completionSettleMs) && manifest.completionSettleMs > 0,
    "manifest.completionSettleMs", `${path}.completionSettleMs`,
    "completionSettleMs is how long after an applied completion the task-ended is owed, a positive whole number of milliseconds, stated by every provider");
  if (manifest.orgLevels !== undefined) {
    if (!Array.isArray(manifest.orgLevels)) {
      into.add("manifest.orgLevels.shape", `${path}.orgLevels`, "orgLevels must be an array when present");
    } else {
      const ids = new Set<string>();
      let wellFormed = true;
      manifest.orgLevels.forEach((level: unknown, index: number) => {
        const at = `${path}.orgLevels[${index}]`;
        if (!isPlainObject(level)) {
          into.add("manifest.orgLevel.shape", at, "each level must be an object with an id and a label");
          wellFormed = false;
          return;
        }
        if (into.filled(level.id, "manifest.orgLevel.id", `${at}.id`, "a level needs an id")) {
          if (ids.has(level.id as string)) {
            into.add("manifest.orgLevel.unique", `${at}.id`, `duplicate level: ${level.id}`);
            wellFormed = false;
          }
          ids.add(level.id as string);
        } else wellFormed = false;
        if (!into.filled(level.label, "manifest.orgLevel.label", `${at}.label`, "a level needs the label a desk shows for it")) wellFormed = false;
      });
      if (wellFormed && !ids.has("person")) {
        into.add("manifest.orgLevels.person", `${path}.orgLevels`,
          "a declared ladder states the whole ladder and must include person, the subject of every resolution");
      }
    }
  }

  if (manifest.taskTypePresentation !== undefined) {
    if (!isPlainObject(manifest.taskTypePresentation)) {
      into.add("manifest.taskTypePresentation.shape", `${path}.taskTypePresentation`,
        "taskTypePresentation must be an object when present");
    } else {
      for (const [taskType, presentation] of Object.entries(manifest.taskTypePresentation)) {
        const at = `${path}.taskTypePresentation.${taskType}`;
        if (!isPlainObject(presentation)) {
          into.add("manifest.taskTypePresentation.entry", at, "each presentation must be an object");
          continue;
        }
        into.filled(presentation.singular, "manifest.taskTypePresentation.singular", `${at}.singular`, "a presentation needs a singular name");
        into.filled(presentation.plural, "manifest.taskTypePresentation.plural", `${at}.plural`, "a presentation needs a plural name");
        if (presentation.referenceLabel !== undefined) {
          into.filled(presentation.referenceLabel, "manifest.taskTypePresentation.referenceLabel", `${at}.referenceLabel`,
            "referenceLabel must not be empty when present");
        }
      }
    }
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Task.
// ---------------------------------------------------------------------------

function validateDestinationDirectory(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("task.destinations.shape", path, "a conference control carries the directory it offers: { destinations: [...] }");
    return;
  }
  if (!Array.isArray(value.destinations)) {
    into.add("task.destinations.list", `${path}.destinations`, "destinations must be an array");
    return;
  }
  // Nothing is typed, so a directory with nothing in it is a control with nothing to offer.
  if (value.destinations.length === 0) {
    into.add("task.destinations.offer", path, "a directory offers at least one item; with none, omit the capability");
  }
  const seen = new Set<string>();
  value.destinations.forEach((destination: unknown, index: number) => {
    const at = `${path}.destinations[${index}]`;
    if (!isPlainObject(destination)) {
      into.add("task.destination.shape", at, "each destination must be an object");
      return;
    }
    if (into.filled(destination.id, "task.destination.id", `${at}.id`, "a destination needs an id")) {
      if (seen.has(destination.id as string)) into.add("task.destination.unique", `${at}.id`, `duplicate destination id: ${destination.id}`);
      seen.add(destination.id as string);
    }
    into.filled(destination.label, "task.destination.label", `${at}.label`, "a destination needs a label");
  });
}

function validateOutcomes(value: unknown, path: string, into: Collector): void {
  if (value === true) return;
  if (!isPlainObject(value)) {
    into.add("task.outcomes.shape", path, "must be true or an outcome policy");
    return;
  }
  if (value.required !== undefined) {
    into.require(typeof value.required === "boolean", "task.outcomes.required", `${path}.required`,
      "required must be a boolean when present");
  }
  // A code must be collected before completion, so there must be one to collect.
  if (value.required === true && !(Array.isArray(value.codes) && value.codes.length > 0)) {
    into.add("task.outcomes.required.codes", `${path}.codes`, "a required outcome policy must publish at least one code");
  }
  if (value.notes !== undefined) into.oneOf(value.notes, NOTES_RULES, "task.outcomes.notes", `${path}.notes`);
  if (value.codes === undefined) return;
  if (!Array.isArray(value.codes)) {
    into.add("task.outcomes.codes", `${path}.codes`, "codes must be an array when present");
    return;
  }
  const seen = new Set<string>();
  value.codes.forEach((code: unknown, index: number) => {
    const at = `${path}.codes[${index}]`;
    if (!isPlainObject(code)) {
      into.add("task.outcome.shape", at, "each outcome code must be an object");
      return;
    }
    if (into.filled(code.id, "task.outcome.id", `${at}.id`, "an outcome code needs an id")) {
      if (seen.has(code.id as string)) into.add("task.outcome.unique", `${at}.id`, `duplicate outcome code: ${code.id}`);
      seen.add(code.id as string);
    }
    into.filled(code.label, "task.outcome.label", `${at}.label`, "an outcome code needs a label");
  });
}

function validateCustomCapabilities(value: unknown, path: string, into: Collector): void {
  if (!Array.isArray(value)) {
    into.add("task.custom.shape", path, "custom must be an array when present");
    return;
  }
  const seen = new Set<string>();
  value.forEach((custom: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(custom)) {
      into.add("task.custom.entry", at, "each custom capability must be an object");
      return;
    }
    if (into.filled(custom.id, "task.custom.id", `${at}.id`, "a custom capability needs an id")) {
      if (seen.has(custom.id as string)) into.add("task.custom.unique", `${at}.id`, `duplicate custom capability: ${custom.id}`);
      seen.add(custom.id as string);
    }
    if (!isPlainObject(custom.ui)) {
      into.add("task.custom.ui", `${at}.ui`, "a custom capability needs a ui description");
      return;
    }
    into.oneOf(custom.ui.control, CUSTOM_UI_CONTROLS, "task.custom.ui.control", `${at}.ui.control`);
    into.filled(custom.ui.label, "task.custom.ui.label", `${at}.ui.label`, "a custom control needs a label");
    into.oneOf(custom.ui.placement, CUSTOM_UI_PLACEMENTS, "task.custom.ui.placement", `${at}.ui.placement`);
    into.oneOf(custom.ui.render, CUSTOM_RENDERS, "task.custom.ui.render", `${at}.ui.render`);
    if (custom.prompt !== undefined) {
      if (!isPlainObject(custom.prompt) || !Array.isArray(custom.prompt.fields)) {
        into.add("task.custom.prompt.shape", `${at}.prompt`, "a prompt is an object with the fields the agent fills");
      } else {
        into.require(custom.prompt.fields.length > 0, "task.custom.prompt.fields", `${at}.prompt.fields`, "a prompt with no fields asks for nothing; omit it");
        custom.prompt.fields.forEach((field: unknown, fieldIndex: number) => {
          const where = `${at}.prompt.fields[${fieldIndex}]`;
          if (!isPlainObject(field)) {
            into.add("task.custom.prompt.field.shape", where, "each prompt field must be an object");
            return;
          }
          into.filled(field.name, "task.custom.prompt.field.name", `${where}.name`, "a prompt field needs a name");
          into.filled(field.label, "task.custom.prompt.field.label", `${where}.label`, "a prompt field needs a label");
          into.oneOf(field.type, CREDENTIAL_FIELD_TYPES, "task.custom.prompt.field.type", `${where}.type`);
          if (field.required !== undefined) into.require(typeof field.required === "boolean", "task.custom.prompt.field.required", `${where}.required`, "required must be a boolean when present");
          if (field.autocomplete !== undefined) into.require(typeof field.autocomplete === "string", "task.custom.prompt.field.autocomplete", `${where}.autocomplete`, "autocomplete must be a string when present");
        });
      }
    }
  });
}

const DEFAULT_LEVEL_IDS: readonly string[] = DEFAULT_LEVELS.map(level => level.id);
const POLICY_SETTINGS = membersOf<TeamPolicySetting>({ on: true, off: true, person: true });
const POLICY_KEYS = new Set<string>([
  ...TASK_CAPABILITIES.voice, ...TASK_CAPABILITIES.chat, ...TASK_CAPABILITIES.email, "dial",
].filter(name => name !== "browsers" && name !== "outcomes" && name !== "custom"));
const PERSON_SETTABLE = /^(hold|skill:.+)$/;
const isLocked = (value: unknown): value is Record<string, unknown> => isPlainObject(value) && value.lockedBy !== undefined;

/** The level ids in force: the manifest's, or the defaults when the caller holds no manifest. */
const levelIds = (levels: readonly string[] | undefined): readonly string[] => levels ?? DEFAULT_LEVEL_IDS;

/**
 * What the queue locks is locked on the whole task. Given the locked values, every other field an
 * agent reads -- the title, the reference, an attribute, a custom control's label, a browser URL the
 * desk shows -- is held to carrying none of them. A number is compared by its digits, so no
 * formatting hides it; anything else by its text, case aside.
 */
function validateNothingLeaksInto(task: Record<string, unknown>, locked: readonly string[], path: string, into: Collector): void {
  ruleEvaluated("task.locked.leak");
  const carries = (text: unknown, value: string): boolean => {
    if (typeof text !== "string") return false;
    const digits = value.replace(/[\s+().-]/g, "");
    if (/^\d+$/.test(digits)) return text.replace(/\D/g, "").includes(digits);
    return text.toLowerCase().includes(value.trim().toLowerCase());
  };
  const hold = (text: unknown, at: string) => {
    for (const value of locked) {
      if (carries(text, value)) into.add("task.locked.leak", at, "carries a value the queue locked: what the queue locks is locked on the whole task, and appears nowhere the agent reads");
    }
  };
  hold(task.title, `${path}.title`);
  hold(task.reference, `${path}.reference`);
  if (Array.isArray(task.attributes)) {
    task.attributes.forEach((attribute, index) => {
      if (!isPlainObject(attribute)) return;
      hold(attribute.label, `${path}.attributes[${index}].label`);
      hold(attribute.value, `${path}.attributes[${index}].value`);
      if (isPlainObject(attribute.party)) {
        hold(attribute.party.number, `${path}.attributes[${index}].party.number`);
        hold(attribute.party.email, `${path}.attributes[${index}].party.email`);
      }
    });
  }
  const custom = isPlainObject(task.capabilities) ? task.capabilities.custom : undefined;
  if (Array.isArray(custom)) custom.forEach((control, index) => { if (isPlainObject(control)) hold(control.label, `${path}.capabilities.custom[${index}].label`); });
  if (Array.isArray(task.browsers)) {
    task.browsers.forEach((browser, index) => {
      if (isPlainObject(browser) && browser.urlVisibility !== "hidden") hold(browser.url, `${path}.browsers[${index}].url`);
    });
  }
}

/** `lockedBy`: a declared level other than `person`, who never locks their own value. */
function validateLockedByInto(value: unknown, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  if (!into.filled(value, rule, path, "lockedBy names the level that locked it")) return;
  into.require(value !== "person", `${rule}.person`, path, "a person never locks their own value");
  into.require(levelIds(levels).includes(value as string), `${rule}.unknown`, path,
    `${describeValue(value)} is not a level this manifest declares: in force are ${levelIds(levels).join(", ")}`);
}

/** `{ lockedBy, reason? }` standing in for a value: who locked it, and a reason if given. */
function validateLockedInto(value: Record<string, unknown>, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  validateLockedByInto(value.lockedBy, `${rule}.lockedBy`, `${path}.lockedBy`, levels, into);
  if (value.reason !== undefined) into.filled(value.reason, `${rule}.reason`, `${path}.reason`, "a reason must not be empty when present");
}

/** What every resolved value carries: who set it, and who locked it if anyone. */
function validateResolvedInto(value: Record<string, unknown>, rule: string, path: string, levels: readonly string[] | undefined, into: Collector): void {
  if (into.filled(value.setBy, `${rule}.setBy`, `${path}.setBy`, "setBy names who stated the value: a level, or provider")) {
    into.require(value.setBy === "provider" || levelIds(levels).includes(value.setBy as string), `${rule}.setBy.unknown`, `${path}.setBy`,
      `${describeValue(value.setBy)} is neither provider nor a level this manifest declares`);
  }
  if (value.lockedBy !== undefined) validateLockedByInto(value.lockedBy, `${rule}.lockedBy`, `${path}.lockedBy`, levels, into);
  if (value.reason !== undefined) {
    into.filled(value.reason, `${rule}.reason`, `${path}.reason`, "a reason must not be empty when present");
    into.require(value.lockedBy !== undefined, `${rule}.reason.unexpected`, `${path}.reason`, "a reason goes with lockedBy: it says why it was locked");
  }
}

/** The level ids a manifest puts in force, for validators that receive one. */
function manifestLevels(manifest: unknown): readonly string[] | undefined {
  if (!isPlainObject(manifest)) return undefined;
  const declared = Array.isArray(manifest.orgLevels)
    ? manifest.orgLevels.filter((level: unknown): level is { id: string; label: string } => isPlainObject(level) && typeof level.id === "string")
    : undefined;
  return effectiveLevels(declared).map(level => level.id);
}
const CUSTOM_RENDERS = membersOf<NonNullable<CustomCapability["ui"]["render"]>>({ inline: true, page: true });
const CREDENTIAL_FIELD_TYPES = membersOf<CredentialField["type"]>({ text: true, password: true });

function validateBrowsers(value: unknown, path: string, into: Collector): void {
  if (!Array.isArray(value)) {
    into.add("task.browsers.shape", path, "browsers must be an array");
    return;
  }
  const seen = new Set<string>();
  const names = new Set<string>();
  value.forEach((browser: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(browser)) {
      into.add("task.browser.shape", at, "each browser must be an object");
      return;
    }
    if (into.filled(browser.id, "task.browser.id", `${at}.id`, "a browser needs an id")) {
      if (seen.has(browser.id as string)) into.add("task.browser.unique", `${at}.id`, `duplicate browser id: ${browser.id}`);
      seen.add(browser.id as string);
    }
    // The name is an input to a `TAB_NAME` isolation scheme: two tabs with one name would
    // silently share a session.
    if (into.filled(browser.name, "task.browser.name", `${at}.name`, "a browser needs a name")) {
      if (names.has(browser.name as string)) into.add("task.browser.name.unique", `${at}.name`, `duplicate browser name: ${browser.name}`);
      names.add(browser.name as string);
    }
    into.filled(browser.purpose, "task.browser.purpose", `${at}.purpose`, "a browser needs a purpose");
    if (browser.urlVisibility !== undefined) {
      into.oneOf(browser.urlVisibility, URL_VISIBILITIES, "task.browser.urlVisibility", `${at}.urlVisibility`);
    }

    if (into.filled(browser.url, "task.browser.url", `${at}.url`, "a browser needs a url")) {
      let scheme: string | undefined;
      try { scheme = new URL(browser.url as string).protocol; } catch { scheme = undefined; }
      into.require(scheme !== undefined && ALLOWED_BROWSER_URL_SCHEMES.includes(scheme as "http:" | "https:"),
        "task.browser.url.scheme", `${at}.url`,
        `a browser url must use ${ALLOWED_BROWSER_URL_SCHEMES.join(" or ")}`);
    }

    // Reuse and its scheme travel together. A reusing browser with no scheme would otherwise
    // inherit whatever a host happened to default to, which is how two tasks end up sharing a
    // session nobody intended. The guide names the rule for the missing case.
    if (browser.sharedSession === true) {
      if (browser.isolationScheme === undefined) {
        into.add("task.browser.isolationScheme.required", `${at}.isolationScheme`,
          `a reusing browser must declare one of: ${ISOLATION_SCHEME_VALUES.join(", ")}`);
      } else {
        into.require(ISOLATION_SCHEME_VALUES.includes(browser.isolationScheme as string),
          "task.browser.isolationScheme", `${at}.isolationScheme`,
          `an isolation scheme must be one of: ${ISOLATION_SCHEME_VALUES.join(", ")}`);
      }
    } else if (browser.sharedSession === false) {
      into.require(browser.isolationScheme === undefined, "task.browser.isolationScheme.unexpected",
        `${at}.isolationScheme`, "a browser that does not share its session must not declare an isolation scheme");
    } else {
      into.add("task.browser.sharedSession", `${at}.sharedSession`, "a browser must say whether its session is shared across tasks");
    }
  });
}

function validateTaskAttributes(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    into.add("task.attributes.shape", path, "attributes must be an array when present");
    return;
  }
  const keys = new Set<string>();
  value.forEach((attribute: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(attribute)) {
      into.add("task.attribute.shape", at, "each task attribute must be an object");
      return;
    }
    if (into.filled(attribute.key, "task.attribute.key", `${at}.key`, "a task attribute needs a key")) {
      if (keys.has(attribute.key as string)) into.add("task.attribute.unique", `${at}.key`, `duplicate attribute key: ${attribute.key}`);
      keys.add(attribute.key as string);
    }
    if (attribute.label !== undefined) {
      into.filled(attribute.label, "task.attribute.label", `${at}.label`, "a label must not be empty when present");
    }
    switch (attribute.type) {
      case "text":
        into.require(typeof attribute.value === "string", "task.attribute.text", `${at}.value`, "a text attribute needs a string value");
        break;
      case "contact":
        validateContactInto(attribute.party, `${at}.party`, into, levels);
        break;
      case "timestamp":
        into.timestamp(attribute.at, "task.attribute.timestamp", `${at}.at`);
        break;
      default:
        into.add("task.attribute.type", `${at}.type`, `unsupported attribute type: ${describeValue(attribute.type)}`);
    }
  });
}

function validateHistory(value: unknown, path: string, into: Collector, task: { phase?: unknown; audio?: unknown } = {}): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    into.add("task.history.shape", path, "history must be an object with its steps when present");
    return;
  }
  // What the record adds up to before this agent: each total present when the provider knows it
  // and absent when it does not, never a plausible nought.
  into.require(!Object.hasOwn(value, "handleSeconds"), "task.history.interactionSeconds.renamed", `${path}.handleSeconds`,
    "use interactionSeconds; the former field is not accepted");
  for (const field of ["interactionSeconds", "holdSeconds", "queueSeconds"] as const) {
    if (value[field] !== undefined) {
      into.require(isDurationSeconds(value[field]), `task.history.${field}`, `${path}.${field}`,
        `${field} must be a whole number of seconds, zero or more, or omitted when unknown`);
    }
  }
  if (value.transfers !== undefined) {
    into.require(typeof value.transfers === "number" && Number.isInteger(value.transfers) && value.transfers >= 0,
      "task.history.transfers", `${path}.transfers`, "transfers must be a whole number, zero or more, or omitted when unknown");
  }
  if (!Array.isArray(value.steps)) {
    into.add("task.history.steps.shape", `${path}.steps`, "history carries its steps as an array, empty when the task has had none");
    return;
  }
  let previous: number | undefined;
  value.steps.forEach((entry: unknown, index: number) => {
    const at = `${path}.steps[${index}]`;
    if (!isPlainObject(entry)) {
      into.add("task.history.entry", at, "each history step must be an object");
      return;
    }
    into.oneOf(entry.step, HISTORY_STEPS, "task.history.step", `${at}.step`);
    if (into.timestamp(entry.at, "task.history.at", `${at}.at`)) {
      // The record is one entry per occurrence, oldest first: a second hold is a second entry
      // after the first, never a revision of it or an entry filed out of its turn.
      const instant = Date.parse(entry.at as string);
      if (previous !== undefined && instant < previous) {
        into.add("task.history.order", `${at}.at`, "history steps are oldest first; this entry is earlier than the one before it");
      }
      previous = instant;
    }
    if (entry.seconds !== undefined) {
      // Omitted while a leg is still running. Nought is a claim that it took no time.
      into.require(isDurationSeconds(entry.seconds) && (entry.seconds as number) > 0,
        "task.history.seconds", `${at}.seconds`,
        "seconds must be a positive whole number; omit it while the step is still running");
    } else {
      // An open leg is one still running, and the task says whether it can be: a hold runs only while
      // the task is paused, and a mute only while its audio is up. An open entry after that is a leg
      // nobody closed, which reads exactly like a leg running now.
      if (entry.step === "held") {
        into.require(task.phase === "paused", "task.history.held.open", `${at}.seconds`,
          `a held entry without seconds is a hold still running, and the task is ${describeValue(task.phase)}: the hold has ended, and its duration is stated`);
      }
      if (entry.step === "muted") {
        into.require(task.audio !== "ended" && task.phase !== "completing", "task.history.muted.open", `${at}.seconds`,
          "a muted entry without seconds is still running, but this interaction's audio has ended: the provider closes its open leg and states the duration; other channels may continue");
      }
    }
    // A muted entry carries whose the silence was, as the host reported it; no other step has it.
    // And it names the agent: the host has exactly one, the provider knows who, so an unattributed
    // muted leg is a record that dropped a fact it held rather than one it could not establish.
    if (entry.step === "muted") {
      into.oneOf(entry.mutedBy, MUTED_BY, "task.history.mutedBy", `${at}.mutedBy`);
      into.require(entry.by !== undefined, "task.history.muted.by", `${at}.by`,
        "a muted leg is attributed to the login's agent: the host reported it, and the provider knows who the host's agent is");
    }
    else if ((HISTORY_STEPS as readonly unknown[]).includes(entry.step)) {
      into.require(entry.mutedBy === undefined, "task.history.mutedBy.unexpected", `${at}.mutedBy`, "only a muted step says who silenced the microphone");
    }
    if (entry.by !== undefined) {
      into.require(isUserId(entry.by), "task.history.by", `${at}.by`,
        "by must be a non-empty user id; omit it when the person cannot be identified");
      // On `queued` nobody takes part, so there is nothing to name.
      into.require(entry.step !== "queued", "task.history.by.unexpected", `${at}.by`,
        "a queued step names nobody");
    }
    // A step that dialled says where to and, when a host placed it, which dial; no other step dialled.
    const dialled = typeof entry.step === "string" && (HISTORY_STEPS_THAT_DIAL as readonly string[]).includes(entry.step);
    for (const field of ["dialId", "destinationId"] as const) {
      if (entry[field] === undefined) continue;
      if (into.filled(entry[field], `task.history.${field}`, `${at}.${field}`, `${field} must not be empty when present`)) {
        into.require(dialled, `task.history.${field}.unexpected`, `${at}.${field}`,
          `${describeValue(entry.step)} dialled nothing; ${field} belongs on transferred, conferenced, or unanswered`);
      }
    }
  });
}

/** Present only while consulting, and only on voice: elsewhere there is nobody to consult. */
const TASK_MEDIA_STATES = membersOf<TaskAudioState>({ started: true, ended: true });

/** Real-time audio is a voice affair, and its state is one of two words. */
/** A host dial, or explicitly provider-triggered preview dial, is ringing the party. */
function partyRingingBeforeWork(task: Record<string, unknown>): boolean {
  return Array.isArray(task.onCall) && task.onCall.some(entry =>
    isPlainObject(entry) && entry.role === "party" && entry.stage === "ringing" && (isFilled(entry.dialId) || (task.phase === "preview" && task.atDeadline === "provider-dials" && entry.dialId === undefined)));
}

function validateTaskAudio(task: Record<string, unknown>, value: unknown, channel: string, phase: unknown, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.audio.channel", path,
    `a ${channel} task carries no real-time audio state`)) return;
  if (into.oneOf(value, TASK_MEDIA_STATES, "task.audio", path)) {
    // Nothing is acquired while pending, and a preview has placed no call: audio names a task whose
    // work has begun, on a snapshot as on the event, or a host would open the microphone on an offer.
    // Ring-back may precede answer for a host dial or an explicitly provider-triggered preview.
    // A deadline alone is never evidence that audio started.
    into.require(!(WORK_NOT_BEGUN as readonly unknown[]).includes(phase) || partyRingingBeforeWork(task), "task.audio.beforeWork", path,
      `a ${describeValue(phase)} task has no audio: audio arrives once its work has begun, or once an evidenced host/provider preview dial is ringing its party`);
  }
}
const WORK_NOT_BEGUN = ["pending", "confirmed", "preview"] as const;

/**
 * Who is on the call, as the provider states it. Voice only. Each entry is a role with what that
 * role needs and nothing another role would: a party or an agent dialled nowhere, so neither
 * carries a destination; somebody conferenced came from one, so they do.
 */
function validateOnCall(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.onCall.channel", path, `a ${channel} task has nobody on a call`)) return;
  if (!Array.isArray(value)) {
    into.add("task.onCall.shape", path, "onCall is an array of who is on the call, when the provider knows");
    return;
  }
  let parties = 0;
  value.forEach((entry: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      into.add("task.onCall.entry", at, "each entry on the call must be an object");
      return;
    }
    if (!into.oneOf(entry.role, ON_CALL_ROLES, "task.onCall.role", `${at}.role`)) return;
    const role = entry.role as OnCallRole;
    into.timestamp(entry.since, "task.onCall.since", `${at}.since`);
    if (entry.held !== undefined) {
      into.require(entry.held === true, "task.onCall.held", `${at}.held`, "held is stated by presence: send true or omit it");
    }
    if (role === "party") parties += 1;
    if (role === "agent") {
      into.require(isUserId(entry.userId), "task.onCall.userId", `${at}.userId`, "an agent on the call is named by their user id");
    } else {
      into.require(entry.userId === undefined, "task.onCall.userId.unexpected", `${at}.userId`, `a ${role} is not named by a user id`);
    }
    if (role === "conferenced") {
      into.filled(entry.destinationId, "task.onCall.destinationId", `${at}.destinationId`, `a ${role} entry names the directory item that was dialled`);
      // Stated, so a snapshot says who is present without anyone having seen the dial's outcome.
      if (into.oneOf(entry.stage, ON_CALL_STAGES, "task.onCall.stage", `${at}.stage`)) {
        into.require(!(entry.stage === "ringing" && entry.held === true), "task.onCall.held.ringing", `${at}.held`,
          "nobody ringing is held; held belongs to somebody who has joined");
      }
      if (entry.dialId !== undefined) into.filled(entry.dialId, "task.onCall.dialId", `${at}.dialId`, "dialId must not be empty when present");
      if (entry.label !== undefined) into.filled(entry.label, "task.onCall.label", `${at}.label`, "a label must not be empty when present");
    } else if (role === "party" && (entry.dialId !== undefined || entry.stage !== undefined)) {
      // The party is dialled again on the same task -- a connect-back the host placed, a callback the
      // platform placed -- and then carries the stage the dial has reached; a dial with no stage is
      // half a claim, and the host's dialId is present where a host placed it, as on any dialled entry.
      into.require(entry.stage !== undefined, "task.onCall.party.dial", at,
        "a party being dialled again carries the stage the dial has reached; the host's dialId beside it where a host placed the dial");
      if (entry.dialId !== undefined) into.filled(entry.dialId, "task.onCall.dialId", `${at}.dialId`, "dialId must not be empty when present");
      if (entry.stage !== undefined && into.oneOf(entry.stage, ON_CALL_STAGES, "task.onCall.stage", `${at}.stage`)) {
        into.require(!(entry.stage === "ringing" && entry.held === true), "task.onCall.held.ringing", `${at}.held`,
          "nobody ringing is held; held belongs to somebody who has joined");
      }
      for (const field of ["destinationId", "label"] as const) {
        into.require(entry[field] === undefined, `task.onCall.${field}.unexpected`, `${at}.${field}`,
          `a party is not a directory item; ${field} belongs on conferenced`);
      }
    } else {
      for (const field of ["destinationId", "dialId", "label", "stage"] as const) {
        into.require(entry[field] === undefined, `task.onCall.${field}.unexpected`, `${at}.${field}`,
          role === "party" ? `a party carries ${field} on a connect-back alone, with its dial and stage together` : `a ${role} was dialled from nowhere; ${field} belongs on conferenced`);
      }
    }
  });
  into.require(parties <= 1, "task.onCall.party.single", path, "a call has one party; a second is somebody else's role");
}

const LEAD_STAGES = membersOf<TaskLeadAssist["stage"]>({ requested: true, joined: true });

/** The agent's request for a lead. Voice only; `joined` names the lead, `requested` cannot. */
function validateLeadAssist(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.leadAssist.channel", path, `a ${channel} task cannot carry a lead request`)) return;
  if (!isPlainObject(value)) {
    into.add("task.leadAssist.shape", path, "lead must be an object when present");
    return;
  }
  if (into.oneOf(value.stage, LEAD_STAGES, "task.leadAssist.stage", `${path}.stage`)) {
    if (value.stage === "joined") {
      into.require(isUserId(value.leadId), "task.leadAssist.leadId", `${path}.leadId`, "a joined lead is named by their user id");
    } else {
      into.require(value.leadId === undefined, "task.leadAssist.leadId.unexpected", `${path}.leadId`,
        "nobody has joined a requested lead, so there is no lead to name");
    }
  }
  if (value.note !== undefined) into.filled(value.note, "task.leadAssist.note", `${path}.note`, "a note must not be empty when present");
  into.timestamp(value.since, "task.leadAssist.since", `${path}.since`);
}

/** A call a lead took over: which member it came from, and when. Voice only. */
function validateTakenOver(value: unknown, channel: string, path: string, into: Collector): void {
  if (value === undefined) return;
  if (!into.require(channel === "voice", "task.takenOver.channel", path, `a ${channel} task has no call to take over`)) return;
  if (!isPlainObject(value)) {
    into.add("task.takenOver.shape", path, "takenOver must be an object when present");
    return;
  }
  into.require(isUserId(value.memberId), "task.takenOver.memberId", `${path}.memberId`, "a taken-over call names the member it was taken from");
  into.timestamp(value.since, "task.takenOver.since", `${path}.since`);
}

export interface TaskValidationContext {
  /** The provider's channel, from its manifest. A task must agree with it. */
  channel: string;
  /** The level ids in force, from the manifest. The defaults when absent. */
  levels?: readonly string[];
  /** `ConnectContext.autoAcceptTasks` as sent: whether a pending task states its `acceptance`. Unknown to a caller without the context, and then unchecked. */
  autoAcceptTasks?: boolean;
  /** Whether the manifest declares `dialOutcomes`. A task that may dial needs it to; absent, the question is not asked. */
  dialOutcomesDeclared?: boolean;
  /**
   * The values the queue locked on this login's tasks -- a party's number or email -- as whoever
   * runs the validator knows them. Where a task's party stands locked, no other field of it may
   * carry one of these. Unknown to a host, which never sees the value, and then unchecked.
   */
  locked?: readonly string[];
  /**
   * A member's task on the team member list, trimmed by the provider: the workspace -- controls,
   * their source, browsers, completion terms -- is the member's and may be absent; what is present
   * is held to the same rules as on the member's own desk.
   */
  member?: true;
}

/** Whether a task is the agent's own doing: a dial the host placed on its onCall, or a call a lead took over. */
function originatedByTheAgent(task: Record<string, unknown>): boolean {
  if (Array.isArray(task.onCall) && task.onCall.some(entry => isPlainObject(entry) && typeof entry.dialId === "string")) return true;
  return task.takenOver !== undefined;
}

export function validateTask(task: unknown, context: TaskValidationContext, path = "task"): ProtocolViolation[] {
  const into = new Collector();
  validateTaskInto(task, context, path, into);
  return into.violations;
}

function validateTaskInto(task: unknown, context: TaskValidationContext, path: string, into: Collector): void {
  if (!isPlainObject(task)) {
    into.add("task.shape", path, "a task must be an object");
    return;
  }
  // A task carries no lead state: the lead's view is the team member list, and a lead's own call
  // is an ordinary assignment marked takenOver.
  for (const retired of ["assisting", "listening", "monitoring"] as const) {
    into.require(!Object.hasOwn(task, retired), "task.leadState.retired", `${path}.${retired}`,
      "a task carries no lead state; a call a lead took over says takenOver, and the lead's view is the team member list");
  }
  for (const former of ["handlingHistory", "interactionHistory"] as const) {
    into.require(!Object.hasOwn(task, former), "task.history.renamed", `${path}.${former}`,
      "use history; the former field is not accepted");
  }
  for (const former of ["id", "allocationId"] as const) {
    into.require(!Object.hasOwn(task, former), "task.assignmentId.renamed", `${path}.${former}`,
      "use assignmentId; a task is named by its assignment alone, and the former field is not accepted");
  }
  into.require(isAssignmentId(task.assignmentId), "task.assignmentId", `${path}.assignmentId`,
    "a task names the assignment it is the record of: the provider's name for it, unique within the provider and never reused");
  into.filled(task.title, "task.title", `${path}.title`, "a task needs a title");
  into.filled(task.taskType, "task.taskType", `${path}.taskType`, "a task needs a task type");
  if (into.oneOf(task.phase, TASK_PHASES, "task.phase", `${path}.phase`) && task.phase === "preview") {
    // A preview is a record waiting for the agent to press Call: only voice has a call to place,
    // and pressing Call is a dial, so the manifest has to have said how a dial ends.
    into.require(context.channel === "voice", "task.phase.channel", `${path}.phase`, `a ${context.channel} task has no call to preview`);
    into.require(context.dialOutcomesDeclared !== false, "task.preview.dialOutcomes.required", `${path}.phase`,
      "a preview ends in the agent pressing Call, which dials, and the manifest declares no dialOutcomes to say how a dial ends");
  }
  // The deadline and what happens at it travel together, and only while the record is being previewed.
  if (task.previewEndsInSeconds !== undefined || task.atDeadline !== undefined) {
    into.require(task.phase === "preview", "task.preview.deadline.unexpected", `${path}.previewEndsInSeconds`,
      "previewEndsInSeconds and atDeadline belong to a task in preview; past it there is nothing to wait for");
    if (task.previewEndsInSeconds === undefined) {
      into.add("task.preview.previewEndsInSeconds.required", `${path}.previewEndsInSeconds`, "atDeadline says what happens at a deadline, so there has to be one");
    } else {
      into.require(isDurationSeconds(task.previewEndsInSeconds), "task.preview.previewEndsInSeconds", `${path}.previewEndsInSeconds`,
        "previewEndsInSeconds is how long the preview has left: a whole number of seconds, zero or more, counted from this publication");
    }
    if (task.atDeadline === undefined) {
      into.add("task.preview.atDeadline.required", `${path}.atDeadline`,
        "a preview with a deadline says what happens at it: provider dials, host dials, or waits for the agent -- an agent counting down has to know which");
    } else {
      into.oneOf(task.atDeadline, PREVIEW_DEADLINES, "task.preview.atDeadline", `${path}.atDeadline`);
    }
  }
  // Acceptance is the offer's word, carried on the pending task so a snapshot can say it: it
  // travels exactly when Omni said tasks may be auto-accepted, and only while the task is pending.
  // Work the agent originated -- a dial or connect-back, carrying the host's dialId on onCall; a
  // lead's join, carrying assisting; a listen, carrying listening -- was accepted by the command
  // that created it, and says so whatever the provisioning: the desk shows no Accept for a call
  // the agent placed. The provisioning governs work the queue routes, and nothing else.
  const originated = task.phase === "pending" && originatedByTheAgent(task);
  ruleEvaluated("task.acceptance.originated");
  if (task.acceptance !== undefined) {
    into.oneOf(task.acceptance, ACCEPTANCE_MODES, "task.acceptance", `${path}.acceptance`);
    if (task.phase !== "pending") {
      into.add("task.acceptance.unexpected", `${path}.acceptance`, "acceptance is an offer's word; a task past pending has been accepted");
    } else if (originated) {
      into.require(task.acceptance === "automatic", "task.acceptance.originated", `${path}.acceptance`,
        "work the agent originated -- a dial, a connect-back, a call taken over -- was accepted by the command that created it, and says automatic whatever the provisioning");
    } else if (context.autoAcceptTasks === false) {
      into.add("task.acceptance.unexpected", `${path}.acceptance`,
        "autoAcceptTasks is off, so every task the queue routes requires agent acceptance and a pending task carries no acceptance");
    }
  } else if (originated) {
    into.add("task.acceptance.originated", `${path}.acceptance`,
      "work the agent originated -- a dial, a connect-back, a call taken over -- says acceptance: automatic whatever the provisioning: the command that created it accepted it");
  } else if (task.phase === "pending" && context.autoAcceptTasks === true) {
    into.add("task.acceptance.required", `${path}.acceptance`, "autoAcceptTasks is on, so a pending task states how it is accepted");
  }
  if (context.member !== true || task.completionMode !== undefined) into.oneOf(task.completionMode, COMPLETION_MODES, "task.completionMode", `${path}.completionMode`);
  // The allowance is coupled to the mode: a provider that will complete the task itself is going
  // to act on the allowance, so it must state one; a provider waiting for `complete` may omit it
  // to say it imposes no deadline. Present, it is a duration either way.
  if (task.wrapAllowance === undefined) {
    if (context.member !== true) into.require(task.completionMode !== "provider-automatic", "task.wrapAllowance.required",
      `${path}.wrapAllowance`, "provider-automatic completion needs an allowance to act on");
  } else {
    into.require(isDurationSeconds(task.wrapAllowance), "task.wrapAllowance", `${path}.wrapAllowance`,
      "wrapAllowance must be a whole number of seconds, zero or more, or omitted under agent-command");
  }

  // The channel is fixed per provider by its manifest, so a task claiming another one is a
  // task Omni would render with the wrong controls.
  into.require(task.channel === context.channel, "task.channel", `${path}.channel`,
    `a ${context.channel} provider may not publish a ${describeValue(task.channel)} task`);

  if (task.reference !== undefined) {
    into.filled(task.reference, "task.reference", `${path}.reference`, "a reference must not be empty when present");
  }
  if (task.party !== undefined) validateContactInto(task.party, `${path}.party`, into, context.levels);
  if (context.locked !== undefined && isPlainObject(task.party) && (isLocked(task.party.number) || isLocked(task.party.email))) {
    validateNothingLeaksInto(task, context.locked, path, into);
  }

  if (task.recording !== undefined) {
    into.require(context.channel === "voice", "recording.task.channel", `${path}.recording`, "recording is voice-only");
    if (!isPlainObject(task.recording)) into.add("recording.task.shape", `${path}.recording`, "expected provider recording state");
    else {
      for (const key of Object.keys(task.recording)) into.require(key === "provider", "recording.task.owner", `${path}.recording.${key}`, "host state belongs in HostReport, never provider task updates");
      if (task.recording.provider !== undefined) into.violations.push(...validateRecordingState(task.recording.provider, `${path}.recording.provider`));
    }
  }
  if (context.member !== true || task.browsers !== undefined) validateBrowsers(task.browsers, `${path}.browsers`, into);
  validateTaskAttributes(task.attributes, `${path}.attributes`, into, context.levels);
  validateHistory(task.history, `${path}.history`, into, { phase: task.phase, audio: task.audio });
  validateOnCall(task.onCall, context.channel, `${path}.onCall`, into);
  // Audio and onCall describe this agent's interaction, not the continuing caller journey.
  // Once the interaction's audio ends or it enters wrap, its live room is cleared. Other
  // channels may remain connected under another interaction or in IVR/queue stages.
  if (task.phase === "completing" && task.audio === "started") {
    into.add("task.audio.completing", `${path}.audio`,
      "a completing task's interaction audio has ended or never started; it cannot still be started during wrap");
  }
  if (Array.isArray(task.onCall) && task.onCall.length > 0 && (task.phase === "completing" || task.audio === "ended")) {
    into.add("task.onCall.ended", `${path}.onCall`,
      `this interaction is no longer connected (${task.phase === "completing" ? "the task is completing" : "its audio ended"}); clear its onCall view without implying that other channels ended`);
  }
  validateTaskAudio(task, task.audio, context.channel, task.phase, `${path}.audio`, into);
  validateLeadAssist(task.leadAssist, context.channel, `${path}.leadAssist`, into);
  validateTakenOver(task.takenOver, context.channel, `${path}.takenOver`, into);

  // Where the terms came from is stated with them: a host cannot tell "the platform permits
  // nothing" from "the terms could not be read" from the set alone, and the provider knows which.
  if (context.member !== true || task.capabilitySource !== undefined) into.oneOf(task.capabilitySource, CAPABILITY_SOURCES, "task.capabilitySource", `${path}.capabilitySource`);
  const capabilities = task.capabilities;
  if (context.member === true && capabilities === undefined && task.browsers === undefined) return;
  if (!isPlainObject(capabilities)) {
    into.add("task.capabilities.shape", `${path}.capabilities`, "a task needs a capabilities object");
    return;
  }
  const allowed = isChannel(context.channel) ? TASK_CAPABILITIES[context.channel] : TASK_CAPABILITIES.voice;
  // A task that supplies browser definitions declares the capability that shows them, and one
  // that declares it supplies at least one: the capability puts a panel in the workspace, and a
  // panel with nothing in it is a control with nothing to offer.
  if (Array.isArray(task.browsers) && task.browsers.length > 0 && capabilities.browsers !== true) {
    into.add("task.browsers.capability", `${path}.browsers`, "a task that supplies browsers declares capabilities.browsers");
  }
  if (capabilities.browsers === true && Array.isArray(task.browsers) && task.browsers.length === 0) {
    into.add("task.browsers.required", `${path}.browsers`, "a task that declares capabilities.browsers supplies at least one; with none, omit the capability");
  }
  // An outcome is given in wrap, by the agent: a provider that completes the task itself cannot
  // wait for one, and a task with no wrap has nowhere to take one.
  if (isPlainObject(capabilities.outcomes) && capabilities.outcomes.required === true) {
    into.require(task.completionMode !== "provider-automatic", "task.outcomes.required.mode", `${path}.capabilities.outcomes.required`,
      "a required outcome is the agent's to give, so the task completes on the agent's command; provider-automatic completion cannot wait for it");
  }
  if (capabilities.outcomes !== undefined) {
    into.require(task.wrapAllowance !== 0, "task.outcomes.wrapAllowance", `${path}.capabilities.outcomes`,
      "outcomes are collected in wrap, and wrapAllowance 0 gives none: publish a wrap or no outcomes");
  }
  for (const [name, declared] of Object.entries(capabilities)) {
    if (declared === undefined) continue;
    if (!allowed.includes(name)) {
      // A name another channel owns is a channel error; one no channel owns is not a capability at
      // all -- mute among them, since the microphone is the host's and no provider declares it.
      const known = (Object.values(TASK_CAPABILITIES) as readonly (readonly string[])[]).some(names => names.includes(name));
      into.add(known ? "task.capability.channel" : "task.capability.unknown", `${path}.capabilities.${name}`,
        known ? `a ${context.channel} task may not declare ${name}` : `${name} is not a capability a provider declares on any channel`);
      continue;
    }
    // A control that dials needs the manifest to have said how a dial ends, or its outcome has no words.
    if ((DIALLING_CAPABILITIES as readonly string[]).includes(name) && context.dialOutcomesDeclared === false) {
      into.add("task.capability.dialOutcomes.required", `${path}.capabilities.${name}`,
        `${name} dials, and the manifest declares no dialOutcomes to say how a dial ends`);
    }
    // A control the queue could allow may stand locked in its place, saying whose. What the
    // queue provides -- browsers, outcomes, custom controls -- is content, not a control.
    if (isLocked(declared)) {
      if (into.require(name !== "browsers" && name !== "outcomes" && name !== "custom", "task.capability.locked.unexpected",
        `${path}.capabilities.${name}`, `${name} is what the queue provides, not a control anyone locks`)) {
        validateLockedInto(declared, "task.capability.locked", `${path}.capabilities.${name}`, context.levels, into);
      }
      continue;
    }
    switch (name) {
      case "recording": into.violations.push(...validateRecordingPolicy(declared, `${path}.capabilities.recording`)); break;
      case "outcomes": validateOutcomes(declared, `${path}.capabilities.outcomes`, into); break;
      case "custom": validateCustomCapabilities(declared, `${path}.capabilities.custom`, into); break;
      case "conference": validateDestinationDirectory(declared, `${path}.capabilities.${name}`, into); break;
      default:
        // Presence is the permission: the flag capabilities carry no payload, so anything but
        // true is a value a host would have to interpret.
        into.require(declared === true, "task.capability.value", `${path}.capabilities.${name}`,
          `${name} is declared by presence: send true or omit it`);
    }
  }
}

// ---------------------------------------------------------------------------
// Breaks, team, snapshot.
// ---------------------------------------------------------------------------

function validateForcedBreak(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("break.forced.shape", path, "a forced break must be an object");
    return;
  }
  into.require(isUserId(value.by) || value.by === "provider", "break.forced.by", `${path}.by`, "a forced break says who forced it: the lead by user id, or provider where the platform did");
  for (const field of ["endsAutomatically", "endsAt"] as const) {
    into.require(!Object.hasOwn(value, field), "break.forced.manualResume", `${path}.${field}`,
      "automatic ending fields are unsupported; the agent must resume manually");
  }
  if (value.expectedDurationMs !== undefined) into.require(
    typeof value.expectedDurationMs === "number" && Number.isFinite(value.expectedDurationMs) && value.expectedDurationMs > 0,
    "break.forced.expectedDurationMs", `${path}.expectedDurationMs`, "expectedDurationMs must be a positive finite number of milliseconds");

}

/** Checks break status against the full currently retained task set, after a transaction. */
export function validateBreakStatus(state: unknown, tasks: unknown, path = "snapshot"): ProtocolViolation[] {
  const into = new Collector();
  validateBreakState(state, `${path}.break`, into);
  into.require(Array.isArray(tasks), "break.tasks.shape", `${path}.tasks`, "the complete current task list is required");
  if (Array.isArray(tasks)) tasks.forEach((task: unknown, index: number) => {
    into.require(isPlainObject(task), "break.task.shape", `${path}.tasks[${index}]`, "each retained task must be an object");
  });
  // A break in effect begins when the work ends, so it holds no task. A snapshot reporting both
  // describes a state the agent cannot be in, whichever half is stale. The one exception is a
  // call a lead took over: the provider assigns it whatever break the lead is on.
  // The converse: a committed break with nothing outstanding has begun. starting-after-task beside
  // no task is a break waiting on work that does not exist, and an empty list reading as "still
  // finishing" is the plausible nought.
  ruleEvaluated("break.starting-after-task.tasks");
  if (isPlainObject(state) && state.status === "starting-after-task"
    && Array.isArray(tasks) && tasks.length === 0) {
    into.add("break.starting-after-task.tasks", `${path}.break.status`,
      "a break starting after the task waits on a task, and the snapshot carries none: with nothing outstanding the break is on-break");
  }
  if (isPlainObject(state) && state.status === "on-break"
    && Array.isArray(tasks) && tasks.length > 0) {
    const takenOver = tasks.every((task: unknown) => isPlainObject(task) && task.takenOver !== undefined);
    if (!takenOver) {
      into.add("break.on-break.tasks", `${path}.tasks`,
        "a break in effect holds no task: it begins when the work ends, and until then the state is starting-after-task; the one exception is a call a lead took over");
    }
  }

  return into.violations;
}

/**
 * Checks a lead command before dispatch, against the current authentication, transport and team
 * member list (`team`) and, for force-break and end-forced-break, the target's full `memberBreak`.
 * The authority is the login's `lead` flag; the provider rechecks the target and the state
 * atomically, since a team member list is not authority to act after it has changed.
 */
export function validateTeamCommand(request: unknown, context: unknown, path = "teamCommand"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(context) || !isPlainObject(request) || !isPlainObject(request.command)) {
    into.add("team.command.shape", path, "a command and current authentication/transport/team context are required");
    return into.violations;
  }
  const auth = isPlainObject(context.authentication) ? context.authentication : {};
  into.violations.push(...validateAuthenticationState(auth, `${path}.authentication`));
  const caps = isPlainObject(auth.capabilities) ? auth.capabilities : {};
  into.require((auth.status === "authenticated" || auth.status === "refreshing") && context.transport === "active",
    "team.command.connection", path, "lead commands require a live login and active transport");
  into.require(caps.lead === true, "team.command.capability", path, "the login must declare lead");
  const command = request.command;
  const member = ["type", "memberId", "assignmentId"];
  const allowed: Record<string, readonly string[]> = {
    "lead-features": ["type", "enabled"],
    "decide-break-request": ["type", "memberId", "decision", "reason"], "set-break-policy": ["type", "policy"],
    "force-break": ["type", "memberId", "reasonId", "reason", "expectedDurationMs"], "end-forced-break": ["type", "memberId"],
    join: member, decline: [...member, "reason"], listen: member, coach: member, "join-call": member, leave: member, "take-over-call": member,
    "set-policy": ["type", "capability", "setting"],
  };
  const fields = typeof command.type === "string" && Object.hasOwn(allowed, command.type) ? allowed[command.type] : undefined;
  if (!fields) { into.add("team.command.type", path, `unknown lead command: ${describeValue(command.type)}`); return into.violations; }
  for (const key of Object.keys(request)) into.require(key === "command", "team.request.field", `${path}.${key}`, "only command is supported");
  for (const key of Object.keys(command)) into.require(fields.includes(key), "team.command.field", `${path}.${key}`, "field is not supported for this command");
  if (command.reason !== undefined) into.filled(command.reason, "team.command.reason", path, "reason must not be empty");
  if (command.type === "lead-features") {
    into.require(typeof command.enabled === "boolean", "team.command.enabled", `${path}.enabled`, "lead-features says on or off, as a boolean");
    return into.violations;
  }
  if (command.type === "set-break-policy") {
    into.require(["approval-required", "automatically-approved", "requests-suspended"].includes(command.policy as string), "team.command.policy", path, "unknown break policy");
    return into.violations;
  }
  if (command.type === "set-policy") {
    into.require(typeof command.capability === "string" && (POLICY_KEYS.has(command.capability) || /^skill:.+$/.test(command.capability)),
      "team.command.capability.key", `${path}.capability`, "a policy names a task control, dial, or a skill");
    if (into.oneOf(command.setting, POLICY_SETTINGS, "team.command.setting", `${path}.setting`)) {
      into.require(command.setting !== "person" || (typeof command.capability === "string" && PERSON_SETTABLE.test(command.capability)),
        "team.command.setting.person", `${path}.setting`, "only hold and skills may be left to the person");
    }
    return into.violations;
  }
  into.filled(command.memberId, "team.command.member", path, "name the target member");
  const team = isPlainObject(context.team) ? context.team : {};
  const members = Array.isArray(team.members) ? team.members : [];
  const target = members.find((m: unknown) => isPlainObject(m) && m.id === command.memberId);
  const self = isPlainObject(auth.identity) ? auth.identity.id : undefined;
  into.require(isPlainObject(target) && command.memberId !== self, "team.command.member", path,
    "the target must be another member of the current team member list");
  if (command.assignmentId !== undefined) {
    into.require(isAssignmentId(command.assignmentId), "team.command.assignmentId", `${path}.assignmentId`, "an assignment id must be non-empty when present");
    const tasks = isPlainObject(target) && Array.isArray(target.tasks) ? target.tasks : undefined;
    if (tasks !== undefined) into.require(tasks.some((task: unknown) => isPlainObject(task) && task.assignmentId === command.assignmentId),
      "team.command.assignmentId.unknown", `${path}.assignmentId`, "the assignment named is not one the team member list shows the member holding");
  }
  if (command.type === "decide-break-request") {
    into.require(command.decision === "granted" || command.decision === "denied", "team.command.decision", path, "decide granted or denied");
    into.require(isPlainObject(target) && target.break === "awaiting-approval", "team.command.awaiting", path,
      "decide only a currently awaiting-approval request");
  } else if (command.type === "force-break" || command.type === "end-forced-break") {
    validateBreakState(context.memberBreak, `${path}.memberBreak`, into);
    const state = isPlainObject(context.memberBreak) ? context.memberBreak : {};
    if (command.type === "end-forced-break") into.require(state.forced !== undefined && (state.status === "on-break" || state.status === "starting-after-task"),
      "team.command.endForcedBreak", path, "lift a current forced-break restriction without resuming the agent");
    if (command.type === "force-break") {
      if (command.expectedDurationMs !== undefined) into.require(
        typeof command.expectedDurationMs === "number" && Number.isFinite(command.expectedDurationMs) && command.expectedDurationMs > 0,
        "team.command.expectedDurationMs", `${path}.expectedDurationMs`, "expectedDurationMs must be positive finite milliseconds; it never resumes the agent");
      if (command.reasonId !== undefined) into.filled(command.reasonId, "team.command.reasonId", path, "reasonId must not be empty");
      const reasons = Array.isArray(state.reasons) ? state.reasons : [];
      into.require(state.reasons === undefined ? command.reasonId === undefined : reasons.some((r: unknown) => isPlainObject(r) && r.id === command.reasonId),
        "team.command.reasonId", path, "force-break uses the target's currently published reason codes");
    }
  } else if (command.type === "join" || command.type === "decline") {
    const asked = isPlainObject(target) && isPlainObject(target.request) ? target.request : undefined;
    into.require(asked !== undefined && (command.assignmentId === undefined || asked.assignmentId === command.assignmentId),
      "team.command.request", path, `${command.type} answers a request the team member list carries on the member, and this member has none`);
  } else if (command.type === "coach" || command.type === "join-call" || command.type === "leave") {
    into.require(isPlainObject(target) && target.listening !== undefined, "team.command.listening", path,
      `${command.type} needs the lead on this member's call: the team member list shows listening on them`);
  }
  return into.violations;
}

/** The four agent break methods; this is a validation API, not a wire command. */
export type BreakMethod = "requestBreak" | "commitBreak" | "cancelBreak" | "endBreak";

/**
 * Validate immediately before dispatch against current provider state. Context must contain
 * the current authentication and transport. This cannot fence a concurrent backend change;
 * the provider must recheck atomically. Result validation never replaces authoritative state.
 */
export function validateBreakCommand(method: BreakMethod, request: unknown, state: unknown,
  context: unknown, path = "breakCommand"): ProtocolViolation[] {
  const into = new Collector();
  validateBreakState(state, `${path}.state`, into);
  if (!isPlainObject(context)) {
    into.add("break.command.context", path, "current authentication and transport are required");
    return into.violations;
  }
  into.violations.push(...validateAuthenticationState(context.authentication, `${path}.authentication`));
  const auth = isPlainObject(context.authentication) ? context.authentication : {};
  into.require(auth.status === "authenticated" || auth.status === "refreshing", "break.command.authentication", path,
    "break commands require a live authenticated login");
  into.require(isPlainObject(auth.capabilities) && auth.capabilities.breaks === true, "break.command.capability", path,
    "the login must declare breaks");
  into.require(context.transport === "active", "break.command.transport", path, "break commands require active transport");
  if (!["requestBreak", "commitBreak", "cancelBreak", "endBreak"].includes(method)) {
    into.add("break.command.method", path, "unknown break method");
    return into.violations;
  }
  if (!isPlainObject(state) || into.violations.length) return into.violations;
  const status = state.status;
  if (method === "requestBreak") {
    into.require(status === "not-requested", "break.command.request.pending", path, "a new request starts only from not-requested");
    if (!isPlainObject(request)) {
      into.add("break.request.shape", path, "requestBreak takes a request object");
      return into.violations;
    }
    for (const key of Object.keys(request)) into.require(key === "reason" || key === "reasonId",
      "break.request.field", `${path}.${key}`, "a break request carries only reason and reasonId");
    for (const key of ["reason", "reasonId"]) if (request[key] !== undefined)
      into.filled(request[key], `break.request.${key}`, `${path}.${key}`, "a supplied reason must not be empty");
    const reasons = Array.isArray(state.reasons) ? state.reasons : [];
    const selected = reasons.find((r: unknown) => isPlainObject(r) && r.id === request.reasonId);
    if (state.reasons !== undefined) into.require(selected !== undefined, "break.request.reasonId", path,
      "choose a currently published reasonId; free text is not a substitute");
    else into.require(request.reasonId === undefined, "break.request.reasonId.unexpected", path, "no reason codes were published");
    into.require(state.canRequestBreak === true || (isPlainObject(selected) && selected.alwaysAvailable === true),
      "break.request.canRequestBreak", path, "asking is disabled except for the selected alwaysAvailable reason");
  } else {
    into.require(request === undefined, "break.command.arguments", path, "this break method takes no arguments");
    if (method === "commitBreak") into.require(status === "granted" || status === "starting-after-task" || status === "on-break",
      "break.command.commit.grant", path, "commit requires a grant; repeated committed state is idempotent");
    if (method === "cancelBreak") into.require(status === "awaiting-approval" || status === "granted",
      "break.command.cancel.precommit", path, "cancel only a pre-commit request; a raced commit requires commit recovery");
    if (method === "endBreak") {
      into.require(status === "starting-after-task" || status === "on-break", "break.command.end.started", path,
        "end a committed break, including a returning provider still finishing work");
      // A forced break also ends only when the agent explicitly resumes.
    }
  }
  return into.violations;
}

/**
 * Checks two complete break states within one provider/login's ordered event stream.
 * Call before replacing accepted state; report violations and reconcile on failure.
 * This is not a freshness check: validate a fresh authoritative snapshot separately and
 * use it as a new baseline, never as an event transition. Source ordering and connection
 * fencing remain required; neither timestamps nor approval rank identify a break attempt.
 */
export function validateBreakTransition(before: unknown, after: unknown, path = "break"): ProtocolViolation[] {
  const into = new Collector();
  validateBreakState(before, `${path}.before`, into);
  validateBreakState(after, `${path}.after`, into);
  if (into.violations.length || !isPlainObject(before) || !isPlainObject(after)) return into.violations;
  const from = before.status as BreakStatus;
  const to = after.status as BreakStatus;
  const committed = to === "starting-after-task" || to === "on-break";
  if (committed && (from === "not-requested" || from === "awaiting-approval") && after.forced === undefined) {
    into.add("stream.breakState.commitBeforeGrant", `${path}.after.status`,
      `${to} follows a commit, and a commit follows granted; the break stood at ${from}`);
  }
  const backwards =
    (from === "on-break" && (to === "awaiting-approval" || to === "granted" || to === "starting-after-task")) ||
    (from === "starting-after-task" && (to === "awaiting-approval" || to === "granted")) ||
    (from === "granted" && to === "awaiting-approval");
  if (backwards) into.add("stream.breakState.backwards", `${path}.after.status`,
    `a break does not go from ${from} back to ${to}; a new request passes through not-requested`);
  return into.violations;
}

function validateBreakState(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("break.shape", path, "break state must be an object");
    return;
  }
  into.require(!Object.hasOwn(value, "imposed"), "break.forced.renamed", `${path}.imposed`,
    "imposed was renamed to forced; use only forced");
  into.require(!Object.hasOwn(value, "approval"), "break.status.renamed", `${path}.approval`,
    "BreakState.approval was renamed to status; use only status");
  into.oneOf(value.status, BREAK_APPROVALS, "break.status", `${path}.status`);
  into.require(!Object.hasOwn(value, "mayAsk"), "break.canRequestBreak.renamed", `${path}.mayAsk`,
    "mayAsk was renamed to canRequestBreak; use only canRequestBreak");
  into.require(typeof value.canRequestBreak === "boolean", "break.canRequestBreak", `${path}.canRequestBreak`, "canRequestBreak says whether the agent may ask for a break: a boolean");

  into.require(!Object.hasOwn(value, "refusedReason"), "break.requestUnavailableReason.renamed", `${path}.refusedReason`,
    "refusedReason was renamed to requestUnavailableReason; use only requestUnavailableReason");
  for (const field of ["requestUnavailableReason", "decisionReason"] as const) {
    if (value[field] !== undefined) {
      into.filled(value[field], `break.${field}`, `${path}.${field}`, `${field} must not be empty when present`);
    }
  }
  // The refusal is the reason the control is withdrawn; beside `canRequestBreak: true` it explains nothing.
  if (value.requestUnavailableReason !== undefined) {
    into.require(value.canRequestBreak !== true, "break.requestUnavailableReason.canRequestBreak", `${path}.requestUnavailableReason`,
      "requestUnavailableReason is shown when canRequestBreak is false; omit it while the agent may ask");
  }
  into.require(!Object.hasOwn(value, "retryAfterMs"), "break.retryRequestAfterMs.renamed", `${path}.retryAfterMs`,
    "retryAfterMs was renamed to retryRequestAfterMs on BreakState");
  if (value.retryRequestAfterMs !== undefined) {
    into.require(typeof value.retryRequestAfterMs === "number" && Number.isFinite(value.retryRequestAfterMs) && value.retryRequestAfterMs >= 0,
      "break.retryRequestAfterMs", `${path}.retryRequestAfterMs`, "retryRequestAfterMs must be a non-negative number when present");
  }
  if (value.activeReasonId !== undefined) {
    into.filled(value.activeReasonId, "break.activeReasonId", `${path}.activeReasonId`,
      "activeReasonId must not be empty when present");
    // A break nobody is on has no reason. Reporting one beside `not-requested` describes a
    // break that is not happening.
    into.require(value.status !== "not-requested", "break.activeReasonId.status", `${path}.activeReasonId`,
      "activeReasonId must be omitted when no break is requested or in effect");
  }
  if (value.forced !== undefined) {
    validateForcedBreak(value.forced, `${path}.forced`, into);
    // A forced break is a break somebody forced; beside `not-requested` there is no break.
    // A forced break is a break in progress or about to be: it travels with on-break or
    // starting-after-task and nothing else. Beside granted, the host would commit a break nobody asked for.
    into.require(value.status === "on-break" || value.status === "starting-after-task", "break.forced.status", `${path}.forced`,
      `a forced break is in effect or starting after the task; ${describeValue(value.status)} says the agent asked, or that there is none`);
  }

  if (value.reasons === undefined) return;
  if (!Array.isArray(value.reasons)) {
    into.add("break.reasons.shape", `${path}.reasons`, "break reasons must be an array when present");
    return;
  }
  // A provider that defines no codes omits the field: an empty list is a second spelling of that.
  if (value.reasons.length === 0) {
    into.add("break.reasons.empty", `${path}.reasons`, "a provider that defines no reasons omits the field rather than publishing an empty list");
  }
  const seen = new Set<string>();
  value.reasons.forEach((reason: unknown, index: number) => {
    const at = `${path}.reasons[${index}]`;
    if (!isPlainObject(reason)) {
      into.add("break.reason.shape", at, "each break reason must be an object");
      return;
    }
    if (into.filled(reason.id, "break.reason.id", `${at}.id`, "a break reason needs an id")) {
      if (seen.has(reason.id as string)) into.add("break.reason.unique", `${at}.id`, `duplicate break reason id: ${reason.id}`);
      seen.add(reason.id as string);
    }
    into.filled(reason.label, "break.reason.label", `${at}.label`, "a break reason needs a label");
    if (reason.kind !== undefined) into.oneOf(reason.kind, BREAK_KINDS, "break.reason.kind", `${at}.kind`);
    if (reason.alwaysAvailable !== undefined) {
      into.require(reason.alwaysAvailable === true, "break.reason.alwaysAvailable", `${at}.alwaysAvailable`,
        "alwaysAvailable is declared by presence: send true or omit it");
    }
  });
  // The active reason is one of the published ones, or it is a reason Omni cannot name.
  if (typeof value.activeReasonId === "string" && value.activeReasonId.length > 0) {
    into.require(seen.has(value.activeReasonId), "break.activeReasonId.known", `${path}.activeReasonId`,
      `activeReasonId names a reason the provider did not publish: ${value.activeReasonId}`);
  }
  // A break in effect, or about to be, on a provider that publishes reasons is on one of them: an
  // forced one included, since the lead's force-break command named it. A break of no kind is a break whose
  // rules -- who may listen through it, whether it counts -- nobody can apply.
  ruleEvaluated("break.activeReasonId.required");
  if (seen.size > 0 && (value.status === "on-break" || value.status === "starting-after-task")) {
    into.require(typeof value.activeReasonId === "string" && value.activeReasonId.length > 0, "break.activeReasonId.required", `${path}.activeReasonId`,
      `a break ${describeValue(value.status)} on a provider that publishes reasons names the one it is on`);
  }
}

/**
 * Who is reading what the adapter published, and what their login declares. The validators check
 * structure without it; given it, they also hold what the adapter publishes to the login.
 */
export interface ReaderContext {
  /**
   * The signed-in agent, `AuthenticationState.identity.id`. A lead does not report to themself:
   * a team member list that lists them in `members`, or their own ask in `requests`, is a violation.
   */
  self?: UserId;
  /**
   * The login's `AuthenticationState.capabilities`. The login is the permission: a lead's
   * snapshot carries a team member list, nobody else's does, and `requests` need `team.leadAssistControl`.
   */
  capabilities?: UserCapabilities;
  /** The level ids in force. Filled from the manifest by `validateSnapshot` and `validateEventEnvelope`; the defaults otherwise. */
  levels?: readonly string[];
  /** The login's `loginId`. A snapshot or event naming another belongs to a login that is gone. */
  loginId?: string;
  /**
   * Whether the lead has the team feature on, as the application last told the provider. The
   * provider assumes nothing until told: on, a snapshot carries the team; off, nothing of the
   * team is owed or expected. Unknown to a caller without it, and then unchecked either way.
   */
  leadFeatures?: boolean;
  /** The provider's channel, for a member's task that states none. Filled from the manifest by `validateSnapshot` and `validateEventEnvelope`. */
  channel?: Channel;
  /**
   * The values the queue locked on this login's tasks, as whoever runs the validator knows them:
   * a conformance run states them, a host never has them. Where a task's party stands locked, no
   * other field of it may carry one (`task.locked.leak`). Absent, unchecked.
   */
  locked?: readonly string[];
  /** `ConnectContext.autoAcceptTasks` as sent: whether a pending task states its `acceptance`. Unknown to a caller without the context, and then unchecked. */
  autoAcceptTasks?: boolean;
}

export function validateTeamMembers(teamMembers: unknown, path = "team", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  validateTeamMembersInto(teamMembers, path, context, into);
  return into.violations;
}

function validateTeamMembersInto(teamMembers: unknown, path: string, context: ReaderContext, into: Collector): void {
  if (!isPlainObject(teamMembers)) {
    into.add("team.shape", path, "a team member list must be an object");
    return;
  }
  // The login is the permission: a team member list reaches a login that declares `capabilities.lead`
  // and nobody else. Only a caller holding the login can check it.
  if (context.capabilities !== undefined && context.capabilities.lead !== true) {
    into.add("team.unentitled", path,
      "a team member list published to a login that does not declare capabilities.lead: the login is the permission");
  }
  // Policies are present where the provider offers policy control, absent where it does not.
  if (teamMembers.policies !== undefined) validateTeamPoliciesInto(teamMembers.policies, `${path}.policies`, into, context.levels);
  if (!Array.isArray(teamMembers.members)) {
    into.add("team.members.shape", `${path}.members`, "a team member list must carry a members array");
    return;
  }
  const seen = new Set<string>();
  teamMembers.members.forEach((member: unknown, index: number) => {
    const at = `${path}.members[${index}]`;
    if (isPlainObject(member) && isUserId(member.id)) {
      if (seen.has(member.id as string)) into.add("team.member.unique", `${at}.id`, `duplicate team member: ${member.id}`);
      seen.add(member.id as string);
    }
    validateTeamMemberInto(member, at, context, into);
  });
  // One member's call at a time.
  const listened = teamMembers.members.filter((member: unknown) => isPlainObject(member) && member.listening !== undefined);
  if (listened.length > 1) into.add("team.listening.single", `${path}.members`, "a lead is on one member's call at a time");
}

/** One member as the lead sees them, whole: on the list, and on `team-member-updated` alone. */
export function validateTeamMember(member: unknown, path = "member", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  validateTeamMemberInto(member, path, context, into);
  return into.violations;
}

function validateTeamMemberInto(member: unknown, at: string, context: ReaderContext, into: Collector): void {
  if (!isPlainObject(member)) {
    into.add("team.member.shape", at, "each team member must be an object");
    return;
  }
  if (into.require(isUserId(member.id), "team.member.id", `${at}.id`, "a team member needs a user id")) {
    into.require(member.id !== context.self, "team.member.self", `${at}.id`,
      "the team member list carries the agent it is published to: a lead does not report to themself");
  }
  into.oneOf(member.availability, TEAM_AVAILABILITIES, "team.member.availability", `${at}.availability`);
  if (member.since !== undefined) into.timestamp(member.since, "team.member.since", `${at}.since`);
  if (member.break !== undefined) {
    // Only an outstanding request appears here: `not-requested` is absence, `on-break` is
    // `availability: "on-break"`, and a denial never survives to be reported.
    if (into.oneOf(member.break, MEMBER_BREAKS, "team.member.break", `${at}.break`)) {
      into.require(member.availability !== "signed-out" && member.availability !== "on-break", "team.member.break.availability",
        `${at}.break`, "a member on a break or signed out has no request outstanding");
    }
  }
  // The member's open tasks, as the lead sees them: trimmed by the provider, held to the task rules otherwise.
  if (member.tasks !== undefined) {
    if (!Array.isArray(member.tasks)) {
      into.add("team.member.tasks.shape", `${at}.tasks`, "a member's tasks are an array: [] when they hold none, omitted only where the provider cannot see them");
    } else {
      const held = new Set<string>();
      member.tasks.forEach((task: unknown, index: number) => {
        const channel = isPlainObject(task) && typeof task.channel === "string" && isChannel(task.channel) ? task.channel : context.channel ?? "voice";
        validateTaskInto(task, { channel, levels: context.levels, member: true }, `${at}.tasks[${index}]`, into);
        if (isPlainObject(task) && isAssignmentId(task.assignmentId)) {
          if (held.has(task.assignmentId as string)) into.add("team.member.tasks.unique", `${at}.tasks[${index}].assignmentId`, `duplicate assignment on one member: ${task.assignmentId}`);
          held.add(task.assignmentId as string);
        }
      });
      into.require(member.availability !== "signed-out" || member.tasks.length === 0, "team.member.tasks.availability", `${at}.tasks`,
        "a member signed out holds no task");
    }
  }
  // The lead on this member's call, in the mode they are heard.
  if (member.listening !== undefined) {
    if (!isPlainObject(member.listening)) {
      into.add("team.member.listening.shape", `${at}.listening`, "listening must be an object when present");
    } else {
      const listened = member.listening;
      if (into.require(isAssignmentId(member.listening.assignmentId), "team.member.listening.assignmentId", `${at}.listening.assignmentId`,
        "listening names which of the member's calls the lead is on: the application opens the lead's audio on it") && Array.isArray(member.tasks)) {
        into.require(member.tasks.some((task: unknown) => isPlainObject(task) && task.assignmentId === listened.assignmentId),
          "team.member.listening.assignment", `${at}.listening.assignmentId`, "the call the lead is on is one the member's tasks carry");
      }
      into.oneOf(member.listening.mode, LISTENING_MODES, "team.member.listening.mode", `${at}.listening.mode`);
      into.timestamp(member.listening.since, "team.member.listening.since", `${at}.listening.since`);
    }
  }
  // The member's own history for the day: about the person, not any one call.
  if (member.shift !== undefined) validateShiftInto(member.shift, `${at}.shift`, into);
  // The member's standing ask for a lead, on one of the calls they hold.
  if (member.request !== undefined) {
    if (!isPlainObject(member.request)) {
      into.add("team.member.request.shape", `${at}.request`, "request must be an object when present");
    } else {
      const asked = member.request;
      if (into.require(isAssignmentId(asked.assignmentId), "team.member.request.assignmentId", `${at}.request.assignmentId`,
        "a request names the member's assignment the lead would join") && Array.isArray(member.tasks)) {
        into.require(member.tasks.some((task: unknown) => isPlainObject(task) && task.assignmentId === asked.assignmentId),
          "team.member.request.assignment", `${at}.request.assignmentId`, "the call the member asks a lead onto is one their tasks carry");
      }
      if (asked.note !== undefined) into.filled(asked.note, "team.member.request.note", `${at}.request.note`, "a note must not be empty when present");
      into.timestamp(asked.since, "team.member.request.since", `${at}.request.since`);
    }
  }
}

export function validateSnapshot(snapshot: unknown, manifest: unknown, path = "snapshot", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(snapshot)) {
    into.add("snapshot.shape", path, "a snapshot must be an object");
    return into.violations;
  }
  const channel = isPlainObject(manifest) && typeof manifest.channel === "string" ? manifest.channel : "voice";
  const levels = context.levels ?? manifestLevels(manifest);

  into.oneOf(snapshot.transport, TRANSPORT_STATUSES, "snapshot.transport", `${path}.transport`);
  if (into.filled(snapshot.loginId, "snapshot.loginId", `${path}.loginId`, "a snapshot needs the login id it belongs to")
    && context.loginId !== undefined) {
    into.require(snapshot.loginId === context.loginId, "snapshot.loginId.mismatch", `${path}.loginId`,
      `a snapshot for session ${describeValue(snapshot.loginId)} on a login whose session is ${context.loginId}`);
  }


  // The count is the provider's confirmation of how much work it answered with. Stated, never
  // inferred: an unanswered or blank state lacks it, and cannot pass as a confirmed empty.
  if (into.require(typeof snapshot.taskCount === "number" && Number.isInteger(snapshot.taskCount) && snapshot.taskCount >= 0,
    "snapshot.taskCount", `${path}.taskCount`, "a snapshot states its task count: a whole number, zero or more")
    && Array.isArray(snapshot.tasks)) {
    into.require(snapshot.taskCount === snapshot.tasks.length, "snapshot.taskCount.mismatch", `${path}.taskCount`,
      `taskCount says ${snapshot.taskCount} and tasks carries ${snapshot.tasks.length}: a count that does not reconcile is an answer nobody gave`);
  }
  if (!Array.isArray(snapshot.tasks)) {
    into.add("snapshot.tasks.shape", `${path}.tasks`, "a snapshot must carry a tasks array");
  } else {
    const seen = new Set<string>();
    snapshot.tasks.forEach((task: unknown, index: number) => {
      validateTaskInto(task, { channel, levels, autoAcceptTasks: context.autoAcceptTasks, dialOutcomesDeclared: manifestDials(manifest), locked: context.locked }, `${path}.tasks[${index}]`, into);
      if (isPlainObject(task) && isAssignmentId(task.assignmentId)) {
        if (seen.has(task.assignmentId as string)) into.add("task.assignmentId.unique", `${path}.tasks[${index}].assignmentId`, `duplicate assignment id: ${task.assignmentId}`);
        seen.add(task.assignmentId as string);
      }
    });
  }

  into.violations.push(...validateBreakStatus(snapshot.break, snapshot.tasks, path));

  // Presence is the permission, and it cuts both ways: data a provider never declared a
  // capability for is data Omni would show against a control the agent does not have.
  const idle = isPlainObject(manifest) && isPlainObject(manifest.idleCapabilities) ? manifest.idleCapabilities : {};
  // And it cuts the other way too: a declared contribution is required, `[]` included. A snapshot
  // that omits one the manifest declares has not cleared it, it has said nothing, and Omni would
  // go on showing whatever it held.
  if (snapshot.contacts === undefined && idle.contacts === true) {
    into.add("snapshot.contacts.required", `${path}.contacts`,
      "the manifest declares contacts, so every snapshot carries the contribution: [] when there are none");
  }
  if (snapshot.calendar === undefined && idle.calendar === true) {
    into.add("snapshot.calendar.required", `${path}.calendar`,
      "the manifest declares calendar, so every snapshot carries the contribution: [] when there are none");
  }
  if (snapshot.contacts !== undefined) {
    into.require(idle.contacts === true, "snapshot.contacts.capability", `${path}.contacts`,
      "contacts require the contacts idle capability");
    if (Array.isArray(snapshot.contacts)) {
      snapshot.contacts.forEach((contact: unknown, index: number) =>
        validateContactInto(contact, `${path}.contacts[${index}]`, into, levels));
    } else {
      into.add("snapshot.contacts.shape", `${path}.contacts`, "contacts must be an array when present");
    }
  }
  if (snapshot.calendar !== undefined) {
    into.require(idle.calendar === true, "snapshot.calendar.capability", `${path}.calendar`,
      "scheduled activities require the calendar idle capability");
    if (Array.isArray(snapshot.calendar)) {
      const seen = new Set<string>();
      snapshot.calendar.forEach((activity: unknown, index: number) => {
        validateScheduledActivityInto(activity, `${path}.calendar[${index}]`, into, levels);
        if (isPlainObject(activity) && isFilled(activity.id)) {
          if (seen.has(activity.id as string)) {
            into.add("activity.id.unique", `${path}.calendar[${index}].id`, `duplicate activity id: ${activity.id}`);
          }
          seen.add(activity.id as string);
        }
      });
    } else {
      into.add("snapshot.calendar.shape", `${path}.calendar`, "calendar must be an array when present");
    }
  }
  // The switch is the permission: once the application has said the team feature is on, a
  // snapshot carries the team, `members: []` included. Before it has said, the provider assumes
  // nothing and owes nothing. The other direction -- a team member list to a login that does not
  // lead, or to a lead who turned the feature off -- is the team member list's own rule.
  if (context.leadFeatures === true && snapshot.team === undefined) {
    into.add("team.required", `${path}.team`,
      "the team feature is on, so every snapshot carries a team member list: members: [] when nobody is in it");
  }
  if (context.leadFeatures === false && snapshot.team !== undefined) {
    into.add("team.unexpected", `${path}.team`, "the team feature is not on for this lead: nothing of the team reaches them until the application switches it on, and nothing after it switches it off");
  }
  if (snapshot.team !== undefined) validateTeamMembersInto(snapshot.team, `${path}.team`, { ...context, levels, channel: isChannel(channel) ? channel : undefined }, into);

  return into.violations;
}

// ---------------------------------------------------------------------------
// Events.
// ---------------------------------------------------------------------------

function validateTaskOutcome(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("event.taskEnded.outcome.shape", path, "an outcome must be an object");
    return;
  }
  switch (value.type) {
    case "completed":
      into.oneOf(value.by, COMPLETED_BY, "event.taskEnded.outcome.completed", `${path}.by`);
      break;
    case "taken-over":
      // A lead is not a directory item: the ending names the lead, and the host resolves the name.
      into.require(isUserId(value.leadId), "event.taskEnded.outcome.takenOver", `${path}.leadId`, "a take-over names the lead who took the call, by user id");
      break;
    case "cancelled":
      // One word covered the agent declining, the provider withdrawing and the party abandoning the
      // ring; a record that cannot tell them apart is not a record. by says who, as completed does.
      into.oneOf(value.by, CANCELLED_BY, "event.taskEnded.outcome.cancelled.by", `${path}.by`);
      if (value.reason !== undefined) {
        into.filled(value.reason, "event.taskEnded.outcome.cancelled", `${path}.reason`,
          "a reason must not be empty when present");
      }
      break;
    case "expired":
      // Only the phases in which a task is still waiting on somebody can expire.
      into.oneOf(value.phase, EXPIRABLE_PHASES, "event.taskEnded.outcome.expired", `${path}.phase`);
      break;
    case "failed":
      if (!isPlainObject(value.failure)) {
        into.add("event.taskEnded.outcome.failed", `${path}.failure`, "a failed outcome must carry a failure");
      } else {
        validateFailureInto(value.failure, `${path}.failure`, into);
      }
      break;
    default:
      into.add("event.taskEnded.outcome.type", `${path}.type`, `unsupported outcome: ${describeValue(value.type)}`);
  }
}

function validateQueueSummary(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("event.summary.shape", path, "a provider summary must be an object");
    return;
  }
  into.filled(value.title, "event.summary.title", `${path}.title`, "a summary needs a title");
  if (value.subtitle !== undefined) {
    into.filled(value.subtitle, "event.summary.subtitle", `${path}.subtitle`, "a subtitle must not be empty when present");
  }
  into.require(typeof value.waitingCount === "number" && Number.isInteger(value.waitingCount) && value.waitingCount >= 0,
    "event.summary.waitingCount", `${path}.waitingCount`, "waitingCount must be a whole number, zero or more");
  into.timestamp(value.updatedAt, "event.summary.updatedAt", `${path}.updatedAt`);
  if (value.metrics === undefined) return;
  if (!Array.isArray(value.metrics)) {
    into.add("event.summary.metrics.shape", `${path}.metrics`, "metrics must be an array when present");
    return;
  }
  const ids = new Set<string>();
  value.metrics.forEach((metric: unknown, index: number) => {
    if (isPlainObject(metric) && isFilled(metric.id)) {
      if (ids.has(metric.id as string)) into.add("event.summary.metric.unique", `${path}.metrics[${index}].id`, `duplicate metric id: ${metric.id}`);
      ids.add(metric.id as string);
    }
    const at = `${path}.metrics[${index}]`;
    if (!isPlainObject(metric)) {
      into.add("event.summary.metric.shape", at, "each metric must be an object");
      return;
    }
    into.filled(metric.id, "event.summary.metric.id", `${at}.id`, "a metric needs an id");
    into.filled(metric.label, "event.summary.metric.label", `${at}.label`, "a metric needs a label");
    into.require(typeof metric.value === "string", "event.summary.metric.value", `${at}.value`,
      "a metric value must be a string; the provider decides how it reads");
  });
}

export function validateEventEnvelope(envelope: unknown, manifest: unknown, path = "event", context: ReaderContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(envelope)) {
    into.add("event.shape", path, "an event envelope must be an object");
    return into.violations;
  }
  const channel = isPlainObject(manifest) && typeof manifest.channel === "string" ? manifest.channel : "voice";
  const levels = context.levels ?? manifestLevels(manifest);

  into.filled(envelope.id, "event.id", `${path}.id`, "an event needs an id");
  if (into.filled(envelope.loginId, "event.loginId", `${path}.loginId`, "an event needs the login id it belongs to")
    && context.loginId !== undefined) {
    into.require(envelope.loginId === context.loginId, "event.loginId.mismatch", `${path}.loginId`,
      `an event for session ${describeValue(envelope.loginId)} on a login whose session is ${context.loginId}`);
  }
  const idle = isPlainObject(manifest) && isPlainObject(manifest.idleCapabilities) ? manifest.idleCapabilities : {};
  into.timestamp(envelope.occurredAt, "event.occurredAt", `${path}.occurredAt`);

  const event = envelope.event;
  if (!isPlainObject(event)) {
    into.add("event.payload.shape", `${path}.event`, "an envelope must carry an event");
    return into.violations;
  }
  const at = `${path}.event`;
  into.require(!Object.hasOwn(event, "taskId"), "event.assignmentId.renamed", `${at}.taskId`,
    "an event names a task by its assignment alone; the former field is not accepted");

  switch (event.type) {
    case "snapshot":
      into.oneOf(event.reason, SNAPSHOT_REASONS, "event.snapshot.reason", `${at}.reason`);
      into.violations.push(...validateSnapshot(event.snapshot, manifest, `${at}.snapshot`, { ...context, levels }));
      break;
    case "transport-status":
      into.oneOf(event.status, TRANSPORT_STATUSES, "event.transportStatus.status", `${at}.status`);
      // An error says how to revive it; any other status has nothing to revive.
      if (event.status === "error") {
        if (into.require(event.recovery !== undefined, "event.transportStatus.recovery.required", `${at}.recovery`,
          "an error names its recovery: reconnect, or reauthenticate")) {
          into.oneOf(event.recovery, TRANSPORT_RECOVERIES, "event.transportStatus.recovery", `${at}.recovery`);
        }
      } else {
        into.require(event.recovery === undefined, "event.transportStatus.recovery.unexpected", `${at}.recovery`,
          "recovery goes with an error; nothing needs reviving here");
      }
      if (event.message !== undefined) {
        into.filled(event.message, "event.transportStatus.message", `${at}.message`, "a message must not be empty when present");
      }
      break;
    case "break-state":
      validateBreakState(event.break, `${at}.break`, into);
      break;
    case "task-offered":
      validateTaskInto(event.task, { channel, levels, autoAcceptTasks: context.autoAcceptTasks, dialOutcomesDeclared: manifestDials(manifest), locked: context.locked }, `${at}.task`, into);
      // An offer introduces work that is not yet under way; work in progress arrives only on a snapshot.
      if (isPlainObject(event.task) && typeof event.task.phase === "string") {
        into.require((OFFERABLE_PHASES as readonly string[]).includes(event.task.phase), "event.taskOffered.phase", `${at}.task.phase`,
          `task-offered introduces a task as ${OFFERABLE_PHASES.join(", ")}, never as ${event.task.phase}`);
      }
      if (event.expiresInSeconds !== undefined) into.require(isDurationSeconds(event.expiresInSeconds), "event.taskOffered.expiresInSeconds", `${at}.expiresInSeconds`,
        "expiresInSeconds is how long the offer stands: a whole number of seconds, zero or more, counted from this event");
      break;
    case "task-updated":
      validateTaskInto(event.task, { channel, levels, autoAcceptTasks: context.autoAcceptTasks, dialOutcomesDeclared: manifestDials(manifest), locked: context.locked }, `${at}.task`, into);
      break;
    case "task-audio-started":
      into.require(channel === "voice", "event.audio.channel", `${at}.type`, "only a voice provider publishes audio transitions");
      into.require(isAssignmentId(event.assignmentId), "event.taskAudioStarted.assignmentId", `${at}.assignmentId`, "an event about a task names its assignment");
      break;
    case "task-audio-ended":
      into.require(channel === "voice", "event.audio.channel", `${at}.type`, "only a voice provider publishes audio transitions");
      into.require(isAssignmentId(event.assignmentId), "event.taskAudioEnded.assignmentId", `${at}.assignmentId`, "an event about a task names its assignment");
      break;
    case "task-ended":
      into.require(isAssignmentId(event.assignmentId), "event.taskEnded.assignmentId", `${at}.assignmentId`, "an event about a task names its assignment");
      validateTaskOutcome(event.outcome, `${at}.outcome`, into);
      break;
    case "dial-outcome": {
      into.filled(event.dialId, "event.dialOutcome.dialId", `${at}.dialId`, "an outcome names the dial it ends, by the host's dialId");
      // Only a distinction the manifest declared: an undeclared word is a guess dressed as a code.
      const declared = isPlainObject(manifest) && Array.isArray(manifest.dialOutcomes) ? manifest.dialOutcomes : undefined;
      if (into.oneOf(event.outcome, DIAL_OUTCOMES, "event.dialOutcome.outcome", `${at}.outcome`)) {
        into.require(declared !== undefined && declared.includes(event.outcome), "event.dialOutcome.undeclared", `${at}.outcome`,
          `the manifest does not declare ${describeValue(event.outcome)} among its dialOutcomes`);
      }
      if (event.assignmentId !== undefined) into.require(isAssignmentId(event.assignmentId), "event.dialOutcome.assignmentId", `${at}.assignmentId`, "assignmentId must name an assignment when present");
      if (event.destinationId !== undefined) into.filled(event.destinationId, "event.dialOutcome.destinationId", `${at}.destinationId`, "a destinationId must not be empty when present");
      if (event.reason !== undefined) into.filled(event.reason, "event.dialOutcome.reason", `${at}.reason`, "a reason must not be empty when present");
      break;
    }
    case "announcement":
      into.filled(event.text, "event.announcement.text", `${at}.text`, "an announcement needs text");
      into.timestamp(event.announcedAt, "event.announcement.announcedAt", `${at}.announcedAt`);
      if (event.expiresAt !== undefined) into.timestamp(event.expiresAt, "event.announcement.expiresAt", `${at}.expiresAt`);
      if (event.html !== undefined) {
        into.require(typeof event.html === "string", "event.announcement.html", `${at}.html`, "html must be a string when present");
      }
      break;
    case "diagnostic":
      into.filled(event.expected, "event.diagnostic.expected", `${at}.expected`, "a diagnostic states the rule that was broken, as a sentence");
      into.filled(event.observed, "event.diagnostic.observed", `${at}.observed`, "a diagnostic states what was observed instead");
      if (event.assignmentId !== undefined) into.require(isAssignmentId(event.assignmentId), "event.diagnostic.assignmentId", `${at}.assignmentId`, "assignmentId must name an assignment when present");
      break;
    case "queue-summary":
      validateQueueSummary(event.summary, `${at}.summary`, into);
      break;
    case "team-updated": case "team-member-updated": case "team-member-removed": case "team-policies-updated": {
      const field = event.type === "team-updated" ? "team" : event.type === "team-member-updated" ? "member" : event.type === "team-member-removed" ? "memberId" : "policies";
      into.require(context.capabilities === undefined || context.capabilities.lead === true, "event.team.capability", `${at}.${field}`,
        `${event.type} reaches a login that declares lead, and nobody else`);
      into.require(context.leadFeatures !== false, "event.team.features", `${at}.${field}`, "the team feature is not on for this lead: nothing of the team reaches them until the application switches it on, and nothing after it switches it off");
      const teamContext = { ...context, levels, channel: isChannel(channel) ? channel : undefined };
      if (event.type === "team-updated") validateTeamMembersInto(event.team, `${at}.team`, teamContext, into);
      else if (event.type === "team-member-updated") validateTeamMemberInto(event.member, `${at}.member`, teamContext, into);
      else if (event.type === "team-member-removed") {
        if (into.require(isUserId(event.memberId), "event.teamMemberRemoved.memberId", `${at}.memberId`, "team-member-removed names the member taken off, by user id")) {
          into.require(event.memberId !== context.self, "team.member.self", `${at}.memberId`, "a lead does not report to themself, so is never removed from their own team");
        }
      } else validateTeamPoliciesInto(event.policies, `${at}.policies`, into, levels);
      break;
    }
    case "contacts-updated":
      into.require(idle.contacts === true, "event.contacts.capability", `${at}.contacts`,
        "contacts-updated requires the contacts idle capability");
      if (!Array.isArray(event.contacts)) {
        into.add("event.contacts.shape", `${at}.contacts`, "contacts must be an array");
      } else {
        event.contacts.forEach((contact: unknown, index: number) =>
          validateContactInto(contact, `${at}.contacts[${index}]`, into, levels));
      }
      break;
    case "calendar-updated":
      into.require(idle.calendar === true, "event.calendar.capability", `${at}.calendar`,
        "calendar-updated requires the calendar idle capability");
      if (!Array.isArray(event.calendar)) {
        into.add("event.calendar.shape", `${at}.calendar`, "calendar must be an array");
      } else {
        const ids = new Set<string>();
        event.calendar.forEach((activity: unknown, index: number) => {
          validateScheduledActivityInto(activity, `${at}.calendar[${index}]`, into, levels);
          if (isPlainObject(activity) && isFilled(activity.id)) {
            if (ids.has(activity.id as string)) into.add("activity.id.unique", `${at}.calendar[${index}].id`, `duplicate activity id: ${activity.id}`);
            ids.add(activity.id as string);
          }
        });
      }
      break;
    default:
      into.add("event.type", `${at}.type`, `unsupported event type: ${describeValue(event.type)}`);
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Results. A result crosses the same boundary a snapshot does, from an adapter that may be
// compiled against another version, and Omni shows the agent what it says.
// ---------------------------------------------------------------------------

const PREFERENCE_ID = /^(hold|skill:.+)$/;

/** The choices left to the person, each with where it stands. */
function validatePreferencesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!Array.isArray(value)) {
    into.add("preferences.shape", path, "preferences must be an array");
    return;
  }
  const seen = new Set<string>();
  value.forEach((preference: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(preference)) {
      into.add("preference.shape", at, "each preference must be an object");
      return;
    }
    if (into.require(typeof preference.id === "string" && PREFERENCE_ID.test(preference.id), "preference.id", `${at}.id`,
      "a preference is hold or skill:<id>: nothing else is the person's to set")) {
      if (seen.has(preference.id as string)) into.add("preference.unique", `${at}.id`, `duplicate preference: ${preference.id}`);
      seen.add(preference.id as string);
    }
    into.filled(preference.label, "preference.label", `${at}.label`, "a preference needs a label");
    into.require(typeof preference.enabled === "boolean", "preference.enabled", `${at}.enabled`, "a preference says where it stands");
    validateResolvedInto(preference, "preference", at, levels, into);
  });
}

/** The team's policy per capability as the lead sees it: the setting, who set it, who locked it. */
function validateShiftInto(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("team.member.shift.shape", path, "shift must be an object when present");
    return;
  }
  const signedIn = into.timestamp(value.signedInAt, "team.member.shift.signedInAt", `${path}.signedInAt`);
  if (value.signedOutAt !== undefined && into.timestamp(value.signedOutAt, "team.member.shift.signedOutAt", `${path}.signedOutAt`) && signedIn) {
    into.require(Date.parse(value.signedOutAt as string) >= Date.parse(value.signedInAt as string), "team.member.shift.signedOutAt.order", `${path}.signedOutAt`,
      "a member signs out after signing in");
  }
  for (const field of ["talkSeconds", "holdSeconds", "breakSeconds"] as const) {
    if (value[field] !== undefined) into.require(isDurationSeconds(value[field]), `team.member.shift.${field}`, `${path}.${field}`,
      `${field} must be a whole number of seconds, zero or more, or omitted when unknown`);
  }
  if (value.tasksHandled !== undefined) into.require(Number.isInteger(value.tasksHandled) && (value.tasksHandled as number) >= 0,
    "team.member.shift.tasksHandled", `${path}.tasksHandled`, "tasksHandled must be a whole number, zero or more, or omitted when unknown");
  if (value.events !== undefined) {
    if (!Array.isArray(value.events)) {
      into.add("team.member.shift.events.shape", `${path}.events`, "events must be an array when present");
      return;
    }
    let previous: number | undefined;
    value.events.forEach((event: unknown, index: number) => {
      const at = `${path}.events[${index}]`;
      if (!isPlainObject(event)) { into.add("team.member.shift.event.shape", at, "each shift event must be an object"); return; }
      into.oneOf(event.kind, SHIFT_EVENT_KINDS, "team.member.shift.event.kind", `${at}.kind`);
      if (into.timestamp(event.at, "team.member.shift.event.at", `${at}.at`)) {
        const instant = Date.parse(event.at as string);
        if (previous !== undefined && instant < previous) into.add("team.member.shift.events.order", `${at}.at`, "shift events are oldest first; this event is earlier than the one before it");
        previous = instant;
      }
    });
  }
}

function validateTeamPoliciesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(value)) {
    into.add("team.policies.shape", path, "policies must be an object keyed by capability");
    return;
  }
  for (const [key, policy] of Object.entries(value)) {
    if (policy === undefined) continue;
    const at = `${path}.${key}`;
    if (!into.require(POLICY_KEYS.has(key) || /^skill:.+$/.test(key), "team.policy.key", at,
      `${key} is not a control a policy can name: a task control, dial, or skill:<id>`)) continue;
    if (!isPlainObject(policy)) {
      into.add("team.policy.shape", at, "each policy carries its setting, who set it, and who locked it if anyone");
      continue;
    }
    if (into.oneOf(policy.setting, POLICY_SETTINGS, "team.policy.setting", `${at}.setting`)) {
      into.require(policy.setting !== "person" || PERSON_SETTABLE.test(key), "team.policy.person", `${at}.setting`,
        `${key} is the team's, on or off; only hold and skills may be left to the person`);
    }
    validateResolvedInto(policy, "team.policy", at, levels, into);
    into.require(policy.setBy !== "person", "team.policy.setBy", `${at}.setBy`, "a team policy is not set by a person");
  }
}

/** A `ProtocolFailure`, wherever one appears: on a result, or on a task's failed outcome. */
function validateFailureInto(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("failure.shape", path, "a failure must be an object");
    return;
  }
  if (into.filled(value.code, "failure.code", `${path}.code`, "a failure needs a code")) {
    // A provider names its own codes freely; the `omni.` namespace is the contract's, and a code
    // in it that the contract lacks is one Omni would show without knowing what it means.
    if ((value.code as string).startsWith("omni.")) {
      into.require((OMNI_FAILURE_CODES as readonly string[]).includes(value.code as string), "failure.code.unknown",
        `${path}.code`, `not a contract failure code: ${value.code}`);
    }
  }
  into.filled(value.message, "failure.message", `${path}.message`, "a failure needs a message");
  into.require(typeof value.retryable === "boolean", "failure.retryable", `${path}.retryable`,
    "a failure must say whether it is retryable");
  if (value.retryAfterMs !== undefined) {
    into.require(typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0,
      "failure.retryAfterMs", `${path}.retryAfterMs`, "retryAfterMs must be a non-negative number when present");
  }
}

const URL_VISIBILITIES = membersOf<UrlVisibility>({ full: true, domain: true, hidden: true });
const HOST_AUDIO_REASONS = membersOf<HostAudioUnavailableReason>({ "no-device": true, denied: true, "not-asked": true, "in-use": true, lost: true });
const HOST_OUTPUT_REASONS = membersOf<HostOutputUnavailableReason>({ "no-device": true, lost: true });

function validateUnavailable(value: Record<string, unknown>, rule: string, path: string, into: Collector): void {
  if (value.failure === undefined) {
    into.add(`${rule}.failure.required`, `${path}.failure`, "unavailable carries the failure that says why");
  } else {
    validateFailureInto(value.failure, `${path}.failure`, into);
  }
}

/**
 * Validates the host's report as Omni publishes it to an adapter. This is Omni's output, so the
 * check belongs to the host's own tests and to the harness, which validates whatever host a test
 * hands the adapter.
 */
const HOST_GUARANTEES = membersOf<keyof HostGuarantees>({ browserUrlVisibility: true, personConsent: true });
const MUTED_BY = membersOf<MutedBy>({ host: true, station: true });
const HOST_MUTES = membersOf<HostMute>({ stream: true, station: true });

/**
 * What pressing Mute does on this host, stated on a softphone login and nowhere else: on a desk
 * phone the microphone is the phone's, and off voice there is none. Neither the value nor its
 * absence is inferred from what kind of application the host is.
 */
/** What the host states as capacity: a whole number, zero or more, zero being host-stopped. */
export function validateCapacity(capacity: unknown, path = "capacity"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(capacity)) {
    into.add("capacity.shape", path, "a capacity is an object carrying count");
    return into.violations;
  }
  into.require(typeof capacity.count === "number" && Number.isInteger(capacity.count) && capacity.count >= 0, "capacity.count", `${path}.count`,
    "count is a whole number, zero or more: how many tasks this provider may assign at once, zero while the agent's capacity is elsewhere");
  return into.violations;
}

/** The login's store, which the host provides on every connection: three functions, and nothing else is a store. */
export function validateLoginStore(store: unknown, path = "store"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(store)) {
    into.add("store.shape", path, "a connection carries the login's store: an object with get, set and delete");
    return into.violations;
  }
  for (const method of ["get", "set", "delete"] as const) {
    into.require(typeof store[method] === "function", `store.${method}`, `${path}.${method}`, `a login store ${method}s by key`);
  }
  return into.violations;
}

export function validateHostMute(mute: unknown, softphone: boolean, path = "host.mute"): ProtocolViolation[] {
  const into = new Collector();
  if (mute === undefined) {
    into.require(!softphone, "host.mute.required", path, "a softphone login's host states what its Mute does: stream or station");
  } else if (into.require(softphone, "host.mute.unexpected", path, "only a softphone login's host holds a microphone to mute; a desk phone's is the phone's, and a conversation has none")) {
    into.oneOf(mute, HOST_MUTES, "host.mute", path);
  }
  return into.violations;
}

/**
 * What a host promises. Presence is the guarantee, so a key declared `false` is refused: a
 * promise withheld is an absent key, never a false one, exactly as a capability is.
 */
export function validateHostGuarantees(guarantees: unknown, path = "host.guarantees"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(guarantees)) {
    into.add("host.guarantees.shape", path, "a host declares its guarantees as an object, empty when it makes none");
    return into.violations;
  }
  for (const [name, declared] of Object.entries(guarantees)) {
    if (declared === undefined) continue;
    if (!into.require((HOST_GUARANTEES as readonly string[]).includes(name), "host.guarantee.unknown", `${path}.${name}`,
      `${name} is not a guarantee this contract names: ${HOST_GUARANTEES.join(", ")}`)) continue;
    into.require(declared === true, "host.guarantee.value", `${path}.${name}`,
      "a guarantee is declared by presence; one the host does not make is omitted, never false");
  }
  return into.violations;
}

/**
 * What the host reports of a leg it performed, as an adapter may validate it before forwarding:
 * a task, a step, when it began, how long so far if the host says, and an explicit end that
 * carries the final duration.
 */
export function validateHistoryReport(report: unknown, path = "historyReport", manifest?: unknown): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(report)) {
    into.add("historyReport.shape", path, "a history report must be an object");
    return into.violations;
  }
  into.require(!Object.hasOwn(report, "taskId"), "historyReport.assignmentId.renamed", `${path}.taskId`, "a report names the assignment alone; the former field is not accepted");
  into.require(isAssignmentId(report.assignmentId), "historyReport.assignmentId", `${path}.assignmentId`, "a report names the task's assignment, so a late one never lands on the next life of the id");
  into.oneOf(report.step, HISTORY_STEPS, "historyReport.step", `${path}.step`);
  into.timestamp(report.at, "historyReport.at", `${path}.at`);
  // A muted leg says whose the silence was; no other leg has anyone to name for it.
  if (report.step === "muted") into.oneOf(report.mutedBy, MUTED_BY, "historyReport.mutedBy", `${path}.mutedBy`);
  else if ((HISTORY_STEPS as readonly unknown[]).includes(report.step)) {
    into.require(report.mutedBy === undefined, "historyReport.mutedBy.unexpected", `${path}.mutedBy`, "only a muted leg says who silenced the microphone");
  }
  if (report.seconds !== undefined) {
    into.require(isDurationSeconds(report.seconds) && (report.seconds as number) > 0, "historyReport.seconds", `${path}.seconds`,
      "seconds must be a positive whole number; omit it rather than report nought");
  }
  if (report.ended !== undefined) {
    if (into.require(report.ended === true, "historyReport.ended", `${path}.ended`, "ended is declared by presence, as true; a running leg omits it")) {
      into.require(report.seconds !== undefined, "historyReport.ended.seconds", `${path}.seconds`,
        "an ended leg states its final duration");
    }
  } else if (report.seconds !== undefined && manifest !== undefined) {
    // A running report crosses only to a provider that asked for one: begin and end are the whole
    // of what the rest receive.
    into.require(isPlainObject(manifest) && manifest.runningStepReports === true, "historyReport.running.unexpected", `${path}.seconds`,
      "this provider takes begin and end only; a running report was never asked for");
  }
  return into.violations;
}

/** A silenced device says who silenced it; one that flows, or whose flow the host cannot know, says nothing. */
function validateMutedBy(device: Record<string, unknown>, rule: string, path: string, into: Collector): void {
  if (device.flowing === false) {
    into.oneOf(device.mutedBy, MUTED_BY, `${rule}.mutedBy`, `${path}.mutedBy`);
  } else {
    into.require(device.mutedBy === undefined, `${rule}.mutedBy.unexpected`, `${path}.mutedBy`,
      "mutedBy says who silenced a device that is not flowing; a flowing one names nobody");
  }
}

export function validateHostReport(report: unknown, path = "host"): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(report)) {
    into.add("host.shape", path, "a host report must be an object");
    return into.violations;
  }
  into.require(typeof report.online === "boolean", "host.online", `${path}.online`, "a host report says whether it has a network");
  into.violations.push(...validateHostRecordings(report.recordings, `${path}.recordings`));
  if (report.audio === undefined) return into.violations;
  if (!isPlainObject(report.audio)) {
    into.add("host.audio.shape", `${path}.audio`, "audio must be an object when present, with input and output");
    return into.violations;
  }
  const input = report.audio.input;
  const at = `${path}.audio.input`;
  if (!isPlainObject(input)) {
    into.add("host.audio.input.shape", at, "audio carries its input");
  } else if (input.status === "available") {
    into.require(typeof input.localAudio === "object" && input.localAudio !== null, "host.audio.input.localAudio", `${at}.localAudio`,
      "a ready input carries the captured microphone");
    into.require(typeof input.flowing === "boolean", "host.audio.input.flowing", `${at}.flowing`,
      "a ready input says whether audio is flowing through it");
    validateMutedBy(input, "host.audio.input", at, into);
    into.require(input.failure === undefined, "host.audio.input.failure.unexpected", `${at}.failure`, "a ready input carries no failure");
    into.require(input.reason === undefined, "host.audio.input.reason.unexpected", `${at}.reason`, "a ready input has no reason to be unavailable");
  } else if (input.status === "unavailable") {
    into.oneOf(input.reason, HOST_AUDIO_REASONS, "host.audio.input.reason", `${at}.reason`);
    validateUnavailable(input, "host.audio.input", at, into);
    into.require(input.localAudio === undefined, "host.audio.input.localAudio.unexpected", `${at}.localAudio`,
      "an unavailable input carries no microphone");
    into.require(input.flowing === undefined, "host.audio.input.flowing.unexpected", `${at}.flowing`,
      "an unavailable input has nothing to flow");
    into.require(input.mutedBy === undefined, "host.audio.input.mutedBy.unexpected", `${at}.mutedBy`,
      "an unavailable input was not silenced; it is absent");
  } else {
    into.add("host.audio.input.status", `${at}.status`, `an input is available or unavailable, not ${describeValue(input.status)}`);
  }
  const output = report.audio.output;
  const out = `${path}.audio.output`;
  if (!isPlainObject(output)) {
    into.add("host.audio.output.shape", out, "audio carries its output");
  } else if (output.status === "available") {
    // Whether the speaker is silenced is stated only where the host can know it: a browser mostly cannot, and omits it.
    if (output.flowing !== undefined) {
      into.require(typeof output.flowing === "boolean", "host.audio.output.flowing", `${out}.flowing`,
        "flowing says whether audio reaches the speaker, when the host can know");
    }
    validateMutedBy(output, "host.audio.output", out, into);
    into.require(output.failure === undefined, "host.audio.output.failure.unexpected", `${out}.failure`, "a ready output carries no failure");
    into.require(output.reason === undefined, "host.audio.output.reason.unexpected", `${out}.reason`, "a ready output has no reason to be unavailable");
  } else if (output.status === "unavailable") {
    into.oneOf(output.reason, HOST_OUTPUT_REASONS, "host.audio.output.reason", `${out}.reason`);
    validateUnavailable(output, "host.audio.output", out, into);
    into.require(output.flowing === undefined, "host.audio.output.flowing.unexpected", `${out}.flowing`,
      "an unavailable output has nothing to flow");
    into.require(output.mutedBy === undefined, "host.audio.output.mutedBy.unexpected", `${out}.mutedBy`,
      "an unavailable output was not silenced; it is absent");
  } else {
    into.add("host.audio.output.status", `${out}.status`, `an output is available or unavailable, not ${describeValue(output.status)}`);
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

const LEAD_ASSIST_ACTIONS = ["request", "cancel"] as const;
const CONFERENCE_ACTIONS = ["add", "remove"] as const;


/** Validate the exact interaction/assignment target before provider command dispatch. */
export function validateTaskCommandRequest(request: unknown, task: unknown, path = "request",
  taskContext?: Omit<TaskValidationContext, "channel">): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(request) || !isPlainObject(task)) {
    into.add("command.request.shape", path, "a request and the current published task are required");
    return into.violations;
  }
  into.require(!Object.hasOwn(request, "taskId"), "command.request.assignmentId.renamed", `${path}.taskId`, "a command names the assignment alone; the former field is not accepted");
  into.filled(request.assignmentId, "command.request.assignmentId", `${path}.assignmentId`, "name the assignment");
  into.require(request.assignmentId === task.assignmentId, "command.request.assignmentId.mismatch", `${path}.assignmentId`, "the command must target this exact assignment");
  for (const key of Object.keys(request)) into.require(["assignmentId", "command"].includes(key),
    "command.request.field", `${path}.${key}`, "unsupported task command request field");
  into.violations.push(...validateTaskCommand(request.command, task, `${path}.command`, taskContext));
  return into.violations;
}

/**
 * What a command needs to be issuable, checked against the task it names: the capability the
 * guide's table gates it on, the phase it belongs to, and the state that has to stand -- a
 * lead requested, somebody else on the call. Without a task only the command's
 * own shape is checked. A host validates before sending, and an adapter before acting: a command
 * for a control the task never offered is the host's error, and this names it.
 */
export function validateTaskCommand(command: unknown, task?: unknown, path = "command", taskContext?: Omit<TaskValidationContext, "channel">): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(command)) {
    into.add("command.shape", path, "a command must be an object");
    return into.violations;
  }
  const type = command.type;
  const channel = isPlainObject(task) && typeof task.channel === "string" && isChannel(task.channel) ? task.channel : undefined;
  const names: readonly string[] = channel !== undefined
    ? TASK_COMMAND_NAMES[channel]
    : [...new Set([...TASK_COMMAND_NAMES.voice, ...TASK_COMMAND_NAMES.chat, ...TASK_COMMAND_NAMES.email])];
  if (type === "custom") {
    into.filled(command.name, "command.custom.name", `${path}.name`, "a custom command names the control it presses");
  }
  if (type !== "custom" && !into.require(typeof type === "string" && names.includes(type), "command.type", `${path}.type`,
    channel === undefined ? `unsupported command: ${describeValue(type)}` : `a ${channel} task has no ${describeValue(type)} command`)) {
    return into.violations;
  }
  // Built-in commands carry only their declared fields; custom controls own their payload.
  // Recording already applies its action-specific field check below.
  if (type !== "custom" && type !== "recording") {
    let fields = ["type"];
    switch (type) {
      case "dial": case "connect-back": fields.push("dialId"); break;
      case "complete": fields.push("outcome", "notes"); break;
      case "schedule": fields.push("at", "note"); break;
      case "lead-assist":
        fields.push("action");
        if (command.action === "request") fields.push("note");
        break;
      case "conference":
        fields.push("action", "destinationId");
        fields.push(command.action === "add" ? "dialId" : "party");
        break;
    }
    for (const key of Object.keys(command)) into.require(fields.includes(key), "command.field", `${path}.${key}`,
      "field is not supported for this command");
  }
  const dial = (rule: string) => into.filled(command.dialId, rule, `${path}.dialId`, "a command that dials carries the host's dialId");
  switch (type) {
    case "dial":
      dial("command.dial.dialId");
      break;
    case "connect-back":
      dial("command.connectBack.dialId");
      break;
    case "schedule":
      into.timestamp(command.at, "command.schedule.at", `${path}.at`);
      if (command.note !== undefined) into.filled(command.note, "command.schedule.note", `${path}.note`, "a note must not be empty when present");
      break;
    case "lead-assist":
      into.oneOf(command.action, LEAD_ASSIST_ACTIONS, "command.leadAssist.action", `${path}.action`);
      if (command.note !== undefined) into.filled(command.note, "command.leadAssist.note", `${path}.note`, "a note must not be empty when present");
      break;
    case "conference":
      if (into.oneOf(command.action, CONFERENCE_ACTIONS, "command.conference.action", `${path}.action`)) {
        if (command.action === "add") {
          dial("command.conference.dialId");
          into.filled(command.destinationId, "command.conference.destinationId", `${path}.destinationId`, "a conference names the directory item it dials in");
        } else {
          const party = command.party === true;
          const item = isFilled(command.destinationId);
          into.require(party !== item, "command.conference.remove.target", path,
            "a remove names one person: the party, or a conferenced entry by its destinationId, never both and never neither");
        }
      }
      break;
    case "recording":
      into.violations.push(...validateRecordingCommandShape(command, "provider", path));
      break;
    case "complete":
      if (command.outcome !== undefined) into.filled(command.outcome, "command.complete.outcome", `${path}.outcome`, "an outcome must not be empty when present");
      if (command.notes !== undefined) into.require(typeof command.notes === "string", "command.complete.notes", `${path}.notes`, "notes must be a string when present");
      break;
    default:
      break;
  }
  if (task === undefined) return into.violations;
  // The task the command is held to has to be one the wire published. A host's own mapping of it,
  // handed in for want of the original, is not, and checking a command against it would be
  // checking against a task nobody has -- so the task is validated first, and a command is held
  // only to a task that stands.
  const published = new Collector();
  validateTaskInto(task, { ...taskContext, channel: channel ?? "voice" }, `${path}.task`, published);
  if (published.violations.length > 0 || !isPlainObject(task)) {
    into.add("command.task", `${path}.task`,
      `the task the command is held to is not one the wire published (${published.violations.map(v => v.rule).join(", ")}): pass the task as the provider sent it, or validate the command's shape alone`);
    return into.violations;
  }

  if (type === "custom") {
    // Held to the task: the control it presses is one the task published, and what the control asked for travels with it.
    const custom = isPlainObject(task) && isPlainObject(task.capabilities) ? task.capabilities.custom : undefined;
    const control = Array.isArray(custom) ? custom.filter(isPlainObject).find(entry => entry.id === command.name) : undefined;
    if (control === undefined) {
      into.add("command.capability.custom", path, `custom ${describeValue(command.name)} presses a control the task never published`);
      return into.violations;
    }
    if (isPlainObject(control.ui) && control.ui.control === "toggle") {
      into.require(typeof command.on === "boolean", "command.custom.on", `${path}.on`, "a custom toggle carries the state it wants as a boolean");
    }
    if (isPlainObject(control.prompt) && Array.isArray(control.prompt.fields)) {
      for (const field of control.prompt.fields.filter(isPlainObject)) {
        if (typeof field.name === "string" && (field.required === true || command[field.name] !== undefined)) {
          into.require(typeof command[field.name] === "string" && (field.required !== true || (command[field.name] as string).length > 0), "command.custom.prompt", `${path}.${field.name}`,
            `${field.name} must be a string when supplied, and a required field must have a value`);
        }
      }
    }
    return into.violations;
  }

  // What the task has to offer or be in for the command to be issuable.
  const capabilities = isPlainObject(task.capabilities) ? task.capabilities : {};
  const offered = (name: string): boolean => {
    const declared = capabilities[name];
    if (declared === undefined) {
      into.add(`command.capability.${name}`, path, `${describeValue(type)} needs the ${name} capability, and the task does not offer it`);
      return false;
    }
    if (isLocked(declared)) {
      into.add("command.capability.locked", path, `${name} stands locked by ${describeValue(declared.lockedBy)}: the control is present without permission`);
      return false;
    }
    return true;
  };
  const inPhase = (rule: string, ...phases: string[]) =>
    into.require(typeof task.phase === "string" && phases.includes(task.phase), rule, path, `${describeValue(type)} belongs to ${phases.join(" or ")}, and the task is ${describeValue(task.phase)}`);
  // A control on the contact acts on a contact being handled. Before in-progress there is nothing
  // to act on yet, and in completing this agent's interaction has ended. The caller and other
  // channels may continue elsewhere; this task's phase no longer permits these controls.
  const interaction = () => inPhase("command.phase.interaction", "in-progress", "paused");
  // A destination is one the directory offered: the id Omni sends is the id the provider published.
  const listed = (name: string) => {
    const declared = capabilities[name];
    const directory = isPlainObject(declared) && Array.isArray(declared.destinations) ? declared.destinations.filter(isPlainObject) : [];
    into.require(directory.some(item => item.id === command.destinationId), "command.destination.unknown", `${path}.destinationId`,
      `${describeValue(command.destinationId)} is not a destination the task's ${name} directory offered`);
  };
  const onCall = Array.isArray(task.onCall) ? task.onCall.filter(isPlainObject) : [];
  switch (type) {
    case "answer": case "accept": case "decline":
      inPhase("command.phase.pending", "pending");
      if (type === "decline") offered("decline");
      break;
    case "dial":
      inPhase("command.phase.preview", "preview");
      break;
    case "hold": case "resume": case "pause": offered("hold"); interaction(); break;
    case "end-call": offered("endCall"); interaction(); break;
    case "terminate-call": offered("terminateCall"); interaction(); break;
    case "recording": {
      if (!offered("recording")) break;
      const policy = isPlainObject(capabilities.recording) ? capabilities.recording.provider : undefined;
      const state = isPlainObject(task.recording) ? task.recording.provider : undefined;
      into.violations.push(...validateRecordingCommandState(command, policy, state, path));
      if (command.action === "start" || command.action === "resume") {
        interaction();
        into.require(task.audio === "started", "recording.request.phase", path, "capture needs live audio");
      } else inPhase("command.phase.interaction", "in-progress", "paused", "completing");
      break;
    }
    case "connect-back":
      offered("connectBack");
      inPhase("command.phase.completing", "completing");
      break;
    case "schedule":
      // A follow-up is promised on the call and written up in wrap alike.
      offered("schedule");
      inPhase("command.phase.interaction", "in-progress", "paused", "completing");
      break;
    case "lead-assist":
      interaction();
      offered("leadAssist");
      if (command.action === "cancel") {
        into.require(isPlainObject(task.leadAssist) && task.leadAssist.stage === "requested", "command.leadAssist.requested", path,
          "cancel needs a request standing: leadAssist with stage requested");
      }
      break;
    case "conference": {
      interaction();
      const conferencing = offered("conference");
      if (conferencing && command.action === "add") listed("conference");
      if (conferencing && command.action === "remove") {
        const others = onCall.filter(entry => entry.role !== "agent");
        if (command.party === true) {
          into.require(others.some(entry => entry.role !== "party"), "command.conference.remove.alone", path,
            "removing the party would leave the agent alone: that is end-call");
        } else if (isFilled(command.destinationId)) {
          into.require(onCall.some(entry => entry.role === "conferenced" && entry.destinationId === command.destinationId), "command.conference.remove.unknown", path,
            `no conferenced entry on onCall has destinationId ${describeValue(command.destinationId)}`);
          into.require(others.length > 1, "command.conference.remove.alone", path,
            "removing the last other person would leave the agent alone: that is end-call");
        }
      }
      break;
    }
    case "complete": {
      // The agent may finish early under either mode; the provider is free to end at once. With
      // no wrap at all there is no window to cut short, and nothing for the command to do.
      into.require(task.wrapAllowance !== 0, "command.complete.wrapAllowance", path,
        "the task has no wrap: with wrapAllowance 0 the provider ends it itself, and there is nothing to complete");
      // What travels with complete is what the outcomes capability published: a code from its
      // list where it has one, a code at all where it requires one, notes as it said, nothing where it published nothing.
      const outcomes = capabilities.outcomes;
      if (outcomes === undefined) {
        into.require(command.outcome === undefined, "command.complete.outcome.unexpected", `${path}.outcome`,
          "the task declares no outcomes; complete travels with no code");
        into.require(command.notes === undefined, "command.complete.notes.unexpected", `${path}.notes`,
          "the task declares no outcomes; complete travels with no notes");
      } else if (outcomes === true) {
        into.require(command.outcome === undefined, "command.complete.outcome.unexpected", `${path}.outcome`,
          "a bare outcomes control publishes no code, so complete carries none");
      } else if (isPlainObject(outcomes)) {
        if (Array.isArray(outcomes.codes) && command.outcome !== undefined) {
          into.require(outcomes.codes.some(code => isPlainObject(code) && code.id === command.outcome), "command.complete.outcome.unknown", `${path}.outcome`,
            `${describeValue(command.outcome)} is not a code the task published`);
        }
        if (outcomes.required === true) {
          into.require(command.outcome !== undefined, "command.complete.outcome.required", `${path}.outcome`,
            "the task requires an outcome and complete carries none");
        }
        if (outcomes.notes === "none") {
          into.require(command.notes === undefined, "command.complete.notes.unexpected", `${path}.notes`, "the task takes no notes");
        } else if (outcomes.notes === "required") {
          into.require(typeof command.notes === "string" && command.notes.length > 0, "command.complete.notes.required", `${path}.notes`, "the task requires notes and complete carries none");
        }
      }
      break;
    }
    default:
      break;
  }
  return into.violations;
}

/** The connection methods whose results `validateResult` knows. */
export type ResultMethod =
  | "execute"
  | "dial"
  | "setCapacity"
  | "requestBreak"
  | "commitBreak"
  | "cancelBreak"
  | "endBreak"
  | "executeTeam"
  | "openAudio"
  | "setPreference"
  | "recordStep";

// Pinned to the result unions: each method's one success status, and the status that carries a
// failure. A method added to `Connection` without a row here is a compile error at the call site.
const RESULT_STATUSES: Record<ResultMethod, { success: string; failure: string | undefined }> = {
  execute: { success: "applied", failure: "failed" },
  dial: { success: "dialling", failure: "failed" },
  // A statement, not a request: taken, never refused.
  setCapacity: { success: "applied", failure: undefined },
  requestBreak: { success: "requested", failure: "failed" },
  commitBreak: { success: "committed", failure: "failed" },
  cancelBreak: { success: "cancelled", failure: "failed" },
  endBreak: { success: "ended", failure: "failed" },
  executeTeam: { success: "applied", failure: "failed" },
  openAudio: { success: "opened", failure: "unavailable" },
  setPreference: { success: "applied", failure: "failed" },
  recordStep: { success: "recorded", failure: "failed" },
};

/**
 * Validates what a connection method answered. A result is untrusted for the same reason a
 * snapshot is: it comes from an adapter that may be compiled against another version, and Omni
 * shows the agent what it says. A status the method does not answer, a failure status without a
 * failure, a success carrying one, or an `omni.` code the contract lacks are each refused.
 */
export function validateResult(result: unknown, method: ResultMethod, path = "result", dialId?: string): ProtocolViolation[] {
  const into = new Collector();
  // A command that dials -- `dial`, or `execute` with a command carrying a `dialId` -- answers
  // `dialling` and restates the host's identity, so the host compares and confirms.
  const dials = method === "dial" || (method === "execute" && dialId !== undefined);
  const statuses = dials ? { success: "dialling", failure: RESULT_STATUSES[method].failure } : RESULT_STATUSES[method];
  if (!isPlainObject(result)) {
    into.add("result.shape", path, `${method} must answer an object`);
    return into.violations;
  }
  if (method === "openAudio" && result.status !== "opened") {
    into.require(result.audio === undefined, "result.audio.unexpected", `${path}.audio`, "only opened carries an audio session");
  }
  if (result.status === statuses.success) {
    into.require(result.failure === undefined, "result.failure.unexpected", `${path}.failure`,
      `${statuses.success} carries no failure`);
    if (method === "openAudio") {
      if (isPlainObject(result.audio)) {
        // Streams may come from another realm, and Node conformance runs have no MediaStream
        // constructor. Check the boundary shape without claiming to verify live audio.
        into.require(isPlainObject(result.audio.remoteAudio), "result.audio.remoteAudio", `${path}.audio.remoteAudio`, "an opened session carries its remote audio stream");
        for (const method of ["setMuted", "close"] as const) {
          into.require(typeof result.audio[method] === "function", `result.audio.${method}`, `${path}.audio.${method}`, `an audio session implements ${method}`);
        }
      } else {
        into.add("result.audio", `${path}.audio`, "opened carries the audio session");
      }
    }
    if (dials) {
      if (into.filled(result.dialId, "result.dialId", `${path}.dialId`, "dialling restates the dialId the host sent") && dialId !== undefined) {
        into.require(result.dialId === dialId, "result.dialId.mismatch", `${path}.dialId`,
          `the host dialled ${dialId} and the provider answered for ${describeValue(result.dialId)}`);
      }
    } else {
      into.require(result.dialId === undefined, "result.dialId.unexpected", `${path}.dialId`, `${statuses.success} dialled nothing and names no dial`);
    }
    if (method === "recordStep") into.timestamp(result.at, "result.recordStep.at", `${path}.at`);
  } else if (statuses.failure !== undefined && result.status === statuses.failure) {
    if (result.failure === undefined) {
      into.add("result.failure.required", `${path}.failure`, `${statuses.failure} carries the failure that says why`);
    } else {
      validateFailureInto(result.failure, `${path}.failure`, into);
    }
  } else {
    into.add("result.status", `${path}.status`,
      `${method} answers ${statuses.success} or ${statuses.failure}, not ${describeValue(result.status)}`);
  }
  return into.violations;
}

// ---------------------------------------------------------------------------
// Authentication.
// ---------------------------------------------------------------------------

/** An IANA zone name the runtime knows: `Asia/Kolkata` is one, an offset or a made-up name is not. */
export function isTimeZone(value: unknown): value is string {
  // The runtime accepts a bare offset such as +05:30 as a zone; this wire does not, since an
  // offset cannot say what day it is on either side of a daylight-saving change.
  if (typeof value !== "string" || value.trim() === "" || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Whether two zone names denote one zone: `Asia/Kolkata` and `Asia/Calcutta` do, and a name is judged by what it denotes. */
export function sameTimeZone(a: unknown, b: unknown): boolean {
  if (!isTimeZone(a) || !isTimeZone(b)) return false;
  const canonical = (zone: string) => new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
  return a === b || canonical(a) === canonical(b);
}

/** The zone a host sends at connect: required, and an IANA name. */
export function validateTimeZone(value: unknown, path = "context.timeZone"): ProtocolViolation[] {
  const into = new Collector();
  into.require(isTimeZone(value), "context.timeZone", path,
    "a host states the agent's time zone at connect as an IANA name, such as Asia/Kolkata; an offset cannot survive a daylight-saving boundary");
  return into.violations;
}

/**
 * What `getUserDetails(ids)` answered: an array of users, each one asked for, each a valid identity.
 * The provider may answer fewer than asked, which is what "unknown to it" looks like; it never
 * answers somebody nobody asked about.
 */
export function validateUserDetails(users: unknown, asked: readonly string[], path = "getUserDetails"): ProtocolViolation[] {
  const into = new Collector();
  if (!Array.isArray(users)) {
    into.add("getUserDetails.shape", path, "getUserDetails answers an array of users, empty when it knows none of them");
    return into.violations;
  }
  users.forEach((user: unknown, index: number) => {
    const at = `${path}[${index}]`;
    validateUser(user, "getUserDetails.user", at, into);
    if (isPlainObject(user) && typeof user.id === "string") {
      into.require(asked.includes(user.id), "getUserDetails.unasked", `${at}.id`, `${user.id} was not among the ids asked for`);
    }
  });
  return into.violations;
}

function validateUser(value: unknown, rule: string, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add(rule, path, "an identity must be an object");
    return;
  }
  into.require(isUserId(value.id), `${rule}.id`, `${path}.id`, "an identity needs a provider-issued user id");
  into.filled(value.displayName, `${rule}.displayName`, `${path}.displayName`, "an identity needs a display name");
  // Never absent: the host stated the zone at authentication, before this identity existed.
  into.require(isTimeZone(value.timeZone), `${rule}.timeZone`, `${path}.timeZone`,
    "every identity carries the agent's time zone as an IANA name, such as Asia/Kolkata; the host stated it at authentication");
}

function validateUserCapabilitiesInto(value: unknown, path: string, into: Collector, levels?: readonly string[]): void {
  if (!isPlainObject(value)) {
    into.add("authentication.capabilities.shape", path,
      "a usable login declares its capabilities: an object, {} when it has none");
    return;
  }
  for (const [name, declared] of Object.entries(value)) {
    if (declared === undefined) continue;
    if (!into.require((SESSION_CAPABILITIES as readonly string[]).includes(name), "authentication.capability.unknown",
      `${path}.${name}`, `unsupported session capability: ${name}`)) continue;
    if (name === "preferences") {
      if (Array.isArray(declared) && declared.length === 0) {
        into.add("authentication.capability.preferences.empty", `${path}.preferences`,
          "a login with nothing left to the person omits preferences rather than declaring an empty list");
      }
      validatePreferencesInto(declared, `${path}.preferences`, into, levels);
      continue;
    }
    into.require(declared === true, "authentication.capability.value", `${path}.${name}`,
      `${name} is declared by presence: send true or omit it`);
  }
}

/** What a login is validated against beyond its own shape. */
export interface LoginValidationContext {
  /** The level ids in force, from the manifest. The defaults when absent. */
  levels?: readonly string[];
}

/**
 * A failure an authentication reports: on a `rejected` start or completion, or on an `expired`
 * state. A provider names its own codes freely; an `omni.` code is the contract's and has to be one
 * it lists. `omni.phone-not-permitted` is never retryable: the agent's station is administrator
 * configuration, and trying again does not reconfigure it.
 */
function validateAuthenticationFailureInto(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("authentication.failure.shape", path, "a failure must be an object");
    return;
  }
  if (into.filled(value.code, "authentication.failure.code", `${path}.code`, "a failure needs a code") && (value.code as string).startsWith("omni.")) {
    into.require((OMNI_FAILURE_CODES as readonly string[]).includes(value.code as string), "failure.code.unknown", `${path}.code`,
      `${describeValue(value.code)} is not a failure code this contract defines`);
  }
  into.filled(value.message, "authentication.failure.message", `${path}.message`, "a failure needs a message");
  into.require(typeof value.retryable === "boolean", "authentication.failure.retryable", `${path}.retryable`, "a failure must say whether it is retryable");
  if (value.code === "omni.phone-not-permitted") {
    into.require(value.retryable === false, "authentication.failure.phone.retryable", `${path}.retryable`,
      "a phone the platform does not permit for this agent is configuration: trying again does not change it, so the refusal is not retryable");
  }
  if (value.retryAfterMs !== undefined) {
    into.require(typeof value.retryAfterMs === "number" && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0, "authentication.failure.retryAfterMs", `${path}.retryAfterMs`,
      "retryAfterMs must be a non-negative number when present");
  }
  if (value.field !== undefined) into.filled(value.field, "authentication.failure.field", `${path}.field`, "field names a declared credentials field when present");
}

export function validateAuthenticationFailure(failure: unknown, path = "failure"): ProtocolViolation[] {
  const into = new Collector();
  validateAuthenticationFailureInto(failure, path, into);
  return into.violations;
}

function validateAuthenticationChallenge(value: unknown, path: string, into: Collector): void {
  if (!isPlainObject(value)) {
    into.add("authentication.result.challenge", path, "interaction-required carries the challenge to put to the person");
    return;
  }
  into.filled(value.flowId, "authentication.challenge.flowId", `${path}.flowId`, "a challenge names the flow to complete or cancel");
  if (!into.oneOf(value.method, AUTHENTICATION_METHODS, "authentication.challenge.method", `${path}.method`)) return;
  if (value.method === "browser-sso") {
    into.filled(value.authorizationUrl, "authentication.challenge.authorizationUrl", `${path}.authorizationUrl`, "browser SSO carries the authorization URL to open");
    into.oneOf(value.browser, AUTHENTICATION_BROWSERS, "authentication.challenge.browser", `${path}.browser`);
  } else if (!Array.isArray(value.fields)) {
    into.add("authentication.challenge.fields", `${path}.fields`, "credentials carries the fields to render");
  } else {
    const seen = new Set<string>();
    value.fields.forEach((field: unknown, index: number) => {
      const at = `${path}.fields[${index}]`;
      if (!isPlainObject(field)) {
        into.add("authentication.challenge.field.shape", at, "a credentials field must be an object");
        return;
      }
      if (into.filled(field.name, "authentication.challenge.field.name", `${at}.name`, "a credentials field needs a name")) {
        into.require(!seen.has(field.name as string), "authentication.challenge.field.unique", `${at}.name`, "each credentials field has its own key in the submitted values");
        seen.add(field.name as string);
      }
      into.filled(field.label, "authentication.challenge.field.label", `${at}.label`, "a credentials field needs a label");
      into.oneOf(field.type, CREDENTIAL_FIELD_TYPES, "authentication.challenge.field.type", `${at}.type`);
      if (field.required !== undefined) into.require(typeof field.required === "boolean", "authentication.challenge.field.required", `${at}.required`, "required must be a boolean when present");
      if (field.autocomplete !== undefined) into.require(typeof field.autocomplete === "string", "authentication.challenge.field.autocomplete", `${at}.autocomplete`, "autocomplete must be a string when present");
    });
  }
}

/**
 * What `start()` or `complete()` answered: a challenge or a rejection from `start`, a login or a
 * rejection from `complete`. A rejection carries a failure the host can show, and a login is held
 * to the same rules as any `authenticated` state.
 */
export function validateAuthenticationResult(result: unknown, method: "start" | "complete", path = "result", context: LoginValidationContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(result)) {
    into.add("authentication.result.shape", path, `${method} must answer an object`);
    return into.violations;
  }
  if (result.status === "rejected") {
    validateAuthenticationFailureInto(result.failure, `${path}.failure`, into);
  } else if (method === "start" && result.status === "interaction-required") {
    validateAuthenticationChallenge(result.challenge, `${path}.challenge`, into);
    into.require(result.failure === undefined, "authentication.failure.unexpected", `${path}.failure`, "an authentication challenge carries no failure");
  } else if (method === "complete" && result.status === "authenticated") {
    into.violations.push(...validateAuthenticationState(result, path, context));
  } else {
    into.add("authentication.result.status", `${path}.status`,
      `${method} answers ${method === "start" ? "interaction-required" : "authenticated"} or rejected, not ${describeValue(result.status)}`);
  }
  if (result.status !== "interaction-required") {
    into.require(result.challenge === undefined, "authentication.challenge.unexpected", `${path}.challenge`, "only interaction-required carries a challenge");
  }
  return into.violations;
}

export function validateAuthenticationState(state: unknown, path = "authentication", context: LoginValidationContext = {}): ProtocolViolation[] {
  const into = new Collector();
  if (!isPlainObject(state)) {
    into.add("authentication.shape", path, "an authentication state must be an object");
    return into.violations;
  }
  if (!into.oneOf(state.status, AUTHENTICATION_STATUSES, "authentication.status", `${path}.status`)) {
    return into.violations;
  }

  // Only `authenticated` may carry an expiry, and only the states that know who the agent is
  // may carry an identity. Anything else is a state claiming knowledge it does not have.
  if (state.status === "authenticated" || state.status === "refreshing") {
    validateUser(state.identity, "authentication.identity", `${path}.identity`, into);
    validateUserCapabilitiesInto(state.capabilities, `${path}.capabilities`, into, context.levels);
  } else if (state.status === "expired") {
    if (state.identity !== undefined) validateUser(state.identity, "authentication.identity", `${path}.identity`, into);
    if (state.failure !== undefined) {
      validateAuthenticationFailureInto(state.failure, `${path}.failure`, into);
    }
  } else {
    into.require(state.identity === undefined, "authentication.identity.unexpected", `${path}.identity`,
      `${state.status} must not carry an identity`);
  }

  if (state.failure !== undefined) {
    into.require(state.status === "expired", "authentication.failure.unexpected", `${path}.failure`,
      "only an expired state may carry a failure");
  }
  if (state.expiresAt !== undefined) {
    into.require(state.status === "authenticated", "authentication.expiresAt.unexpected", `${path}.expiresAt`,
      "only an authenticated state may carry an expiry");
    into.timestamp(state.expiresAt, "authentication.expiresAt", `${path}.expiresAt`);
  }
  if (state.status !== "authenticated" && state.status !== "refreshing") {
    into.require(state.capabilities === undefined, "authentication.capabilities.unexpected", `${path}.capabilities`,
      `${state.status} must not carry capabilities`);
  }
  return into.violations;
}

// Independent current recording evidence and dispatch validation.

const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function collector() {
  const violations: ProtocolViolation[] = [];
  const check = (ok: unknown, rule: string, path: string, message: string) => {
    ruleEvaluated(`recording.${rule}`);
    if (!ok) violations.push({ rule: `recording.${rule}`, path, message });
    return Boolean(ok);
  };
  const keys = (v: Record<string, unknown>, allowed: string[], path: string) => {
    for (const key of Object.keys(v)) check(allowed.includes(key), "field", `${path}.${key}`, "field is not permitted in this recording variant");
  };
  return { violations, check, keys };
}
/** Recording observations use canonical UTC millisecond instants, never native capture boundaries. */
function instant(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return false;
  const n = Date.parse(v);
  return Number.isFinite(n) && new Date(n).toISOString() === v;
}
export function validateRecordingState(value: unknown, path = "recording"): ProtocolViolation[] {
  const { violations, check, keys } = collector();
  if (!object(value)) { check(false, "state.shape", path, "expected recording state"); return violations; }
  if (value.status === "unknown") { keys(value, ["status"], path); return violations; }
  check(["inactive", "active", "paused"].includes(value.status as string), "state.status", `${path}.status`, "expected unknown, inactive, active or paused");
  keys(value, ["status", "observationId", "observedAt", "validUntil", ...(value.status === "inactive" ? [] : ["recordingId"])], path);
  check(filled(value.observationId), "observationId", `${path}.observationId`, "a confirming observation has an opaque identity");
  check(instant(value.observedAt), "observedAt", `${path}.observedAt`, "expected canonical UTC millisecond observation instant");
  check(instant(value.validUntil), "validUntil", `${path}.validUntil`, "expected canonical UTC millisecond expiry instant");
  if (instant(value.observedAt) && instant(value.validUntil)) check(value.observedAt < value.validUntil, "expiry", path, "expiry must be strictly after observation");
  if (value.status !== "inactive") check(filled(value.recordingId), "recordingId", `${path}.recordingId`, "active and paused states identify the actual recording");
  return violations;
}
/** Supply a trusted current instant in the observer's clock domain. Undefined means clock unknown. */
export function effectiveRecordingState(state: RecordingState | undefined, now: number | undefined): RecordingState {
  if (state === undefined || validateRecordingState(state).length || state.status === "unknown" || now === undefined || !Number.isFinite(now)) return { status: "unknown" };
  return Date.parse(state.observedAt) <= now && now < Date.parse(state.validUntil) ? state : { status: "unknown" };
}
export function validateRecordingPolicy(value: unknown, path = "capabilities.recording"): ProtocolViolation[] {
  const { violations, check, keys } = collector();
  if (!object(value)) { check(false, "policy.shape", path, "expected per-task provider/host action policy; true is no longer supported"); return violations; }
  keys(value, ["provider", "host"], path);
  check(value.provider !== undefined || value.host !== undefined, "policy.empty", path, "declare at least one recording path");
  for (const source of ["provider", "host"] as const) {
    const policy = value[source]; if (policy === undefined) continue;
    const at = `${path}.${source}`;
    if (!object(policy)) { check(false, "policy.shape", at, "expected permitted actions"); continue; }
    keys(policy, [...RECORDING_ACTIONS, ...(source === "host" ? ["storageId"] : [])], at);
    check(RECORDING_ACTIONS.some(action => policy[action] !== undefined), "policy.empty", at, "omit paths offering no actions");
    for (const action of RECORDING_ACTIONS) {
      if (policy[action] === undefined) continue;
      check(policy[action] === true, "policy.action", `${at}.${action}`, "permission is true or absent");
    }
    if (source === "host") check(filled(policy.storageId), "storage", `${at}.storageId`, "host storage must be named per task");
  }
  return violations;
}
export function validateHostRecording(value: unknown, softphone: boolean, path = "host.recording"): ProtocolViolation[] {
  if (value === undefined) return [];
  const { violations, check, keys } = collector();
  check(softphone, "host.channel", path, "initial host recording requires voice softphone audio");
  if (!object(value)) { check(false, "host.shape", path, "expected host recording declaration and executor"); return violations; }
  keys(value, ["actions", "storageIds", "execute", "announcesToCaller"], path);
  if (value.announcesToCaller !== undefined) check(value.announcesToCaller === true, "host.announcesToCaller", `${path}.announcesToCaller`, "caller announcement guarantee is true or absent");
  for (const [key, allowed] of [["actions", RECORDING_ACTIONS], ["storageIds", undefined]] as const) {
    const list = value[key];
    if (!Array.isArray(list)) { check(false, "host.list", `${path}.${key}`, "expected explicit array"); continue; }
    check(new Set(list).size === list.length, "host.duplicate", `${path}.${key}`, "duplicate declaration");
    check(list.every(item => filled(item) && (allowed === undefined || (allowed as readonly string[]).includes(item))), "host.list", `${path}.${key}`, "unsupported or empty declaration");
    check(list.length > 0, "host.empty", `${path}.${key}`, "declare at least one supported value");
  }
  if (Array.isArray(value.actions)) {
    check(value.actions.includes("pause") === value.actions.includes("resume"), "host.pause", path, "a pausable host supports resume; task permissions may independently restrict it");
  }
  check(typeof value.execute === "function", "host.execute", `${path}.execute`, "host recording requires its own executor");
  return violations;
}
export function validateHostRecordings(value: unknown, path = "host.recordings"): ProtocolViolation[] {
  if (value === undefined) return [];
  const { violations, check, keys } = collector();
  if (!Array.isArray(value)) { check(false, "reports.shape", path, "expected full host recording report array"); return violations; }
  const seen = new Set<string>();
  value.forEach((report, i) => {
    const at = `${path}[${i}]`;
    if (!object(report)) { check(false, "report.shape", at, "expected scoped report"); return; }
    keys(report, ["assignmentId", "state"], at);
    check(filled(report.assignmentId), "report.scope", at, "report identifies the assignment");
    const key = JSON.stringify([report.assignmentId]);
    check(!seen.has(key), "report.duplicate", at, "one host state per assignment"); seen.add(key);
    violations.push(...validateRecordingState(report.state, `${at}.state`));
  });
  return violations;
}
export function validateRecordingCommandShape(value: unknown, source: "provider" | "host", path = "command"): ProtocolViolation[] {
  const { violations, check, keys } = collector();
  if (!object(value)) { check(false, "command.shape", path, "expected recording command"); return violations; }
  keys(value, ["type", "source", "observationId", "action", ...(value.action === "start" ? [] : ["recordingId"])], path);
  check(value.type === "recording" && value.source === source, "command.source", path, `this executor accepts only ${source} recording commands`);
  check((RECORDING_ACTIONS as readonly unknown[]).includes(value.action), "command.action", `${path}.action`, "unsupported recording action");
  for (const key of ["observationId", ...(value.action === "start" ? [] : ["recordingId"])]) check(filled(value[key]), "command.identity", `${path}.${key}`, "expected nonempty scoped identity");
  return violations;
}
/** One transition table shared by dispatch checks and outcome checks. */
const RECORDING_TRANSITIONS = {
  start: { from: ["inactive"], to: "active" },
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  stop: { from: ["active", "paused"], to: "inactive" },
  cancel: { from: ["active", "paused"], to: "inactive" },
} as const satisfies Record<RecordingAction, { from: readonly RecordingState["status"][]; to: RecordingState["status"] }>;

function recordingTransition(action: unknown) {
  return typeof action === "string" && Object.hasOwn(RECORDING_TRANSITIONS, action)
    ? RECORDING_TRANSITIONS[action as RecordingAction] : undefined;
}

/** Structural/state permission check. Dispatch MUST also call validateRecordingRequest for scope and freshness. */
export function validateRecordingCommandState(command: unknown, policy: unknown, state: unknown, path = "command"): ProtocolViolation[] {
  const { violations, check } = collector();
  if (!object(command)) { check(false, "command.shape", path, "expected recording command"); return violations; }
  const transition = recordingTransition(command.action);
  if (transition === undefined) { check(false, "command.action", `${path}.action`, "unsupported recording action"); return violations; }
  const permitted = object(policy) && policy[command.action as string] === true;
  check(permitted, "command.permission", path, "task does not permit this action on this recorder");
  if (!object(state) || validateRecordingState(state).length) { check(false, "command.state", path, "no validated current recorder observation"); return violations; }
  check((transition.from as readonly unknown[]).includes(state.status), "command.state", path, "action is invalid in the observed recorder state");
  check(command.observationId === state.observationId, "command.stale", path, "observation changed; reconcile before acting");
  if (command.action !== "start") check(command.recordingId === state.recordingId, "command.recordingId", path, "command targets another recording");
  return violations;
}
/** Validate immediately before dispatch using current task, host report and trusted observer-domain time. */
export function validateRecordingRequest(request: unknown, task: unknown, context: {
  source: "provider" | "host";
  now: number | undefined;
  host?: unknown;
  hostReport?: unknown;
  softphone?: boolean;
  /** The same provider/task context used to validate the published task. */
  taskContext?: Omit<TaskValidationContext, "channel">;
}, path = "request"): ProtocolViolation[] {
  const { violations, check, keys } = collector();
  if (!object(request) || !object(task)) { check(false, "request.shape", path, "request and current task required"); return violations; }
  violations.push(...validateTask(task, { ...context.taskContext, channel: "voice" }, `${path}.task`));
  keys(request, ["assignmentId", "command"], path);
  check(filled(request.assignmentId) && request.assignmentId === task.assignmentId, "request.scope", path, "task assignment changed or scope missing");
  check(task.channel === "voice", "request.channel", path, "recording is voice-only");
  violations.push(...validateRecordingCommandShape(request.command, context.source, `${path}.command`));
  if (!object(request.command)) return violations;
  const command = request.command;
  const caps = object(task.capabilities) ? task.capabilities.recording : undefined;
  violations.push(...validateRecordingPolicy(caps)); // a locked or missing capability cannot dispatch
  const policy = object(caps) ? caps[context.source] : undefined;
  let state: unknown = object(task.recording) ? task.recording.provider : undefined;
  if (context.source === "host") {
    violations.push(...validateHostRecording(context.host, context.softphone === true));
    check(object(context.host), "host.required", path, "host did not declare recording support");
    const reports = object(context.hostReport) ? context.hostReport.recordings : undefined;
    violations.push(...validateHostRecordings(reports));
    state = Array.isArray(reports) ? reports.find(r => object(r) && r.assignmentId === task.assignmentId)?.state : undefined;
    if (object(context.host)) {
      check(Array.isArray(context.host.actions) && context.host.actions.includes(command.action), "host.action", path, "host does not support action");
      check(object(policy) && Array.isArray(context.host.storageIds) && context.host.storageIds.includes(policy.storageId), "host.storage", path, "task storage is not one this host provisions");
    }
  }
  const fresh = effectiveRecordingState(state as RecordingState | undefined, context.now);
  check(fresh.status !== "unknown", "request.freshness", path, "current state or trusted observer time unavailable/expired");
  violations.push(...validateRecordingCommandState(command, policy, fresh, `${path}.command`));
  const opening = command.action === "start" || command.action === "resume";
  check(opening ? ["in-progress", "paused"].includes(task.phase as string) && task.audio === "started" : ["in-progress", "paused", "completing"].includes(task.phase as string), "request.phase", path, "capture needs live task audio; terminal controls may finish recordings during wrap-up");
  return violations;
}
/** Check recording-specific result semantics against the owner's confirming observations. */
export function validateRecordingOutcome(command: unknown, before: unknown, after: unknown, result: unknown, path = "recordingOutcome"): ProtocolViolation[] {
  const { violations, check } = collector();
  violations.push(...validateRecordingState(before, `${path}.before`), ...validateRecordingState(after, `${path}.after`));
  if (!object(command) || !object(before) || !object(after)) {
    check(false, "outcome.shape", path, "command and both observations required");
    return violations;
  }
  violations.push(...validateRecordingCommandShape(command, command.source === "host" ? "host" : "provider", `${path}.command`));
  // A rejected promise has no result: any independently evidenced state may follow it.
  if (result === undefined) return violations;
  violations.push(...validateResult(result, "execute", `${path}.result`));
  if (!object(result)) return violations;
  check(result.status === "applied" || result.status === "failed", "outcome.result", path, "recording never returns a dialling result");
  if (result.status === "failed") {
    check(before.status !== "unknown" && after.status === before.status && after.recordingId === before.recordingId, "outcome.noEffect", path, "failed promises confirmed no effect; ambiguous or partial effects have no result");
  } else if (result.status === "applied") {
    const transition = recordingTransition(command.action);
    if (transition === undefined) return violations; // shape validation already reported the unknown action
    check(after.status === transition.to, "outcome.state", path, "applied requires the confirming requested state");
    check(after.observationId !== before.observationId, "outcome.observation", path, "an applied transition needs new confirming evidence");
    check(before.observationId === command.observationId, "outcome.stale", path, "command must act against its named observation");
    check((transition.from as readonly unknown[]).includes(before.status), "outcome.origin", path, "applied cannot claim an impossible transition");
    if (command.action !== "start") check(command.recordingId === before.recordingId, "outcome.recordingId", path, "command must target the prior recording");
    if (command.action === "pause" || command.action === "resume") check(after.recordingId === before.recordingId, "outcome.continuity", path, "pause/resume preserves recording identity");
    if (instant(before.observedAt) && instant(after.observedAt)) check(after.observedAt >= before.observedAt, "outcome.order", path, "clock discontinuity requires reconciliation, not a reversed confirmation");
  }
  return violations;
}
