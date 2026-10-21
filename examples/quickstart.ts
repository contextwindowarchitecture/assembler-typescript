// Quickstart: assemble one support-chat request, then watch the assembler refuse one.
//
//   pnpm run quickstart
//
// A snapshot is everything assembly may look at, frozen: the items producers proposed, the route's policy, the
// placement profile, the budget, the tokenizer, the renderer and the clock. assemble() turns it into a payload and a
// trace, or a refusal and a trace, and reads nothing else (R-23). The README's Quickstart mirrors this file.
import { pathToFileURL } from 'node:url';
import { assemble, type Snapshot } from '@contextwindowarchitecture/assembler';

const NOW = '2026-10-21T12:00:00Z';

export interface Doc { id: string; body: string; relevance: number }

// What a retriever returned for the question, with its scores. The route below admits only chunks scoring 0.5 or more.
export const DOCS: Doc[] = [
  { id: 'kb:refunds', body: 'Pro plans can be refunded in full within 30 days of purchase.', relevance: 0.82 },
  { id: 'kb:pricing', body: 'The Pro plan costs $20 a month, billed annually.', relevance: 0.31 },
];

// Which producers may write which slots, and the rules for each slot. Versioned, so a trace names the policy it used.
const ROUTE_POLICY: Snapshot['route_policy'] = {
  route: 'support-chat',
  version: 'support-chat/v1',
  producers: {
    'policy-registry': { kind: 'policy', slots: ['governance.instructions'] },
    'docs-search': { kind: 'retrieval', slots: ['evidence.knowledge'] },
    conversation: { kind: 'interaction', slots: ['interaction.query'] },
  },
  slots: { 'evidence.knowledge': { min_relevance: 0.5 } },
  requires_evidence: true, // refuse rather than let the model answer from nothing (R-12)
};

// Where each slot lands in the request. Instructions go to the system channel; the rest is escaped material in the
// user message, so a retrieved chunk can never speak as the system (R-7, R-10).
const PROFILE: Snapshot['profile'] = {
  spec: 'cwa/draft',
  id: 'support-chat-default',
  version: 1,
  route: 'support-chat',
  model_family: null,
  route_policy_version: 'support-chat/v1',
  placement: [
    { slot: 'governance.instructions', wrap: 'system' },
    { slot: 'evidence.knowledge', wrap: 'xml:evidence' },
    { slot: 'interaction.query', wrap: 'xml:query' },
  ],
  evaluation: { status: 'unevaluated', suite: null, date: null, result: null, artifact: null },
};

/** An item with the eight fields every item carries; the slot's defaults fill in the rest (R-2, R-3). */
const item = (id: string, slot: string, authority: string, trust: string, body: string, extra: object = {}) =>
  ({ id, slot, source: `src:${id}`, source_version: '1', authority, trust, freshness: NOW, body, ...extra });

/** Freezes one request. Everything that can change the payload is in here; nothing is read later. */
export const buildSnapshot = (docs: Doc[]): Snapshot => ({
  assembly_time: NOW,
  scope: { tenant: 'acme', user: 'u_42', session: 's_1', task: 'support' },
  budget: { input: 8000, reserved_output: 1024, margin_percent: 10 }, // headroom for an estimating tokenizer
  profile: PROFILE,
  route_policy: ROUTE_POLICY,
  tokenizer: 'estimate-utf8/v1', // pass your model's own tokenizer for exact counts (see Extending)
  renderer: 'cwa-messages/v1', // {system, tools, messages}, ready to map onto a provider's request
  batches: [
    { producer: { id: 'policy-registry', kind: 'policy' }, excluded: [], items: [
      item('policy:tone', 'governance.instructions', 'governing', 'verified',
        'Answer from the evidence only, and say so when it does not cover the question.'),
    ] },
    { producer: { id: 'docs-search', kind: 'retrieval' }, excluded: [], items: docs.map(d =>
      item(d.id, 'evidence.knowledge', 'reference_only', 'unverified', d.body, { relevance: d.relevance })) },
    { producer: { id: 'conversation', kind: 'interaction' }, excluded: [], items: [
      item('turn:1', 'interaction.query', 'user', 'unverified', 'Can I get a refund on my Pro plan?'),
    ] },
  ],
  conflicts: [],
} as Snapshot);

/** What cwa-messages/v1 renders. */
export interface MessageRequest {
  system: { id: string; text: string }[];
  tools: { id: string; text: string }[];
  messages: { role: string; content: string }[];
}

/** Parameters for anthropic.messages.create, less model and max_tokens. */
export function toAnthropic(request: MessageRequest): Record<string, unknown> {
  const out: Record<string, unknown> = { system: request.system.map(e => e.text).join('\n\n'), messages: request.messages };
  // A tool's text is the body its capability producer wrote, in the provider's tool format.
  if (request.tools.length) out.tools = request.tools.map(t => JSON.parse(t.text) as unknown);
  return out;
}

/** Parameters for openai.chat.completions.create, less model. */
export function toOpenAI(request: MessageRequest): Record<string, unknown> {
  const system = request.system.map(e => ({ role: 'system', content: e.text }));
  const out: Record<string, unknown> = { messages: [...system, ...request.messages] };
  if (request.tools.length) out.tools = request.tools.map(t => JSON.parse(t.text) as unknown);
  return out;
}

export function main(log: (line: string) => void = console.log): void {
  const { payload, trace } = assemble(buildSnapshot(DOCS));
  const request = JSON.parse(new TextDecoder().decode(payload!)) as MessageRequest;
  log(JSON.stringify(toAnthropic(request), null, 2));
  log(`\n${trace.result!.input_tokens} tokens; left out:`);
  for (const row of trace.excluded) log(`  ${row.item_id}  ${row.reason}`);

  // The retriever found nothing: no payload, so no model call, and the trace says what to do next.
  const refused = assemble(buildSnapshot([])).trace;
  log(`\nrefused: ${refused.refused.reason}, recovery: ${refused.recovery?.action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
