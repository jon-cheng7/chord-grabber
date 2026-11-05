// Lab takes: what was sung, what it should have been, kept in this browser (IndexedDB)

import type { Features, Weights } from '../engine/index.ts';
import type { Frame, Note } from '../listen/summary.ts';

export interface Take {
    version: 1 | 2;
    /** when it was sung; also its id */
    at: string;
    device: string;
    song?: string;
    key?: string;
    frames: Frame[];
    taps: number[];
    /** when STOP was pressed: the end of the last chord */
    stop?: number;
    /** the chords tapped, in order, as typed */
    chords?: string;
    /** the key melody note each chord should get, as typed; - to skip */
    expect?: string;
    /** the take as audio: 22.05 kHz, 16-bit, base64; at is when it starts */
    audio?: { rate: number; at: number; pcm: string };
    /** Basic Pitch's notes, once worked out */
    bp?: Note[];
}

/** a file name for a take: song and when */
export const slugOf = (t: Take): string =>
    `${(t.song ?? 'take').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${t.at.slice(0, 16).replace(/[:T]/g, '-')}`;

export function download(text: string, file: string): void {
    const blob = new Blob([text], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** what Basic Pitch wants */
export const AUDIO_RATE = 22050;

/** chunks from the worklet, joined and brought to another rate */
export async function resample(
    chunks: readonly Float32Array[],
    from: number,
    to: number,
): Promise<Float32Array> {
    const length = chunks.reduce((n, c) => n + c.length, 0);
    if (!length) return new Float32Array();
    const joined = new Float32Array(length);
    let at = 0;
    for (const c of chunks) {
        joined.set(c, at);
        at += c.length;
    }
    if (from === to) return joined;
    const ctx = new OfflineAudioContext(1, Math.ceil((length * to) / from), to);
    const buffer = ctx.createBuffer(1, length, from);
    buffer.copyToChannel(joined, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return (await ctx.startRendering()).getChannelData(0);
}

export function encode(pcm: Float32Array): string {
    const ints = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++)
        ints[i] = Math.max(-1, Math.min(1, pcm[i]!)) * 0x7fff;
    const bytes = new Uint8Array(ints.buffer);
    let bin = '';
    // in slices: spreading a whole take into one call overflows the stack
    for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

export function decode(data: string): Float32Array<ArrayBuffer> {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ints = new Int16Array(bytes.buffer);
    const out = new Float32Array(ints.length);
    for (let i = 0; i < ints.length; i++) out[i] = ints[i]! / 0x7fff;
    return out;
}

const DB = 'cg-lab';
// takes, and the A/B picks that train the style weights
const STORES = ['takes', 'prefs'] as const;
type Store = (typeof STORES)[number];

function db(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(DB, 2);
        open.onupgradeneeded = () => {
            for (const name of STORES)
                if (!open.result.objectStoreNames.contains(name))
                    open.result.createObjectStore(name, { keyPath: 'at' });
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
    });
}

async function run<T>(
    store: Store,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    const d = await db();
    return new Promise((resolve, reject) => {
        const req = work(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export const putTake = (take: Take): Promise<IDBValidKey> =>
    run('takes', 'readwrite', (s) => s.put(take));

export const allTakes = (): Promise<Take[]> =>
    run('takes', 'readonly', (s) => s.getAll() as IDBRequest<Take[]>);

export const removeTake = (at: string): Promise<undefined> =>
    run('takes', 'readwrite', (s) => s.delete(at));

/** one A/B pick: two reharms of the same passage, and which won */
export interface Pref {
    /** when; also its id */
    at: string;
    song: string;
    style: string;
    strength: number;
    /** the passage heard, as slot indexes */
    from: number;
    to: number;
    a: Variant;
    b: Variant;
    /** sounds better; more like the style */
    better: 'a' | 'b' | 'same';
    styled: 'a' | 'b' | 'same';
}

export interface Variant {
    weights: Weights;
    chords: string[];
    /** scored over the passage heard */
    features: Features;
}

export const putPref = (pref: Pref): Promise<IDBValidKey> =>
    run('prefs', 'readwrite', (s) => s.put(pref));

export const allPrefs = (): Promise<Pref[]> =>
    run('prefs', 'readonly', (s) => s.getAll() as IDBRequest<Pref[]>);
