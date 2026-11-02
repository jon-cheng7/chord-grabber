// Files: songs and collections out to .json and back in

import {
    collections,
    idFor,
    restore,
    restoreCollection,
    song,
    type Collection,
    type Saved,
} from './store.ts';

const FORMAT = 'charts';
const VERSION = 1;

interface Bundle {
    format: typeof FORMAT;
    version: number;
    songs: Saved[];
    collections: Collection[];
}

const slug = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'charts';

/** phones get the share sheet (Save to Files); computers a download */
async function hand(bundle: Bundle, name: string): Promise<void> {
    const file = new File(
        [JSON.stringify(bundle, null, 2)],
        `${slug(name)}.json`,
        { type: 'application/json' },
    );
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        } catch (e) {
            // closed the sheet: that's an answer, not a failure
            if ((e as Error).name === 'AbortError') return;
        }
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function exportSong(id: string): Promise<void> {
    const s = song(id);
    if (!s) return Promise.resolve();
    return hand(
        { format: FORMAT, version: VERSION, songs: [s], collections: [] },
        s.title,
    );
}

export function exportCollection(id: string): Promise<void> {
    const c = collections().find((x) => x.id === id);
    if (!c) return Promise.resolve();
    const list = c.songs
        .map((x) => song(x))
        .filter((s): s is Saved => s !== null);
    return hand(
        {
            format: FORMAT,
            version: VERSION,
            songs: list,
            collections: [{ ...c, songs: list.map((s) => s.id) }],
        },
        c.name,
    );
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** a song from a file, checked field by field */
function readSong(v: unknown): Saved | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const title = text(o.title);
    const sheet = text(o.sheet);
    if (title === null || sheet === null) return null;
    return {
        id: text(o.id) ?? '',
        added: Date.now(),
        title,
        artist: text(o.artist) ?? '',
        key: text(o.key),
        capo: typeof o.capo === 'number' ? o.capo : null,
        sheet,
        url: text(o.url),
        shift: typeof o.shift === 'number' ? o.shift : undefined,
        fret: typeof o.fret === 'number' ? o.fret : undefined,
        edits: Array.isArray(o.edits) ? (o.edits as Saved['edits']) : undefined,
        arrangement: Array.isArray(o.arrangement)
            ? (o.arrangement as string[])
            : null,
    };
}

export interface Imported {
    songs: number;
    collections: number;
    /** files that weren't ours */
    skipped: number;
}

export async function importFiles(files: Iterable<File>): Promise<Imported> {
    const got: Imported = { songs: 0, collections: 0, skipped: 0 };
    for (const file of files) {
        let data: Partial<Bundle>;
        try {
            data = JSON.parse(await file.text()) as Partial<Bundle>;
        } catch {
            got.skipped++;
            continue;
        }
        if (data.format !== FORMAT || !Array.isArray(data.songs)) {
            got.skipped++;
            continue;
        }
        const read = data.songs
            .map(readSong)
            .filter((s): s is Saved => s !== null);
        // ids are remade from the sheet; collections follow the new ones
        const ids = new Map(read.map((s) => [s.id, idFor(s)]));
        // collections first, so their songs are safe from the 60-song trim
        for (const c of Array.isArray(data.collections)
            ? data.collections
            : []) {
            if (typeof c?.id !== 'string' || typeof c.name !== 'string')
                continue;
            restoreCollection({
                id: c.id,
                name: c.name,
                songs: (Array.isArray(c.songs) ? c.songs : [])
                    .map((x) => ids.get(x))
                    .filter((x): x is string => !!x),
                added: Date.now(),
            });
            got.collections++;
        }
        for (const s of read.reverse()) restore(s);
        got.songs += read.length;
    }
    return got;
}
