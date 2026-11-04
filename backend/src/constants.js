// Values shared with the contracts and the frontend.
export const ROLES = {
  1: { key: "gbv_office", label: "GBV office (designated office)" },
  2: { key: "legal", label: "Legal services" },
  3: { key: "health", label: "Campus health" },
  4: { key: "social_worker", label: "Social worker" },
};
export const ROLE_ID = Object.fromEntries(Object.entries(ROLES).map(([id, r]) => [r.key, Number(id)]));
export const OFFICE_ROLE = 1;

export const SECTIONS = { summary: 1, details: 2, evidence: 4 };
export const SECTION_NAME = { 1: "summary", 2: "details", 4: "evidence" };
export const SCOPE_ALL = 7;

export const CATEGORIES = {
  1: "Sexual harassment",
  2: "Sexual assault",
  3: "Physical violence",
  4: "Emotional or psychological abuse",
  5: "Stalking",
  6: "Online abuse",
  7: "Other",
};

export const DAY_SECONDS = 86400;
export const dayNumberToDate = (n) => new Date(n * DAY_SECONDS * 1000).toISOString().slice(0, 10);
export const dateToDayNumber = (iso) => Math.floor(Date.parse(iso + "T00:00:00Z") / 1000 / DAY_SECONDS);
export const today = () => new Date().toISOString().slice(0, 10);
