import {
  createTextRegion,
  getBoundsStart,
  getTokensFromText,
  matchText,
} from "./speech-matcher";
import type { Token } from "./word-tokenizer";

export type Position = {
  start: number;
  search: number;
  end: number;
  bounds: number;
};

/*
  Pure transcript -> cursor stepping. Given the current cursor `position` and a
  new (final, interim) transcript pair, return the next cursor position.

  This is the single source of truth for how speech advances the teleprompter.
  Both the live recognizer (lib/recognizer.ts) and the offline benchmark scorer
  (lib/benchmark/scorer.ts) call it, so the benchmark judges engines with the
  exact same matcher that runs in production.

  NOTE: `matchText` keeps a module-level transcript window + moving average in
  speech-matcher.ts. Call `resetTranscriptWindow()` before starting a new run.
*/
export function stepPosition(
  tokens: Token[],
  position: Position,
  finalTranscript: string,
  interimTranscript: string
): Position {
  let next: Position = { ...position };

  const textRegion = createTextRegion(tokens, next.search);
  const boundStart = getBoundsStart(tokens, next.search, textRegion);

  if (finalTranscript !== "") {
    const foundMatch = matchText(getTokensFromText(finalTranscript), textRegion, next.search, true);

    if (foundMatch) {
      const [, matchEnd] = foundMatch;
      next = {
        ...next,
        start: matchEnd,
        search: matchEnd,
        end: matchEnd,
        ...(boundStart !== undefined && { bounds: boundStart }),
      };
    } else {
      next = {
        ...next,
        start: next.end,
        search: next.end,
        end: next.end,
        ...(boundStart !== undefined && { bounds: boundStart }),
      };
    }
  }

  if (interimTranscript !== "") {
    const foundMatch = matchText(getTokensFromText(interimTranscript), textRegion, next.search, false);

    if (foundMatch) {
      const [matchStart, matchEnd] = foundMatch;
      next = {
        ...next,
        search: matchStart,
        end: matchEnd,
        ...(boundStart !== undefined && { bounds: boundStart }),
      };
    }
  }

  return next;
}
