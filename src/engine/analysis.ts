// Harmony: what each chord is doing, read from the chords alone (no melody, no beats)

import { parseChord } from '../music/chord.ts';
import {
    chordNotes,
    minor,
    mod,
    numberChord,
    pitch,
    shiftKey,
    simplifyChord,
} from '../music/theory.ts';
import { rankKeys } from './key.ts';
import type { Profile, Reading, Role, Slot, Song } from './types.ts';

export type Kind = '' | 'm' | 'dim';

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

function kindOf(quality: string): Kind {
    if (/^(?:dim|°|m7b5|ø)/.test(quality)) return 'dim';
    return minor(quality) ? 'm' : '';
}

export const tonicOf = (key: string): number =>
    pitch(parseChord(key)?.root ?? 'C');
export const isMinorKey = (key: string): boolean =>
    minor(parseChord(key)?.quality ?? '');

/** the key a section plays in: the song's, unless it clearly sits elsewhere */
function sectionKey(slots: readonly Slot[], home: string): string {
    if (slots.length < LOCAL_MIN) return home;
    const ranked = rankKeys(slots);
    const best = ranked[0];
    if (!best || best.key === home || best.score <= 0) return home;
    const mine = ranked.find((r) => r.key === home)?.score ?? -Infinity;
    return mine < best.score * LOCAL_MARGIN ? best.key : home;
}

/** a short progression that repeats through most of the section */
function loops(seq: string[]): boolean {
    for (let p = 2; p <= 4; p++) {
        if (seq.length < p * 2) break;
        const same = seq.filter((c, i) => c === seq[i % p]).length;
        if (same / seq.length >= LOOP_SHARE) return true;
    }
    return false;
}

export interface Class {
    numeral: string;
    role: Role;
    diatonic: boolean;
    /** semitones above the key's home note */
    step: number;
    kind: Kind;
}

/** one chord in a key; next decides whether it's a secondary dominant */
export function classify(
    chord: string,
    key: string,
    next: string | null,
): Class {
    const c = parseChord(chord);
    if (!c)
        return {
            numeral: '',
            role: 'colour',
            diatonic: false,
            step: 0,
            kind: '',
        };
    const minorKey = isMinorKey(key);
    const step = mod(pitch(c.root) - tonicOf(key));
    const kind = kindOf(c.quality);
    const scale = (minorKey ? MINOR : MAJOR)[step];
    // the raised fifth of a minor key counts as its own
    const raised = minorKey && step === 7 && kind === '';
    const diatonic = scale?.[0] === kind || raised;
    let role: Role = diatonic ? (scale?.[1] ?? 'colour') : 'colour';
    let numeral = numberChord(chord, key);
    if (!diatonic) {
        const n = next ? parseChord(next) : null;
        const borrowed = minorKey
            ? undefined
            : BORROWED_MAJOR[`${step}${kind}`];
        if (n && kind === '' && mod(pitch(c.root) + 5) === pitch(n.root)) {
            // a major chord a fifth above the next one: a secondary dominant
            role = 'dominant';
            const seventh = /7/.test(c.quality) ? '7' : '';
            numeral = `V${seventh}/${numberChord(simplifyChord(next!), key)}`;
        } else if (borrowed) role = borrowed;
    }
    return { numeral, role, diatonic, step, kind };
}

export interface Analysis {
    readings: Reading[];
    profile: Profile;
    byId: Map<string, Reading>;
    /** the song's key, tidied; null if unknown */
    home: string | null;
}

export function analyze(song: Song): Analysis {
    const home = song.key ? shiftKey(song.key, 0) : null;
    const readings: Reading[] = [];
    let loopSections = 0;
    let chordSections = 0;

    // sections in the order they're played
    const sections = new Map<string, Slot[]>();
    for (const s of song.slots) {
        const list = sections.get(s.section) ?? [];
        list.push(s);
        sections.set(s.section, list);
    }

    for (const found of sections.values()) {
        if (!home) {
            for (const f of found)
                readings.push({
                    ...f,
                    key: '',
                    numeral: '',
                    role: 'colour',
                    diatonic: false,
                    bass: chordNotes(f.chord).bass,
                    cadence: null,
                });
            continue;
        }
        const key = sectionKey(found, home);
        chordSections++;
        if (loops(found.map((f) => simplifyChord(f.chord)))) loopSections++;
        found.forEach((f, i) => {
            const { numeral, role, diatonic } = classify(
                f.chord,
                key,
                found[i + 1]?.chord ?? null,
            );
            readings.push({
                ...f,
                key,
                numeral,
                role,
                diatonic,
                bass: chordNotes(f.chord).bass,
                cadence: null,
            });
        });
    }

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
        loop: chordSections > 0 && loopSections / chordSections >= 0.5,
    };

    return {
        readings,
        profile,
        byId: new Map(readings.map((r) => [r.id, r])),
        home,
    };
}
