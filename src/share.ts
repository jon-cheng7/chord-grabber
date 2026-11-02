// Share links: the whole song, squeezed into the link's hash

import type { SongSource } from './ug.ts';

export interface Shared {
    source: SongSource;
    shift: number;
}

async function squeeze(text: string): Promise<string> {
    const stream = new Blob([text])
        .stream()
        .pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unsqueeze(data: string): Promise<string> {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
}

/** built ahead of time: the share sheet only opens straight from a tap */
export async function makeLink(song: SongSource, shift: number): Promise<string> {
    const { title, artist, key, capo, sheet, url } = song;
    const data = await squeeze(
        JSON.stringify({ title, artist, key, capo, sheet, url, shift }),
    );
    return `${location.origin}${location.pathname}#s=${data}`;
}

/** old-style copy: works on plain http where the clipboard API doesn't */
function copyByHand(text: string): boolean {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.append(box);
    box.select();
    box.setSelectionRange(0, text.length);
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch {
        ok = false;
    }
    box.remove();
    return ok;
}

export async function sendLink(
    link: string,
    title: string,
): Promise<'shared' | 'copied' | 'failed'> {
    if (navigator.share) {
        try {
            await navigator.share({ title, url: link });
            return 'shared';
        } catch (e) {
            // closing the share sheet isn't a failure
            if (e instanceof DOMException && e.name === 'AbortError')
                return 'shared';
        }
    }
    if (copyByHand(link)) return 'copied';
    try {
        await navigator.clipboard.writeText(link);
        return 'copied';
    } catch {
        return 'failed';
    }
}

export async function readShared(data: string): Promise<Shared | null> {
    try {
        const o = JSON.parse(await unsqueeze(data)) as Partial<
            SongSource & { shift: number }
        >;
        if (typeof o.sheet !== 'string') return null;
        return {
            source: {
                title: String(o.title ?? 'Shared song'),
                artist: String(o.artist ?? ''),
                key: typeof o.key === 'string' ? o.key : null,
                capo: typeof o.capo === 'number' ? o.capo : null,
                sheet: o.sheet,
                url: typeof o.url === 'string' ? o.url : null,
            },
            shift: typeof o.shift === 'number' ? o.shift : 0,
        };
    } catch {
        return null;
    }
}
