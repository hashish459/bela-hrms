/**
 * What an employee may ask to change about their own record, section by
 * section — and, by omission, what they may not. Code, placement, salary,
 * status, dates of service and statutory numbers are HR's alone; PAN and
 * citizenship are corrected against the original document, not a web form.
 *
 * Pure data: the self-service forms render from it, the HR queue labels the
 * before/after from it, and the service validates against it.
 */

export type FieldType = "text" | "textarea" | "date" | "select" | "checkbox" | "number" | "email" | "tel";

export type FieldDef = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  max?: number;
  hint?: string;
};

export type SectionKey =
  | "contact"
  | "address"
  | "emergency"
  | "personal"
  | "bank"
  | "family"
  | "qualification"
  | "experience";

export type SectionDef = {
  key: SectionKey;
  label: string;
  description: string;
  /** Row sections add, change or remove rows; the rest edit fields on the record. */
  rows: boolean;
  fields: FieldDef[];
};

const RELATIONSHIPS = [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "father_in_law",
  "mother_in_law",
  "guardian",
  "other",
].map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

const QUALIFICATION_KINDS = [
  { value: "education", label: "Education" },
  { value: "certification", label: "Certification" },
  { value: "training", label: "Training" },
  { value: "skill", label: "Skill" },
  { value: "language", label: "Language" },
];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));

export const SECTIONS: SectionDef[] = [
  {
    key: "contact",
    label: "Contact details",
    description: "Your mobile and personal email.",
    rows: false,
    fields: [
      { name: "mobile", label: "Mobile", type: "tel", max: 20 },
      { name: "personalEmail", label: "Personal email", type: "email", max: 160 },
    ],
  },
  {
    key: "address",
    label: "Address",
    description: "Where you live now and your permanent address.",
    rows: false,
    fields: [
      { name: "temporaryAddress", label: "Current address", type: "textarea", max: 300 },
      { name: "permanentAddress", label: "Permanent address", type: "textarea", max: 300 },
      { name: "district", label: "District", type: "text", max: 60 },
    ],
  },
  {
    key: "emergency",
    label: "Emergency contact",
    description: "Who HR calls if something happens at work.",
    rows: false,
    fields: [
      { name: "emergencyContactName", label: "Name", type: "text", required: true, max: 120 },
      { name: "emergencyContactRelation", label: "Relationship", type: "text", max: 60 },
      { name: "emergencyContactPhone", label: "Phone", type: "tel", required: true, max: 20 },
    ],
  },
  {
    key: "personal",
    label: "Personal details",
    description: "Marital status, blood group and the rest of your personal record.",
    rows: false,
    fields: [
      { name: "fullNameNepali", label: "Full name (Nepali)", type: "text", max: 160 },
      {
        name: "maritalStatus",
        label: "Marital status",
        type: "select",
        options: [
          { value: "single", label: "Single" },
          { value: "married", label: "Married" },
          { value: "divorced", label: "Divorced" },
          { value: "widowed", label: "Widowed" },
        ],
      },
      { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS },
      { name: "nationality", label: "Nationality", type: "text", max: 60 },
      { name: "religion", label: "Religion", type: "text", max: 60 },
    ],
  },
  {
    key: "bank",
    label: "Bank account",
    description: "Where your salary is paid. HR checks it against a cheque or bank letter before it changes.",
    rows: false,
    fields: [
      { name: "bankName", label: "Bank", type: "text", required: true, max: 120 },
      { name: "bankBranch", label: "Branch", type: "text", max: 120 },
      { name: "bankAccountNumber", label: "Account number", type: "text", required: true, max: 40 },
    ],
  },
  {
    key: "family",
    label: "Family member",
    description: "Dependants and nominees for insurance, gratuity and provident fund.",
    rows: true,
    fields: [
      { name: "fullName", label: "Full name", type: "text", required: true, max: 160 },
      { name: "relationship", label: "Relationship", type: "select", required: true, options: RELATIONSHIPS },
      { name: "dateOfBirth", label: "Date of birth", type: "date" },
      { name: "occupation", label: "Occupation", type: "text", max: 120 },
      { name: "contactNumber", label: "Contact number", type: "tel", max: 20 },
      { name: "isDependant", label: "Dependant", type: "checkbox" },
      { name: "isNominee", label: "Nominee", type: "checkbox" },
      { name: "nomineeSharePercent", label: "Nominee share (%)", type: "number", hint: "0–100" },
      { name: "isEmergencyContact", label: "Emergency contact", type: "checkbox" },
    ],
  },
  {
    key: "qualification",
    label: "Education or skill",
    description: "Degrees, certifications, training and languages.",
    rows: true,
    fields: [
      { name: "kind", label: "Kind", type: "select", required: true, options: QUALIFICATION_KINDS },
      { name: "title", label: "Title", type: "text", required: true, max: 200, hint: "BBS, AWS Solutions Architect, Nepali" },
      { name: "institution", label: "Institution", type: "text", max: 200 },
      { name: "result", label: "Result", type: "text", max: 60, hint: "Percentage, GPA or grade" },
      { name: "completedYear", label: "Year completed", type: "number" },
      { name: "expiresOn", label: "Expires on", type: "date", hint: "For certifications that lapse" },
    ],
  },
  {
    key: "experience",
    label: "Previous employment",
    description: "Where you worked before joining.",
    rows: true,
    fields: [
      { name: "employer", label: "Employer", type: "text", required: true, max: 200 },
      { name: "designation", label: "Designation", type: "text", max: 120 },
      { name: "fromDate", label: "From", type: "date" },
      { name: "toDate", label: "To", type: "date" },
      { name: "responsibilities", label: "Responsibilities", type: "textarea", max: 1000 },
      { name: "reasonForLeaving", label: "Reason for leaving", type: "text", max: 200 },
      { name: "referenceContact", label: "Reference contact", type: "text", max: 200 },
    ],
  },
];

