// Edits: chord changes kept as a layer over the sheet, never written into it

import type { Line, Piece } from './parse.ts';

/** a chord set on one word; null removes the one that was there */
export interface Edit {
    line: number;
    piece: number;
    chord: string | null;
    /** inserted where there was no chord */
    added?: boolean;
    /** only this time round the section; absent for every time */
    occ?: number;
}

/** a chord and where it sits */
export interface Spot {
    line: number;
    piece: number;
    chord: string;
}

export const pieces = (line: Line): Piece[] =>
    line.kind === 'lyric'
        ? line.units.flat()
        : line.kind === 'chords'
          ? line.items
          : [];

export function applyEdits(
    lines: readonly Line[],
    edits: readonly Edit[],
): readonly Line[] {
    if (!edits.length) return lines;
    return lines.map((line, i): Line => {
        const mine = edits.filter((e) => e.line === i);
        if (!mine.length) return line;
        const set = (p: Piece, k: number): Piece => {
            const e = mine.find((m) => m.piece === k);
            return e ? { ...p, chord: e.chord } : p;
        };
        if (line.kind === 'lyric') {
            let k = 0;
            const units = line.units.map((u) => u.map((p) => set(p, k++)));
            const chords = units.some((u) => u.some((p) => p.chord));
            return { ...line, units, chords };
        }
        if (line.kind === 'chords')
            return { ...line, items: line.items.map((p, k) => set(p, k)) };
        return line;
    });
}

/** every chord in order, with where it sits */
export function spots(lines: readonly Line[]): Spot[] {
    const out: Spot[] = [];
    lines.forEach((line, i) =>
        pieces(line).forEach((p, k) => {
            if (p.chord) out.push({ line: i, piece: k, chord: p.chord });
        }),
    );
    return out;
}

export function chordAt(
    lines: readonly Line[],
    line: number,
    piece: number,
): string | null {
    const l = lines[line];
    return l ? (pieces(l)[piece]?.chord ?? null) : null;
}
