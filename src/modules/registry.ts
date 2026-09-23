/**
 * The module registry: navigation, the permission catalogue, and the delivery
 * roadmap — all defined in code.
 *
 * This is the single most important structural difference from the system this
 * replaces. There, the menu tree and the permission catalogue lived only in
 * database rows. When the shipped code moved on and the rows did not, a menu item
 * ended up pointing at a parent that no longer existed, the tree could not be
 * walked, and every permission check in the product started returning "denied" —
 * with no error anywhere to say why.
 *
 * Here the tree ships with the build, so it cannot drift. The database stores only
 * which role holds which permission string.
 *
 * `status` marks how far a screen has been built:
 *   "ready"   — implemented and backed by real data
 *   "planned" — the route exists and explains what will live there
 *
 * Planned screens are deliberately in the menu from day one: the shape of the
 * product is agreed up front, and each one is replaced by a real page in turn
 * without the navigation moving under anybody's feet.
 */

export type Permission = string;

export type NavStatus = "ready" | "planned";

export type NavItem = {
  /** Stable id, also the React key. */
  id: string;
  label: string;
  href: string;
  /** Lucide icon name, resolved in the sidebar. */
  icon?: string;
  permission: Permission;
  status: NavStatus;
  /** Groups items into a labelled block inside the module. */
  section?: string;
  /** Shown on the placeholder page, and as the sidebar tooltip. */
  description?: string;
  /**
   * Only meaningful to somebody who *is* an employee — their own leave, their
   * own attendance, their own desk. Hidden from a login with no employee
   * record (an administrator, an integration account), whatever its
   * permissions, because every one of these screens would open onto nobody.
   */
  selfService?: boolean;
};

export type ModuleDefinition = {
  id: string;
  label: string;
  icon: string;
  order: number;
  /** Short line describing what the module is for. */
  summary: string;
  permissions: { key: Permission; label: string }[];
  nav: NavItem[];
};

/** Shorthand so the definitions below stay readable. */
const ready = (
  id: string,
  label: string,
  href: string,
  icon: string,
  permission: string,
  section?: string,
  description?: string,
): NavItem => ({ id, label, href, icon, permission, status: "ready", section, description });

/** A ready item that belongs to the person's own record. */
const mine = (
  id: string,
  label: string,
  href: string,
  icon: string,
  permission: string,
  section?: string,
  description?: string,
): NavItem => ({ ...ready(id, label, href, icon, permission, section, description), selfService: true });

const planned = (
  id: string,
  label: string,
  href: string,
  icon: string,
  permission: string,
  section: string,
  description: string,
): NavItem => ({ id, label, href, icon, permission, status: "planned", section, description });

