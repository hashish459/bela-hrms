/**
 * The notification catalogue: every notification the product can send.
 *
 * Defined in code, like the navigation and the permissions, so it ships with
 * the build and cannot drift from the events that raise it. An organisation
 * stores only its *overrides* (notification_rule): switched off, email turned
 * on, a template reworded. Anything it has not touched uses the default here —
 * which is what lets a release add a notification without anybody configuring
 * it first.
 *
 * Pure: no database, no React. The admin editor imports it for its previews.
 */

export type Recipient = "subject" | "approver" | "supervisor" | "hr";

export const RECIPIENT_LABEL: Record<Recipient, string> = {
  subject: "The employee concerned",
  approver: "Whoever the request is waiting on",
  supervisor: "The employee's supervisor",
  hr: "HR (everyone with the permission below)",
};

export type Category = "leave" | "attendance" | "records" | "reminders" | "organisation" | "announcements";

export const CATEGORIES: { key: Category; label: string; description: string }[] = [
  { key: "leave", label: "Leave", description: "Requests to approve, and decisions on your own." },
  { key: "attendance", label: "Attendance", description: "Corrections to approve, and decisions on your own." },
  { key: "records", label: "Employee records", description: "Transfers, promotions, separations and changes to personal details." },
  { key: "reminders", label: "Reminders", description: "Approvals waiting too long, documents expiring, probation ending." },
  { key: "organisation", label: "Organisation", description: "Changes to branches, departments and the rest of the structure." },
  { key: "announcements", label: "Announcements", description: "Messages sent to staff by an administrator." },
];

export type Severity = "info" | "success" | "warning" | "danger";

export type CatalogueEntry = {
  key: string;
  category: Category;
  label: string;
  description: string;
  /** The domain event that raises it; null for reminders and announcements. */
  source: string | null;
  severity: Severity;
  /** Recipients this notification may go to, and those it goes to by default. */
  allowedRecipients: Recipient[];
  defaultRecipients: Recipient[];
  /** Whose permission makes somebody "HR" for this notification. */
  hrPermission?: string;
  enabled: boolean;
  inApp: boolean;
  email: boolean;
  title: string;
  body: string;
  /** Where clicking it goes, with placeholders. */
  href: string;
  /** Placeholders the templates can use, with a sample value for previews. */
  placeholders: Record<string, string>;
  /** Reminders: days before (or after) that trigger it. */
  thresholdDays?: { default: number; label: string };
};

const LEAVE_PLACEHOLDERS = {
  employee: "Sabina Basnet",
  leaveType: "Home Leave",
  dates: "2083-06-10 → 2083-06-14",
  days: "4 days",
  reference: "LV-2083-0012",
  reason: "Family visit to Pokhara",
  approver: "Anil Thapa",
  actor: "Anil Thapa",
  comment: "Enjoy the break",
  organisation: "Bela Nepal Industries",
};

const ATTENDANCE_PLACEHOLDERS = {
  employee: "Sabina Basnet",
  requestType: "Missing punch",
  date: "2083-05-21",
  reference: "AT-2083-0007",
  reason: "Card reader was offline",
  approver: "Anil Thapa",
  actor: "Anil Thapa",
  comment: "Corrected",
  organisation: "Bela Nepal Industries",
};

