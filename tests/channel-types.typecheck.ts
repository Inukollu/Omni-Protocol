// Compile-time assertions on the contract's channel arms and unions. Nothing here runs; every
// `@ts-expect-error` is a shape the contract must refuse, paired with the shape it must accept.
import {
  ConnectContext,
  LoginStore,
  InteractionReport,
  HostAudioOutput,
  BROWSER_ISOLATION_SCHEMES,
  OMNI_PROTOCOL_VERSION,
  type AuthenticationState,
  type CompleteAuthenticationResult,
  type HostReport,
  type OpenMediaRequest,
  type Manifest,
  type ProviderEvent,
  type Host,
  type OutcomeRules,
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
  type TeamMembers,
  type TaskBrowser,
  type TaskCommand,
  type OnCall,
  type TeamListenCommand,
  type TeamCapabilities,
} from "../src/index.js";

export const voiceManifest = {
  id: "voice-provider",
  displayName: "Voice Provider",
  channel: "voice",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  completionSettleMs: 5000,
  authenticationMethods: ["browser-sso"],
  idleCapabilities: {
    dial: { destinations: "any-number" },
  },
  dialOutcomes: ["answered", "no-answer"],
  phones: ["softphone"],
} satisfies Manifest<"voice">;
// @ts-expect-error A chat provider has no call to hear and lists no phones.
export const chatPhones: Manifest<"chat">["phones"] = ["softphone"];

