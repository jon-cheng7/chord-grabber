// Chord symbols: recognise and split into root, quality, bass

export interface Chord {
    root: string;
    quality: string;
    bass: string | null;
}

const NOTE = '[A-G](?:#|b|♯|♭)?';
// m, maj7, sus4, add9, dim, aug, 7b9, (#11), 6/9 …
const QUALITY =
    "(?:maj|min|dim|aug|sus|add|no|alt|m|M|°|ø|\\+|-|[0-9]|#|b|♯|♭|\\(|\\)|/(?=[0-9])|')*";
const CHORD = new RegExp(`^(${NOTE})(${QUALITY})(?:/(${NOTE}))?$`);

/** (D): a chord you may play or leave out */
export const optional = (token: string): boolean => /^\(.+\)$/.test(token);

const bare = (token: string): string =>
    optional(token) ? token.slice(1, -1) : token;

export function parseChord(token: string): Chord | null {
    const match = CHORD.exec(bare(token));
    if (!match) return null;
    return {
        root: match[1] ?? '',
        quality: match[2] ?? '',
        bass: match[3] ?? null,
    };
}

export function isChord(token: string): boolean {
    return CHORD.test(bare(token));
}

/** bits of a chord line that aren't chords: bars, repeats, dashes */
export function isChordLineFiller(token: string): boolean {
    return /^(?:\||\|\||-+|\/+|%|x\d+|\(x?\d+x?\)|\(|\)|\.+|:|\*|N\.?C\.?|→|>)$/i.test(
        token,
    );
}
