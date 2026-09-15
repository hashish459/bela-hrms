/**
 * Product identity. Everything user-visible reads from here so the name, company
 * and version are stated once.
 */
export const APP = {
  /** Product name, as it appears in the header and browser tab. */
  name: "Bela-HRMS",
  /** Long form, for the login screen and printed documents. */
  fullName: "Bela Human Resource Management System",
  /** Legal entity that owns the software and the data in it. */
  company: "Bela Nepal Industries Pvt. Ltd.",
  companyLegal: "Bela Nepal Industries Private Limited",
  companyNepali: "बेला नेपाल इन्डस्ट्रिज प्रा. लि.",
  /** Bumped when a module ships; see the roadmap on the dashboard. */
  version: "1.0",
  copyrightYear: 2026,
  tagline: "Human resources, attendance and leave for Bela Nepal Industries.",
} as const;