export const chatManifest = {
  id: "chat-provider",
  displayName: "Chat Provider",
  channel: "chat",
  supportedProtocolVersions: [OMNI_PROTOCOL_VERSION],
  completionSettleMs: 5000,
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
  capabilities: { browsers: true, outcomes: true },
  capabilitySource: "queue",
  allocationId: "alloc-1",
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
  capabilitySource: "queue",
  allocationId: "alloc-1",
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
export const voiceHold: TaskCommand<"voice"> = { type: "hold" };
export const chatPause: TaskCommand<"chat"> = { type: "pause" };
// @ts-expect-error The microphone is the host's: no channel has a mute command for the provider.
export const voiceMute: TaskCommand<"voice"> = { type: "mute", muted: true };
// @ts-expect-error Chat has no call to hold; it pauses.
export const chatHold: TaskCommand<"chat"> = { type: "hold" };
// @ts-expect-error DTMF is not a task command: the tones travel with the audio, which is Omni's.
export const voiceDtmf: TaskCommand<"voice"> = { type: "dtmf", digits: "12" };

// The allowance is coupled to the mode: a provider that completes the task itself must say when;
// one waiting for `complete` may leave the deadline open.
export const untimedAgentCommandTask = { ...emailTask, id: "email-3", completionMode: "agent-command", wrapAllowance: undefined } satisfies Task<"email">;
export const timedProviderAutomaticTask = { ...emailTask, id: "email-4", completionMode: "provider-automatic", wrapAllowance: 0 } satisfies Task<"email">;
// @ts-expect-error provider-automatic completion needs an allowance to act on.
export const untimedProviderAutomaticTask: Task<"email"> = { ...emailTask, id: "email-5", completionMode: "provider-automatic", wrapAllowance: undefined };

// Connecting back belongs to voice: the capability and the command exist on no other channel.
export const connectBackCapableVoiceTask = { ...emailTask, id: "call-9", channel: "voice", capabilities: { connectBack: true, outcomes: true } } satisfies Task<"voice">;
export const voiceConnectBack: TaskCommand<"voice"> = { type: "connect-back", dialId: "dial-1" };
// @ts-expect-error Connecting back dials, and every dial carries the host's dialId.
export const unplacedConnectBack: TaskCommand<"voice"> = { type: "connect-back" };
// @ts-expect-error Chat has nobody to connect back to.
export const chatConnectBackCapability: Task<"chat">["capabilities"] = { connectBack: true };
// @ts-expect-error Email has nobody to connect back to.
export const emailConnectBack: TaskCommand<"email"> = { type: "connect-back", dialId: "dial-1" };

// A transfer is cold or warm with a destination, or one of the two steps that finish a warm one.
export const coldTransfer: TaskCommand<"voice"> = { type: "transfer", action: "cold", dialId: "dial-2", destinationId: "tier2" };
// @ts-expect-error renamed away: a transfer says whether it is cold or warm; an arm with no action is gone.
export const actionlessTransfer: TaskCommand<"voice"> = { type: "transfer", dialId: "dial-2", destinationId: "tier2" };
export const consult: TaskCommand<"voice"> = { type: "transfer", action: "warm", dialId: "dial-3", destinationId: "tier2" };
// @ts-expect-error A transfer dials its destination, so it carries the host's dialId.
export const unplacedTransfer: TaskCommand<"voice"> = { type: "transfer", destinationId: "tier2" };
export const completeConsultation: TaskCommand<"voice"> = { type: "transfer", action: "complete" };
export const cancelConsultation: TaskCommand<"voice"> = { type: "transfer", action: "cancel" };
// @ts-expect-error A transfer says where the customer goes, or which consult step it is.
export const aimlessTransfer: TaskCommand<"voice"> = { type: "transfer" };
// @ts-expect-error Completing a consultation names no destination: there is exactly one already.
export const overdeterminedCompletion: TaskCommand<"voice"> = { type: "transfer", action: "complete", destinationId: "tier2" };
// Who is on the call is voice-only, like the commands that bring people onto it.
export const consultingVoiceTask = { ...emailTask, id: "call-10", channel: "voice", capabilities: { warmTransfer: { destinations: [{ id: "tier2", label: "Tier 2" }] } }, phase: "paused", onCall: [{ role: "consulted", destinationId: "tier2", dialId: "dial-3", stage: "ringing", since: "2026-08-21T09:05:00Z" }] } satisfies Task<"voice">;
// @ts-expect-error A dialled entry says where it stands: ringing or joined.
export const unstagedConsulted: OnCall = { role: "consulted", destinationId: "tier2", since: "2026-08-21T09:05:00Z" };
// @ts-expect-error Email has nobody on a call.
export const consultingEmailTask: Task<"email"> = { ...emailTask, id: "email-6", onCall: [{ role: "consulted", destinationId: "tier2", stage: "joined", since: "2026-08-21T09:05:00Z" }] };
// @ts-expect-error A party was dialled from nowhere and names no destination.
export const misplacedParty: OnCall = { role: "party", destinationId: "tier2", since: "2026-08-21T09:05:00Z" };
// The party being connected back carries the host's dial and its stage, together and only together.
export const partyRinging: OnCall = { role: "party", dialId: "dial-9", stage: "ringing", since: "2026-08-21T09:05:00Z" };
// A callback the platform places on the same task: the party ringing, no host dial.
export const partyCalledBack: OnCall = { role: "party", stage: "ringing", since: "2026-08-21T09:05:00Z" };
// @ts-expect-error A dial with no stage is half a claim.
export const partyDialledStageless: OnCall = { role: "party", dialId: "dial-9", since: "2026-08-21T09:05:00Z" };
// @ts-expect-error An agent on the call is named by user id, not by a destination.
export const misplacedAgent: OnCall = { role: "agent", destinationId: "tier2", since: "2026-08-21T09:05:00Z" };

// A conference add dials and carries the host's dialId; a remove names who leaves, as the room names them.
export const addToConference: TaskCommand<"voice"> = { type: "conference", action: "add", dialId: "dial-4", destinationId: "tier2" };
export const removeFromConference: TaskCommand<"voice"> = { type: "conference", action: "remove", destinationId: "tier2" };
export const removeTheCustomer: TaskCommand<"voice"> = { type: "conference", action: "remove", party: true };
// @ts-expect-error A remove names one person: the party, or a directory item, never both.
export const removeEverybody: TaskCommand<"voice"> = { type: "conference", action: "remove", party: true, destinationId: "tier2" };
// @ts-expect-error A remove names one person; naming nobody is end-call.
export const removeNobody: TaskCommand<"voice"> = { type: "conference", action: "remove" };
export const endTheCall: TaskCommand<"voice"> = { type: "end-call" };
// @ts-expect-error renamed away: the agent ends the call; disconnect was the engineer's word.
export const disconnectTheCall: TaskCommand<"voice"> = { type: "disconnect" };
// @ts-expect-error A conference add is a dial, so it carries the host's dialId.
export const unplacedConferenceAdd: TaskCommand<"voice"> = { type: "conference", action: "add", destinationId: "tier2" };
// @ts-expect-error renamed away: the address a conference dials is its destination, as on every other dial.
export const conferenceParticipant: TaskCommand<"voice"> = { type: "conference", action: "add", dialId: "dial-4", participant: "+14155550111" };

// A dial ends one way or another, and only voice has dials to end.
export const voiceDialOutcomes: Manifest<"voice">["dialOutcomes"] = ["answered", "no-answer"];
// @ts-expect-error Chat dials nothing and declares no dial outcomes.
export const chatDialOutcomes: Manifest<"chat">["dialOutcomes"] = ["answered", "no-answer"];

// Preview: the record is on the agent's screen; they press Call, which dials. Voice only.
export const previewTask = { ...emailTask, id: "call-13", channel: "voice", capabilities: {}, phase: "preview", previewEndsAt: "2026-08-21T09:02:00Z", atDeadline: "calls" } satisfies Task<"voice">;
export const pressCall: TaskCommand<"voice"> = { type: "call", dialId: "dial-6" };
// @ts-expect-error Pressing Call dials, and every dial carries the host's dialId.
export const unplacedCall: TaskCommand<"voice"> = { type: "call" };
// @ts-expect-error renamed away: the agent presses Call; the old two-word command is gone.
export const startCall: TaskCommand<"voice"> = { type: "start-call" };
export const waitingDeadline: Task<"voice">["atDeadline"] = "waits";
// @ts-expect-error Preparation expiry must not withdraw the task.
export const expiredPreviewDeadline: Task<"voice">["atDeadline"] = "expires";

// Listening: the lead's own task while they listen, voice only, in one of three modes.
export const listeningLeadTask = { ...emailTask, id: "call-12", channel: "voice", capabilities: {}, listening: { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "coach", since: "2026-08-21T09:04:00Z" } } satisfies Task<"voice">;
// @ts-expect-error Email has no call to listen to.
export const listeningEmailTask: Task<"email"> = { ...emailTask, id: "email-7", listening: { memberId: "A-1", taskId: "call-42", allocationId: "alloc-42", mode: "listen", since: "2026-08-21T09:04:00Z" } };
export const startListen: TeamListenCommand = { type: "listen", memberId: "A-1" };
export const coach: TeamListenCommand = { type: "coach" };
// @ts-expect-error There is no take-over in listening; a lead who wants the call uses lead assist.
export const listenTakeOver: TeamListenCommand = { type: "take-over-call" };
export const listeningLead: TeamCapabilities = { listeningControl: ["listen", "coach"] };
// @ts-expect-error The modes are the three call-centre words.
export const eavesdropper: TeamCapabilities = { listeningControl: ["monitor"] };

// Lead assist: the agent asks and withdraws; the lead takes over or leaves. Voice only.
export const askLead: TaskCommand<"voice"> = { type: "lead-assist", action: "request", note: "Refund dispute" };
export const withdrawLead: TaskCommand<"voice"> = { type: "lead-assist", action: "cancel" };
export const leadTakesOver: TaskCommand<"voice"> = { type: "lead-assist", action: "take-over-call" };
export const leadLeaves: TaskCommand<"voice"> = { type: "lead-assist", action: "leave" };
// @ts-expect-error A chat has no call for a lead to join.
export const chatAskLead: TaskCommand<"chat"> = { type: "lead-assist", action: "request" };
export const leadRequestedTask = { ...emailTask, id: "call-11", channel: "voice", capabilities: { leadAssist: true }, leadAssist: { stage: "requested", since: "2026-08-21T09:04:00Z" } } satisfies Task<"voice">;
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
export const staleNotes = { required: true, notes: "hidden", codes: [] } satisfies OutcomeRules;
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
// The station is the host's: a softphone host states what its Mute does, and a silenced device says who silenced it.
export const streamMutingHost: Host = { guarantees: {}, mute: "stream", report: () => noAudioHere, subscribe: () => () => undefined };
// The connect context ties the mute kind to the phone: a softphone login states it, a desk phone or a conversation cannot.
const store: LoginStore = { get: async () => undefined, set: async () => undefined, delete: async () => undefined };
const seatless = { guarantees: {}, report: () => noAudioHere, subscribe: () => () => undefined };
export const softphoneLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, store, phone: "softphone", host: { ...reticentHost, mute: "stream" } };
export const deskPhoneLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, store, phone: "deskPhone", host: seatless };
export const chatLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, store, host: seatless };
// @ts-expect-error A softphone login's host states what its Mute does.
export const silentSoftphoneLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, store, phone: "softphone", host: seatless };
// @ts-expect-error A desk phone's microphone is the phone's: the host states no mute.
export const mutingDeskPhoneLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, store, phone: "deskPhone", host: { ...reticentHost, mute: "stream" } };
// @ts-expect-error Every connection carries the login's store.
export const storelessLogin: ConnectContext = { protocolVersion: 1, loginId: "s1", timeZone: "Pacific/Chatham", autoAcceptTasks: true, phone: "deskPhone", host: seatless };
export const stationMutingHost: Host = { guarantees: {}, mute: "station", report: () => noAudioHere, subscribe: () => () => undefined };
// @ts-expect-error A host mutes the stream it sends or the station's microphone; there is no third way.
export const softMutingHost: Host = { guarantees: {}, mute: "soft", report: () => noAudioHere, subscribe: () => () => undefined };
export const headsetMuted: HostAudioInput = { status: "available", localAudio: {} as MediaStream, flowing: false, mutedBy: "station" };
// @ts-expect-error A microphone that is not flowing says who silenced it.
export const silencedByNobody: HostAudioInput = { status: "available", localAudio: {} as MediaStream, flowing: false };
// @ts-expect-error A flowing microphone was silenced by nobody.
export const flowingYetMuted: HostAudioInput = { status: "available", localAudio: {} as MediaStream, flowing: true, mutedBy: "host" };
export const speakerOff: HostAudioOutput = { status: "available", flowing: false, mutedBy: "station" };
export const speakerUnknown: HostAudioOutput = { status: "available" };
export const hostMutedLeg: InteractionReport = { taskId: "call-1", allocationId: "alloc-1", step: "muted", at: "2026-08-21T09:00:00Z", mutedBy: "host" };
// @ts-expect-error A muted leg says whose the silence was.
export const anonymousMutedLeg: InteractionReport = { taskId: "call-1", allocationId: "alloc-1", step: "muted", at: "2026-08-21T09:00:00Z" };
// @ts-expect-error Only a muted leg has anyone to name for the silence.
export const mutedHold: InteractionReport = { taskId: "call-1", allocationId: "alloc-1", step: "held", at: "2026-08-21T09:00:00Z", mutedBy: "host" };
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
export const recordedTask = { ...emailTask, id: "email-14", interactionHistory: { steps: [{ step: "answered", at: "2026-08-21T00:59:41Z", by: "a-17" }], interactionSeconds: 312, transfers: 1 } } satisfies Task<"email">;
export const bareStepsTask = { ...emailTask, id: "email-15", interactionHistory: { steps: [] } } satisfies Task<"email">;
export const arrayRecordTask = { ...emailTask, id: "email-16",
  // @ts-expect-error The record is an object carrying its steps and what they add up to, not a bare array.
  interactionHistory: [{ step: "answered", at: "2026-08-21T00:59:41Z" }] } satisfies Task<"email">;
