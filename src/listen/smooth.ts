// The likeliest pitch line through a take, pYIN's second half: each frame's candidates
// weighed against where the voice just was (Viterbi). A one-frame octave jump or blip
// costs more than it explains, so it drops out

import type { Frame } from './summary.ts';

// a voice holds or drifts by about this much (semitones) frame to frame
const DRIFT = 0.5;
// chance per frame of a leap to a new note, anywhere within an octave
const LEAP = 0.1;
// further than an octave in one frame: next to never
const FAR = 1e-4;
// chance per frame of starting or stopping singing
const SWITCH = 0.01;
// how far a frame's candidates are believed
const TRUST = 0.5;
// the range candidates fall in (semitones), for where a note starts after a rest
const SPAN = 56;
// the width a candidate stands for (semitones)
const BIN = 0.2;

const midi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

/** chance of moving this many semitones in one frame, per BIN */
function move(semis: number): number {
    const d = Math.abs(semis);
    const near = ((1 - LEAP) / (2 * DRIFT)) * Math.exp(-d / DRIFT);
    const leap = d <= 12 ? LEAP / 24 : FAR / SPAN;
    return (near + leap) * BIN;
}

/** a frame's candidates; frames from before they were kept stand on YIN's pick */
function candsOf(f: Frame): { hz: number; p: number }[] {
    const flat = f.cands ?? (f.hz > 0 ? [f.hz, f.clarity] : []);
    const out: { hz: number; p: number }[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2)
        if (flat[i]! > 0 && flat[i + 1]! > 0)
            out.push({ hz: flat[i]!, p: flat[i + 1]! });
    return out;
}

/**
 * frames with the line settled: hz on the chosen pitch, clarity 1 where sung
 * and 0 where not. Everything else as it was
 */
export function smooth(frames: readonly Frame[]): Frame[] {
    if (!frames.length) return [];
    const log = Math.log;
    const stay = log(1 - SWITCH);
    const swap = log(SWITCH);
    const land = log(BIN / SPAN);
    const held = log(move(0));

    // per frame: the candidates (sung states) and one unsung state, last
    const states = frames.map(candsOf);
    const back: Int16Array[] = [];
    let prev: number[] = [];
    let prevM: number[] = [];
    let prevQuiet = 0;

    frames.forEach((_, k) => {
        const cands = states[k]!;
        const voiced = cands.reduce((s, c) => s + c.p, 0) * TRUST;
        const m = cands.map((c) => midi(c.hz));
        const score: number[] = [];
        const from = new Int16Array(cands.length + 1);
        cands.forEach((c, j) => {
            // from a rest: anywhere in range
            let best = k ? prevQuiet + swap + land : land;
            let arg = prev.length;
            prev.forEach((v, i) => {
                const s = v + stay + log(move(m[j]! - prevM[i]!));
                if (s > best) {
                    best = s;
                    arg = i;
                }
            });
            score.push(best + log(c.p * TRUST));
            from[j] = arg;
        });
        let quiet = k ? prevQuiet + stay : 0;
        let arg = prev.length;
        prev.forEach((v, i) => {
            if (v + swap > quiet) {
                quiet = v + swap;
                arg = i;
            }
        });
        // pYIN's unsung states are one per pitch, sharing what's left: priced the
        // same as a held pitch, or a rest always outbids singing
        quiet += log(Math.max(1e-9, 1 - voiced)) + held + land;
        from[cands.length] = arg;
        back.push(from);
        prev = score;
        prevM = m;
        prevQuiet = quiet;
    });

    // back from the likeliest end
    let at = prev.length;
    prev.forEach((v, i) => {
        if (v > (at === prev.length ? prevQuiet : prev[at]!)) at = i;
    });
    const out: Frame[] = new Array(frames.length);
    for (let k = frames.length - 1; k >= 0; k--) {
        const cands = states[k]!;
        const sung = at < cands.length;
        out[k] = {
            ...frames[k]!,
            hz: sung ? cands[at]!.hz : 0,
            clarity: sung ? 1 : 0,
        };
        at = back[k]![at]!;
    }
    return out;
}
