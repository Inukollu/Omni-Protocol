// Compile-time assertions on the contract's channel arms and unions. Nothing here runs; every
// `@ts-expect-error` is a shape the contract must refuse, paired with the shape it must accept.
import {
  BROWSER_ISOLATION_SCHEMES,
  OMNI_PROTOCOL_VERSION,
  type AuthenticationState,
  type CompleteAuthenticationResult,
  type HostReport,
  type OpenMediaRequest,
  type Manifest,
  type ProviderEvent,
  type Host,
  type DispositionRules,
  type HostAudioInput,
  type AcceptanceMode,
  type CapacityResult,
  type PersonalBrowserCapability,
  type PersonalBrowser,
  type AgentPreference,
  type SetPreferenceRequest,
  type TeamPolicy,
  type Snapshot,
  type Task,
  type TeamRoster,
  type TaskBrowser,
  type TaskCommand,
} from "../src/index.js";

export const voiceManifest = {
  id: "voice-provider",
  displayName: "Voice Provider",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["browser-sso"],
  idleCapabilities: {
    dial: { destinations: "any-number" },
  },
} satisfies Manifest<"voice">;

export const chatManifest = {
  id: "chat-provider",
  displayName: "Chat Provider",
  channel: "chat",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  authenticationMethods: ["credentials"],
  idleCapabilities: {
    contacts: true,
    // @ts-expect-error Dial is available only to a voice provider.
    dial: { destinations: "any-number" },
  },
} satisfies Manifest<"chat">;

export const ladderedManifest = {
  ...voiceManifest,
  orgLevels: [
    { id: "org", label: "Your organisation" },
    { id: "team", label: "Your queue group" },
    { id: "person", label: "You" },
  ],
} satisfies Manifest<"voice">;

export const mergedTiersManifest = {
  ...voiceManifest,
  // @ts-expect-error The field is orgLevels: a fixture keeping the old `levels` key must fail the build.
  levels: [{ id: "org", label: "Your organisation" }],
} satisfies Manifest<"voice">;

export const emailTask = {
  id: "email-1",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: { browsers: true, dispositions: true },
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  wrapAllowance: 60,
} satisfies Task<"email">;

export const invalidEmailTask = {
  id: "email-2",
  title: "Reply to customer",
  channel: "email",
  taskType: "Customer Support",
  capabilities: {
    // @ts-expect-error Hold is not an email task capability.
    hold: true,
  },
  phase: "in-progress",
  browsers: [],
  completionMode: "agent-command",
  wrapAllowance: 60,
} satisfies Task<"email">;

// A reusing browser declares its scheme, and a browser that does not reuse declares none.
// There is no default: sharing a signed-in session is a decision, not something to inherit.
export const reusingBrowser = {
  id: "crm", name: "CRM", purpose: "Contact record", url: "https://crm.example.com/contact/42",
  sharedSession: true,
  isolationScheme: BROWSER_ISOLATION_SCHEMES.PROVIDER_NAME__TASK_TYPE_NAME__TAB_NAME,
} satisfies TaskBrowser;

export const isolatedBrowser = {
  id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/",
  sharedSession: false,
} satisfies TaskBrowser;

// Each refused shape sits on one line so the directive above it covers wherever tsc anchors it.
// @ts-expect-error A reusing browser with no isolation scheme does not compile.
export const reusingBrowserWithoutAScheme: TaskBrowser = { id: "crm", name: "CRM", purpose: "Contact record", url: "https://crm.example.com/contact/42", sharedSession: true };
// @ts-expect-error A browser that does not reuse has no scheme to declare.
export const isolatedBrowserWithAScheme: TaskBrowser = { id: "kb", name: "Knowledge", purpose: "Article lookup", url: "https://kb.example.com/", sharedSession: false, isolationScheme: BROWSER_ISOLATION_SCHEMES.TAB_NAME };

// Every command reaches the provider through `execute`; the union is the channel's whole set.
export const voiceMute: TaskCommand<"voice"> = { type: "mute", muted: true };
export const chatPause: TaskCommand<"chat"> = { type: "pause" };
// @ts-expect-error Chat has no microphone to mute.
export const chatMute: TaskCommand<"chat"> = { type: "mute", muted: true };
// @ts-expect-error DTMF is not a task command: the tones travel with the audio, which is Omni's.
export const voiceDtmf: TaskCommand<"voice"> = { type: "dtmf", digits: "12" };

