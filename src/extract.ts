// Any chord page's HTML → the song, without the page around it

import { isChord, isChordLineFiller } from './chord.ts';
import { shiftKey } from './transpose.ts';
import { readUltimateGuitar, type SongSource } from './ug.ts';

const JUNK =
    'script, style, noscript, template, svg, iframe, nav, footer, aside, form, button, select, input, textarea, dialog, [role="dialog"], [hidden], [aria-hidden="true"]';
const JUNK_NAME =
    /^(?:comments?|comment-.*|sidebar|related.*|share|social.*|footer|breadcrumbs?|menu|navbar|cookie.*|newsletter|ads?|advert.*|promo.*|modal.*|.*-modal|popup.*|login.*|signup.*|subscribe.*)$/i;
// page widgets inside the song box: transposers, downloads, toolbars
const TOOLS = /transpose|download|toolbar|controls|print/i;
const BLOCK =
    /^(?:address|article|blockquote|dd|div|dl|dt|figure|h[1-6]|header|hr|li|main|ol|p|pre|section|table|tbody|thead|tr|td|th|ul)$/;
const LABEL =
    /^(?:intro|verse|chorus|pre-?chorus|post-?chorus|bridge|tag|outro|interlude|instrumental|ending|refrain|turnaround|vamp|coda|hook|breakdown|solo|riff)\s*\d*\s*(?:\([^)]*\))?\s*:?$/i;
const NOTE = '[A-G](?:#|b|♯|♭)?m?';
const MIN_CHORDS = 4;
// a chord-over-lyrics line in a box this short is one song line
const LINE_CHARS = 200;

const tag = (el: Element): string => el.tagName.toLowerCase();
const clean = (text: string): string => text.replace(/ /g, ' ');

function strip(root: Element): void {
    for (const el of root.querySelectorAll(JUNK)) el.remove();
    for (const el of root.querySelectorAll('[class], [id]')) {
        const names = `${el.getAttribute('class') ?? ''} ${el.id}`;
        if (
            names.split(/\s+/).some((n) => JUNK_NAME.test(n)) ||
            TOOLS.test(names)
        )
            el.remove();
    }
    for (const el of root.querySelectorAll('[style]')) {
        if (/display\s*:\s*none/i.test(el.getAttribute('style') ?? ''))
            el.remove();
    }
}

/** '' for anything too long to be a chord */
function chordText(el: Element): string {
    const raw = el.textContent ?? '';
    // bar lines ride along: |Gb
    return raw.length > 60 ? '' : clean(raw).replace(/[\s|]+/g, '');
}

function depth(el: Element): number {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
}

/** styled chord marks: elements naming one chord, the biggest tag + class group */
function chordMarks(root: Element): Element[] {
    const groups = new Map<string, Element[]>();
    const all: Element[] = [];
    for (const el of root.querySelectorAll('*')) {
        const text = chordText(el);
        if (!isChord(text)) continue;
        all.push(el);
        const sig = `${tag(el)}.${(el.getAttribute('class') ?? '').trim()}`;
        const list = groups.get(sig) ?? [];
        list.push(el);
        groups.set(sig, list);
    }
    // most chords wins; on a tie the tighter wrapper
    let best: Element[] = [];
    for (const list of groups.values()) {
        const tie =
            list.length === best.length &&
            depth(list[0]!) > depth(best[0]!);
        if (list.length > best.length || tie) best = list;
    }
    if (best.length < MIN_CHORDS) return [];
    // Bb<span>m</span>, G/<span>B</span>: the whole name, not its parts
    const marks = new Set(best);
    for (const el of all) {
        const inner = best.filter((m) => m !== el && el.contains(m));
        if (inner.some((m) => chordText(m) !== chordText(el))) {
            for (const m of inner) marks.delete(m);
            marks.add(el);
        }
    }
    return [...marks];
}