export const revivableError = { type: "transport-status", status: "error", recovery: "reconnect" } satisfies ProviderEvent<"voice">;
// @ts-expect-error An error names its recovery; the type does not let it stay silent.
export const silentError = { type: "transport-status", status: "error" } satisfies ProviderEvent<"voice">;
export const plainActive = { type: "transport-status", status: "active",
  // @ts-expect-error Recovery goes with an error; an active status has nothing to revive.
  recovery: "reconnect" } satisfies ProviderEvent<"voice">;
// @ts-expect-error An email task cannot be a joined call.
export const emailAssisting: Task<"email"> = { ...emailTask, id: "email-7", assisting: { memberId: "A-1", since: "2026-08-21T09:05:00Z" } };

// What the login may do travels with the identity, and nowhere else.
const asha = { id: "1042", displayName: "Asha Rao", timeZone: "Asia/Kolkata" };
export const leadLogin: AuthenticationState = { status: "authenticated", identity: asha, capabilities: { breaks: true, team: { breakControl: true, leadAssistControl: true } } };
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
export const teamMembers: TeamMembers = { members: [], requests: [] };
// @ts-expect-error What the lead may do is on the login, not the team member list.
export const teamMembersWithControl: TeamMembers = { members: [], breakControl: true };

// The host reports; a request may lack the microphone, and a ready input may not.
export const openWithoutHostAudio: OpenMediaRequest = { taskId: "call-42", allocationId: "alloc-42" };
// Everything that names a task after the fact names its life: a task id alone could land on the next customer under a reused id.
export const endedEvent: ProviderEvent<"voice"> = { type: "task-ended", taskId: "call-42", allocationId: "alloc-42", outcome: { type: "completed", by: "agent" } };
// @ts-expect-error An ending names the allocation it ends.
export const endedByIdAlone: ProviderEvent<"voice"> = { type: "task-ended", taskId: "call-42", outcome: { type: "completed", by: "agent" } };
// @ts-expect-error A command names the life it acts on.
export const commandByIdAlone: TaskCommandRequest<"voice"> = { taskId: "call-42", command: { type: "hold" } };
export const noMicrophone: HostReport = { online: true, audio: { input: { status: "unavailable", reason: "in-use", failure: { code: "host.in-use", message: "Another application holds the microphone", retryable: true } }, output: { status: "unavailable", reason: "no-device", failure: { code: "host.no-speaker", message: "No speaker", retryable: true } } } };
export const noAudioHere: HostReport = { online: true };
// @ts-expect-error An available input carries the microphone it captured and says whether audio flows.
export const readyWithoutAudio: HostReport = { online: true, audio: { input: { status: "available" }, output: { status: "available" } } };

