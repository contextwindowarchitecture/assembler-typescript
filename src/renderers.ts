// Renderers (conformance/README.md, Tokenizers and renderers). A renderer turns the placed items into payload
// bytes and counts them with the snapshot's tokenizer; fitting renders the whole payload for every fit test.
import { createHash } from 'node:crypto';
import { parseInstant } from './instant.js';
import { canonicalize, compareStrings } from './strings.js';
import type { Tokenizer } from './tokenizers.js';
import type { Profile, Slot } from './types.js';

type Placement = Profile['placement'];
const XML_WRAP = /^xml:[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Why a message request cannot realize a placement: platform roles stay with governance slots (R-7), and the system
 * text comes first. cwa-messages/v1 and cwa-message-blocks/v1 realize exactly the same profiles. */
function messageProblems(placement: Placement): string[] {
  let seenXml = false;
  return placement.flatMap(({ slot, wrap }, i) => {
    const problems: string[] = [];
    if (wrap !== 'system' && wrap !== 'tools' && !XML_WRAP.test(wrap)) problems.push(`placement[${i}] wraps ${wrap}, which is not system, tools or xml:<tag>`);
    else if (wrap === 'system' && !slot.startsWith('governance.')) problems.push(`placement[${i}] puts ${slot} in system`);
    else if (wrap === 'tools' && slot !== 'governance.capabilities') problems.push(`placement[${i}] puts ${slot} in tools`);
    else if (wrap === 'system' && seenXml) problems.push(`placement[${i}] puts system after an xml: placement`);
    seenXml ||= wrap.startsWith('xml:');
    return problems;
  });
}

const REALIZE: Record<string, (placement: Placement) => string[]> = {
  'fixture-xml/v1': placement => placement.flatMap(({ wrap }, i) =>
    XML_WRAP.test(wrap) ? [] : [`placement[${i}] wraps ${wrap}, which is not an xml:<tag> wrap`]),
  'cwa-messages/v1': messageProblems,
  'cwa-message-blocks/v1': messageProblems,
};

/** Why a renderer cannot realize a profile's placement; empty when it can, or when the renderer is unknown. A renderer
 * is known only as an own key of REALIZE, so an ID such as toString or __proto__ is unknown. */
export const realizationProblems = (renderer: string, placement: Placement): string[] =>
  Object.hasOwn(REALIZE, renderer) ? REALIZE[renderer]!(placement) : [];

/** The renderers this package provides, the only ones it renders with: it takes none of the application's own
 * (R-16). The list is frozen, so a caller cannot add an ID assemble() would accept and fail to render. A test holds
 * it to the published renderers, every required one among them. */
export const RENDERERS: readonly string[] = Object.freeze(Object.keys(REALIZE));

/**
 * The IDs of the renderers conformance/README.md publishes, in its order, those under Optional included, whether or
 * not this package provides them. A trace that names one always means its published rendering (R-16). The package
 * takes no renderer of the application's own, so none can take one of these IDs, and RENDERERS holds only IDs from
 * this list. A test holds it to the vendored README.
 */
export const PUBLISHED_RENDERERS: readonly string[] = Object.freeze(['fixture-xml/v1', 'cwa-messages/v1', 'cwa-message-blocks/v1']);

/** The renderers every implementation provides: the README's bullets before Optional. The conformance runner fails a
 * case that names one an implementation lacks rather than skipping it (Reporting results). */
export const REQUIRED_RENDERERS: readonly string[] = Object.freeze(['fixture-xml/v1', 'cwa-messages/v1']);

/** An item as the renderer sees it: the body is its current one, a variant once fitting has compressed it. */
export interface RenderItem {
  id: string;
  slot: Slot;
  body: string;
  lineage: string;
  /** When the item was observed; for a history turn, when it was said (R-2, R-7). */
  freshness: string;
  /** The id of the surfaced conflict group whose member this item is (R-11). */
  conflict?: string | undefined;
}

/** One rendered occurrence of an item, in payload order. */
export interface Occurrence {
  item: RenderItem;
  placement: number;
  /** The tokens of the body as this occurrence renders it: escaped in an xml: wrap, as-is in system and tools. An
   * xml: element's tags and a conflict mark's <conflict> wrapper count only in the payload's tokens. */
  tokens: number;
}

export interface Rendered {
  payload: Buffer;
  /** The renderer's count of the whole payload: result.input_tokens. */
  tokens: number;
  occurrences: Occurrence[];
}

const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const attribute = (text: string): string => escape(text).replaceAll('"', '&quot;');

/** A body as a placement's wrap renders it. */
export const renderedBody = (wrap: string, body: string): string => (wrap.startsWith('xml:') ? escape(body) : body);

function xmlElement(tag: string, item: RenderItem, speaker: boolean): string {
  let attributes = ` id="${attribute(item.id)}"`;
  if (speaker && item.slot === 'interaction.history') attributes += ` speaker="${item.lineage === 'generated' ? 'assistant' : 'user'}"`;
  if (item.conflict !== undefined) attributes += ` conflict="${attribute(item.conflict)}"`;
  return `<${tag}${attributes}>\n${escape(item.body)}\n</${tag}>\n`;
}

/** An entry of a message request: a system or tools entry, or a cwa-message-blocks/v1 content entry. */
interface Entry {
  id: string;
  text: string;
  /** The surfaced conflict group whose member the entry's item is (R-11). */
  conflict?: string;
}

/** A cwa-messages/v1 system or tools entry. A surfaced member's mark is in its text, the only part the model
 * receives (R-11); the body stays unescaped (R-10). */
function messagesEntry(item: RenderItem): Entry {
  if (item.conflict === undefined) return { id: item.id, text: item.body };
  return { id: item.id, text: `<conflict group="${attribute(item.conflict)}">\n${item.body}\n</conflict>`, conflict: item.conflict };
}

/** A cwa-message-blocks/v1 content entry: an xml: occurrence exactly as cwa-messages/v1 writes it into its content.
 * A surfaced member's mark stays in the text, its conflict attribute, and the entry names the group as a system
 * entry does (R-11). */
function blockEntry(tag: string, item: RenderItem): Entry {
  const text = xmlElement(tag, item, true);
  return item.conflict === undefined ? { id: item.id, text } : { id: item.id, text, conflict: item.conflict };
}

/** A payload's parts before counting: the texts the renderer counts, and each item occurrence in order. */
interface Layout {
  /** The payload text: fixture-xml/v1's document, or a message renderer's RFC 8785 request. */
  text: string;
  /** The texts the renderer's count sums: fixture-xml/v1's document; every system and tools text, conflict mark
   * included, and cwa-messages/v1's message content or each of cwa-message-blocks/v1's content entries. */
  counted: string[];
  occurrences: { item: RenderItem; placement: number; wrap: string }[];
}

/** A placement's items in every renderer's order (conformance/README.md, Ordering): by id, except that
 * interaction.history renders its turns in the order they were said, by freshness compared as instants at full
 * precision, and by id only among turns said at the same instant (R-7). */
function ordered(slot: Slot, items: readonly RenderItem[]): RenderItem[] {
  const inSlot = items.filter(item => item.slot === slot);
  if (slot !== 'interaction.history') return inSlot.sort((a, b) => compareStrings(a.id, b.id));
  const said = new Map(inSlot.map(item => [item, parseInstant(item.freshness)]));
  return inSlot.sort((a, b) => said.get(a)!.compare(said.get(b)!) || compareStrings(a.id, b.id));
}

function layout(renderer: string, placement: Placement, items: readonly RenderItem[]): Layout {
  const occurrences: Layout['occurrences'] = [];
  placement.forEach(({ slot, wrap }, index) => {
    for (const item of ordered(slot, items)) occurrences.push({ item, placement: index, wrap });
  });
  if (renderer === 'fixture-xml/v1') {
    const text = occurrences.map(({ item, wrap }) => xmlElement(wrap.slice(4), item, false)).join('');
    return { text, counted: [text], occurrences };
  }
  if (renderer === 'cwa-messages/v1' || renderer === 'cwa-message-blocks/v1') {
    const system: Entry[] = [];
    const tools: Entry[] = [];
    const blocks: Entry[] = [];
    for (const { item, wrap } of occurrences) {
      if (wrap === 'system' || wrap === 'tools') (wrap === 'system' ? system : tools).push(messagesEntry(item));
      else blocks.push(blockEntry(wrap.slice(4), item));
    }
    const roles = [...system, ...tools].map(e => e.text);
    if (renderer === 'cwa-messages/v1') {
      // One text holds every xml: occurrence: the blocks' texts joined in order.
      const content = blocks.map(e => e.text).join('');
      return { text: canonicalize({ system, tools, messages: [{ role: 'user', content }] }), counted: [...roles, content], occurrences };
    }
    // One entry per xml: occurrence, each counted on its own, as system and tools entries are.
    return { text: canonicalize({ system, tools, messages: [{ role: 'user', content: blocks }] }),
      counted: [...roles, ...blocks.map(e => e.text)], occurrences };
  }
  throw new Error(`renderer ${renderer} is not provided`);
}

const total = (texts: string[], count: Tokenizer): number => texts.reduce((sum, text) => sum + count(text), 0);

/** The renderer's count of the payload the items render to, without building the rest of the result. */
export const countPayload = (renderer: string, placement: Placement, items: readonly RenderItem[], count: Tokenizer): number =>
  total(layout(renderer, placement, items).counted, count);

export function render(renderer: string, placement: Placement, items: readonly RenderItem[], count: Tokenizer): Rendered {
  const { text, counted, occurrences } = layout(renderer, placement, items);
  return {
    payload: Buffer.from(text, 'utf8'),
    tokens: total(counted, count),
    occurrences: occurrences.map(({ item, placement: index, wrap }) => ({ item, placement: index, tokens: count(renderedBody(wrap, item.body)) })),
  };
}

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
