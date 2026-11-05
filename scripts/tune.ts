// Your A/B picks → the style weights. Each pick says "this reharm beat that one"; a
// logistic regression on the difference in their scores (style, distinct, melody, faithful) finds
// the weights that agree with you most, pulled gently toward the current ones.
//   node scripts/tune.ts            reads every export in data/prefs/
//   node scripts/tune.ts --write    and writes src/engine/weights.ts

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { WEIGHTS, type Weights } from '../src/engine/index.ts';
import type { Pref } from '../src/lab/takes.ts';

// how hard the fit is pulled back to the current weights; more picks, less pull
const PULL = 0.5;
const STEPS = 4000;
const RATE = 0.05;
const KEYS = ['style', 'distinct', 'melody', 'faithful'] as const;

if (!existsSync('data/prefs')) {
    console.error(
        'No picks yet: export them from the style pop-out into data/prefs/',
    );
    process.exit(1);
}
const prefs = new Map<string, Pref>();
for (const name of readdirSync('data/prefs')) {
    if (!name.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(`data/prefs/${name}`, 'utf8')) as
        Pref | Pref[];
    // exports overlap: each pick once
    for (const p of Array.isArray(data) ? data : [data]) prefs.set(p.at, p);
}

/** what restyle maximises: faithful counts by how much strength holds it back */
const scored = (p: Pref, side: 'a' | 'b'): number[] => {
    const f = p[side].features;
    // picks from before distinct was scored count it as no difference
    return [
        f.style,
        f.distinct ?? 0,
        f.melody,
        f.faithful * (1 - p.strength) * 2,
    ];
};

const picks = [...prefs.values()].filter((p) => p.better !== 'same');
const data = picks.map((p) => ({
    x: scored(p, 'a').map((v, i) => v - scored(p, 'b')[i]!),
    y: p.better === 'a' ? 1 : 0,
}));

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const dot = (w: number[], x: number[]): number =>
    w.reduce((s, wi, i) => s + wi * x[i]!, 0);
const agree = (w: number[]): number =>
    data.length
        ? data.filter((d) => (dot(w, d.x) > 0 ? 1 : 0) === d.y).length /
          data.length
        : NaN;

const start = KEYS.map((k) => WEIGHTS[k]);
const w = [...start];
for (let step = 0; step < STEPS && data.length; step++) {
    const grad = w.map((wi, i) => -PULL * (wi - start[i]!));
    for (const d of data) {
        const err = d.y - sigmoid(dot(w, d.x));
        d.x.forEach((xi, i) => (grad[i]! += err * xi));
    }
    // no negative weights: a style shouldn't be rewarded for sounding less like itself
    w.forEach(
        (wi, i) => (w[i] = Math.max(0, wi + (RATE * grad[i]!) / data.length)),
    );
}

// a sanity check on the style tables: is the higher style score the one you heard as more styled
const styled = [...prefs.values()].filter((p) => p.styled !== 'same');
const styleAgrees = styled.filter(
    (p) => (p.a.features.style > p.b.features.style ? 'a' : 'b') === p.styled,
).length;

const fixed = (n: number): string => n.toFixed(2);
const next: Weights = {
    style: w[0]!,
    distinct: w[1]!,
    melody: w[2]!,
    faithful: w[3]!,
};
console.log(`${prefs.size} picks, ${picks.length} with a winner`);
console.log(
    `agree with you: ${fixed(agree(start))} now → ${fixed(agree(w))} fitted`,
);
console.log(
    `now     ${KEYS.map((k, i) => `${k} ${fixed(start[i]!)}`).join('  ')}`,
);
console.log(`fitted  ${KEYS.map((k, i) => `${k} ${fixed(w[i]!)}`).join('  ')}`);
if (styled.length)
    console.log(
        `more styled: the style tables agree with your ear ${styleAgrees} of ${styled.length}`,
    );

if (process.argv.includes('--write')) {
    writeFileSync(
        'src/engine/weights.ts',
        `// Written by scripts/tune.ts from ${picks.length} A/B picks\n\n` +
            `import type { Weights } from './style.ts';\n\n` +
            `export const WEIGHTS: Weights = {\n${KEYS.map((k) => `    ${k}: ${fixed(next[k])},`).join('\n')}\n};\n`,
    );
    console.log('Wrote src/engine/weights.ts');
} else console.log('Add --write to keep them');
