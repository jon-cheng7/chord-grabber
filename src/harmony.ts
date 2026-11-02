// Harmony: what each chord is doing, read from the chords alone (no melody, no beats)

import { parseChord } from './chord.ts';
import { rankKeys } from './key.ts';
import type { Line, Piece } from './parse.ts';
import { chordNotes, type Option, type OptionGroup } from './reharm.ts';
import {
    minor,
    mod,
    numberChord,
    pitch,
    shiftKey,
    simplifyChord,
    transposeChord,
} from './transpose.ts';
import type { View } from './view.ts';

/** home, moving away, pulling back, or none of those */
export type Role = 'tonic' | 'pre' | 'dominant' | 'colour';
export type Cadence = 'full' | 'plagal' | 'deceptive' | 'half';

export interface Reading {
    chord: string;
    row: number;
    piece: number;
    /** block of the arrangement it sits in */
    block: number;
    /** the key of its section */
    key: string;
    /** IV, ii7, ♭VII, V7/vi … */
    numeral: string;
    role: Role;
    /** in its key's own scale */
    diatonic: boolean;
    /** words it's held over; 0 on a chord-only line */
    held: number;
    bass: number;
    /** first / last chord on its line: phrases start and land there */
    starts: boolean;
    ends: boolean;
    cadence: Cadence | null;
}

export interface Profile {
    /** shares of all chords */
    sevenths: number;
    slashes: number;
    outside: number;
    secondary: number;
    /** most sections cycle one short progression */
    loop: boolean;
}

export interface Harmony {
    readings: Reading[];
    profile: Profile;
    at(row: number, piece: number): Reading | null;
    keyAt(row: number): string | null;
}

type Kind = '' | 'm' | 'dim';

// scale step → its triad and what it usually does
const MAJOR: Record<number, [Kind, Role]> = {
    0: ['', 'tonic'],
    2: ['m', 'pre'],
    4: ['m', 'tonic'],
    5: ['', 'pre'],
    7: ['', 'dominant'],
    9: ['m', 'tonic'],
    11: ['dim', 'dominant'],
};
const MINOR: Record<number, [Kind, Role]> = {
    0: ['m', 'tonic'],
    2: ['dim', 'pre'],
    3: ['', 'tonic'],
    5: ['m', 'pre'],
    7: ['m', 'dominant'],
    8: ['', 'pre'],
    10: ['', 'dominant'],
};
// borrowed from the parallel key, doing the job of the chord they replace
const BORROWED_MAJOR: Record<string, Role> = {
    '5m': 'pre',
    '8': 'pre',
    '10': 'pre',
    '3': 'tonic',
};

// a section needs this many chords before it can have a key of its own
const LOCAL_MIN = 6;
// and the song's key has to fit it this much worse
const LOCAL_MARGIN = 0.75;
const LOOP_SHARE = 0.8;

const pieces = (line: Line): Piece[] =>
    line.kind === 'lyric'
        ? line.units.flat()
        : line.kind === 'chords'
          ? line.items
          : [];

function kindOf(quality: string): Kind {
    if (/^(?:dim|°|m7b5|ø)/.test(quality)) return 'dim';
    return minor(quality) ? 'm' : '';
}

const tonicOf = (key: string): number => pitch(parseChord(key)?.root ?? 'C');
const isMinorKey = (key: string): boolean =>
    minor(parseChord(key)?.quality ?? '');

/** the key each block plays in: the song's, unless the block clearly sits elsewhere */
function blockKey(
    lines: readonly Line[],
    home: string,
    chords: number,
): string {
    if (chords < LOCAL_MIN) return home;
    const ranked = rankKeys(lines);
    const best = ranked[0];
    if (!best || best.key === home || best.score <= 0) return home;
    const mine = ranked.find((r) => r.key === home)?.score ?? -Infinity;
    return mine < best.score * LOCAL_MARGIN ? best.key : home;
}

/** a short progression that repeats through most of the block */
function loops(seq: string[]): boolean {
    for (let p = 2; p <= 4; p++) {
        if (seq.length < p * 2) break;
        const same = seq.filter((c, i) => c === seq[i % p]).length;
        if (same / seq.length >= LOOP_SHARE) return true;
    }
    return false;
}