export const MODULES: ModuleDefinition[] = [
  // ------------------------------------------------------------ self service
  {
    id: "self",
    label: "Self Service",
    icon: "UserRound",
    order: 5,
    summary: "Everything about you: your record, your requests, your leave and attendance — for employees, not for administrator logins.",
    permissions: [
      { key: "self.desk.view", label: "Use the employee desk" },
      { key: "self.profile.view", label: "View own profile and documents" },
      { key: "self.directory.view", label: "View the staff directory" },
      { key: "self.notice.read", label: "Read notices" },
    ],
    nav: [
      mine("self.desk", "My Desk", "/me", "LayoutDashboard", "self.desk.view", "Me"),
      mine("self.profile", "My Profile", "/me/profile", "IdCard", "self.profile.view", "Me",
        "Your record, service history, family, qualifications and documents — and requests to correct them."),
      mine("self.calendar", "My Calendar", "/me/calendar", "CalendarRange", "self.desk.view", "Me",
        "Your Bikram Sambat month, with a request one click from any day."),
      mine("self.notifications", "Notifications", "/me/notifications", "Bell", "self.desk.view", "Me",
        "Everything waiting on you and every decision on your own requests, with your delivery preferences."),
      mine("self.notices", "Notices", "/me/notices", "Megaphone", "self.notice.read", "Workplace"),
      mine("self.directory", "Staff Directory", "/me/directory", "Contact", "self.directory.view", "Workplace"),
    ],
  },

  // ------------------------------------------------------------------ people
  {
    id: "hr",
    label: "Employees",
    icon: "Users",
    order: 10,
    summary: "The employee master every other module keys off.",
    permissions: [
      { key: "hr.employee.view", label: "View employees" },
      { key: "hr.employee.create", label: "Add employees" },
      { key: "hr.employee.update", label: "Edit employees" },
      { key: "hr.employee.separate", label: "Record separations" },
      { key: "hr.employee.viewSalary", label: "View salary figures" },
      { key: "hr.document.manage", label: "Manage employee documents" },
      { key: "hr.recruitment.manage", label: "Manage recruitment" },
    ],
    nav: [
      ready("hr.employees", "Employees", "/hr/employees", "Users", "hr.employee.view"),
      ready("hr.reporting-lines", "Reporting Lines", "/hr/reporting-lines", "Network", "hr.employee.view"),
      ready("hr.documents", "Documents", "/hr/documents", "FileText", "hr.document.manage", "Records",
        "Contracts, certificates and identity documents against each employee, with expiry reminders."),
      // Read-only for anyone who can see employees; recording a decision needs
      // hr.employee.update, which the page checks for itself. Gating the menu on
      // update would hide the queue from the people who chase it.
      ready("hr.confirmation", "Confirmations", "/hr/confirmations", "BadgeCheck", "hr.employee.view", "Lifecycle",
        "Probation reviews falling due, and the confirmation decision that moves someone to permanent."),
      ready("hr.transfers", "Transfers & Promotions", "/hr/transfers", "ArrowRightLeft", "hr.employee.view", "Lifecycle",
        "Dated placement changes written to employee_assignments, so payroll can answer what was true on a date."),
      ready("hr.separation", "Separations", "/hr/separations", "LogOut", "hr.employee.separate", "Lifecycle",
        "Resignation, termination and retirement, with the clearance checklist and final settlement handoff."),
      ready("hr.profile-requests", "Profile Requests", "/hr/profile-requests", "UserPen", "hr.employee.update", "Records",
        "Corrections employees ask for from their own profile — contact, bank, family, qualifications — to apply or refuse."),
      planned("hr.recruitment", "Recruitment", "/hr/recruitment", "UserPlus", "hr.recruitment.manage", "Hiring",
        "Vacancies, applicants, shortlisting and interview scheduling through to an offer."),
    ],
  },

  // -------------------------------------------------------------- attendance
  {
    id: "attendance",
    label: "Attendance",
    icon: "Clock",
    order: 20,
    summary: "Shifts, daily attendance, overtime and regularisation.",
    permissions: [
      { key: "attendance.record.viewOwn", label: "View own attendance" },
      { key: "attendance.record.viewAll", label: "View everyone's attendance" },
      { key: "attendance.record.edit", label: "Edit attendance records" },
      { key: "attendance.request.create", label: "Raise attendance requests" },
      { key: "attendance.request.approve", label: "Approve attendance requests" },
      { key: "attendance.shift.manage", label: "Manage shifts" },
      { key: "attendance.roster.manage", label: "Assign shifts" },
      { key: "attendance.device.manage", label: "Manage attendance devices" },
    ],
    nav: [
      mine("attendance.my", "My Attendance", "/attendance/my", "CalendarClock", "attendance.record.viewOwn", "Daily"),
      ready("attendance.register", "Daily Register", "/attendance/register", "ListChecks", "attendance.record.viewAll", "Daily"),
      ready("attendance.monthly", "Monthly Sheet", "/attendance/monthly", "CalendarRange", "attendance.record.viewAll", "Daily"),
      mine("attendance.requests", "My Requests", "/attendance/requests", "FilePlus2", "attendance.request.create", "Requests"),
      ready("attendance.approvals", "Approvals", "/attendance/approvals", "Stamp", "attendance.request.approve", "Requests"),
      ready("attendance.shifts", "Shift Master", "/attendance/shifts", "Timer", "attendance.shift.manage", "Setup"),
      ready("attendance.roster", "Shift Assignment", "/attendance/roster", "CalendarCog", "attendance.roster.manage", "Setup"),
      ready("attendance.overtime", "Overtime", "/attendance/overtime", "TimerReset", "attendance.request.create", "Requests",
        "Overtime claims against the OT minutes attendance already computes, with their own approval chain and rate rules."),
      ready("attendance.devices", "Devices", "/attendance/devices", "Fingerprint", "attendance.device.manage", "Setup",
        "Biometric and card readers, who is enrolled on them, and the raw punch log they push."),
      ready("attendance.reports", "Reports", "/attendance/reports", "BarChart3", "attendance.record.viewAll", "Reports",
        "Overview, muster roll, lateness, absenteeism, overtime, exceptions and department reports, exportable to CSV."),
    ],
  },

  // ------------------------------------------------------------------- leave
  {
    id: "leave",
    label: "Leave",
    icon: "CalendarDays",
    order: 30,
    summary: "Entitlement, balances, applications and approval.",
    permissions: [
      { key: "leave.request.viewOwn", label: "View own leave" },
      { key: "leave.request.create", label: "Apply for leave" },
      { key: "leave.request.viewAll", label: "View everyone's leave" },
      { key: "leave.request.approve", label: "Approve leave" },
      { key: "leave.type.manage", label: "Manage leave types" },
      { key: "leave.balance.manage", label: "Adjust leave balances" },
    ],
    nav: [
      mine("leave.my", "My Leave", "/leave/my", "CalendarCheck", "leave.request.viewOwn", "Requests"),
      ready("leave.approvals", "Approvals", "/leave/approvals", "Stamp", "leave.request.approve", "Requests"),
      ready("leave.register", "Leave Register", "/leave/register", "ClipboardList", "leave.request.viewAll", "Records"),
      ready("leave.calendar", "Leave Calendar", "/leave/calendar", "CalendarRange", "leave.request.viewAll", "Records"),
      ready("leave.reports", "Reports", "/leave/reports", "BarChart3", "leave.request.viewAll", "Reports",
        "Overview, balances, utilisation by type, leave history, approval turnaround and department reports, exportable to CSV."),
      ready("leave.balances", "Leave Balances", "/leave/balances", "Scale", "leave.balance.manage", "Setup"),
      ready("leave.types", "Leave Types", "/leave/types", "Tags", "leave.type.manage", "Setup"),
      ready("leave.policy", "Leave Policy", "/leave/policy", "Scale", "leave.type.manage", "Setup",
        "What each leave means to attendance and payroll, entitlement by contract, and who may approve how much."),
      planned("leave.encashment", "Encashment", "/leave/encashment", "Banknote", "leave.balance.manage", "Year end",
        "Paying out unused entitlement at year end, and the payroll line it produces."),
      planned("leave.lapse", "Lapse & Carry Forward", "/leave/lapse", "ArchiveRestore", "leave.balance.manage", "Year end",
        "The year-end job that carries balances forward up to each type's cap and lapses the remainder."),
    ],
  },

  // ---------------------------------------------------------------- workbook
  {
    id: "workbook",
    label: "Work-Book",
    icon: "NotebookPen",
    order: 35,
    summary: "The daily work-book: what each employee did today, reviewed and analysed by administrators.",
    permissions: [
      { key: "workbook.entry.write", label: "Keep my daily work-book" },
      { key: "workbook.record.viewAll", label: "Review everybody's work-book records" },
    ],
    nav: [
      mine("workbook.my", "My Work-Book", "/workbook", "NotebookPen", "workbook.entry.write", "Daily",
        "Record the tasks you worked on each day, the time they took and what came of them, then submit the day."),
      ready("workbook.records", "Records", "/workbook/records", "BookOpenCheck", "workbook.record.viewAll", "Review",
        "Every submitted and draft day, filterable by month, department, person and text, exportable to CSV."),
      ready("workbook.insights", "Insights", "/workbook/insights", "ChartColumn", "workbook.record.viewAll", "Review",
        "Submission discipline, where the hours went by category, department and project, and who has not written today."),
    ],
  },

  // ----------------------------------------------------------------- payroll
  {
    id: "payroll",
    label: "Payroll",
    icon: "Banknote",
    order: 40,
    summary: "Salary structure, monthly processing and statutory deductions.",
    permissions: [
      { key: "payroll.structure.manage", label: "Manage salary structure" },
      { key: "payroll.process.run", label: "Run payroll" },
      { key: "payroll.payslip.viewOwn", label: "View own payslip" },
      { key: "payroll.payslip.viewAll", label: "View all payslips" },
      { key: "payroll.statutory.manage", label: "Manage statutory settings" },
    ],
    nav: [
      planned("payroll.heads", "Salary Heads", "/payroll/heads", "ListTree", "payroll.structure.manage", "Setup",
        "Earnings and deductions, how each is computed, and whether it is taxable or contributes to SSF."),
      planned("payroll.structure", "Salary Structure", "/payroll/structure", "Layers", "payroll.structure.manage", "Setup",
        "Which heads apply to which grade or employment type, and at what value."),
      planned("payroll.process", "Monthly Payroll", "/payroll/process", "PlayCircle", "payroll.process.run", "Processing",
        "The monthly run: pull attendance and leave, compute each head, TDS and SSF, then lock the period."),
      planned("payroll.payslips", "Payslips", "/payroll/payslips", "Receipt", "payroll.payslip.viewAll", "Processing",
        "Generated payslips by period, in Nepali and English, with the working-day basis shown."),
      planned("payroll.tds", "Income Tax (TDS)", "/payroll/tds", "Percent", "payroll.statutory.manage", "Statutory",
        "Nepali slab rates, the married/unmarried threshold, and the annualised projection each month deducts against."),
      planned("payroll.ssf", "SSF & Provident Fund", "/payroll/ssf", "PiggyBank", "payroll.statutory.manage", "Statutory",
        "Social Security Fund and provident fund contributions, employee and employer sides, with the monthly return."),
      planned("payroll.bank", "Bank Advice", "/payroll/bank", "Landmark", "payroll.process.run", "Processing",
        "The salary transfer file for the bank, grouped by branch and account."),
    ],
  },

  // ---------------------------------------------------------------- appraisal
  {
    id: "appraisal",
    label: "Appraisal",
    icon: "LineChart",
    order: 50,
    summary: "Objectives, review cycles and outcomes.",
    permissions: [
      { key: "appraisal.setup.manage", label: "Manage appraisal setup" },
      { key: "appraisal.cycle.manage", label: "Manage appraisal cycles" },
      { key: "appraisal.self.submit", label: "Submit self appraisal" },
      { key: "appraisal.review.submit", label: "Review appraisals" },
      { key: "appraisal.result.view", label: "View appraisal results" },
    ],
    nav: [
      planned("appraisal.kra", "KRA & KPI Setup", "/appraisal/kra", "Target", "appraisal.setup.manage", "Setup",
        "Key result areas and the indicators under them, weighted per designation."),
      planned("appraisal.rating", "Rating Scales", "/appraisal/rating", "Gauge", "appraisal.setup.manage", "Setup",
        "The scale reviewers score against, and how scores roll up to a final grade."),
      planned("appraisal.cycles", "Appraisal Cycles", "/appraisal/cycles", "RefreshCw", "appraisal.cycle.manage", "Cycle",
        "Periods, who is in scope, and the schedule from self appraisal to final moderation."),
      planned("appraisal.self", "My Appraisal", "/appraisal/self", "UserCheck", "appraisal.self.submit", "Cycle",
        "An employee's own submission against their objectives for the open cycle."),
      planned("appraisal.review", "Reviews", "/appraisal/review", "ClipboardCheck", "appraisal.review.submit", "Cycle",
        "The supervisor and reviewer stages, running on the shared approval engine."),
      planned("appraisal.results", "Results", "/appraisal/results", "Trophy", "appraisal.result.view", "Outcome",
        "Final ratings, the distribution across the organisation, and promotion eligibility."),
    ],
  },

  // ----------------------------------------------------------------- training
  {
    id: "training",
    label: "Training",
    icon: "GraduationCap",
    order: 60,
    summary: "Programmes, nomination and effectiveness.",
    permissions: [
      { key: "training.program.manage", label: "Manage training programmes" },
      { key: "training.nomination.manage", label: "Manage nominations" },
      { key: "training.record.view", label: "View training records" },
    ],
    nav: [
      planned("training.programs", "Programmes", "/training/programs", "BookOpen", "training.program.manage", "Catalogue",
        "The course catalogue: provider, duration, cost and which competencies it addresses."),
      planned("training.calendar", "Training Calendar", "/training/calendar", "CalendarRange", "training.program.manage", "Catalogue",
        "Scheduled sessions across the year, with seats and the venue."),
      planned("training.nominations", "Nominations", "/training/nominations", "UserPlus", "training.nomination.manage", "Delivery",
        "Nominating staff onto a session, with supervisor approval before the seat is confirmed."),
      planned("training.attendance", "Session Attendance", "/training/attendance", "ListChecks", "training.nomination.manage", "Delivery",
        "Who actually attended, and the certificate that goes onto their record."),
      planned("training.feedback", "Feedback & Effectiveness", "/training/feedback", "MessageSquare", "training.record.view", "Outcome",
        "Post-course feedback and the follow-up assessment of whether it changed anything."),
    ],
  },

  // ------------------------------------------------------------------- travel
  {
    id: "travel",
    label: "Travel & TADA",
    icon: "Plane",
    order: 70,
    summary: "Travel orders, allowances and settlement.",
    permissions: [
      { key: "travel.request.create", label: "Raise travel requests" },
      { key: "travel.request.approve", label: "Approve travel" },
      { key: "travel.settings.manage", label: "Manage TADA rules" },
    ],
    nav: [
      planned("travel.requests", "Travel Requests", "/travel/requests", "PlaneTakeoff", "travel.request.create", "Requests",
        "Travel orders with destination, purpose and advance requested, on the shared approval engine."),
      planned("travel.approvals", "Approvals", "/travel/approvals", "Stamp", "travel.request.approve", "Requests",
        "The travel approval queue, level by level."),
      planned("travel.settlement", "Settlement", "/travel/settlement", "ReceiptText", "travel.request.create", "Requests",
        "Post-trip settlement of the advance against actual daily allowance and fares."),
      planned("travel.rules", "TADA Rules", "/travel/rules", "Ruler", "travel.settings.manage", "Setup",
        "Daily allowance and fare entitlement by grade and destination band."),
      planned("travel.locations", "Locations", "/travel/locations", "MapPin", "travel.settings.manage", "Setup",
        "Destinations grouped into the bands the TADA rates key off."),
    ],
  },

  // ------------------------------------------------------------ expense claim
  {
    id: "expense",
    label: "Expense Claims",
    icon: "ReceiptText",
    order: 80,
    summary: "Reimbursement claims and staff advances.",
    permissions: [
      { key: "expense.claim.create", label: "Raise expense claims" },
      { key: "expense.claim.approve", label: "Approve expense claims" },
      { key: "expense.setup.manage", label: "Manage expense setup" },
      { key: "expense.advance.manage", label: "Manage staff advances" },
    ],
    nav: [
      planned("expense.claims", "My Claims", "/expense/claims", "FilePlus2", "expense.claim.create", "Claims",
        "Itemised claims with receipts attached, checked against the category limit before submission."),
      planned("expense.approvals", "Approvals", "/expense/approvals", "Stamp", "expense.claim.approve", "Claims",
        "The claim approval queue, then handoff to finance for payment."),
      planned("expense.categories", "Categories & Limits", "/expense/categories", "Tags", "expense.setup.manage", "Setup",
        "Claimable categories, per-grade ceilings, and whether a receipt is mandatory."),
      planned("expense.advances", "Staff Advances", "/expense/advances", "HandCoins", "expense.advance.manage", "Advances",
        "Salary and travel advances, the repayment schedule, and the payroll deduction it drives."),
    ],
  },

  // -------------------------------------------------------------- procurement
  {
    id: "procurement",
    label: "Procurement",
    icon: "ShoppingCart",
    order: 90,
    summary: "Requisition through to goods receipt.",
    permissions: [
      { key: "procurement.request.create", label: "Raise purchase requests" },
      { key: "procurement.request.approve", label: "Approve purchase requests" },
      { key: "procurement.order.manage", label: "Manage purchase orders" },
      { key: "procurement.vendor.manage", label: "Manage vendors" },
    ],
    nav: [
      planned("procurement.requests", "Purchase Requests", "/procurement/requests", "FilePlus2", "procurement.request.create", "Requisition",
        "Departmental requisitions with budget line and justification, approved before any quotation is sought."),
      planned("procurement.quotations", "Quotations", "/procurement/quotations", "FileSearch", "procurement.order.manage", "Sourcing",
        "Vendor quotations against a request, and the comparative statement behind the award."),
      planned("procurement.orders", "Purchase Orders", "/procurement/orders", "FileCheck2", "procurement.order.manage", "Sourcing",
        "Issued orders, delivery terms, and what remains outstanding against each."),
      planned("procurement.grn", "Goods Receipt", "/procurement/grn", "PackageCheck", "procurement.order.manage", "Receipt",
        "Receiving against an order, quantity and quality check, and the stock entry it raises."),
      planned("procurement.vendors", "Vendors", "/procurement/vendors", "Building", "procurement.vendor.manage", "Setup",
        "Supplier register with PAN, category and performance history."),
    ],
  },

  // ---------------------------------------------------------------- inventory
  {
    id: "inventory",
    label: "Inventory",
    icon: "Boxes",
    order: 100,
    summary: "Stores, stock movement and issue.",
    permissions: [
      { key: "inventory.item.manage", label: "Manage items" },
      { key: "inventory.request.create", label: "Raise item requests" },
      { key: "inventory.issue.manage", label: "Issue and return stock" },
      { key: "inventory.stock.view", label: "View stock" },
    ],
    nav: [
      planned("inventory.items", "Items", "/inventory/items", "Package", "inventory.item.manage", "Setup",
        "The item master: unit, group, reorder level and whether expiry is tracked."),
      planned("inventory.groups", "Item Groups", "/inventory/groups", "FolderTree", "inventory.item.manage", "Setup",
        "The grouping stock reports and issue limits are organised by."),
      planned("inventory.stores", "Stores", "/inventory/stores", "Warehouse", "inventory.item.manage", "Setup",
        "Physical stores, who keeps each, and which branches draw from them."),
      planned("inventory.requests", "Item Requests", "/inventory/requests", "FilePlus2", "inventory.request.create", "Movement",
        "Requesting stock from a store, approved before issue."),
      planned("inventory.issue", "Issue & Return", "/inventory/issue", "ArrowRightLeft", "inventory.issue.manage", "Movement",
        "Issuing against a request, and returning what comes back."),
      planned("inventory.ledger", "Stock Ledger", "/inventory/ledger", "BookOpen", "inventory.stock.view", "Reports",
        "Movement per item and store, with the running balance and valuation."),
    ],
  },

  // ------------------------------------------------------------- fixed assets
  {
    id: "assets",
    label: "Fixed Assets",
    icon: "Building2",
    order: 110,
    summary: "Asset register, allocation and depreciation.",
    permissions: [
      { key: "assets.register.view", label: "View asset register" },
      { key: "assets.register.manage", label: "Manage assets" },
      { key: "assets.allocation.manage", label: "Allocate assets" },
      { key: "assets.depreciation.run", label: "Run depreciation" },
    ],
    nav: [
      planned("assets.register", "Asset Register", "/assets/register", "ClipboardList", "assets.register.view", "Register",
        "Every asset with its tag, cost, location and current holder."),
      planned("assets.groups", "Asset Groups", "/assets/groups", "FolderTree", "assets.register.manage", "Setup",
        "Groups and classes, each with its depreciation method and rate."),
      planned("assets.allocation", "Allocation", "/assets/allocation", "UserCheck", "assets.allocation.manage", "Movement",
        "Issuing an asset to an employee or unit, transfers, and return on separation."),
      planned("assets.maintenance", "Maintenance", "/assets/maintenance", "Wrench", "assets.register.manage", "Movement",
        "Scheduled and breakdown maintenance, cost, and downtime against each asset."),
      planned("assets.depreciation", "Depreciation", "/assets/depreciation", "TrendingDown", "assets.depreciation.run", "Period end",
        "The periodic depreciation run and the schedule it writes per asset."),
      planned("assets.disposal", "Disposal", "/assets/disposal", "Trash2", "assets.register.manage", "Period end",
        "Retirement, sale or write-off, with the gain or loss on disposal."),
    ],
  },

  // ------------------------------------------------------------- organisation
  {
    id: "setup",
    label: "Organisation",
    icon: "Network",
    order: 200,
    summary: "Structure, calendar and reference data.",
    permissions: [
      { key: "setup.structure.view", label: "View organisation structure" },
      { key: "setup.structure.manage", label: "Manage organisation structure" },
      { key: "setup.fiscalYear.manage", label: "Manage fiscal years" },
      { key: "setup.holiday.manage", label: "Manage holidays" },
    ],
    nav: [
      ready("setup.divisions", "Divisions", "/setup/structure/divisions", "Layers3", "setup.structure.view", "Structure"),
      ready("setup.business-units", "Business Units", "/setup/structure/business-units", "Building", "setup.structure.view", "Structure"),
      ready("setup.sub-business-units", "Sub Business Units", "/setup/structure/sub-business-units", "Building2", "setup.structure.view", "Structure"),
      ready("setup.branches", "Branches", "/setup/branches", "MapPin", "setup.structure.view", "Structure"),
      ready("setup.departments", "Departments", "/setup/departments", "Boxes", "setup.structure.view", "Structure"),
      ready("setup.designations", "Designations", "/setup/designations", "BadgeCheck", "setup.structure.view", "Structure"),
      ready("setup.functional-categories", "Functional Categories", "/setup/structure/functional-categories", "Shapes", "setup.structure.view", "Grouping"),
      ready("setup.projects", "Projects", "/setup/structure/projects", "FolderKanban", "setup.structure.view", "Grouping"),
      ready("setup.locations", "Locations", "/setup/structure/locations", "Map", "setup.structure.view", "Grouping"),
      ready("setup.fiscal-years", "Fiscal Years", "/setup/fiscal-years", "CalendarRange", "setup.fiscalYear.manage", "Calendar"),
      ready("setup.holidays", "Holidays", "/setup/holidays", "PartyPopper", "setup.holiday.manage", "Calendar"),
      ready("setup.grades", "Grades", "/setup/grades", "Layers", "setup.structure.view", "Structure",
        "Pay grades and the basic salary each one starts at."),
      ready("setup.employment-types", "Employment Types", "/setup/employment-types", "FileBadge", "setup.structure.view", "Structure",
        "The contract somebody is on — permanent, contract, probation — which leave entitlement keys off."),
      ready("setup.company", "Company Profile", "/setup/company", "Building2", "setup.structure.view", "Organisation",
        "Legal name, PAN, registered address and the logo that appears on payslips and letters."),
    ],
  },

  // ----------------------------------------------------------- administration
  {
    id: "admin",
    label: "Administration",
    icon: "ShieldCheck",
    order: 210,
    summary: "Access control and the audit trail.",
    permissions: [
      { key: "admin.user.view", label: "View users" },
      { key: "admin.user.manage", label: "Manage users" },
      { key: "admin.role.view", label: "View roles" },
      { key: "admin.role.manage", label: "Manage roles and permissions" },
      { key: "admin.audit.view", label: "View the audit trail" },
      { key: "admin.settings.manage", label: "Manage system settings" },
      { key: "admin.notifications.manage", label: "Manage notifications and send announcements" },
      { key: "admin.recycle.manage", label: "Restore or permanently purge deleted records" },
      { key: "admin.retention.manage", label: "Set data retention and clear old operational data" },
      { key: "admin.settings.appearance", label: "Change own appearance settings" },
    ],
    nav: [
      ready("admin.users", "Users", "/admin/users", "UserCog", "admin.user.view", "Access"),
      ready("admin.roles", "Roles", "/admin/roles", "KeyRound", "admin.role.view", "Access"),
      ready("admin.audit", "Audit Trail", "/admin/audit", "ScrollText", "admin.audit.view", "Oversight"),
      ready("admin.modules", "Modules", "/admin/modules", "Blocks", "admin.settings.manage", "Oversight",
        "What is installed, what it depends on, and what is currently working."),
      ready("admin.settings", "Appearance", "/admin/settings", "Palette", "admin.settings.appearance", "Preferences",
        "Theme, typeface, text size, density and accent — personal to each person and their browser."),
      ready("admin.notifications", "Notifications", "/admin/notifications", "BellRing", "admin.notifications.manage", "Oversight",
        "Which events notify whom, by which channel and in what words; announcements; and the delivery log."),
      ready("admin.retention", "Data Retention", "/admin/retention", "DatabaseZap", "admin.retention.manage", "Oversight",
        "How long audit entries, notifications, email, events and raw punches are kept — cleared automatically or on demand."),
      ready("admin.recycle-bin", "Recycle Bin", "/admin/recycle-bin", "Trash2", "admin.recycle.manage", "Oversight",
        "Everything deleted across the system — logins, employee records, masters, file entries — to restore or purge."),
    ],
  },

  // ----------------------------------------------------------- documentation
  {
    id: "docs",
    label: "Documentation",
    icon: "BookOpen",
    order: 220,
    summary: "How the system works, and how to use it.",
    permissions: [{ key: "docs.read", label: "Read the documentation" }],
    nav: [
      ready("docs.start", "Getting Started", "/docs", "Compass", "docs.read", "Guide"),
      ready("docs.manual", "User Manual", "/docs/manual", "BookOpen", "docs.read", "Guide"),
      ready("docs.self-service", "Self Service", "/docs/self-service", "UserRound", "docs.read", "Guide",
        "My Desk: what is on it, what you can do from it, and who can see what."),
      ready("docs.faq", "FAQ", "/docs/faq", "MessagesSquare", "docs.read", "Guide"),
      ready("docs.architecture", "Architecture", "/docs/architecture", "Network", "docs.read", "Reference"),
      ready("docs.modules", "Module Architecture", "/docs/modules", "Blocks", "docs.read", "Reference",
        "How the functional modules are kept independent, and the order they are built in."),
      ready("docs.data-model", "Data Model", "/docs/data-model", "Database", "docs.read", "Reference"),
      ready("docs.workflows", "Workflows", "/docs/workflows", "GitBranch", "docs.read", "Reference"),
      ready("docs.roadmap", "Roadmap", "/docs/roadmap", "Milestone", "docs.read", "Reference"),
    ],
  },
];

