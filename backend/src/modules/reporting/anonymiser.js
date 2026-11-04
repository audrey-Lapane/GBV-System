// Pattern-based anonymiser. It removes common identifiers from free text before encryption.
// It is NOT perfect: names in ordinary sentences can be missed. The reporter is told this,
// and its precision and recall are measured in evaluation/anonymiser-eval.js.

const RULES = [
  // email addresses
  { kind: "email", re: /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g },
  // South African ID numbers: 13 digits, YYMMDD + 7 (spaces allowed)
  { kind: "id_number", re: /\b\d{2}[01]\d[0-3]\d[\s-]?\d{4}[\s-]?\d{2}[\s-]?\d\b/g },
  // phone numbers: +27 or 0 followed by 9 digits, with optional separators
  { kind: "phone", re: /(?:\+27|\b0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}\b/g },
  // student or staff numbers: 7 to 10 digit runs
  { kind: "number", re: /\b\d{7,10}\b/g },
  // titles followed by a capitalised name: Mr Smith, Dr. N. Mokoena, Prof Ndlovu
  { kind: "name", re: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir|Madam)\.?\s+(?:[A-Z]\.\s*)*[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g },
  // introductions: my name is X, named X, called X, his name is X
  {
    kind: "name",
    re: /\b((?:my|his|her|their)\s+name\s+is|named|called|known\s+as)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})/g,
    keepPrefix: true,
  },
  // street addresses: 12 Main Street / Road / Avenue
  { kind: "address", re: /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Crescent)\b\.?/g },
  // room or residence unit numbers: Room 214, Block C 12
  { kind: "room", re: /\b(?:room|rm|unit|flat)\s*#?\s*[A-Z]?\d{1,4}[A-Z]?\b/gi },
];

export function anonymise(text) {
  if (!text) return { text: "", removed: {} };
  let out = String(text);
  const removed = {};
  for (const rule of RULES) {
    out = out.replace(rule.re, (...m) => {
      removed[rule.kind] = (removed[rule.kind] || 0) + 1;
      return rule.keepPrefix ? `${m[1]} [name removed]` : `[${rule.kind.replace("_", " ")} removed]`;
    });
  }
  return { text: out, removed };
}
