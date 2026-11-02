// Key from the chords: what's played, where sections start and land, what resolves

import { isChord, parseChord } from './chord.ts';
import type { Line } from './parse.ts';
import { minor, mod, pitch, shiftKey } from './transpose.ts';

type Kind = 'maj' | 'min' | 'dim' | 'open';

interface Heard {
    root: number;
    kind: Kind;
    weight: number;
}

// how strongly a chord on each step says "this key"; anything else counts against
const MAJOR_FIT: Record<number, Partial<Record<Kind, number>>> = {
    0: { maj: 4 },
    2: { min: 1.2, maj: 0.2 },
    4: { min: 0.8, maj: 0.3 },
    5: { maj: 2, min: 0.4 },
    7: { maj: 2.5 },
    8: { maj: 0.3 },
    9: { min: 1.2 },
    10: { maj: 0.4 },
    11: { dim: 0.5 },
};
const MINOR_FIT: Record<number, Partial<Record<Kind, number>>> = {
    0: { min: 4 },
    2: { dim: 0.5 },
    3: { maj: 1.2 },
    5: { min: 1.8, maj: 0.3 },
    7: { maj: 2, min: 1.5 },
    8: { maj: 1.2 },
    10: { maj: 1.2 },
    11: { dim: 0.5 },
};
const OFF = -1;

function kindOf(quality: string): Kind {
    if (/^(?:dim|°|m7b5|ø)/.test(quality)) return 'dim';
    if (minor(quality)) return 'min';
    // sus and power chords have no third to take sides
    if (/^(?:sus|5$)/.test(quality)) return 'open';
    return 'maj';
}

/** a line's chords in order */
function lineChords(line: Line): Heard[] {
    const names: string[] = [];
    if (line.kind === 'lyric')
        for (const p of line.units.flat()) if (p.chord) names.push(p.chord);
    if (line.kind === 'chords')
        for (const p of line.items) {
            if (p.chord) names.push(p.chord);
            // bar notation left as text
            else
                for (const t of p.text.split(/[\s|]+/))
                    if (isChord(t)) names.push(t);
        }
    return names
        .map((n) => parseChord(n))
        .filter((c) => c !== null)
        .map((c) => ({
            root: pitch(c.root),
            kind: kindOf(c.quality),
            weight: 1,
        }));
}

/** chords weighted by where they fall: phrase and section edges, resolutions */
function heard(lines: readonly Line[]): Heard[] {
    const all: Heard[] = [];
    let section: Heard[] = [];
    const close = (): void => {
        if (!section.length) return;
        section[0]!.weight += 1;
        section[section.length - 1]!.weight += 1;
        all.push(...section);
        section = [];
    };
    for (const line of lines) {
        if (line.kind === 'section') close();
        const chords = lineChords(line);
        // phrases tend to start at home
        if (chords[0]) chords[0].weight += 0.5;
        section.push(...chords);
    }
    close();
    if (!all.length) return all;
    all[0]!.weight += 1;
    // sheets often stop mid-loop, so the very end only counts a little more
    all[all.length - 1]!.weight += 1;
    // up a fourth from a major chord: V → I, the strongest pull home
    for (let i = 1; i < all.length; i++) {
        const a = all[i - 1]!;
        const b = all[i]!;
        if (a.kind === 'maj' && mod(b.root - a.root) === 5) b.weight += 1;
    }
    return all;
}

function fit(c: Heard, tonic: number, minorKey: boolean): number {
    const step = (minorKey ? MINOR_FIT : MAJOR_FIT)[mod(c.root - tonic)];
    if (!step) return OFF;
    const value =
        c.kind === 'open' ? Math.max(...Object.values(step)) : step[c.kind];
    return value ?? OFF;
}

/** all 24 keys, best first */
export function rankKeys(
    lines: readonly Line[],
): { key: string; score: number }[] {
    const chords = heard(lines);
    if (!chords.length) return [];
    const keys = Array.from({ length: 24 }, (_, i) => {
        const minorKey = i >= 12;
        const tonic = i % 12;
        const score = chords.reduce(
            (sum, c) => sum + c.weight * fit(c, tonic, minorKey),
            0,
        );
        return { key: shiftKey(minorKey ? 'Cm' : 'C', tonic), score };
    });
    return keys.sort((a, b) => b.score - a.score);
}

/** the key the chords are written in: the page's without its capo, else what they say */
export function songKey(
    said: string | null,
    lines: readonly Line[],
    capo: number | null = null,
): string | null {
    // pages give the key as heard; Bb with capo 3 is G shapes
    if (said && parseChord(said)) return capo ? shiftKey(said, -capo) : said;
    return rankKeys(lines)[0]?.key ?? null;
}