// The allowance is coupled to the mode: a provider that completes the task itself must say when;
// one waiting for `complete` may leave the deadline open.
export const untimedAgentCommandTask = { ...emailTask, id: "email-3", completionMode: "agent-command", wrapAllowance: undefined } satisfies Task<"email">;
export const timedProviderAutomaticTask = { ...emailTask, id: "email-4", completionMode: "provider-automatic", wrapAllowance: 0 } satisfies Task<"email">;
// @ts-expect-error provider-automatic completion needs an allowance to act on.
export const untimedProviderAutomaticTask: Task<"email"> = { ...emailTask, id: "email-5", completionMode: "provider-automatic", wrapAllowance: undefined };

// Calling back belongs to voice: the capability and the command exist on no other channel.
export const callbackCapableVoiceTask = { ...emailTask, id: "call-9", channel: "voice", capabilities: { callback: true, dispositions: true } } satisfies Task<"voice">;
export const voiceCallback: TaskCommand<"voice"> = { type: "callback" };
// @ts-expect-error Chat has nobody to call back.
export const chatCallbackCapability: Task<"chat">["capabilities"] = { callback: true };
// @ts-expect-error Email has nobody to call back.
export const emailCallback: TaskCommand<"email"> = { type: "callback" };

// A transfer is blind with a destination, or one of the three consult steps; never both at once.
export const blindTransfer: TaskCommand<"voice"> = { type: "transfer", destination: "+14155550111" };
export const consult: TaskCommand<"voice"> = { type: "transfer", action: "consult", destination: "+14155550111" };
export const completeConsultation: TaskCommand<"voice"> = { type: "transfer", action: "complete" };
export const cancelConsultation: TaskCommand<"voice"> = { type: "transfer", action: "cancel" };
// @ts-expect-error A transfer says where the customer goes, or which consult step it is.
export const aimlessTransfer: TaskCommand<"voice"> = { type: "transfer" };
// @ts-expect-error Completing a consultation names no destination: there is exactly one already.
export const overdeterminedCompletion: TaskCommand<"voice"> = { type: "transfer", action: "complete", destination: "+14155550111" };
// The consultation in progress is voice-only, like the capability that starts it.
export const consultingVoiceTask = { ...emailTask, id: "call-10", channel: "voice", capabilities: { consultTransfer: true }, phase: "paused", consultation: { destination: "+14155550111" } } satisfies Task<"voice">;
// @ts-expect-error Email has nobody to consult.
export const consultingEmailTask: Task<"email"> = { ...emailTask, id: "email-6", consultation: { destination: "+14155550111" } };

// Consulting a lead: the agent asks and withdraws; the lead takes over or leaves. Voice only.
export const askLead: TaskCommand<"voice"> = { type: "lead", action: "request", note: "Refund dispute" };
export const withdrawLead: TaskCommand<"voice"> = { type: "lead", action: "cancel" };
export const leadTakesOver: TaskCommand<"voice"> = { type: "lead", action: "take-over" };
export const leadLeaves: TaskCommand<"voice"> = { type: "lead", action: "leave" };
// @ts-expect-error A chat has no call for a lead to join.
export const chatAskLead: TaskCommand<"chat"> = { type: "lead", action: "request" };
export const leadRequestedTask = { ...emailTask, id: "call-11", channel: "voice", capabilities: { consultLead: true }, lead: { stage: "requested", since: "2026-08-21T09:04:00Z" } } satisfies Task<"voice">;
export const leadsOwnTask = { ...emailTask, id: "call-11", channel: "voice", capabilities: {}, assisting: { memberId: "A-1", since: "2026-08-21T09:05:00Z" } } satisfies Task<"voice">;
export const liveAudioTask = { ...emailTask, id: "call-12", channel: "voice", capabilities: {}, media: "started" } satisfies Task<"voice">;
export const audiolessEmailTask = { ...emailTask, id: "email-9",
  // @ts-expect-error Real-time media is a voice affair; an email task carries no state for it.
  media: "started" } satisfies Task<"email">;
// @ts-expect-error A snapshot states its task count; a blank state cannot pass as a confirmed empty.
export const uncountedSnapshot = { transport: "active", loginId: "s-1", break: { approval: "not-requested", mayAsk: true }, tasks: [] } satisfies Snapshot<"voice">;
export const hiddenUrlBrowser = { id: "crm", name: "CRM", url: "https://crm.example.com/42", purpose: "Customer record", sharedSession: false, urlVisibility: "hidden" } satisfies TaskBrowser;
export const plainUrlBrowser = { id: "kb", name: "Knowledge", url: "https://kb.example.com/", purpose: "Article lookup", sharedSession: false } satisfies TaskBrowser;
export const partialUrlBrowser = { id: "kb", name: "Knowledge", url: "https://kb.example.com/", purpose: "Article lookup", sharedSession: false,
  // @ts-expect-error A URL is hidden, shown to its domain, or shown in full; there is no fourth word.
  urlVisibility: "partial" } satisfies TaskBrowser;
