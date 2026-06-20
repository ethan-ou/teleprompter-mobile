const MIN_AVERAGE = 2;
const NUM_AVERAGE = 3;

// Cap on the per-step forward momentum bias. Clamping to [0, MAX_MOMENTUM]
// keeps only forward push (which carries the cursor through adjacent-word
// oscillation) while preventing two failure modes of an unclamped bias: a
// backward raw blip dragging the smoothed cursor further back, and a large
// forward jump overshooting past where speech actually is.
const MAX_MOMENTUM = 3;

let positions: [number, number][] = [];

export function calculateMovingAverage(start: number, end: number): [number, number] | undefined {
  positions.push([start, end]);
  positions = positions.slice(-NUM_AVERAGE);

  if (positions.length < MIN_AVERAGE) {
    return;
  }

  const startValues = [];
  const endValues = [];
  for (const index of positions) {
    const [start, end] = index;
    startValues.push(start);
    endValues.push(end);
  }

  return [
    Math.max(Math.ceil(weightedMovingAverage(startValues)), 0),
    Math.max(Math.ceil(weightedMovingAverage(endValues)), 0),
  ];
}

export function resetMovingAverage() {
  positions = [];
}

/* Calculate average with more recent items being weighed
   more heavily than previous items. */
function weightedMovingAverage(array: number[]) {
  let total = 0;
  let count = 0;
  let prev;

  for (let i = 0; i < array.length; i++) {
    // Recency bias weighted toward the last transcribed index, clamped to only
    // capped forward momentum so backward blips and large jumps don't destabilise
    // the smoothed position.
    const bias = prev !== undefined ? Math.min(Math.max(array[i] - prev, 0), MAX_MOMENTUM) : 0;

    const weighting = array.length - i;
    total += (array[i] + bias) * weighting;
    count += weighting;

    prev = array[i];
  }

  return total / count;
}