export const SECTION_BY_KEY = new Map(SECTIONS.map((s) => [s.key, s]));

export type ProposedValues = Record<string, string | boolean | number | null>;

/**
 * Validates a submitted section against its definition. Returns clean values
 * or field errors; unknown fields are dropped, never passed through.
 */
export function validateSection(
  key: SectionKey,
  raw: Record<string, FormDataEntryValue | undefined>,
): { ok: true; values: ProposedValues } | { ok: false; errors: Record<string, string> } {
  const def = SECTION_BY_KEY.get(key);
  if (!def) return { ok: false, errors: { form: "Unknown section." } };
  const values: ProposedValues = {};
  const errors: Record<string, string> = {};

  for (const f of def.fields) {
    const v = raw[f.name];
    if (f.type === "checkbox") {
      values[f.name] = v === "on" || v === "true";
      continue;
    }
    const text = typeof v === "string" ? v.trim() : "";
    if (!text) {
      if (f.required) errors[f.name] = `${f.label} is required.`;
      values[f.name] = null;
      continue;
    }
    if (f.max && text.length > f.max) {
      errors[f.name] = `Keep it under ${f.max} characters.`;
      continue;
    }
    switch (f.type) {
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) errors[f.name] = "Use the date picker.";
        else values[f.name] = text;
        break;
      case "number": {
        const n = Number(text);
        if (!Number.isFinite(n) || !Number.isInteger(n)) errors[f.name] = "A whole number.";
        else if (f.name === "nomineeSharePercent" && (n < 0 || n > 100)) errors[f.name] = "Between 0 and 100.";
        else if (f.name === "completedYear" && (n < 1950 || n > 2200)) errors[f.name] = "A year, AD or BS.";
        else values[f.name] = n;
        break;
      }
      case "email":
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[f.name] = "Not an email address.";
        else values[f.name] = text.toLowerCase();
        break;
      case "tel":
        if (!/^[0-9+\-() ]{6,20}$/.test(text)) errors[f.name] = "Digits, spaces and + - ( ) only.";
        else values[f.name] = text;
        break;
      case "select":
        if (!f.options?.some((o) => o.value === text)) errors[f.name] = "Choose one of the options.";
        else values[f.name] = text;
        break;
      default:
        values[f.name] = text;
    }
  }

  if (key === "experience" && values.fromDate && values.toDate && String(values.toDate) < String(values.fromDate)) {
    errors.toDate = "Ends before it starts.";
  }
  if (key === "family" && !values.isNominee) values.nomineeSharePercent = null;

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

/** Readable value for a before/after table. */
export function displayValue(field: FieldDef | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field?.type === "checkbox") return value ? "Yes" : "No";
  if (field?.type === "select") return field.options?.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}
