// Reharm engine: the only way in. Slots in, plain answers out; it never sees the sheet or the screen

import { analyze } from './analysis.ts';
import { followUps, reaches } from './moves.ts';
import { fromSong, passing, styled, suggestFor } from './suggest.ts';
import type {
    Direction,
    OptionGroup,
    Passing,
    Profile,
    Reading,
    Song,
} from './types.ts';

export { rankKeys, songKey, type KeySlot } from './key.ts';
export { melodyFit } from './fit.ts';
export {
    chordOf,
    homeOf,
    shapeOf,
    STYLES,
    tokenOf,
    type Style,
    type StyleTable,
} from './styles.ts';
export {
    features,
    modelOf,
    poolOf,
    restyle,
    type Features,
    type Model,
    type Restyled,
    type RestyleOptions,
    type Weights,
} from './style.ts';
export { WEIGHTS } from './weights.ts';
export type * from './types.ts';

export interface Engine {
    readonly profile: Profile;
    read(id: string): Reading | null;
    /** the key a slot's section plays in */
    keyOf(id: string): string | null;
    /** what to swap a slot's chord for; source is the sheet's own chord there */
    suggest(id: string, source: string): OptionGroup[];
    /** does picking this change what the slot does, not just its sound */
    reaches(id: string, source: string, picked: string): boolean;
    /** ways for the chords around a pick to follow it */
    followUps(id: string, picked: string): Direction[];
    /** a chord to pass from one chord to the next, in the key of slot at */
    between(from: string, to: string, at: string | null): Passing | null;
}

export function createEngine(song: Song): Engine {
    const a = analyze(song);
    const read = (id: string): Reading | null => a.byId.get(id) ?? null;
    const keyOf = (id: string | null): string | null =>
        (id && read(id)?.key) || a.home;
    /** the next chord in the same section, which decides secondary dominants */
    const nextOf = (here: Reading): string | null => {
        const next = a.readings[a.readings.indexOf(here) + 1];
        return next?.section === here.section ? next.chord : null;
    };

    return {
        profile: a.profile,
        read,
        keyOf,
        suggest(id, source) {
            // from the sheet's own chord, so edits don't drift ever further
            const groups = styled(
                suggestFor(source, keyOf(id), song.flats),
                a.profile,
            );
            const here = read(id);
            const own = here && fromSong(a.readings, here, source, song.flats);
            if (!own) return groups;
            const taken = new Set(
                groups.flatMap((g) => g.options.map((o) => o.chord)),
            );
            const fresh = own.options.filter((o) => !taken.has(o.chord));
            return fresh.length
                ? [{ ...own, options: fresh }, ...groups]
                : groups;
        },
        reaches(id, source, picked) {
            const here = read(id);
            return !!here && reaches(source, picked, here, nextOf(here));
        },
        followUps(id, picked) {
            const here = read(id);
            return here
                ? followUps(a.readings, here, picked, song.flats, a.profile)
                : [];
        },
        between: (from, to, at) => passing(from, to, keyOf(at), song.flats),
    };
}