export const agentsOwnTab = { id: "tab-1", name: "Intranet", url: "https://intranet.example.com/" } satisfies PersonalBrowser;
// The renamed keys are refused by the type, so a fixture kept from an older release fails the build.
export const staleLogin = { transport: "active", break: { approval: "not-requested", mayAsk: true }, tasks: [], taskCount: 0,
  // @ts-expect-error The login is identified by loginId.
  sessionId: "session-1" } satisfies Snapshot<"voice">;
export const staleBreak = { transport: "active", loginId: "login-1", tasks: [], taskCount: 0,
  // @ts-expect-error Whether the agent may ask is mayAsk.
  break: { approval: "not-requested", accepting: true } } satisfies Snapshot<"voice">;
export const staleLadder = { ...voiceManifest,
  // @ts-expect-error The org's ladder is orgLevels.
  orgTiers: [{ id: "org", label: "Your organisation" }] } satisfies Manifest<"voice">;
export const staleWrap = { ...emailTask, id: "email-10",
  // @ts-expect-error The wrap allowance is wrapAllowance.
  completionAllowance: 30 } satisfies Task<"email">;
export const staleParty = { ...emailTask, id: "email-11",
  // @ts-expect-error The person on the other end is the party.
  contact: { name: "Asha" } } satisfies Task<"email">;
export const staleSharing = { id: "kb", name: "Knowledge", url: "https://kb.example.com/", purpose: "Article lookup",
  // @ts-expect-error A browser says whether its session is shared: sharedSession.
  reuse: false } satisfies TaskBrowser;
// @ts-expect-error The queue board is queue-summary.
export const staleSummary = { type: "provider-summary", summary: { title: "Sales", waitingCount: 0, updatedAt: "2026-08-21T09:00:00Z" } } satisfies ProviderEvent<"voice">;
export const stalePolicy = { setting: "on", setBy: "team" } satisfies TeamPolicy;
// @ts-expect-error What the team leaves to the individual is person, the level's own word.
export const staleAgentPolicy = { setting: "agent", setBy: "team" } satisfies TeamPolicy;
// @ts-expect-error No notes field is none; hidden is what a URL can be.
export const staleNotes = { required: true, notes: "hidden", codes: [] } satisfies DispositionRules;
// @ts-expect-error A microphone is available or unavailable.
export const staleMicrophone: HostAudioInput = { status: "ready", localAudio: {} as MediaStream, flowing: true };
// @ts-expect-error Acceptance is by consent or automatic.
export const staleOffer: AcceptanceMode = "require-agent-acceptance";
// @ts-expect-error The flag is consent; manual is a number typed by hand.
export const staleManual: AcceptanceMode = "manual";
// @ts-expect-error A capacity is applied.
export const staleCapacity: CapacityResult = { status: "accepted" };
export const staleAccessScope = { access: { mode: "allow-all" },
  // @ts-expect-error The access rules say what they apply to: accessAppliesTo.
  accessPolicyScope: "initial-url" } satisfies PersonalBrowserCapability;
export const promisingHost: Host = { guarantees: { browserUrlVisibility: true, personConsent: true }, report: () => noAudioHere, subscribe: () => () => undefined };
export const reticentHost: Host = { guarantees: {}, report: () => noAudioHere, subscribe: () => () => undefined };
export const lyingHost: Host = {
  // @ts-expect-error A guarantee is declared by presence; a host that does not make one omits it, never false.
  guarantees: { personConsent: false }, report: () => noAudioHere, subscribe: () => () => undefined };
export const consentOffer = { type: "task-offered", task: { ...emailTask, id: "email-12", phase: "pending", acceptance: "consent" } } satisfies ProviderEvent<"email">;
export const staleOfferMode = { type: "task-offered", task: { ...emailTask, id: "email-13", phase: "pending" },
  // @ts-expect-error Acceptance is the task's word now, not the offer's.
  acceptanceMode: "consent" } satisfies ProviderEvent<"email">;
export const spokenDiagnostic = { type: "diagnostic", expected: "a party arrives with a name", observed: "party 4471 arrived id-only", taskId: "call-42" } satisfies ProviderEvent<"voice">;
// @ts-expect-error A diagnostic says what was observed; a rule broken with nothing observed is half a sentence.
export const halfDiagnostic = { type: "diagnostic", expected: "a party arrives with a name" } satisfies ProviderEvent<"voice">;
export const handedTask = { ...emailTask, id: "email-14", inherited: { handleSeconds: 312, holdSeconds: 95, queueSeconds: 41, transfers: 1, handlers: ["a-17"] } } satisfies Task<"email">;
export const handlerlessTask = { ...emailTask, id: "email-15",
  // @ts-expect-error What is inherited names who handled it; the type requires the handlers.
  inherited: { handleSeconds: 312, holdSeconds: 95, queueSeconds: 41, transfers: 1 } } satisfies Task<"email">;
