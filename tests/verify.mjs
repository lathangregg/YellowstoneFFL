// Sanity checks for the data and analytics. Run with: node tests/verify.mjs
// 1) Internal consistency (always runs): the pivot diagonal must equal Sleeper's official records.
// 2) Regression values for Weeks 1-8 of the 2026 season (runs when those weeks are present).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../site/js/analytics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'site/data/league.json'), 'utf8'));
const ctx = A.prepare(data);
let failed = 0, passed = 0;
const ok = (cond, msg) => { cond ? passed++ : (failed++, console.error('FAIL:', msg)); };
const close = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b}`);
const rid = name => ctx.teams.find(t => t.name === name)?.rosterId;
const N = ctx.rids.length;

// ---- 1. consistency -----------------------------------------------------------------------
const piv = A.pivot(ctx);
for (const t of ctx.teams) {
  const d = piv[t.rosterId][t.rosterId];
  ok(d.w === t.official.w && d.l === t.official.l && d.t === t.official.t,
    `${t.name}: pivot diagonal ${A.fmtRec(d)} != Sleeper ${t.official.w}-${t.official.l}`);
}
const wva = A.weeklyVsAll(ctx);
for (const t of ctx.teams) for (const w of ctx.completed) {
  const r = wva[t.rosterId].weeks[w];
  ok(r.w + r.l + r.t === N - 1, `${t.name} week ${w}: weekly record does not cover ${N - 1} opponents`);
}
for (const w of ctx.completed) {
  const wins = ctx.rids.reduce((a, r) => a + wva[r].weeks[w].w, 0);
  const losses = ctx.rids.reduce((a, r) => a + wva[r].weeks[w].l, 0);
  ok(wins === losses, `week ${w}: league wins (${wins}) != losses (${losses})`);
}
for (const a of ctx.rids) for (const b of ctx.rids) {
  const r = piv[a][b];
  ok(r.w + r.l + r.t === ctx.completed.length, `pivot ${a}/${b}: games != completed weeks`);
}

// ---- 2. regression (Weeks 1-8, 2026) ------------------------------------------------------------
const W8 = [1, 2, 3, 4, 5, 6, 7, 8];
if (data.league.season === '2026' && W8.every(w => ctx.completed.includes(w))) {
  const sm = Object.fromEntries(A.summary(ctx, W8).map(r => [r.rid, r]));
  const me = rid('lgregg5'), sam = rid('SamYounger');
  ok(A.fmtRec(sm[me].own) === '8-0', 'lgregg5 own record');
  ok(A.fmtRec(sm[me].others) === '75-29', 'lgregg5 vs others');
  ok(A.fmtRec(sm[me].median) === '7-1', 'lgregg5 vs median');
  close(sm[me].pf, 1045.5, 0.06, 'lgregg5 PF');
  close(sm[me].luck, 2.23, 0.01, 'lgregg5 luck');
  ok(A.fmtRec(sm[sam].others) === '71-33', 'SamYounger vs others');
  ok(A.fmtRec(sm[sam].median) === '6-2', 'SamYounger vs median');
  close(sm[sam].pf, 1085.9, 0.06, 'SamYounger PF');
  ok(A.fmtRec(sm[rid('owenlc')].others) === '68-36', 'owenlc vs others');
  ok(A.fmtRec(sm[rid('ClonchShell')].others) === '64-40', 'ClonchShell vs others');
  ok(A.fmtRec(sm[rid('Gsansom71')].others) === '29-75', 'Gsansom71 vs others');
  const w8 = A.weeklyVsAll(ctx, W8);
  ok(JSON.stringify(W8.map(w => w8[me].weeks[w].w)) === '[13,11,5,10,7,10,8,11]', 'lgregg5 weekly wins vs all');
  const conc = A.concentration(ctx, W8);
  close(conc[me].eff, 9.6, 0.05, 'lgregg5 effective players');
  close(conc[rid('DJDave86')].eff, 8.2, 0.05, 'DJDave86 effective players');
  close(conc[me].gini, 0.55, 0.005, 'lgregg5 gini');
  const dep = Object.fromEntries(A.dependency(ctx, W8).map(r => [r.rid, r]));
  ok(dep[rid('DJDave86')].top.name === 'Jaxon Smith-Njigba' && dep[rid('DJDave86')].oldRank === 7 && dep[rid('DJDave86')].newRank === 14, 'DJDave86 dependency');
  ok(dep[me].top.name.startsWith('Kenneth Walker') && dep[me].oldRank === 4 && dep[me].newRank === 9, 'lgregg5 dependency');
  const W6 = [1, 2, 3, 4, 5, 6];
  close(A.pfBy(ctx, W6, 'all')[me], 800.78, 0.06, 'lgregg5 PF wk1-6');
  close(A.pfBy(ctx, W6, 'noDEF')[me], 760.28, 0.06, 'lgregg5 PF no DEF wk1-6');
  close(A.pfBy(ctx, W6, 'noKDEF')[me], 704.28, 0.06, 'lgregg5 PF no K/DEF wk1-6');
} else {
  console.log('(regression block skipped: Weeks 1-8 of 2026 not all present)');
}

console.log(`${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