// Who decides: a control the queue could allow may stand locked in its place, naming the level;
// a preference carries who set it; only hold and skills are ever the person's.
export const lockedRecording: Task<"voice"> = { ...emailTask, id: "call-12", channel: "voice", capabilities: { hold: true, recording: { lockedBy: "team", reason: "Nobody on this team records" } }, party: { name: "Asha", number: { lockedBy: "org" }, email: { lockedBy: "site" } } };
// @ts-expect-error An email task has no recording to lock.
export const emailLockedRecording: Task<"email"> = { ...emailTask, capabilities: { recording: { lockedBy: "team" } } };
// @ts-expect-error Mute is the host's, never a capability the provider declares or locks.
export const lockedMute: Task<"voice"> = { ...emailTask, id: "call-13", channel: "voice", capabilities: { mute: { lockedBy: "team" } } };
export const skillChoice: AgentPreference = { id: "skill:billing", label: "Billing", enabled: true, setBy: "person" };
// @ts-expect-error Connecting back is the team's, never the person's.
export const connectBackChoice: AgentPreference = { id: "connectBack", label: "Connect back", enabled: false, setBy: "team" };
export const inheritAgain: SetPreferenceRequest = { id: "hold", inherit: true };
// @ts-expect-error Mute is the host's, never a preference the provider keeps.
export const muteChoice: AgentPreference = { id: "mute", label: "Mute", enabled: true, setBy: "person" };
export const teamHold: TeamPolicy = { setting: "off", setBy: "team" };
export const siteRecording: TeamPolicy = { setting: "on", setBy: "site", lockedBy: "site" };

