// Reharm: the sheet as the engine sees it, and the engine's answers placed back on the sheet

import type { Sections } from './arrange.ts';
import { pieces, spots, type Edit } from './edits.ts';
import {
    createEngine,
    songKey,
    type Engine,
    type KeySlot,
    type Option,
    type Slot,
    type Song,
    type Why,
} from './engine/index.ts';
import { isChord } from './music/chord.ts';
import type { Line, Piece } from './parse.ts';
import type { View } from './view.ts';

/** every chord of a sheet as written, bar notation included: enough to find its key */
export function sheetSlots(lines: readonly Line[]): KeySlot[] {
    const out: KeySlot[] = [];
    let section = 0;
    for (const line of lines) {
        if (line.kind === 'section') {
            section++;
            continue;
        }
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
        names.forEach((chord, i) =>
            out.push({ chord, section: String(section), starts: i === 0 }),
        );
    }
    return out;
}

/** the key the chords are written in: the page's without its capo, else what they say */
export const sheetKey = (
    said: string | null,
    lines: readonly Line[],
    capo: number | null = null,
): string | null => songKey(said, sheetSlots(lines), capo);

export interface SheetHarmony {
    engine: Engine;
    /** what the engine was given, for a whole-song reharm */
    song: Song;
    /** a chord's place, as the engine knows it */
    id(row: number, piece: number): string;
    /** and back to its place in the view */
    place(id: string): { row: number; piece: number } | null;
}

/**
 * the view as engine slots: a section per block as played, ids from the sheet's
 * own line and time round, so they outlast transposing and rearranging
 */
export function sheetHarmony(
    view: View,
    sections: Sections | null,
    key: string | null,
    flats: boolean,
    edits: readonly Edit[],
): SheetHarmony {
    const id = (row: number, piece: number): string =>
        `${view.origin[row] ?? -1}:${piece}.${view.occ[row] ?? 0}`;
    // chords you set yourself, this time round or every time
    const locked = (row: number, piece: number): boolean =>
        edits.some(
            (e) =>
                e.line === view.origin[row] &&
                e.piece === piece &&
                (e.occ === undefined || e.occ === view.occ[row]),
        );
    const places = new Map<string, { row: number; piece: number }>();
    const slots: Slot[] = [];
    view.blocks.forEach((b, block) => {
        const label = sections?.library.find((s) => s.id === b.id)?.label ?? '';
        for (let row = b.start; row < b.end; row++) {
            const line = view.lines[row];
            if (!line) continue;
            const ps = pieces(line);
            const at = ps.flatMap((p, k) => (p.chord ? [k] : []));
            at.forEach((k, n) => {
                const text = ps
                    .slice(k, at[n + 1] ?? ps.length)
                    .map((p) => p.text)
                    .join('');
                const slot = id(row, k);
                places.set(slot, { row, piece: k });
                slots.push({
                    id: slot,
                    chord: ps[k]!.chord!,
                    section: String(block),
                    label,
                    starts: n === 0,
                    ends: n === at.length - 1,
                    held:
                        line.kind === 'lyric'
                            ? (text.match(/\S+/g)?.length ?? 0)
                            : 0,
                    locked: locked(row, k),
                });
            });
        }
    });
    const song = { key, flats, slots };
    return {
        engine: createEngine(song),
        song,
        id,
        place: (slot) => places.get(slot) ?? null,
    };
}

/** an explanation in words, chords named as the reader sees them */
export const say = (why: Why, name: (chord: string) => string): string =>
    why.map((p) => (typeof p === 'string' ? p : name(p.chord))).join('');

export interface Gap {
    /** where the passing chord goes */
    line: number;
    piece: number;
    from: string;
    to: string;
    options: Option[];
    score: number;
}

// fewer, better: a gap needs room, a reason, and somewhere to land
const MIN_WORDS = 3;
const MAX_CHANGES = 3;
const THRESHOLD = 0.35;

const words = (line: Line): Piece[] =>
    line.kind === 'lyric' ? line.units.flat() : [];

/** passing chords worth offering, at most one per line; the engine says what, the words say where */
export function passingGaps(lines: readonly Line[], h: SheetHarmony): Gap[] {
    const all = spots(lines);
    const best = new Map<number, Gap>();

    all.forEach((a, i) => {
        const b = all[i + 1];
        const line = lines[a.line];
        if (!b || !line || line.kind !== 'lyric') return;
        const ws = words(line);
        if (ws.filter((p) => p.chord).length >= MAX_CHANGES) return;
        const sameLine = b.line === a.line;
        const end = sameLine ? b.piece : ws.length;
        // the words held under chord a, not counting its own
        let at = end - 1;
        while (at > a.piece && !ws[at]?.text.trim()) at--;
        const room = at - a.piece + 1;
        if (room < MIN_WORDS || at <= a.piece) return;

        const pass = h.engine.between(a.chord, b.chord, h.id(b.line, b.piece));
        if (!pass) return;
        const { options, fit } = pass;
        // a walking bass sits halfway along, the rest just before the change
        let place = pass.walk ? Math.round((a.piece + 1 + at) / 2) : at;
        // landing on a new line or section counts most
        const landing = sameLine ? 0.5 : 1;
        const score = (Math.min(room, 6) / 6) * fit * landing;
        if (score < THRESHOLD) return;
        if (place <= a.piece) place = at;
        if (ws[place]?.chord) return;
        const gap = {
            line: a.line,
            piece: place,
            from: a.chord,
            to: b.chord,
            options,
            score,
        };
        const had = best.get(a.line);
        if (!had || had.score < score) best.set(a.line, gap);
    });
    return [...best.values()];
}