export const CATALOGUE: CatalogueEntry[] = [
  /* ---------------------------------------------------------------- leave */
  {
    key: "leave.submitted",
    category: "leave",
    label: "Leave request waiting for approval",
    description: "Sent when an employee applies for leave, to whoever approves it first.",
    source: "leave.request.submitted",
    severity: "info",
    allowedRecipients: ["approver", "supervisor", "hr", "subject"],
    defaultRecipients: ["approver"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{employee}} requested {{days}} of {{leaveType}}",
    body: "{{dates}} · {{reference}}\nReason: {{reason}}",
    href: "/leave/approvals",
    placeholders: LEAVE_PLACEHOLDERS,
  },
  {
    key: "leave.forwarded",
    category: "leave",
    label: "Leave request passed to the next approver",
    description: "Sent when one level approves and the request needs a higher level's sign-off.",
    source: "leave.request.forwarded",
    severity: "info",
    allowedRecipients: ["approver", "subject", "hr"],
    defaultRecipients: ["approver"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{employee}}'s {{leaveType}} needs your approval",
    body: "{{actor}} approved it and passed it to you. {{dates}} · {{days}} · {{reference}}",
    href: "/leave/approvals",
    placeholders: LEAVE_PLACEHOLDERS,
  },
  {
    key: "leave.approved",
    category: "leave",
    label: "Leave approved",
    description: "Tells the employee their leave is confirmed.",
    source: "leave.request.approved",
    severity: "success",
    allowedRecipients: ["subject", "supervisor", "hr"],
    defaultRecipients: ["subject"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: true,
    title: "Your {{leaveType}} is approved",
    body: "{{dates}} · {{days}} · approved by {{actor}}. {{comment}}",
    href: "/leave/my",
    placeholders: LEAVE_PLACEHOLDERS,
  },
  {
    key: "leave.rejected",
    category: "leave",
    label: "Leave rejected",
    description: "Tells the employee their request was refused, with the approver's comment.",
    source: "leave.request.rejected",
    severity: "danger",
    allowedRecipients: ["subject", "supervisor", "hr"],
    defaultRecipients: ["subject"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: true,
    title: "Your {{leaveType}} request was not approved",
    body: "{{dates}} · {{reference}} · {{actor}}: {{comment}}",
    href: "/leave/my",
    placeholders: LEAVE_PLACEHOLDERS,
  },
  {
    key: "leave.withdrawn",
    category: "leave",
    label: "Leave withdrawn",
    description: "Tells whoever was reviewing the request that the employee withdrew it.",
    source: "leave.request.withdrawn",
    severity: "warning",
    allowedRecipients: ["approver", "supervisor", "hr"],
    defaultRecipients: ["approver"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: false,
    title: "{{employee}} withdrew {{leaveType}}",
    body: "{{dates}} · {{reference}} no longer needs a decision.",
    href: "/leave/approvals",
    placeholders: LEAVE_PLACEHOLDERS,
  },

  /* ----------------------------------------------------------- attendance */
  {
    key: "attendance.submitted",
    category: "attendance",
    label: "Attendance correction waiting for approval",
    description: "Sent when an employee asks for a day to be corrected.",
    source: "attendance.request.submitted",
    severity: "info",
    allowedRecipients: ["approver", "supervisor", "hr"],
    defaultRecipients: ["approver"],
    hrPermission: "attendance.record.edit",
    enabled: true,
    inApp: true,
    email: false,
    title: "{{employee}} asked to correct {{date}}",
    body: "{{requestType}} · {{reference}}\nReason: {{reason}}",
    href: "/attendance/approvals",
    placeholders: ATTENDANCE_PLACEHOLDERS,
  },
  {
    key: "attendance.forwarded",
    category: "attendance",
    label: "Attendance correction passed to the next approver",
    description: "Sent when a correction needs a higher level's sign-off.",
    source: "attendance.request.forwarded",
    severity: "info",
    allowedRecipients: ["approver", "subject"],
    defaultRecipients: ["approver"],
    hrPermission: "attendance.record.edit",
    enabled: true,
    inApp: true,
    email: false,
    title: "{{employee}}'s correction for {{date}} needs your approval",
    body: "{{requestType}} · {{reference}} · passed on by {{actor}}",
    href: "/attendance/approvals",
    placeholders: ATTENDANCE_PLACEHOLDERS,
  },
  {
    key: "attendance.approved",
    category: "attendance",
    label: "Attendance correction approved",
    description: "Tells the employee their day has been corrected and recalculated.",
    source: "attendance.request.approved",
    severity: "success",
    allowedRecipients: ["subject", "supervisor"],
    defaultRecipients: ["subject"],
    hrPermission: "attendance.record.edit",
    enabled: true,
    inApp: true,
    email: false,
    title: "Your correction for {{date}} is approved",
    body: "{{requestType}} · {{reference}} · approved by {{actor}}. The day has been recalculated.",
    href: "/attendance/my",
    placeholders: ATTENDANCE_PLACEHOLDERS,
  },
  {
    key: "attendance.rejected",
    category: "attendance",
    label: "Attendance correction rejected",
    description: "Tells the employee their correction was refused.",
    source: "attendance.request.rejected",
    severity: "danger",
    allowedRecipients: ["subject", "supervisor"],
    defaultRecipients: ["subject"],
    hrPermission: "attendance.record.edit",
    enabled: true,
    inApp: true,
    email: false,
    title: "Your correction for {{date}} was not approved",
    body: "{{requestType}} · {{reference}} · {{actor}}: {{comment}}",
    href: "/attendance/requests",
    placeholders: ATTENDANCE_PLACEHOLDERS,
  },

  /* ------------------------------------------------------------ reminders */
  {
    key: "reminder.approval_waiting",
    category: "reminders",
    label: "Approval waiting too long",
    description: "Reminds an approver about a leave request they have not decided, once a day.",
    source: null,
    severity: "warning",
    allowedRecipients: ["approver", "hr"],
    defaultRecipients: ["approver"],
    hrPermission: "leave.request.viewAll",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{employee}}'s {{leaveType}} has waited {{waiting}}",
    body: "{{dates}} · {{reference}} is still waiting for your decision.",
    href: "/leave/approvals",
    placeholders: { ...LEAVE_PLACEHOLDERS, waiting: "4 days" },
    thresholdDays: { default: 3, label: "Remind after this many days waiting" },
  },
  {
    key: "reminder.document_expiring",
    category: "reminders",
    label: "Document about to expire",
    description: "A passport, contract or licence on an employee's file is near its expiry date.",
    source: null,
    severity: "warning",
    allowedRecipients: ["subject", "hr"],
    defaultRecipients: ["subject", "hr"],
    hrPermission: "hr.document.manage",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{document}} expires {{expires}}",
    body: "{{employee}}'s {{document}} expires on {{expiryDate}}. Upload the renewed copy before then.",
    href: "/me/profile",
    placeholders: {
      employee: "Sabina Basnet",
      document: "Passport",
      expires: "in 21 days",
      expiryDate: "2083-07-01",
      organisation: "Bela Nepal Industries",
    },
    thresholdDays: { default: 30, label: "Warn this many days before expiry" },
  },
  {
    key: "reminder.probation_ending",
    category: "reminders",
    label: "Probation ending",
    description: "An employee's probation ends soon and needs a confirmation decision.",
    source: null,
    severity: "warning",
    allowedRecipients: ["supervisor", "hr"],
    defaultRecipients: ["supervisor", "hr"],
    hrPermission: "hr.employee.update",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{employee}}'s probation ends {{ends}}",
    body: "Probation ends on {{probationEnd}}. Record the confirmation decision before then.",
    href: "/hr/confirmations",
    placeholders: {
      employee: "Sabina Basnet",
      ends: "in 10 days",
      probationEnd: "2083-06-30",
      organisation: "Bela Nepal Industries",
    },
    thresholdDays: { default: 14, label: "Warn this many days before probation ends" },
  },

  /* ----------------------------------------------------- employee records */
  {
    key: "people.movement_applied",
    category: "records",
    label: "Transfer or promotion took effect",
    description: "Tells the employee (and their supervisor) that a transfer, promotion or revision is now on their record.",
    source: "people.movement.applied",
    severity: "info",
    allowedRecipients: ["subject", "supervisor", "hr"],
    defaultRecipients: ["subject", "supervisor"],
    hrPermission: "hr.employee.update",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{kind}} effective {{date}}",
    body: "{{employee}} — {{kind}} {{reference}} is now on the record.",
    href: "/me/profile?tab=service",
    placeholders: {
      employee: "Sabina Basnet",
      kind: "Transfer",
      date: "2083-06-01",
      reference: "TRF-2083-0004",
      organisation: "Bela Nepal Industries",
    },
  },
  {
    key: "people.separation_initiated",
    category: "records",
    label: "Separation recorded",
    description: "A resignation, termination or retirement was recorded; clearance begins.",
    source: "people.separation.initiated",
    severity: "warning",
    allowedRecipients: ["subject", "supervisor", "hr"],
    defaultRecipients: ["supervisor", "hr"],
    hrPermission: "hr.employee.separate",
    enabled: true,
    inApp: true,
    email: true,
    title: "{{employee}}: {{kind}} recorded",
    body: "Last working day {{date}} · {{reference}}. The clearance checklist is open.",
    href: "/hr/separations",
    placeholders: {
      employee: "Sabina Basnet",
      kind: "Resignation",
      date: "2083-07-15",
      reference: "SEP-2083-0002",
      organisation: "Bela Nepal Industries",
    },
  },
  {
    key: "people.profile_change_submitted",
    category: "records",
    label: "Profile change requested",
    description: "An employee asked HR to correct something on their record.",
    source: "people.profile_change.submitted",
    severity: "info",
    allowedRecipients: ["hr", "supervisor"],
    defaultRecipients: ["hr"],
    hrPermission: "hr.employee.update",
    enabled: true,
    inApp: true,
    email: false,
    title: "{{employee}} asked to update their {{section}}",
    body: "Review the before and after, then apply or refuse it.",
    href: "/hr/profile-requests",
    placeholders: { employee: "Sabina Basnet", section: "bank account", organisation: "Bela Nepal Industries" },
  },
  {
    key: "people.profile_change_decided",
    category: "records",
    label: "Profile change decided",
    description: "Tells the employee whether HR applied or refused the change they asked for.",
    source: "people.profile_change.decided",
    severity: "info",
    allowedRecipients: ["subject"],
    defaultRecipients: ["subject"],
    enabled: true,
    inApp: true,
    email: true,
    title: "Your {{section}} change was {{outcome}}",
    body: "{{actor}}: {{comment}}",
    href: "/me/profile?tab=requests",
    placeholders: {
      section: "bank account",
      outcome: "approved",
      actor: "Anil Thapa",
      comment: "Updated from the bank letter",
      organisation: "Bela Nepal Industries",
    },
  },

  /* --------------------------------------------------------- organisation */
  {
    key: "org.structure_changed",
    category: "organisation",
    label: "Organisation structure changed",
    description: "A branch, department, designation or other master was added, changed or retired.",
    source: "org.structure.changed",
    severity: "info",
    allowedRecipients: ["hr"],
    defaultRecipients: ["hr"],
    hrPermission: "setup.structure.manage",
    enabled: false,
    inApp: true,
    email: false,
    title: "{{kind}} {{action}}",
    body: "A {{kind}} was {{action}} in the organisation structure.",
    href: "/setup/company",
    placeholders: { kind: "Branch", action: "updated", organisation: "Bela Nepal Industries" },
  },

  /* -------------------------------------------------------- announcements */
  {
    key: "announcement",
    category: "announcements",
    label: "Announcement",
    description: "A message an administrator sends to everybody, a department, a branch or a role.",
    source: null,
    severity: "info",
    allowedRecipients: [],
    defaultRecipients: [],
    enabled: true,
    inApp: true,
    email: false,
    title: "{{title}}",
    body: "{{body}}",
    href: "/me/notifications",
    placeholders: { title: "Office closed on Friday", body: "For the national holiday.", organisation: "Bela Nepal Industries" },
  },
];

