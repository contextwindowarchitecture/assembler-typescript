// Renderers (conformance/README.md, Tokenizers and renderers). A renderer turns the placed items into payload
// bytes and counts them with the snapshot's tokenizer; fitting renders the whole payload for every fit test.
import { createHash } from 'node:crypto';
import { canonicalize, compareStrings } from './strings.js';
import type { Tokenizer } from './tokenizers.js';
import type { Profile, Slot } from './types.js';

type Placement = Profile['placement'];
const XML_WRAP = /^xml:[A-Za-z_][A-Za-z0-9_.-]*$/;

const REALIZE: Record<string, (placement: Placement) => string[]> = {
  'fixture-xml/v1': placement => placement.flatMap(({ wrap }, i) =>
    XML_WRAP.test(wrap) ? [] : [`placement[${i}] wraps ${wrap}, which is not an xml:<tag> wrap`]),
  'cwa-messages/v1': placement => {
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
  },
};

/** Why a renderer cannot realize a profile's placement; empty when it can, or when the renderer is unknown. */
export const realizationProblems = (renderer: string, placement: Placement): string[] => REALIZE[renderer]?.(placement) ?? [];

export const RENDERERS = Object.keys(REALIZE);

/** An item as the renderer sees it: the body is its current one, a variant once fitting has compressed it. */
export interface RenderItem {
  id: string;
  slot: Slot;
  body: string;
  lineage: string;
  /** The id of the surfaced conflict group whose member this item is (R-11). */
  conflict?: string | undefined;
}

/** One rendered occurrence of an item, in payload order. */
export interface Occurrence {
  item: RenderItem;
  placement: number;
  /** The tokens of the body as this occurrence renders it: escaped in an xml: wrap, as-is in system and tools. */
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

/** A payload's parts before counting: the texts the renderer counts, and each item occurrence in order. */
interface Layout {
  /** The payload text: fixture-xml/v1's document, or cwa-messages/v1's RFC 8785 request. */
  text: string;
  /** The texts the renderer's count sums: the document, or every system and tools text and the message content. */
  counted: string[];
  occurrences: { item: RenderItem; placement: number; wrap: string }[];
}

function layout(renderer: string, placement: Placement, items: readonly RenderItem[]): Layout {
  const sorted = [...items].sort((a, b) => compareStrings(a.id, b.id));
  const occurrences: Layout['occurrences'] = [];
  placement.forEach(({ slot, wrap }, index) => {
    for (const item of sorted) if (item.slot === slot) occurrences.push({ item, placement: index, wrap });
  });
  if (renderer === 'fixture-xml/v1') {
    const text = occurrences.map(({ item, wrap }) => xmlElement(wrap.slice(4), item, false)).join('');
    return { text, counted: [text], occurrences };
  }
  if (renderer === 'cwa-messages/v1') {
    const system: { id: string; text: string; conflict?: string }[] = [];
    const tools: typeof system = [];
    let content = '';
    for (const { item, wrap } of occurrences) {
      if (wrap === 'system' || wrap === 'tools') {
        (wrap === 'system' ? system : tools).push({ id: item.id, text: item.body, ...(item.conflict !== undefined ? { conflict: item.conflict } : {}) });
      } else {
        content += xmlElement(wrap.slice(4), item, true);
      }
    }
    const text = canonicalize({ system, tools, messages: [{ role: 'user', content }] });
    return { text, counted: [...system.map(e => e.text), ...tools.map(e => e.text), content], occurrences };
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
