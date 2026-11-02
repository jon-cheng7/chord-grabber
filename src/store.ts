// Saved songs, collections and settings, this device only

import type { Edit } from './reharm.ts';
import type { SongSource } from './ug.ts';

export interface Saved extends SongSource {
    id: string;
    added: number;
    /** semitones the reader moved it */
    shift?: number;
    /** the reader's own capo; the sheet shows the shapes */
    fret?: number;
    /** reharm changes, in the key the sheet is written in */
    edits?: Edit[];
    /** section ids in playing order; absent for the sheet's own */
    arrangement?: string[] | null;
}

const SONGS = 'cg-songs';
const SIZE = 'cg-size';
const MAX_SONGS = 60;

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // full or blocked: the song still shows, it just isn't kept
    }
}

/** same sheet → same id, so re-imports don't duplicate */
export function idFor(song: SongSource): string {
    let h = 2166136261;
    for (const ch of `${song.title}\n${song.artist}\n${song.sheet}`) {
        h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
    }
    return (h >>> 0).toString(36);
}

export function songs(): Saved[] {
    return read<Saved[]>(SONGS, []);
}

export function song(id: string): Saved | null {
    return songs().find((s) => s.id === id) ?? null;
}

export function save(source: SongSource): Saved {
    const id = idFor(source);
    const old = song(id);
    const saved: Saved = {
        ...source,
        id,
        added: Date.now(),
        shift: old?.shift,
        fret: old?.fret,
        edits: old?.edits,
        arrangement: old?.arrangement,
    };
    const rest = songs().filter((s) => s.id !== id);
    write(SONGS, trim([saved, ...rest]));
    return saved;
}

/** newest first; songs in a collection are never dropped */
function trim(list: Saved[]): Saved[] {
    const kept = new Set(collections().flatMap((c) => c.songs));
    return list.filter((s, i) => i < MAX_SONGS || kept.has(s.id));
}

/** a whole song from a file, with what was done to it there */
export function restore(file: Saved): Saved {
    const id = idFor(file);
    const restored: Saved = { ...file, id, added: Date.now() };
    const rest = songs().filter((s) => s.id !== id);
    write(SONGS, trim([restored, ...rest]));
    return restored;
}

export function setShift(id: string, shift: number): void {
    write(
        SONGS,
        songs().map((s) => (s.id === id ? { ...s, shift } : s)),
    );
}

export function setFret(id: string, fret: number): void {
    write(
        SONGS,
        songs().map((s) => (s.id === id ? { ...s, fret } : s)),
    );
}

/** new sheet text, keeping what still fits */
export function updateSheet(
    id: string,
    sheet: string,
    edits: Edit[],
    arrangement: string[] | null,
): Saved | null {
    let updated: Saved | null = null;
    write(
        SONGS,
        songs().map((s) => {
            if (s.id !== id) return s;
            updated = { ...s, sheet, edits, arrangement };
            return updated;
        }),
    );
    return updated;
}

export function setArrangement(id: string, order: string[] | null): void {
    write(
        SONGS,
        songs().map((s) => (s.id === id ? { ...s, arrangement: order } : s)),
    );
}

export function setEdits(id: string, edits: Edit[]): void {
    write(
        SONGS,
        songs().map((s) => (s.id === id ? { ...s, edits } : s)),
    );
}

export function remove(id: string): void {
    write(
        SONGS,
        songs().filter((s) => s.id !== id),
    );
    writeCollections(
        collections().map((c) => ({
            ...c,
            songs: c.songs.filter((x) => x !== id),
        })),
    );
}

export interface Collection {
    id: string;
    name: string;
    /** song ids, in the order they were added */
    songs: string[];
    added: number;
}

const COLLECTIONS = 'cg-collections';

export function collections(): Collection[] {
    return read<Collection[]>(COLLECTIONS, []);
}

function writeCollections(list: Collection[]): void {
    write(COLLECTIONS, list);
}

export function addCollection(name: string): Collection {
    const made: Collection = {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name,
        songs: [],
        added: Date.now(),
    };
    writeCollections([made, ...collections()]);
    return made;
}

export function renameCollection(id: string, name: string): void {
    writeCollections(
        collections().map((c) => (c.id === id ? { ...c, name } : c)),
    );
}

export function removeCollection(id: string): void {
    writeCollections(collections().filter((c) => c.id !== id));
}

export function setInCollection(id: string, songId: string, on: boolean): void {
    writeCollections(
        collections().map((c) => {
            if (c.id !== id) return c;
            const rest = c.songs.filter((x) => x !== songId);
            return { ...c, songs: on ? [...rest, songId] : rest };
        }),
    );
}

/** from a file: the same collection again gains its songs, a new one is added */
export function restoreCollection(file: Collection): void {
    const list = collections();
    const old = list.find((c) => c.id === file.id);
    if (!old) {
        writeCollections([{ ...file, added: Date.now() }, ...list]);
        return;
    }
    const merged = [
        ...old.songs,
        ...file.songs.filter((x) => !old.songs.includes(x)),
    ];
    writeCollections(
        list.map((c) => (c.id === old.id ? { ...c, songs: merged } : c)),
    );
}

export function textSize(): number {
    return read<number>(SIZE, 17);
}

export function setTextSize(px: number): void {
    write(SIZE, px);
}

const CONNECTED = 'cg-shortcut';

/** a song has arrived through the Shortcut or bookmarklet on this device */
export function connected(): boolean {
    return read<boolean>(CONNECTED, false);
}

export function markConnected(): void {
    write(CONNECTED, true);
}

export function pref<T>(key: string, fallback: T): T {
    return read<T>(key, fallback);
}

export function setPref(key: string, value: unknown): void {
    write(key, value);
}