// team may leave to the person.

// @ts-expect-error renamed away: the former report export is not a compatibility alias
import type { HandlingReport } from "../src/index.js";
// @ts-expect-error renamed away: task snapshots use the interaction field
export type FormerHistoryField = Task["handlingHistory"];
// @ts-expect-error renamed away: provider manifests require the completion bound
export type FormerCompletionBound = Manifest["disposalSettleMs"];

// @ts-expect-error renamed away: outcome types replace the former export, without aliases
import type { DispositionRules } from "../src/index.js";
// @ts-expect-error renamed away: complete commands carry outcome, not the former field
export const formerOutcomeCommand: TaskCommand = { type: "complete", disposition: "resolved" };
// @ts-expect-error renamed away: task capabilities expose outcomes
export type FormerOutcomeCapability = Task["capabilities"]["dispositions"];

// @ts-expect-error renamed away: TeamMembers replaces the former type without an alias
import type { TeamRoster } from "../src/index.js";
// @ts-expect-error renamed away: use validateTeamMembers
import { validateTeamRoster } from "../src/validation.js";

export const joinCallListenCommand = { type: "join-call" } satisfies import("../src/index.js").TeamListenCommand;
// @ts-expect-error renamed away: the listen action is join-call
export const formerListenCommand = { type: "barge" } satisfies import("../src/index.js").TeamListenCommand;
// @ts-expect-error renamed away: listening state uses join-call too
export const formerListeningMode: import("../src/index.js").ListeningMode = "barge";

