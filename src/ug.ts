// Ultimate Guitar page data → sheet text and song details

export interface SongSource {
    title: string;
    artist: string;
    key: string | null;
    capo: number | null;
    /** sheet text, UG [ch] markup or plain chords-over-lyrics */
    sheet: string;
    url: string | null;
}

const ENTITIES: Record<string, string> = {
    quot: '"',
    amp: '&',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
};

/** the data sits in an HTML attribute, so it arrives entity-encoded */
export function decodeEntities(text: string): string {
    return text.replace(
        /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
        (whole, body: string) => {
            if (body[0] === '#') {
                const code =
                    body[1] === 'x' || body[1] === 'X'
                        ? parseInt(body.slice(2), 16)
                        : parseInt(body.slice(1), 10);
                return Number.isFinite(code)
                    ? String.fromCodePoint(code)
                    : whole;
            }
            return ENTITIES[body.toLowerCase()] ?? whole;
        },
    );
}

type Obj = Record<string, unknown>;

/** first object in the tree that passes, depth first */
function findObject(
    node: unknown,
    test: (o: Obj) => boolean,
    depth = 0,
): Obj | null {
    if (depth > 12 || node === null || typeof node !== 'object') return null;
    if (!Array.isArray(node) && test(node as Obj)) return node as Obj;
    for (const value of Object.values(node)) {
        const hit = findObject(value, test, depth + 1);
        if (hit) return hit;
    }
    return null;
}

const get = (o: Obj | null, key: string): unknown => (o ? o[key] : undefined);

const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

/** accepts the js-store attribute value, its JSON, or a whole page */
export function readUltimateGuitar(input: string): SongSource | null {
    let blob = input.trim();
    const inPage = /class="js-store"[^>]*data-content="([^"]*)"/.exec(blob);
    if (inPage) blob = inPage[1] ?? '';
    if (blob.includes('&quot;')) blob = decodeEntities(blob);
    let data: unknown;
    try {
        data = JSON.parse(blob);
    } catch {
        return null;
    }

    // layout has moved around over the years: look for shapes, not paths
    const view = findObject(
        data,
        (o) => typeof get(o.wiki_tab as Obj, 'content') === 'string',
    );
    const sheet = str(get(view?.wiki_tab as Obj, 'content'));
    if (!sheet) return null;
    const tab = findObject(data, (o) => 'song_name' in o && 'artist_name' in o);
    const meta = (get(view, 'meta') as Obj | undefined) ?? null;
    const capo = Number(get(meta, 'capo'));
    return {
        title: str(get(tab, 'song_name')) ?? 'Untitled',
        artist: str(get(tab, 'artist_name')) ?? '',
        key: str(get(tab, 'tonality_name')) ?? str(get(meta, 'tonality')),
        capo: Number.isFinite(capo) && capo > 0 ? capo : null,
        sheet,
        url: str(get(tab, 'tab_url')),
    };
}