export const ALL_PERMISSIONS: { key: Permission; label: string; module: string }[] =
  MODULES.flatMap((m) => m.permissions.map((p) => ({ ...p, module: m.label })));

const PERMISSION_KEYS = new Set(ALL_PERMISSIONS.map((p) => p.key));

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}

const NAV_BY_HREF = new Map<string, { item: NavItem; module: ModuleDefinition }>();
for (const m of MODULES) for (const item of m.nav) NAV_BY_HREF.set(item.href, { item, module: m });

/** Looks a route up in the registry. Used by the placeholder page to 404 unknown paths. */
export function navItemForHref(href: string) {
  return NAV_BY_HREF.get(href) ?? null;
}

export type NavSection = { label: string | null; items: NavItem[] };
export type VisibleModule = ModuleDefinition & { sections: NavSection[] };

/**
 * The navigation a given permission set can see, grouped into sections. Modules
 * with no visible items are dropped entirely, so the sidebar never shows an
 * empty heading.
 */
export function visibleNavigation(
  granted: ReadonlySet<Permission>,
  context: { hasEmployee: boolean } = { hasEmployee: true },
): VisibleModule[] {
  return MODULES.slice()
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const items = m.nav.filter(
        (item) => granted.has(item.permission) && (context.hasEmployee || !item.selfService),
      );

      // Gather by label rather than by adjacency. A module often declares its
      // built screens first and its planned ones after, which would otherwise
      // produce two separate "Requests" blocks in the same menu — confusing to
      // read, and duplicate React keys. Section order follows first appearance.
      const order: (string | null)[] = [];
      const grouped = new Map<string | null, NavItem[]>();
      for (const item of items) {
        const label = item.section ?? null;
        if (!grouped.has(label)) {
          grouped.set(label, []);
          order.push(label);
        }
        grouped.get(label)!.push(item);
      }

      const sections: NavSection[] = order.map((label) => ({
        label,
        items: grouped.get(label)!,
      }));
      return { ...m, sections };
    })
    .filter((m) => m.sections.length > 0);
}

