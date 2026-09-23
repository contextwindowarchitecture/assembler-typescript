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

/** Each placement's items, ordered by id within the placement. */
function placed(placement: Placement, items: readonly RenderItem[]): { index: number; wrap: string; items: RenderItem[] }[] {
  return placement.map(({ slot, wrap }, index) => ({
    index, wrap, items: items.filter(item => item.slot === slot).sort((a, b) => compareStrings(a.id, b.id)),
  }));
}

export function render(renderer: string, placement: Placement, items: readonly RenderItem[], count: Tokenizer): Rendered {
  const occurrences: Occurrence[] = [];
  const occur = (item: RenderItem, index: number, wrap: string): void => {
    occurrences.push({ item, placement: index, tokens: count(renderedBody(wrap, item.body)) });
  };
  if (renderer === 'fixture-xml/v1') {
    let text = '';
    for (const { index, wrap, items: here } of placed(placement, items)) {
      for (const item of here) {
        text += xmlElement(wrap.slice(4), item, false);
        occur(item, index, wrap);
      }
    }
    return { payload: Buffer.from(text, 'utf8'), tokens: count(text), occurrences };
  }
  if (renderer === 'cwa-messages/v1') {
    const system: object[] = [];
    const tools: object[] = [];
    let content = '';
    let tokens = 0;
    for (const { index, wrap, items: here } of placed(placement, items)) {
      for (const item of here) {
        if (wrap === 'system' || wrap === 'tools') {
          (wrap === 'system' ? system : tools).push({ id: item.id, text: item.body, ...(item.conflict !== undefined ? { conflict: item.conflict } : {}) });
          tokens += count(item.body);
        } else {
          content += xmlElement(wrap.slice(4), item, true);
        }
        occur(item, index, wrap);
      }
    }
    tokens += count(content);
    const payload = canonicalize({ system, tools, messages: [{ role: 'user', content }] });
    return { payload: Buffer.from(payload, 'utf8'), tokens, occurrences };
  }
  throw new Error(`renderer ${renderer} is not provided`);
}

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
