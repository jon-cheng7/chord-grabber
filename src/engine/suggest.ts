// Suggestions: what to swap a chord for, what can pass between two, what the song itself uses

import { parseChord } from '../music/chord.ts';
import {
    chordNotes,
    minor,
    mod,
    noteName,
    pitch,
    simplifyChord,
    transposeChord,
} from '../music/theory.ts';
import { tonicOf } from './analysis.ts';
import type {
    Option,
    OptionGroup,
    Passing,
    Profile,
    Reading,
} from './types.ts';

const shared = (a: string, b: string): number => {
    const x = chordNotes(a).tones;
    return chordNotes(b).tones.filter((t) => x.includes(t)).length;
};

interface KeyInfo {
    /** the key's own home note: A in A minor, not C */
    tonic: number;
    minor: boolean;
    flats: boolean;
}

function keyInfo(key: string | null, flats: boolean): KeyInfo | null {
    const c = key ? parseChord(key) : null;
    if (!c) return null;
    return { tonic: pitch(c.root), minor: minor(c.quality), flats };
}

// triad on each scale step, major and natural minor
const MAJOR_TRIADS: Record<number, string> = {
    0: '',
    2: 'm',
    4: 'm',
    5: '',
    7: '',
    9: 'm',
    11: 'dim',
};
const MINOR_TRIADS: Record<number, string> = {
    0: 'm',
    2: 'dim',
    3: '',
    5: 'm',
    7: 'm',
    8: '',
    10: '',
};
const triads = (k: KeyInfo): Record<number, string> =>
    k.minor ? MINOR_TRIADS : MAJOR_TRIADS;

const core = (name: string): string => {
    const c = parseChord(name);
    if (!c) return name;
    const kind = /^(?:dim|°)/.test(c.quality)
        ? 'dim'
        : minor(c.quality)
          ? 'm'
          : '';
    return `${c.root}${kind}`;
};

/** what to swap a chord for, safest first in each group */
export function suggestFor(
    name: string,
    key: string | null,
    flats: boolean,
): OptionGroup[] {
    const c = parseChord(name);
    if (!c) return [];
    const k = keyInfo(key, flats);
    const root = pitch(c.root);
    const base = core(name);
    const isMinor = /m$/.test(base);
    const isDim = /dim$/.test(base);
    const n = (p: number): string => noteName(p, flats);
    const deg = (step: number): string =>
        k ? `${n(k.tonic + step)}${triads(k)[step] ?? ''}` : '';
    const d = k ? mod(root - k.tonic) : -1;

    const colour: Option[] = isDim
        ? [{ chord: `${base}7`, why: ['fuller diminished'] }]
        : isMinor
          ? [
                { chord: `${base}7`, why: ['softer, jazzier'] },
                { chord: `${base}add9`, why: ['open, airy'] },
                { chord: `${c.root}sus4`, why: ['unresolved'] },
            ]
          : [
                { chord: `${base}add9`, why: ['open, airy'] },
                { chord: `${base}sus2`, why: ['open, no third'] },
                { chord: `${base}sus4`, why: ['wants to resolve'] },
                {
                    chord: d === 7 ? `${base}7` : `${base}maj7`,
                    why: [d === 7 ? 'stronger pull home' : 'warm, dreamy'],
                },
            ];

    const third = mod(root + (isMinor || isDim ? 3 : 4));
    const fifth = mod(root + (isDim ? 6 : 7));
    const bass: Option[] = [
        { chord: `${base}/${n(third)}`, why: ['third in the bass: smoother'] },
        { chord: `${base}/${n(fifth)}`, why: ['fifth in the bass: floating'] },
    ];
    if (k && d !== 0)
        bass.push({
            chord: `${base}/${n(k.tonic)}`,
            why: ['over the home note'],
        });

    const swap: Option[] = [];
    const borrowed: Option[] = [];
    const spicy: Option[] = [];
    if (k) {
        const add = (list: Option[], step: number, why: string, q?: string) => {
            const chord =
                q === undefined ? deg(step) : `${n(k.tonic + step)}${q}`;
            list.push({ chord, why: [why] });
        };
        if (k.minor) {
            // steps from the minor home: i, ii°, III, iv, v / V, VI, VII
            if (d === 0) {
                add(swap, 3, 'relative major: same notes, brighter');
                add(swap, 8, 'shares two notes');
                add(borrowed, 0, 'major 1: a bright ending', '');
            } else if (d === 2) {
                add(swap, 5, 'same job, darker');
                add(borrowed, 2, 'minor 2: softer lead to 5', 'm');
            } else if (d === 3) {
                add(swap, 0, 'relative minor: back home');
                add(swap, 7, 'shares two notes');
            } else if (d === 5) {
                add(swap, 2, 'same job, darker', 'm7b5');
                add(swap, 8, 'shares two notes');
                add(borrowed, 5, 'major 4: a lift', '');
            } else if (d === 7) {
                if (isMinor) add(borrowed, 7, 'major 5: pulls home harder', '');
                else add(swap, 7, 'minor 5: softer, modal', 'm');
                add(swap, 10, '♭7: a modal way home', '');
                add(spicy, 1, 'tritone sub: slides home', '7');
            } else if (d === 8) {
                add(swap, 5, 'shares two notes');
                add(swap, 0, 'shares two notes');
            } else if (d === 10) {
                add(swap, 7, 'shares two notes');
            }
        } else if (d === 0) {
            add(swap, 9, 'relative minor: same feel, sadder');
            add(swap, 4, 'shares two notes');
        } else if (d === 2) {
            add(swap, 5, 'same job, brighter');
            add(borrowed, 2, 'major 2: pushes to 5', '');
        } else if (d === 4) {
            add(swap, 0, 'shares two notes');
            add(borrowed, 4, 'major 3: leads to 6m', '');
        } else if (d === 5) {
            add(swap, 2, 'same job, softer');
            add(swap, 9, 'shares two notes');
            add(borrowed, 5, 'minor 4: bittersweet', 'm');
            add(borrowed, 10, '♭7: borrowed lift', '');
        } else if (d === 7) {
            add(swap, 4, 'shares two notes');
            add(borrowed, 10, '♭7: softer way home', '');
            add(spicy, 1, 'tritone sub: slides home', '7');
        } else if (d === 9) {
            add(swap, 0, 'same feel, brighter');
            add(swap, 5, 'shares two notes');
            add(borrowed, 8, '♭6: bigger, cinematic', '');
        }
        if (d !== 7 && !isDim)
            spicy.push({
                chord: `${n(root)}7`,
                why: ['dominant: pulls a 4th up'],
            });
    }

    const rank = (list: Option[]): Option[] => {
        const seen = new Set([name]);
        return list
            .filter((o) => {
                if (seen.has(o.chord)) return false;
                seen.add(o.chord);
                return true;
            })
            .sort((a, b) => shared(name, b.chord) - shared(name, a.chord));
    };
    return [
        { label: 'COLOUR', options: rank(colour) },
        { label: 'BASS', options: rank(bass) },
        { label: 'SWAP', options: rank(swap) },
        { label: 'BORROWED', options: rank(borrowed) },
        { label: 'SPICY', options: rank(spicy) },
    ].filter((g) => g.options.length);
}