export const revivableError = { type: "transport-status", status: "error", recovery: "reconnect" } satisfies ProviderEvent<"voice">;
// @ts-expect-error An error names its recovery; the type does not let it stay silent.
export const silentError = { type: "transport-status", status: "error" } satisfies ProviderEvent<"voice">;
export const plainActive = { type: "transport-status", status: "active",
  // @ts-expect-error Recovery goes with an error; an active status has nothing to revive.
  recovery: "reconnect" } satisfies ProviderEvent<"voice">;
// @ts-expect-error An email task cannot be a joined call.
export const emailAssisting: Task<"email"> = { ...emailTask, id: "email-7", assisting: { memberId: "A-1", since: "2026-08-21T09:05:00Z" } };

// What the login may do travels with the identity, and nowhere else.
const asha = { id: "1042", displayName: "Asha Rao" };
export const leadLogin: AuthenticationState = { status: "authenticated", identity: asha, capabilities: { breaks: true, team: { breakControl: true, consultControl: true } } };
export const plainLogin: AuthenticationState = { status: "refreshing", identity: asha, capabilities: {} };
// @ts-expect-error A usable login says what it may do, {} included.
export const silentLogin: AuthenticationState = { status: "authenticated", identity: asha };
// @ts-expect-error A state that is not usable has nothing to declare.
export const expiredWithCapabilities: AuthenticationState = { status: "expired", identity: asha, capabilities: {} };
export const completed: CompleteAuthenticationResult = { status: "authenticated", identity: asha, capabilities: { breaks: true } };
// @ts-expect-error Completion says what the login may do, like the state it becomes.
export const completedSilently: CompleteAuthenticationResult = { status: "authenticated", identity: asha };
export const bareSnapshot: Snapshot<"voice"> = { transport: "active", loginId: "session-1", break: { approval: "not-requested", mayAsk: true }, tasks: [], taskCount: 0 };
// @ts-expect-error Capabilities live on the login, not the snapshot.
export const staleSnapshot: Snapshot<"voice"> = { ...bareSnapshot, sessionCapabilities: {} };
export const roster: TeamRoster = { members: [], requests: [] };
// @ts-expect-error What the lead may do is on the login, not the roster.
export const rosterWithControl: TeamRoster = { members: [], breakControl: true };

// The host reports; a request may lack the microphone, and a ready input may not.
export const openWithoutHostAudio: OpenMediaRequest = { taskId: "call-42" };
export const noMicrophone: HostReport = { online: true, audio: { input: { status: "unavailable", reason: "in-use", failure: { code: "host.in-use", message: "Another application holds the microphone", retryable: true } }, output: { status: "unavailable", reason: "no-device", failure: { code: "host.no-speaker", message: "No speaker", retryable: true } } } };
export const noAudioHere: HostReport = { online: true };
// @ts-expect-error An available input carries the microphone it captured and says whether audio flows.
export const readyWithoutAudio: HostReport = { online: true, audio: { input: { status: "available" }, output: { status: "available" } } };

// Who decides: a control the queue could allow may stand locked in its place, naming the level;
// a preference carries who set it; only hold, mute and skills are ever the person's.
export const lockedMute: Task<"voice"> = { ...emailTask, id: "call-12", channel: "voice", capabilities: { hold: true, mute: { lockedBy: "team", reason: "Nobody on this team mutes" } }, party: { name: "Asha", number: { lockedBy: "org" }, email: { lockedBy: "site" } } };
// @ts-expect-error An email task has no mute to lock.
export const emailLockedMute: Task<"email"> = { ...emailTask, capabilities: { mute: { lockedBy: "team" } } };
export const skillChoice: AgentPreference = { id: "skill:billing", label: "Billing", enabled: true, setBy: "person" };
// @ts-expect-error Callback is the team's, never the person's.
export const callbackChoice: AgentPreference = { id: "callback", label: "Callback", enabled: false, setBy: "team" };
export const inheritAgain: SetPreferenceRequest = { id: "mute", inherit: true };
export const teamMute: TeamPolicy = { setting: "off", setBy: "team" };
export const siteRecording: TeamPolicy = { setting: "on", setBy: "site", lockedBy: "site" };

// team may leave to the person.
