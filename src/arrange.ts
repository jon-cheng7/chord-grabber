// Arrange: the song cut into sections, then put back in any order

import type { Line } from './parse.ts';

export interface Section {
    /** the header's line index: stable as long as the sheet is */
    id: string;
    label: string;
    short: string;
    /** lines it owns, header included */
    rows: number[];
}

export interface Sections {
    /** each different section once */
    library: Section[];
    /** the order the sheet itself plays them in */
    order: string[];
}

const SHORT: [RegExp, string][] = [
    [/^pre[\s-]?chorus/i, 'PC'],
    [/^post[\s-]?chorus/i, 'PoC'],
    [/^chorus/i, 'C'],
    [/^verse/i, 'V'],
    [/^bridge/i, 'B'],
    [/^intro/i, 'In'],
    [/^outro|^ending/i, 'Out'],
    [/^interlude/i, 'Int'],
    [/^instrumental/i, 'Inst'],
    [/^tag/i, 'Tag'],
    [/^refrain/i, 'R'],
    [/^turnaround/i, 'TA'],
    [/^vamp/i, 'Vamp'],
];

function shortName(label: string): string {
    const num = /(\d+)/.exec(label)?.[1] ?? '';
    for (const [re, s] of SHORT) if (re.test(label.trim())) return `${s}${num}`;
    return label.trim().slice(0, 4);
}

/** "Chorus 2", "CHORUS:", "Chorus (x2)" → "chorus" */
const base = (label: string): string =>
    label
        .toLowerCase()
        .replace(/\(.*?\)|[:\d]/g, '')
        .trim();

/** "Repeat Chorus", "(Chorus x2)", "REPEAT BRIDGE" */
const REPEAT = /^\(?\s*repeat\s+(.+?)\s*(?:x\s*(\d))?\s*\)?$/i;

function lineText(line: Line | undefined): string {
    if (!line) return '';
    if (line.kind === 'lyric')
        return line.units
            .flat()
            .map((p) => `${p.chord ? `[${p.chord}]` : ''}${p.text}`)
            .join('');
    if (line.kind === 'chords')
        return line.items.map((p) => p.chord ?? p.text).join(' ');
    if (line.kind === 'tab') return line.text;
    return '';
}

export function findSections(lines: readonly Line[]): Sections {
    interface Raw {
        id: string;
        label: string;
        rows: number[];
        repeats: string[];
    }
    const raws: Raw[] = [];
    let cur: Raw | null = null;
    lines.forEach((line, i) => {
        if (line.kind === 'section') {
            cur = { id: String(i), label: line.label, rows: [i], repeats: [] };
            raws.push(cur);
            return;
        }
        const repeat = REPEAT.exec(lineText(line).trim());
        if (!cur) {
            if (line.kind === 'blank') return;
            // anything above the first heading
            cur = { id: String(i), label: 'Start', rows: [], repeats: [] };
            raws.push(cur);
        }
        if (repeat?.[1]) {
            const times = Number(repeat[2] ?? 1);
            for (let t = 0; t < times; t++) cur.repeats.push(repeat[1]);
            return;
        }
        cur.rows.push(i);
    });

    // no headings at all: paragraphs become parts
    if (raws.length === 1 && raws[0]!.label === 'Start') {
        raws.length = 0;
        let part: Raw | null = null;
        lines.forEach((line, i) => {
            if (line.kind === 'blank') {
                if (part) part.rows.push(i);
                part = null;
                return;
            }
            if (!part) {
                part = {
                    id: String(i),
                    label: `Part ${raws.length + 1}`,
                    rows: [],
                    repeats: [],
                };
                raws.push(part);
            }
            part.rows.push(i);
        });
    }

    const body = (r: Raw): string =>
        r.rows
            .filter((i) => lines[i]?.kind !== 'section')
            .map((i) => lineText(lines[i]))
            .join('\n')
            .trim();
    // same name and words, chords placed a little differently: still one
    const words = (r: Raw): string =>
        `${base(r.label)}|${body(r)
            .replace(/\[[^\]]*\]/g, '')
            .toLowerCase()
            .replace(/[^a-z]/g, '')}`;
    const byWords = new Map<string, Section>();
    const library: Section[] = [];
    const order: string[] = [];
    const byBody = new Map<string, Section>();
    const byLabel = new Map<string, Section>();
    const find = (label: string): Section | undefined =>
        byLabel.get(base(label)) ??
        library.find((s) => base(s.label).startsWith(base(label)));

    for (const r of raws) {
        const text = body(r);
        // same words and chords, or a bare heading: the one we already have
        const same = text
            ? (byBody.get(text) ?? byWords.get(words(r)))
            : find(r.label);
        if (same) order.push(same.id);
        else if (text) {
            const s: Section = {
                id: r.id,
                label: r.label,
                short: shortName(r.label),
                rows: r.rows,
            };
            library.push(s);
            byBody.set(text, s);
            byWords.set(words(r), s);
            if (!byLabel.has(base(r.label))) byLabel.set(base(r.label), s);
            order.push(s.id);
        }
        for (const ref of r.repeats) {
            const s = find(ref);
            if (s) order.push(s.id);
        }
    }
    // two sections both called "V": number them apart
    const seen = new Map<string, number>();
    for (const s of library) seen.set(s.short, (seen.get(s.short) ?? 0) + 1);
    const count = new Map<string, number>();
    for (const s of library) {
        if ((seen.get(s.short) ?? 0) < 2 || /\d$/.test(s.short)) continue;
        const n = (count.get(s.short) ?? 0) + 1;
        count.set(s.short, n);
        s.short = `${s.short}${n}`;
    }
    return { library, order };
}

/** the sheet in this order; origin maps each new line to its old one */
export function arrange(
    lines: readonly Line[],
    sections: Sections,
    order: readonly string[],
): { lines: Line[]; origin: number[] } {
    const out: Line[] = [];
    const origin: number[] = [];
    for (const id of order) {
        const s = sections.library.find((x) => x.id === id);
        if (!s) continue;
        if (out.length && out[out.length - 1]?.kind !== 'blank') {
            out.push({ kind: 'blank' });
            origin.push(-1);
        }
        // a part with no heading of its own still gets one
        if (lines[s.rows[0] ?? -1]?.kind !== 'section') {
            out.push({ kind: 'section', label: s.label });
            origin.push(-1);
        }
        for (const i of s.rows) {
            const line = lines[i];
            if (!line) continue;
            out.push(line);
            origin.push(i);
        }
    }
    while (out[out.length - 1]?.kind === 'blank') {
        out.pop();
        origin.pop();
    }
    return { lines: out, origin };
}
