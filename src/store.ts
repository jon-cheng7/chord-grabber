// Saved songs and settings, this device only

import type { SongSource } from './ug.ts';

export interface Saved extends SongSource {
    id: string;
    added: number;
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
function idFor(song: SongSource): string {
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
    const saved: Saved = { ...source, id, added: Date.now() };
    const rest = songs().filter((s) => s.id !== id);
    write(SONGS, [saved, ...rest].slice(0, MAX_SONGS));
    return saved;
}

export function remove(id: string): void {
    write(
        SONGS,
        songs().filter((s) => s.id !== id),
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