export function analyze(view: View, songKey: string | null): Harmony {
    const home = songKey ? shiftKey(songKey, 0) : null;
    const readings: Reading[] = [];
    const keys: (string | null)[] = view.lines.map(() => home);
    const blockKeys = new Map<string, string>();
    let loopBlocks = 0;
    let chordBlocks = 0;

    view.blocks.forEach((b, block) => {
        const slice = view.lines.slice(b.start, b.end);
        const found: Omit<
            Reading,
            'key' | 'numeral' | 'role' | 'diatonic' | 'cadence'
        >[] = [];
        slice.forEach((line, i) => {
            const row = b.start + i;
            const ps = pieces(line);
            const at = ps.flatMap((p, k) => (p.chord ? [k] : []));
            at.forEach((k, n) => {
                const chord = ps[k]!.chord!;
                const c = parseChord(chord);
                if (!c) return;
                const next = at[n + 1] ?? ps.length;
                const text = ps
                    .slice(k, next)
                    .map((p) => p.text)
                    .join('');
                found.push({
                    chord,
                    row,
                    piece: k,
                    block,
                    held:
                        line.kind === 'lyric'
                            ? (text.match(/\S+/g)?.length ?? 0)
                            : 0,
                    bass: chordNotes(chord).bass,
                    starts: n === 0,
                    ends: n === at.length - 1,
                });
            });
        });
        if (!home || !found.length) {
            for (const f of found)
                readings.push({
                    ...f,
                    key: home ?? '',
                    numeral: '',
                    role: 'colour',
                    diatonic: false,
                    cadence: null,
                });
            return;
        }
        // repeats share their key: same section, same chords
        const sig = `${b.id}|${b.sig}`;
        let key = blockKeys.get(sig);
        if (!key) {
            key = blockKey(slice, home, found.length);
            blockKeys.set(sig, key);
        }
        for (let r = b.start; r < b.end; r++) keys[r] = key;
        chordBlocks++;
        const seq = found.map((f) => simplifyChord(f.chord));
        if (loops(seq)) loopBlocks++;

        const tonic = tonicOf(key);
        const minorKey = isMinorKey(key);
        const table = minorKey ? MINOR : MAJOR;
        found.forEach((f, i) => {
            const c = parseChord(f.chord)!;
            const step = mod(pitch(c.root) - tonic);
            const kind = kindOf(c.quality);
            const scale = table[step];
            // the raised fifth of a minor key counts as its own
            const raised = minorKey && step === 7 && kind === '';
            const diatonic = scale?.[0] === kind || raised;
            let role: Role = diatonic ? (scale?.[1] ?? 'colour') : 'colour';
            let numeral = numberChord(f.chord, key);
            const next = found[i + 1];
            if (!diatonic) {
                const nextRoot = next
                    ? pitch(parseChord(next.chord)!.root)
                    : -1;
                const borrowed = minorKey
                    ? undefined
                    : BORROWED_MAJOR[`${step}${kind}`];
                if (kind === '' && mod(pitch(c.root) + 5) === nextRoot) {
                    // a major chord a fifth above the next one: a secondary dominant
                    role = 'dominant';
                    const seventh = /7/.test(c.quality) ? '7' : '';
                    numeral = `V${seventh}/${numberChord(simplifyChord(next!.chord), key)}`;
                } else if (borrowed) role = borrowed;
            }
            readings.push({
                ...f,
                key,
                numeral,
                role,
                diatonic,
                cadence: null,
            });
        });
    });

    // cadences: how a line lands, judged on its last chord
    readings.forEach((r, i) => {
        if (!r.ends || !r.numeral) return;
        const prev = readings[i - 1];
        const step = mod(pitch(parseChord(r.chord)!.root) - tonicOf(r.key));
        const homeChord = r.role === 'tonic' && step === 0;
        if (homeChord && prev?.role === 'dominant') r.cadence = 'full';
        else if (homeChord && prev?.role === 'pre') r.cadence = 'plagal';
        else if (
            prev?.role === 'dominant' &&
            r.role === 'tonic' &&
            step === (isMinorKey(r.key) ? 8 : 9)
        )
            r.cadence = 'deceptive';
        else if (r.role === 'dominant') r.cadence = 'half';
    });

    const share = (test: (r: Reading) => boolean): number =>
        readings.length ? readings.filter(test).length / readings.length : 0;
    const profile: Profile = {
        sevenths: share((r) => /7|9|11|13|add|sus/.test(r.chord)),
        slashes: share((r) => r.chord.includes('/')),
        outside: share((r) => !!r.numeral && !r.diatonic),
        secondary: share(
            (r) => r.numeral.includes('/') && r.role === 'dominant',
        ),
        loop: chordBlocks > 0 && loopBlocks / chordBlocks >= 0.5,
    };

    const byPlace = new Map(readings.map((r) => [`${r.row}:${r.piece}`, r]));
    return {
        readings,
        profile,
        at: (row, piece) => byPlace.get(`${row}:${piece}`) ?? null,
        keyAt: (row) => keys[row] ?? home,
    };
}

const MAX_FROM_SONG = 3;

/**
 * chords the song already uses elsewhere that could stand here, moved into
 * this spot's key; the most convincing suggestions are the song's own
 */
export function fromSong(
    h: Harmony,
    here: Reading,
    original: string,
    labelOf: (block: number) => string,
    flats: boolean,
): OptionGroup | null {
    if (!here.numeral) return null;
    const tones = chordNotes(original).tones;
    const own = simplifyChord(original);
    const picked = new Map<string, Option & { rank: number }>();
    for (const r of h.readings) {
        if (r.row === here.row && r.piece === here.piece) continue;
        const move = mod(tonicOf(here.key) - tonicOf(r.key));
        const chord = move ? transposeChord(r.chord, move, flats) : r.chord;
        if (simplifyChord(chord) === own) continue;
        const shared = chordNotes(chord).tones.filter((t) =>
            tones.includes(t),
        ).length;
        const sameJob = r.role === here.role && r.role !== 'colour';
        if (!sameJob && shared < 2) continue;
        // a chord from outside the key is the rarer, more telling find
        const rank = (sameJob ? 2 : 0) + shared + (r.diatonic ? 0 : 1);
        const had = picked.get(chord);
        if (had && had.rank >= rank) continue;
        const where = labelOf(r.block);
        picked.set(chord, {
            chord,
            why: where ? `${r.numeral} · in ${where}` : r.numeral,
            rank,
        });
    }
    const options = [...picked.values()]
        .sort((a, b) => b.rank - a.rank)
        .slice(0, MAX_FROM_SONG)
        .map(({ chord, why }) => ({ chord, why }));
    return options.length ? { label: 'IN THIS SONG', options } : null;
}

// a song that leans on sevenths hears those first among its colours
const RICH = 0.25;

export function styled(groups: OptionGroup[], profile: Profile): OptionGroup[] {
    if (profile.sevenths < RICH) return groups;
    const seventh = (o: Option): number => Number(/7/.test(o.chord));
    return groups.map((g) =>
        g.label === 'COLOUR'
            ? {
                  ...g,
                  options: [...g.options].sort(
                      (a, b) => seventh(b) - seventh(a),
                  ),
              }
            : g,
    );
}
