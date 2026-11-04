// Values shared with the contracts (sections are bit flags; roles are on-chain role numbers).
export const SECTIONS = { summary: 1, details: 2, evidence: 4 };
export const SECTION_LABEL = { 1: "Report", 2: "Full details", 4: "Evidence" };
export const sectionNames = (mask) =>
  [1, 2, 4].filter((b) => (mask & b) === b).map((b) => SECTION_LABEL[b]).join(", ") || "None";

// Plain-language role names for the reporter.
export const ROLE_LABEL = {
  0: "Not a registered staff member",
  1: "GBV office",
  2: "Legal services",
  3: "Campus health",
  4: "Social worker",
};
export const ROLE_KEY_LABEL = { gbv_office: "GBV office", legal: "Legal services", health: "Campus health", social_worker: "Social worker", admin: "Administrator" };
export const ROLE_KEY_ID = { gbv_office: 1, legal: 2, health: 3, social_worker: 4 };

export const DURATIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export const ACTION_LABEL = {
  report_registered: "Report recorded",
  item_added: "Part of the report stored (encrypted)",
  item_withdrawn: "Part of the report withdrawn",
  report_withdrawn: "Report withdrawn and made unreadable",
  alert_sent: "GBV office alerted (ID, category and date only)",
  consent_granted: "Access given",
  consent_revoked: "Access taken back",
  access_requested: "Access requested",
  access_attempt: "Someone tried to open the report",
};

export const dayNumber = (isoDate) => Math.floor(Date.parse(isoDate + "T00:00:00Z") / 86400000);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
