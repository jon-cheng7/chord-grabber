// How well a chord suits what's sung over it: its own notes suit, its colours (9ths, 13ths…)
// suit as far as the style likes them, anything else clashes

import { parseChord } from '../music/chord.ts';
import { chordNotes, minor, mod, pitch } from '../music/theory.ts';

// a note that's neither the chord's nor one of its colours
const CLASH = -0.5;

/** notes over a chord that colour it rather than clash, by its kind */
function colours(name: string): number[] {
    const c = parseChord(name);
    if (!c) return [];
    const q = c.quality;
    const root = pitch(c.root);
    let steps: number[];
    if (/^(?:dim|°)/.test(q)) steps = [2, 5, 8, 11];
    else if (/^(?:m7b5|ø)/.test(q)) steps = [2, 5, 8];
    else if (minor(q)) steps = [2, 5, 9];
    else if (/sus/.test(q)) steps = [2, 9, 10];
    else if (/7|9|11|13/.test(q) && !/maj|M7|Δ/.test(q))
        // dominant: every altered colour is fair
        steps = [1, 2, 3, 6, 8, 9];
    else steps = [2, 6, 9, 11];
    return steps.map((s) => mod(root + s));
}

/**
 * profile: how much of each pitch class is sung, summing to 1. tension: how far
 * the style welcomes colours, 0–1. From −0.5 (all clash) to 1 (all chord notes)
 */
export function melodyFit(
    chord: string,
    profile: readonly number[],
    tension: number,
): number {
    const tones = chordNotes(chord).tones;
    if (!tones.length) return 0;
    const colour = colours(chord);
    let fit = 0;
    profile.forEach((w, pc) => {
        if (!w) return;
        fit +=
            w *
            (tones.includes(pc) ? 1 : colour.includes(pc) ? tension : CLASH);
    });
    return fit;
}