/** deepest element holding most of the marks */
function holder(marks: Element[]): Element | null {
    const counts = new Map<Element, number>();
    for (const mark of marks) {
        for (let p = mark.parentElement; p; p = p.parentElement)
            counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let best: Element | null = null;
    let depth = -1;
    for (const [el, n] of counts) {
        if (n < marks.length * 0.8) continue;
        let d = 0;
        for (let p = el.parentElement; p; p = p.parentElement) d++;
        if (d > depth) [best, depth] = [el, d];
    }
    return best;
}

/** text with line breaks where the page would show them, marks as [ch] */
function serialize(root: Element, marks: Set<Element> = new Set()): string {
    let out = '';
    let lastChord = false;
    const pre = (el: Element): boolean =>
        el.closest('pre') !== null ||
        /white-space\s*:\s*pre/i.test(el.getAttribute('style') ?? '');
    const isLine = (el: Element): boolean =>
        marks.size > 0 &&
        !el.querySelector('br, pre') &&
        (el.textContent ?? '').replace(/\s+/g, ' ').length <= LINE_CHARS &&
        [...marks].some((m) => el.contains(m));
    const breakLine = (): void => {
        if (out && !out.endsWith('\n')) out += '\n';
        lastChord = false;
    };
    const walk = (node: Node, inLine: boolean): void => {
        if (node.nodeType === 3) {
            const parent = node.parentElement;
            let text = clean(node.textContent ?? '');
            if (!parent || !pre(parent)) {
                // indentation between tags
                if (
                    !text.trim() &&
                    text.includes('\n') &&
                    parent?.children.length
                )
                    return;
                text = text.replace(/\s+/g, ' ');
                if (!out || /[\n ]$/.test(out)) text = text.trimStart();
            }
            if (text) lastChord = false;
            out += text;
            return;
        }
        if (node.nodeType !== 1) return;
        const el = node as Element;
        const name = tag(el);
        if (name === 'br') {
            out += inLine ? ' ' : '\n';
            lastChord = false;
            return;
        }
        if (marks.has(el)) {
            const raw = clean(el.textContent ?? '').trim();
            const lead = /^\|+/.exec(raw)?.[0] ?? '';
            const tail = /\|+$/.exec(raw)?.[0] ?? '';
            if (lastChord && !lead) out += ' ';
            out += `${lead}[ch]${chordText(el)}[/ch]${tail}`;
            lastChord = !tail;
            return;
        }
        const text = clean(el.textContent ?? '').trim();
        if (LABEL.test(text) && !el.querySelector('*')) {
            breakLine();
            out += `${text.replace(/:$/, '')}\n`;
            return;
        }
        const block = !inLine && BLOCK.test(name);
        const line = block && isLine(el);
        if (block || line) breakLine();
        for (const child of el.childNodes) walk(child, inLine || line);
        if (block || line) breakLine();
    };
    walk(root, false);
    // Db/F split over two marks
    return out.replace(
        /\[ch\]([^[]+)\[\/ch\]\/\[ch\]([A-G](?:#|b)?)\[\/ch\]/g,
        '[ch]$1/$2[/ch]',
    );
}

/** chords-over-lyrics text: how much of it reads as a chord sheet */
function textScore(text: string): number {
    let chords = 0;
    let lyrics = 0;
    for (const line of text.split('\n')) {
        const tokens = line.replace(/\[\/?ch\]/g, ' ').trim().split(/\s+/);
        if (!tokens[0]) continue;
        const real = tokens.filter((t) => !isChordLineFiller(t));
        if (real.length && real.every(isChord)) {
            chords += real.length;
            continue;
        }
        // inline marks: chords and lyrics on one line
        chords += line.split('[ch]').length - 1;
        if (/[a-z]{2}/i.test(line.replace(/\[ch\].*?\[\/ch\]/g, ''))) lyrics++;
    }
    return lyrics >= 2 ? chords : chords * 0.2;
}

/** lyrics with a blank between every line → one song line each */
function tidy(text: string): string {
    const trim = (t: string): string[] =>
        t.split('\n').map((l) => l.replace(/\s+$/, ''));
    let lines = trim(text);
    const filled = lines.filter(Boolean).length;
    let spaced = 0;
    for (let i = 0; i + 1 < lines.length; i++)
        if (lines[i] && !lines[i + 1]) spaced++;
    if (filled > 6 && spaced > filled * 0.8) {
        // keep only doubled blanks
        lines = trim(lines.join('\n').replace(/\n\n(?!\n)/g, '\n'));
    }
    return (
        lines
            .map((l) =>
                LABEL.test(l.trim())
                    ? `\n[${l.trim().replace(/:$/, '')}]\n`
                    : l,
            )
            .join('\n')
            // a gap before each section, none after its name
            .replace(/^(\[[^\]\n]+\])\n\n+/gm, '$1\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\n+|\n+$/g, '')
    );
}

interface Found {
    sheet: string;
    block: Element;
    score: number;
}

/** stray widget text above the song: drop it */
function fromFirstChord(sheet: string): string {
    const lines = sheet.split('\n');
    const start = lines.findIndex(
        (l) => l.includes('[ch]') || LABEL.test(l.trim()),
    );
    return start > 0 ? lines.slice(start).join('\n') : sheet;
}

function chordBlock(body: Element): Found | null {
    let best: Found | null = null;
    const marks = chordMarks(body);
    const box = marks.length ? holder(marks) : null;
    if (box) {
        const sheet = fromFirstChord(serialize(box, new Set(marks)));
        if (textScore(sheet) > 0)
            best = { sheet, block: box, score: marks.length };
    }
    const boxes = [...body.querySelectorAll('pre, [style*="white-space"]')];
    for (const br of body.querySelectorAll('br')) {
        const p = br.parentElement;
        if (p && !boxes.includes(p)) boxes.push(p);
    }
    for (const el of boxes) {
        const sheet = serialize(el);
        const score = textScore(sheet);
        if (score > (best?.score ?? 0)) best = { sheet, block: el, score };
    }
    return best && best.score >= MIN_CHORDS ? best : null;
}

/** no chords on the page: the biggest run of plain lines */
function lyricBlock(body: Element): Found | null {
    let best: Found | null = null;
    for (const el of body.querySelectorAll('div, section, article, td')) {
        const own = [...el.children].filter(
            (c) => tag(c) === 'p' || tag(c) === 'br',
        ).length;
        if (own < 3) continue;
        let links = 0;
        for (const a of el.querySelectorAll('a'))
            links += (a.textContent ?? '').length;
        const score = (el.textContent ?? '').trim().length - links * 3;
        if (score > (best?.score ?? 0))
            best = { sheet: serialize(el), block: el, score };
    }
    return best && best.score > 80 ? best : null;
}

/** "Song Chords - Artist | Site" → song and artist */
function names(doc: Document): { title: string; artist: string } {
    const meta = (p: string): string =>
        doc
            .querySelector(`meta[property="${p}"]`)
            ?.getAttribute('content')
            ?.trim() ?? '';
    const site = meta('og:site_name').toLowerCase();
    const h1 = clean(doc.querySelector('h1')?.textContent ?? '').trim();
    const raw = meta('og:title') || doc.title || h1;
    const parts = raw
        .split(/\s+[|–—-]\s+/)
        .map((p) => p.trim())
        .filter((p) => p && p.toLowerCase() !== site);
    const bare = (p: string): string =>
        p
            .replace(/\((?:easy|chords?|tabs?|lyrics?)[^)]*\)/gi, '')
            .replace(/\b(?:chords?|tabs?|lyrics?)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    if (parts.length < 2) return { title: bare(parts[0] ?? h1), artist: '' };
    const [a = '', b = ''] = parts;
    // "Song Chords" marks the song, then an exact h1, then title first
    const marked = /\bchords?\b/i;
    const first =
        marked.test(b) && !marked.test(a)
            ? false
            : marked.test(a) ||
              bare(h1).toLowerCase() !== bare(b).toLowerCase();
    return first
        ? { title: bare(a), artist: bare(b) }
        : { title: bare(b), artist: bare(a) };
}

function details(
    block: Element,
    body: Element,
): { key: string | null; capo: number | null } {
    const own = block.closest('[data-key]')?.getAttribute('data-key') ?? '';
    const text = clean(body.textContent ?? '').replace(/\s+/g, ' ');
    const said = new RegExp(`\\bkey\\s*:\\s*(${NOTE})(?![a-z])`, 'i').exec(
        text,
    );
    const key = (isChord(own) ? own : said?.[1]) ?? null;
    let capo: number | null = null;
    const plain = /\bcapo\s*:\s*(\d{1,2})\b/i.exec(text);
    const play = new RegExp(
        `\\bcapo\\s*(\\d{1,2})[^.]{0,12}?\\bplay(?:ed)?\\s+in\\s+(${NOTE})(?![a-z])|\\b(${NOTE})\\s+with\\s+capo\\s+(\\d{1,2})`,
        'i',
    ).exec(text);
    if (plain) capo = Number(plain[1]);
    else if (play) {
        // only if the sheet is written in the capo shapes
        const shape = play[2] ?? play[3];
        if (key && shape === key) capo = Number(play[1] ?? play[4]);
    }
    // key as heard, like UG: shapes in C with capo 1 sound in Db
    return {
        key: key && capo && play && !plain ? shiftKey(key, capo) : key,
        capo: capo || null,
    };
}

export function looksLikeHtml(text: string): boolean {
    return /<(?:html|body|head|div)\b/i.test(text.slice(0, 5000));
}

export function extractSong(
    doc: Document,
    url: string | null = null,
): SongSource | null {
    const store = doc.querySelector('.js-store')?.getAttribute('data-content');
    const ug = store ? readUltimateGuitar(store) : null;
    if (ug) return ug;
    const body = doc.body;
    if (!body) return null;
    const { title, artist } = names(doc);
    const canonical =
        doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ??
        null;
    strip(body);
    const found = chordBlock(body) ?? lyricBlock(body);
    if (!found) return null;
    const sheet = tidy(found.sheet);
    if (!sheet) return null;
    return {
        title: title || 'Untitled',
        artist,
        ...details(found.block, body),
        sheet,
        url: url ?? canonical,
    };
}
