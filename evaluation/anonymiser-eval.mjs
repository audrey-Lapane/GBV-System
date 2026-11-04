// Measures the anonymiser's precision and recall on labelled synthetic records.
//   node anonymiser-eval.mjs [count=200]
// Each record has seeded identifiers (names, phones, ID numbers, emails, student numbers,
// room numbers) placed in varied sentences, including forms the patterns are known to miss
// (a bare name in a sentence). Report the result honestly: it will not be 100%.
import { writeFileSync, mkdirSync } from "node:fs";
import { anonymise } from "../backend/src/modules/reporting/anonymiser.js";

const N = Number(process.argv[2] || 200);
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");

const FIRST = ["Thandiwe", "Lerato", "Sipho", "Mpho", "Ndivhuwo", "Rendani", "Tshilidzi", "Kagiso", "Ayanda", "Lufuno", "Pieter", "Fatima"];
const LAST = ["Mokoena", "Ndlovu", "Mudau", "Nemakonde", "Khumalo", "Dlamini", "Van Wyk", "Netshitenzhe", "Maluleke", "Naidoo"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const idNumber = () => `${digits(2)}${pick(["01", "05", "11"])}${pick(["03", "15", "28"])}${digits(7)}`;
const phone = () => pick([`0${pick(["82", "72", "61", "15"])} ${digits(3)} ${digits(4)}`, `+27 ${pick(["82", "71"])} ${digits(3)} ${digits(4)}`, `0${pick(["83", "79"])}${digits(7)}`]);
const email = () => `${pick(FIRST).toLowerCase()}.${digits(2)}@${pick(["gmail.com", "univen.ac.za", "yahoo.co.za"])}`;
const student = () => digits(8);
const room = () => `room ${pick(["A", "B", ""])}${digits(3)}`;

// [template, kinds of seeded values]
const TEMPLATES = [
  [(v) => `My name is ${v[0]} and he would not leave me alone.`, [name]],
  [(v) => `It was Mr ${v[0].split(" ")[1]} from the residence office.`, [() => name()], (v) => v[0].split(" ")[1]],
  [(v) => `He keeps calling me on ${v[0]} even at night.`, [phone]],
  [(v) => `He took my ID card, number ${v[0]}.`, [idNumber]],
  [(v) => `He sent messages from ${v[0]} to my account.`, [email]],
  [(v) => `His student number is ${v[0]} if that helps.`, [student]],
  [(v) => `It happened in ${v[0]} after the party.`, [room]],
  [(v) => `A guy named ${v[0]} followed me to the bus stop.`, [name]],
  [(v) => `${v[0]} pushed me against the wall.`, [name]], // bare name: expected to be missed
  [(v) => `I told my friend ${v[0]} what happened.`, [name]], // bare name: expected to be missed
  [() => `It was around 9 in the evening on the 3rd floor, near the library.`, []], // no identifiers (false-positive check)
  [() => `I waited 20 minutes and then walked home with two friends.`, []],
];

let tp = 0, fn = 0, fp = 0, markers = 0;
const missedByKind = {};
const samples = [];
for (let i = 0; i < N; i++) {
  const sentences = [];
  const seeded = [];
  for (let k = 0; k < 3; k++) {
    const [tpl, gens, target] = pick(TEMPLATES);
    const vals = gens.map((g) => g());
    sentences.push(tpl(vals));
    vals.forEach((v, j) => seeded.push({ value: target ? target(vals) : v, kind: gens[j].name || "name" }));
  }
  const text = sentences.join(" ");
  const out = anonymise(text).text;
  const found = (out.match(/\[(?:[a-z ]+) removed\]/g) || []).length;
  markers += found;
  let hits = 0;
  for (const s of seeded) {
    if (out.includes(s.value)) { fn++; missedByKind[s.kind] = (missedByKind[s.kind] || 0) + 1; }
    else { tp++; hits++; }
  }
  fp += Math.max(0, found - hits);
  if (i < 5) samples.push({ input: text, output: out });
}

const precision = tp / (tp + fp);
const recall = tp / (tp + fn);
const result = { records: N, seededIdentifiers: tp + fn, removed: tp, missed: fn, falseRemovals: fp, precision: +precision.toFixed(3), recall: +recall.toFixed(3), missedByKind, samples };
console.log(`Records ${N}, seeded identifiers ${tp + fn}`);
console.log(`Removed ${tp}, missed ${fn}, removals of non-identifiers ${fp}`);
console.log(`Precision ${(precision * 100).toFixed(1)}%  Recall ${(recall * 100).toFixed(1)}%`);
console.log("Missed by kind:", missedByKind);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/anonymiser-${Date.now()}.json`, import.meta.url), JSON.stringify(result, null, 2));