export const CATALOGUE_BY_KEY = new Map(CATALOGUE.map((e) => [e.key, e]));

/** The effective rule: the catalogue default with an organisation's override on top. */
export type EffectiveRule = {
  entry: CatalogueEntry;
  enabled: boolean;
  inApp: boolean;
  email: boolean;
  recipients: Recipient[];
  title: string;
  body: string;
  thresholdDays: number | null;
  isCustomised: boolean;
};

export function effectiveRule(
  entry: CatalogueEntry,
  override?: {
    isEnabled: boolean;
    inApp: boolean;
    email: boolean;
    recipients: string[];
    titleTemplate: string;
    bodyTemplate: string;
    thresholdDays: number | null;
  } | null,
): EffectiveRule {
  if (!override) {
    return {
      entry,
      enabled: entry.enabled,
      inApp: entry.inApp,
      email: entry.email,
      recipients: entry.defaultRecipients,
      title: entry.title,
      body: entry.body,
      thresholdDays: entry.thresholdDays?.default ?? null,
      isCustomised: false,
    };
  }
  return {
    entry,
    enabled: override.isEnabled,
    inApp: override.inApp,
    email: override.email,
    // a recipient the catalogue no longer allows is dropped, not trusted
    recipients: override.recipients.filter((r): r is Recipient => entry.allowedRecipients.includes(r as Recipient)),
    title: override.titleTemplate,
    body: override.bodyTemplate,
    thresholdDays: override.thresholdDays ?? entry.thresholdDays?.default ?? null,
    isCustomised: true,
  };
}

/**
 * Fills `{{placeholder}}`s. Unknown or empty placeholders become nothing, and
 * the punctuation they leave dangling is tidied, so "approved by {{actor}}. {{comment}}"
 * with no comment reads as a sentence rather than ending in ". ".
 */
export function render(template: string, context: Record<string, string | number | null | undefined>): string {
  return template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: string) => {
      const value = context[key];
      return value === null || value === undefined ? "" : String(value);
    })
    // "Anil ." → "Anil." — sentence punctuation only; "·" is a separator
    .replace(/[ \t]+([.,;])/g, "$1")
    // "A ·  · B" → "A · B": a separator whose neighbour was left empty
    .replace(/([ \t]·[ \t]*)+(?=[ \t]·)/g, "")
    // a line that now starts or ends on a separator
    .replace(/(^|\n)[ \t]*[·:,][ \t]*/g, "$1")
    .replace(/[ \t]*[·:,][ \t]*(?=\n|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Placeholders a template uses that the entry does not provide — shown as a warning in the editor. */
export function unknownPlaceholders(template: string, entry: CatalogueEntry): string[] {
  const used = [...template.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(used.filter((k) => !(k in entry.placeholders)))];
}
