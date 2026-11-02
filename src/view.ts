// The sheet as shown: arranged, reharmed per occurrence, and compacted to play

import { arrange, type Sections } from './arrange.ts';
import type { Line } from './parse.ts';
import { applyEdits, spots, type Edit } from './reharm.ts';

export interface Block {
    id: string;
    /** nth time this section comes round */
    occ: number;
    start: number;
    end: number;
    /** same section and same chords: plays from the first copy */
    sig: string;
}

export interface View {
    /** arranged, no reharm */
    raw: readonly Line[];
    lines: readonly Line[];
    /** each row's line in the sheet as written, -1 for added headings */
    origin: number[];
    occ: number[];
    blocks: Block[];
}

export interface Step {
    /** row in the compact sheet */
    row: number;
    piece: number;
    chord: string;
    /** which block of the arrangement this step plays */
    block: number;
    /** the row in the full view it stands for */
    src: number;
}

export interface Compact {
    lines: readonly Line[];
    steps: Step[];
}

/** an edit for one occurrence beats one for every occurrence */
function rowEdits(view: Omit<View, 'lines'>, edits: readonly Edit[]): Edit[] {
    const out: Edit[] = [];
    view.origin.forEach((line, row) => {
        if (line < 0) return;
        const mine = edits.filter((e) => e.line === line);
        const pieces = new Set(mine.map((e) => e.piece));
        for (const piece of pieces) {
            const at = mine.filter((e) => e.piece === piece);
            const e =
                at.find((x) => x.occ === view.occ[row]) ??
                at.find((x) => x.occ === undefined);
            if (e) out.push({ ...e, line: row });
        }
    });
    return out;
}

export function buildView(
    lines: readonly Line[],
    sections: Sections | null,
    order: readonly string[],
    edits: readonly Edit[],
): View {
    let raw: readonly Line[] = lines;
    let origin = lines.map((_, i) => i);
    const occ: number[] = lines.map(() => 0);
    const blocks: Block[] = [];
    if (sections) {
        const built = arrange(lines, sections, order);
        raw = built.lines;
        origin = built.origin;
        // find where each section starts in the built sheet
        const seen = new Map<string, number>();
        let row = 0;
        for (const id of order) {
            const s = sections.library.find((x) => x.id === id);
            if (!s) continue;
            const first = s.rows[0] ?? -1;
            while (row < raw.length && origin[row] !== first) row++;
            // a heading added for a part sits just before it
            const start = raw[row - 1]?.kind === 'section' && origin[row - 1] === -1
                ? row - 1
                : row;
            const n = seen.get(id) ?? 0;
            seen.set(id, n + 1);
            blocks.push({ id, occ: n, start, end: start, sig: '' });
            row++;
        }
        blocks.forEach((b, i) => {
            b.end = blocks[i + 1]?.start ?? raw.length;
            for (let r = b.start; r < b.end; r++) occ[r] = b.occ;
        });
    } else {
        blocks.push({ id: 'all', occ: 0, start: 0, end: raw.length, sig: '' });
    }
    const partial = { raw, origin, occ, blocks };
    const shown = applyEdits(raw, rowEdits(partial, edits));
    for (const b of blocks)
        b.sig = JSON.stringify(shown.slice(b.start, b.end));
    return { ...partial, lines: shown };
}

/** each different block once; steps jump back to repeats */
export function compact(view: View): Compact {
    const lines: Line[] = [];
    const firstOf = new Map<string, number>();
    // full-view row → compact row, for the blocks that are drawn
    const place = new Map<number, number>();
    view.blocks.forEach((b) => {
        const key = `${b.id}|${b.sig}`;
        if (firstOf.has(key)) return;
        firstOf.set(key, b.start);
        if (lines.length && lines[lines.length - 1]?.kind !== 'blank')
            lines.push({ kind: 'blank' });
        for (let r = b.start; r < b.end; r++) {
            place.set(r, lines.length);
            const line = view.lines[r];
            if (line) lines.push(line);
        }
    });
    const all = spots(view.lines);
    const steps: Step[] = [];
    view.blocks.forEach((b, i) => {
        const from = firstOf.get(`${b.id}|${b.sig}`) ?? b.start;
        for (const sp of all) {
            if (sp.line < from || sp.line >= from + (b.end - b.start)) continue;
            const row = place.get(sp.line);
            if (row === undefined) continue;
            steps.push({
                row,
                piece: sp.piece,
                chord: sp.chord,
                block: i,
                src: b.start + (sp.line - from),
            });
        }
    });
    return { lines, steps };
}
