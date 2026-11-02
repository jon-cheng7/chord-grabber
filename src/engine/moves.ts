// Moves: when a pick changes what a chord does, a few ways for its neighbours to follow.
// The pick is fixed; only the chords either side (same section, not locked) may change

import { parseChord } from '../music/chord.ts';
import {
    chordNotes,
    mod,
    noteName,
    pitch,
    simplifyChord,
} from '../music/theory.ts';
import { classify, isMinorKey, tonicOf } from './analysis.ts';
import type { Direction, Profile, Reading, Why } from './types.ts';

const MAX = 3;

// triads on the key's own steps; minor uses the raised fifth, so V can resolve
const MAJOR_STEPS: Record<number, string> = {
    0: '',
    2: 'm',
    4: 'm',
    5: '',
    7: '',
    9: 'm',
    11: 'dim',
};
const MINOR_STEPS: Record<number, string> = {
    0: 'm',
    2: 'dim',
    3: '',
    5: 'm',
    7: '',
    8: '',
    10: '',
};

const rootOf = (chord: string): number => pitch(parseChord(chord)?.root ?? 'C');
const plain = (chord: string): string => chord.replace(/\/.*$/, '');
const ch = (chord: string) => ({ chord });

/**
 * does the pick change what the chord does here (borrowed, a new pull,
 * another job), or only how it sounds (colour, inversion, a like-for-like swap)
 */
export function reaches(
    source: string,
    picked: string,
    here: Reading,
    next: string | null,
): boolean {
    if (!here.key || simplifyChord(picked) === simplifyChord(source))
        return false;
    const was = classify(source, here.key, next);
    const now = classify(picked, here.key, next);
    return !now.diatonic || now.role !== was.role;
}

/** ways to make the chords around a pick agree with it, most telling first */
export function followUps(
    readings: readonly Reading[],
    here: Reading,
    picked: string,
    flats: boolean,
    profile: Profile,
): Direction[] {
    const i = readings.indexOf(here);
    const near = (j: number): Reading | null => {
        const r = readings[j];
        return r && r.section === here.section ? r : null;
    };
    const prev = near(i - 1);
    const next = near(i + 1);
    const after = near(i + 2);
    const open = (r: Reading | null): r is Reading => !!r && !r.locked;

    const key = here.key;
    const tonic = tonicOf(key);
    const steps = isMinorKey(key) ? MINOR_STEPS : MAJOR_STEPS;
    const n = (p: number): string => noteName(p, flats);
    const onStep = (step: number): string =>
        `${n(tonic + step)}${steps[mod(step)] ?? ''}`;
    const stepOf = (r: Reading | null): number =>
        r ? mod(rootOf(r.chord) - tonic) : -1;
    const root = rootOf(picked);
    const it = classify(picked, key, next?.chord ?? null);

    const out: Direction[] = [];
    const add = (name: string, why: Why, swaps: [Reading, string][]) => {
        const real = swaps.filter(([r, c]) => c !== r.chord);
        if (!real.length || out.some((d) => d.name === name)) return;
        const swap = new Map(real);
        const window = [prev, here, next, swap.has(after!) ? after : null]
            .filter((r): r is Reading => !!r)
            .map((r) => (r === here ? picked : (swap.get(r) ?? r.chord)));
        out.push({
            name,
            why,
            changes: real.map(([r, chord]) => ({ id: r.id, chord })),
            window,
        });
    };

    // something that pulls: it should land where it pulls to
    const dim = it.kind === 'dim';
    const tritone = !dim && /7/.test(picked) && it.step === 1;
    if (it.role === 'dominant' || dim || tritone) {
        const target = mod(dim || tritone ? root + (dim ? 1 : -1) : root + 5);
        const landing = onStep(mod(target - tonic));
        if (open(next) && rootOf(next.chord) !== target)
            add(
                'Land it',
                [ch(picked), ' wants to land on ', ch(landing)],
                [[next, landing]],
            );
        else if (
            open(prev) &&
            !dim &&
            !tritone &&
            rootOf(prev.chord) !== mod(root + 7)
        ) {
            const ii = `${n(root + 7)}${/m$/.test(simplifyChord(landing)) ? 'm7b5' : 'm7'}`;
            add(
                'ii–V',
                [ch(ii), ' sets up ', ch(picked), ': a stronger push'],
                [[prev, ii]],
            );
        }
    }

    // borrowed from the parallel minor, in a major key
    if (!it.diatonic && it.role === 'pre' && !isMinorKey(key)) {
        const home = onStep(0);
        const flat7 = n(tonic + 10);
        if (it.step === 5 && it.kind === 'm') {
            if (open(prev) && stepOf(prev) !== 5)
                add(
                    'IV then iv',
                    [ch(onStep(5)), ' sinking to ', ch(picked)],
                    [[prev, onStep(5)]],
                );
            if (open(next) && stepOf(after) === 0 && stepOf(next) !== 10)
                add(
                    'Back door',
                    [ch(picked), ' → ', ch(`${flat7}7`), ' → ', ch(home)],
                    [[next, `${flat7}7`]],
                );
            if (open(next) && next.role === 'dominant' && next.ends)
                add(
                    'Straight home',
                    [ch(picked), ' → ', ch(home), ': a gentle amen'],
                    [[next, home]],
                );
        } else if (it.step === 8) {
            if (
                open(next) &&
                stepOf(next) !== 10 &&
                (stepOf(after) === 0 || next.role === 'dominant')
            )
                add(
                    'Climb home',
                    [ch(picked), ' → ', ch(flat7), ' → ', ch(home), ', rising'],
                    [[next, flat7]],
                );
        } else if (it.step === 10) {
            if (open(next) && stepOf(next) !== 0)
                add(
                    'Into home',
                    [ch(picked), ' rises a step to ', ch(home)],
                    [[next, home]],
                );
            if (open(prev) && stepOf(prev) !== 8)
                add(
                    'Climb',
                    [ch(n(tonic + 8)), ' → ', ch(picked), ', rising'],
                    [[prev, n(tonic + 8)]],
                );
        }
    }

    // anything else: smooth the way in
    if (open(prev)) {
        const bass = chordNotes(picked).bass;
        const was = chordNotes(prev.chord);
        // the chord before, on whichever of its notes sits a step from the pick's bass
        const step = was.tones
            .filter((t) => t !== was.bass)
            .map((t) => ({ t, d: Math.min(mod(bass - t), mod(t - bass)) }))
            .filter(({ d }) => d === 1 || d === 2)
            .sort((a, b) => a.d - b.d)[0];
        if (step) {
            const base = plain(prev.chord);
            const chord =
                rootOf(base) === step.t ? base : `${base}/${n(step.t)}`;
            add(
                'Bass leads in',
                ['the bass steps into ', ch(picked)],
                [[prev, chord]],
            );
        }
        if (it.role !== 'dominant' && rootOf(prev.chord) !== mod(root + 7))
            add(
                'Lead in',
                [ch(`${n(root + 7)}7`), ' pulls into ', ch(picked)],
                [[prev, `${n(root + 7)}7`]],
            );
    }

    // plain songs and loops: the gentler ways first
    if (profile.loop || profile.outside < 0.05) {
        const gentle = (d: Direction): number =>
            d.name === 'Bass leads in' ? 0 : d.name === 'Lead in' ? 2 : 1;
        out.sort((a, b) => gentle(a) - gentle(b));
    }
    return out.slice(0, MAX);
}
