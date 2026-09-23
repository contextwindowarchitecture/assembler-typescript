// Renderers (conformance/README.md, Tokenizers and renderers).
import type { Profile } from './types.js';

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
