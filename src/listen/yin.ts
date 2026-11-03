// Pitch of one frame of a single voice: YIN (de Cheveigné & Kawahara, 2002), with pYIN's
// candidates (Mauch & Dixon, 2014): every likely pitch and how likely, for smooth.ts to choose from

export interface Pitch {
    /** YIN's own pick; 0 when nothing clears its threshold */
    hz: number;
    /** 0–1: how cleanly periodic the frame is; singing sits well above 0.8 */
    clarity: number;
    /** likely pitches, flat as hz, probability, hz, probability… */
    cands: number[];
}

// a sung or hummed voice, low bass (G1) to high soprano; any lower and a
// 64 ms frame holds too few periods to trust
export const MIN_HZ = 50;
export const MAX_HZ = 1000;
// quieter than this is breath or room, not a note
const SILENCE_RMS = 0.01;
// the dip a period has to reach to count; lower is stricter
const THRESHOLD = 0.15;
// candidates kept per frame
const MAX_CANDS = 4;

/**
 * pYIN: rather than one threshold, many, weighted by a Beta(2, 11.3) prior
 * (mean 0.15). A dip's probability is the weight of the thresholds that pick it
 */
const PRIOR = (() => {
    const w = Array.from({ length: 100 }, (_, k) => {
        const s = (k + 1) / 100;
        return s * Math.pow(1 - s, 34 / 3 - 1);
    });
    const total = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / total);
})();

/** null for silence */
export function yin(
    frame: Float32Array,
    rate: number,
    scratch: Float32Array = new Float32Array(frame.length >> 1),
): Pitch | null {
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i]! * frame[i]!;
    if (Math.sqrt(energy / frame.length) < SILENCE_RMS) return null;

    const half = frame.length >> 1;
    const lo = Math.max(2, Math.floor(rate / MAX_HZ));
    const hi = Math.min(half - 1, Math.ceil(rate / MIN_HZ));
    const d = scratch;

    // how unlike itself the frame is, shifted by tau
    for (let tau = 1; tau <= hi; tau++) {
        let sum = 0;
        for (let i = 0; i < half; i++) {
            const delta = frame[i]! - frame[i + tau]!;
            sum += delta * delta;
        }
        d[tau] = sum;
    }
    // normalised by the running mean, so short shifts don't win by default
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= hi; tau++) {
        running += d[tau]!;
        d[tau] = running ? (d[tau]! * tau) / running : 1;
    }

    // every valley bottom, in order of shift
    const dips: number[] = [];
    for (let t = lo; t <= hi; t++)
        if (d[t]! < d[t - 1]! && (t === hi || d[t]! <= d[t + 1]!)) dips.push(t);

    // between samples: fit a parabola through the dip and its neighbours
    const exact = (tau: number): number => {
        const a = d[tau - 1] ?? d[tau]!;
        const b = d[tau]!;
        const c = d[tau + 1] ?? d[tau]!;
        const bend = a - 2 * b + c;
        return bend ? tau + (a - c) / (2 * bend) : tau;
    };

    const odds = new Map<number, number>();
    PRIOR.forEach((w, k) => {
        const s = (k + 1) / 100;
        const pick = dips.find((t) => d[t]! < s);
        if (pick !== undefined) odds.set(pick, (odds.get(pick) ?? 0) + w);
    });
    const cands = [...odds.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CANDS)
        .flatMap(([t, p]) => [rate / exact(t), p]);

    const tau = dips.find((t) => d[t]! < THRESHOLD);
    if (tau === undefined) return { hz: 0, clarity: 0, cands };
    return {
        hz: rate / exact(tau),
        clarity: Math.max(0, Math.min(1, 1 - d[tau]!)),
        cands,
    };
}
