/**
 * Tenancy, identity and the audit trail.
 *
 * Two decisions here are deliberate departures from the system this replaces:
 *
 * 1. **One database, many organisations.** The legacy product mapped a hostname to
 *    a whole separate database in an XML file on disk. Tenancy is a column here,
 *    enforced on every query, so a tenant cannot be lost by editing a file.
 *
 * 2. **Permissions are strings defined in code; only grants are data.** The legacy
 *    menu tree lived entirely in the database, drifted out of step with the shipped
 *    build, and took the whole permission system down with it when a parent row went
 *    missing. Here the catalogue of permissions and the navigation tree are compiled
 *    into the app (see `src/modules/registry.ts`); the database only records which
 *    role was granted which permission string.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const calendarPreference = pgEnum("calendar_preference", ["BS", "AD"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  nameNepali: text("name_nepali"),
  /** Permanent Account Number - Nepal's tax registration id. */
  pan: text("pan"),
  address: text("address"),
  district: text("district"),
  phone: text("phone"),
  email: text("email"),
  logoUrl: text("logo_url"),
  /** Which calendar the UI leads with. Storage is always Gregorian. */
  defaultCalendar: calendarPreference("default_calendar").notNull().default("BS"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Nepali fiscal years run Shrawan 1 to Ashadh end - e.g. 2083/84 BS is
 * 17 Jul 2026 to 16 Jul 2027. Almost every ERP figure is scoped to one.
 */
export const fiscalYears = pgTable(
  "fiscal_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** "2083/84" */
    code: text("code").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    /** Denormalised BS keys so the UI never has to convert to render a list. */
    startDateBs: text("start_date_bs").notNull(),
    endDateBs: text("end_date_bs").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    isClosed: boolean("is_closed").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("fiscal_years_org_code_key").on(t.orgId, t.code),
    index("fiscal_years_org_idx").on(t.orgId),
  ],
);

/**
 * A closed accounting period.
 *
 * Attendance and leave figures feed payroll, so once a month has been paid it
 * must stop moving. A lock row makes that explicit and auditable rather than
 * relying on everybody remembering; `attendance_days.is_locked` is set from it.
 *
 * Locks are per (organisation, fiscal year, module, BS month), which is the grain
 * a Nepali payroll actually closes at.
 */
export const periodLocks = pgTable(
  "period_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "cascade" }),
    /** "attendance" | "leave" | "payroll" */
    module: text("module").notNull(),
    /** Bikram Sambat month, 1 = Baisakh. Null locks the whole year. */
    bsMonth: integer("bs_month"),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at").notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [
    unique("period_locks_unique").on(t.orgId, t.fiscalYearId, t.module, t.bsMonth),
    index("period_locks_org_idx").on(t.orgId, t.fiscalYearId),
  ],
);

/** Public and organisation holidays, used by leave and attendance day counting. */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dateBs: text("date_bs").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    /** null = applies to everyone; otherwise "male" | "female" (e.g. Teej). */
    appliesToGender: text("applies_to_gender"),
    /**
     * Optional scope. null = organisation-wide. A group narrows the holiday to
     * the branches or employees related to it, which is how the legacy Holiday
     * Group / Employee Relation / Branch Relation screens are represented.
     * Deliberately untyped as a foreign key here: `holiday_groups` belongs to
     * the calendar module, and core must not depend on a module.
     */
    holidayGroupId: uuid("holiday_group_id"),
    /** Some public holidays are half days — the shift still runs, shortened. */
    isHalfDay: boolean("is_half_day").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique("holidays_org_date_name_key").on(t.orgId, t.date, t.name),
    index("holidays_org_date_idx").on(t.orgId, t.date),
  ],
);

// ---------------------------------------------------------------- identity

/**
 * Application-level facts about a login. Better Auth owns `user`; this row says
 * which tenant that user belongs to and which employee they are.
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Set once an employee record exists; admins may have none. */
    employeeId: uuid("employee_id"),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * The break-glass flag: this login holds every permission the build defines,
     * whatever roles it is or is not assigned.
     *
     * It exists because roles are editable and the editor is reachable only by
     * somebody who already holds it. Grant every permission through roles alone
     * and the system has a state it cannot leave: strip the last administrator's
     * role and *nobody* can restore it, from inside the product, ever again.
     * That is not a hypothetical — it is how this database was locked out.
     *
     * Deliberately on the account, not on a role: nothing on the Roles screen
     * can clear it, because nothing on the Roles screen knows it exists. It is
     * set by `pnpm admin:unlock` at the console, which is the one place a person
     * has already proved they own the machine.
     */
    isSystemAdmin: boolean("is_system_admin").notNull().default(false),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * Deleted from Administration › Users. The login stops working at once
     * (a deleted account is never a viewer) and the row stays in the recycle
     * bin until restored or purged, so the audit trail keeps a name to point at.
     */
    deletedAt: timestamp("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (t) => [
    index("user_accounts_org_idx").on(t.orgId),
    // "does this employee already have a login?" is asked on every link
    index("user_accounts_employee_idx").on(t.employeeId),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** System roles cannot be deleted and always keep at least one member. */
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("roles_org_code_key").on(t.orgId, t.code)],
);

/**
 * A grant is a role plus a permission string from the code-defined catalogue,
 * e.g. "hr.employee.update". Unknown strings are ignored at check time, so a
 * removed permission degrades to "denied" instead of crashing the menu.
 */
export const roleGrants = pgTable(
  "role_grants",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

// ---------------------------------------------------------------- audit

export const auditAction = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "cancel",
  "login",
  "logout",
  "login_failed",
  "restore",
  "purge",
]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    /** Only the fields that changed, so the log stays readable. */
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("audit_log_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_actor_idx").on(t.actorUserId, t.createdAt),
  ],
);

// ---------------------------------------------------------------- relations

export const organizationsRelations = relations(organizations, ({ many }) => ({
  fiscalYears: many(fiscalYears),
  roles: many(roles),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  organization: one(organizations, { fields: [roles.orgId], references: [organizations.id] }),
  grants: many(roleGrants),
  members: many(userRoles),
}));

export const roleGrantsRelations = relations(roleGrants, ({ one }) => ({
  role: one(roles, { fields: [roleGrants.roleId], references: [roles.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
  user: one(user, { fields: [userRoles.userId], references: [user.id] }),
}));

export const userAccountsRelations = relations(userAccounts, ({ one }) => ({
  user: one(user, { fields: [userAccounts.userId], references: [user.id] }),
  organization: one(organizations, {
    fields: [userAccounts.orgId],
    references: [organizations.id],
  }),
}));