/** Progress, for the roadmap panel on the dashboard. */
export function deliveryProgress() {
  const all = MODULES.flatMap((m) => m.nav);
  return {
    ready: all.filter((n) => n.status === "ready").length,
    planned: all.filter((n) => n.status === "planned").length,
    modules: MODULES.map((m) => ({
      id: m.id,
      label: m.label,
      icon: m.icon,
      summary: m.summary,
      ready: m.nav.filter((n) => n.status === "ready").length,
      total: m.nav.length,
    })),
  };
}

/** Seed helper: the permissions a built-in role starts with. */
export const SYSTEM_ROLE_TEMPLATES: Record<string, { name: string; permissions: Permission[] }> = {
  administrator: {
    name: "Administrator",
    permissions: ALL_PERMISSIONS.map((p) => p.key),
  },
  hr_manager: {
    name: "HR Manager",
    permissions: [
      "docs.read", "admin.settings.appearance",
      "self.desk.view", "self.profile.view", "self.directory.view", "self.notice.read",
      "workbook.entry.write",
      "hr.employee.view", "hr.employee.create", "hr.employee.update", "hr.employee.separate",
      "hr.employee.viewSalary", "hr.document.manage", "hr.recruitment.manage",
      "attendance.record.viewOwn", "attendance.record.viewAll", "attendance.record.edit",
      "attendance.request.create", "attendance.request.approve",
      "attendance.shift.manage", "attendance.roster.manage",
      "leave.request.viewOwn", "leave.request.create", "leave.request.viewAll",
      "leave.request.approve", "leave.type.manage", "leave.balance.manage",
      "training.program.manage", "training.nomination.manage", "training.record.view",
      "setup.structure.view", "setup.structure.manage", "setup.holiday.manage",
      "admin.user.view", "admin.audit.view",
    ],
  },
  supervisor: {
    name: "Supervisor",
    permissions: [
      "docs.read", "admin.settings.appearance",
      "self.desk.view", "self.profile.view", "self.directory.view", "self.notice.read",
      "workbook.entry.write",
      "hr.employee.view",
      "attendance.record.viewOwn", "attendance.record.viewAll",
      "attendance.request.create", "attendance.request.approve",
      "leave.request.viewOwn", "leave.request.create", "leave.request.approve",
      "setup.structure.view",
    ],
  },
  employee: {
    name: "Employee",
    permissions: [
      "docs.read", "admin.settings.appearance",
      "self.desk.view", "self.profile.view", "self.directory.view", "self.notice.read",
      "workbook.entry.write",
      "attendance.record.viewOwn", "attendance.request.create",
      "leave.request.viewOwn", "leave.request.create",
      "payroll.payslip.viewOwn",
      "appraisal.self.submit",
      "travel.request.create",
      "expense.claim.create",
    ],
  },
};