// @ts-expect-error renamed away: use the coach action
export const formerCoachCommand: TeamListenCommand = { type: "whisper" };
// @ts-expect-error renamed away: listening state uses coach too
export const formerCoachMode: import("../src/index.js").ListeningMode = "whisper";

// @ts-expect-error renamed away: use TeamListenCommand
import type { TeamMonitorCommand } from "../src/index.js";
// @ts-expect-error renamed away: use listening
export type FormerListeningField = Task["monitoring"];
// @ts-expect-error renamed away: use executeTeamListen
export type FormerListenMethod = import("../src/index.js").Connection["executeTeamMonitor"];

// @ts-expect-error The former lead-assist action has no compatibility alias.
export const retiredLeadTakeOver: TaskCommand<"voice"> = { type: "lead-assist", action: "take-over" };

export const forcedBreak: import("../src/index.js").ForcedBreak = { by: "lead-1", endsAutomatically: false };
export const forcedBreakState: import("../src/index.js").BreakState = { approval: "in-effect", mayAsk: false, forced: forcedBreak };
// @ts-expect-error The old break type has no compatibility alias.
import type { ImposedBreak } from "../src/index.js";
// @ts-expect-error Use forced, including when the new field is also present.
export const retiredBreakField: import("../src/index.js").BreakState = { ...forcedBreakState, imposed: forcedBreak };

export const forceMemberBreak: import("../src/index.js").TeamBreakCommand = { type: "force-break", memberId: "member-1", reasonId: "bio" };
// @ts-expect-error The retired place command has no compatibility alias.
export const retiredPlaceBreak: import("../src/index.js").TeamBreakCommand = { type: "place", memberId: "member-1" };

export const endMemberBreak: import("../src/index.js").TeamBreakCommand = { type: "end-forced-break", memberId: "member-1" };
// @ts-expect-error The former release command has no compatibility alias.
export const retiredReleaseBreak: import("../src/index.js").TeamBreakCommand = { type: "release", memberId: "member-1" };

// @ts-expect-error Use the specific end-forced-break command, not the interim end name.
export const ambiguousTeamBreakEnd: import("../src/index.js").TeamBreakCommand = { type: "end", memberId: "member-1" };

// @ts-expect-error Use force-break, not the interim generic force command.
export const ambiguousForceBreak: import("../src/index.js").TeamBreakCommand = { type: "force", memberId: "member-1" };

export const decideMemberBreak: import("../src/index.js").TeamBreakCommand = { type: "decide-break-request", memberId: "member-1", decision: "granted" };
// @ts-expect-error Use decide-break-request, not the retired generic decide command.
export const ambiguousBreakDecision: import("../src/index.js").TeamBreakCommand = { type: "decide", memberId: "member-1", decision: "denied" };

export const setTeamBreakPolicy: import("../src/index.js").TeamBreakCommand = { type: "set-break-policy", policy: "auto-approve" };
// @ts-expect-error Use set-break-policy, not the retired generic policy command.
export const ambiguousBreakPolicy: import("../src/index.js").TeamBreakCommand = { type: "policy", policy: "approval-required" };

export const requireBreakApproval: import("../src/index.js").TeamBreakCommand = { type: "set-break-policy", policy: "approval-required" };
// @ts-expect-error The old ask policy has no compatibility alias.
export const retiredAskPolicy: import("../src/index.js").TeamBreakCommand = { type: "set-break-policy", policy: "ask" };
