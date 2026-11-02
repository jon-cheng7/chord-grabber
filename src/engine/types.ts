// What the engine takes in and hands back: plain data, no sheet, no screen

/** one chord as the engine sees it, in the key the sheet is written in */
export interface Slot {
    /** stable through transposing and rearranging; handed back in changes */
    id: string;
    chord: string;
    /** one per section as played: a repeat is its own */
    section: string;
    /** Chorus, Bridge … for explanations */
    label: string;
    /** first / last chord on its line: phrases start and land there */
    starts: boolean;
    ends: boolean;
    /** words it's held over; 0 when unknown */
    held: number;
    /** the reader set it: follow-ups leave it alone */
    locked: boolean;
}

export interface Song {
    /** the sheet's key, null if nobody knows */
    key: string | null;
    /** spell what it writes with flats */
    flats: boolean;
    slots: readonly Slot[];
}

/** home, moving away, pulling back, or none of those */
export type Role = 'tonic' | 'pre' | 'dominant' | 'colour';
export type Cadence = 'full' | 'plagal' | 'deceptive' | 'half';

export interface Reading extends Slot {
    /** the key of its section */
    key: string;
    /** IV, ii7, ♭VII, V7/vi … */
    numeral: string;
    role: Role;
    /** in its key's own scale */
    diatonic: boolean;
    bass: number;
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

/** an explanation; chords are left as chords so the reader's key can name them */
export type Why = (string | { chord: string })[];

export interface Option {
    chord: string;
    why: Why;
}

export interface OptionGroup {
    label: string;
    options: Option[];
}

export interface Change {
    id: string;
    chord: string;
}

export interface Direction {
    name: string;
    why: Why;
    /** the neighbours it rewrites; the pick itself isn't one */
    changes: Change[];
    /** the chords around the pick, as they'd play */
    window: string[];
}

export interface Passing {
    options: Option[];
    /** how well it suits the move, 0–1 */
    fit: number;
    /** a walking bass: sits halfway, not just before the change */
    walk: boolean;
}