/** chords that lead from one to the next, and how well they fit */
export function passing(
    from: string,
    to: string,
    key: string | null,
    flats: boolean,
): Passing | null {
    const ca = parseChord(from);
    const cb = parseChord(to);
    if (!ca || !cb) return null;
    const k = keyInfo(key, flats);
    const n = (p: number): string => noteName(p, flats);
    const ra = pitch(ca.root);
    const rb = pitch(cb.root);
    const step = mod(rb - ra);
    const options: Option[] = [];
    let fit = 0;
    let walk = false;
    if (step === 2) {
        options.push({ chord: `${n(ra + 1)}dim`, why: ['chromatic step up'] });
        fit = 1;
    } else if (step === 10) {
        options.push({
            chord: `${core(from)}/${n(ra - 1)}`,
            why: ['bass steps down'],
        });
        fit = 0.9;
    } else if (step === 8 || step === 9) {
        // walk the bass down a third through the note between
        const mid = mod(ra - (step === 9 ? 1 : 2));
        // the key's own chords, dominant and home first
        const order = k?.minor ? [7, 0, 3, 5, 8, 10] : [7, 0, 2, 4, 5, 9];
        const over = k
            ? order
                  .map((s) => `${n(k.tonic + s)}${triads(k)[s]}`)
                  .find((ch) => chordNotes(ch).tones.includes(mid))
            : null;
        if (over) {
            const onRoot = chordNotes(over).bass === mid;
            options.push({
                chord: onRoot ? over : `${over}/${n(mid)}`,
                why: ['bass walks down'],
            });
            fit = 0.9;
            walk = true;
        }
    } else if (step === 3 || step === 4) {
        options.push({
            chord: `${core(from)}/${n(ra + 2)}`,
            why: ['bass walks up'],
        });
        fit = 0.8;
        walk = true;
    } else if (step === 5) {
        const third = mod(ra + (/m$/.test(core(from)) ? 3 : 4));
        options.push({
            chord: `${core(from)}/${n(third)}`,
            why: ['bass walks up'],
        });
        fit = 0.8;
    } else if (step === 0) {
        options.push({ chord: `${ca.root}sus4`, why: ['a lift and back'] });
        options.push({
            chord: `${n(ra + 5)}/${n(ra)}`,
            why: ['4 over the same bass'],
        });
        fit = 0.6;
    }
    // a lead-in works into almost anything but home
    const lead = `${n(rb + 7)}7`;
    const home = k && rb === k.tonic && /m$/.test(core(to)) === k.minor;
    if (!home && lead !== from) {
        options.push({
            chord: lead,
            why: ['lead-in: pulls to ', { chord: to }],
        });
        fit = Math.max(fit, 0.7);
    }
    return options.length ? { options, fit, walk } : null;
}

const MAX_FROM_SONG = 3;

/**
 * chords the song already uses elsewhere that could stand here, moved into
 * this spot's key; the most convincing suggestions are the song's own
 */
export function fromSong(
    readings: readonly Reading[],
    here: Reading,
    original: string,
    flats: boolean,
): OptionGroup | null {
    if (!here.numeral) return null;
    const tones = chordNotes(original).tones;
    const own = simplifyChord(original);
    const picked = new Map<string, Option & { rank: number }>();
    for (const r of readings) {
        if (r.id === here.id) continue;
        const move = mod(tonicOf(here.key) - tonicOf(r.key));
        const chord = move ? transposeChord(r.chord, move, flats) : r.chord;
        if (simplifyChord(chord) === own) continue;
        const common = chordNotes(chord).tones.filter((t) =>
            tones.includes(t),
        ).length;
        const sameJob = r.role === here.role && r.role !== 'colour';
        if (!sameJob && common < 2) continue;
        // a chord from outside the key is the rarer, more telling find
        const rank = (sameJob ? 2 : 0) + common + (r.diatonic ? 0 : 1);
        const had = picked.get(chord);
        if (had && had.rank >= rank) continue;
        picked.set(chord, {
            chord,
            why: [r.label ? `${r.numeral} · in ${r.label}` : r.numeral],
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
