/**
 * Demo seed: one organisation with a real-looking staff list, leave policy and a
 * few requests mid-approval, so the app opens in a working state rather than an
 * empty shell.
 *
 *   pnpm db:seed          add anything missing
 *   pnpm db:seed --reset  wipe the tenant's data first
 *
 * Data is invented. Structure is not: leave types, statutory identifiers and the
 * fiscal calendar follow Nepali practice, matching what the legacy system modelled.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  auditLog,
  fiscalYears,
  holidays,
  organizations,
  roleGrants,
  roles,
  userAccounts,
  userRoles,
} from "./schema/core";
import { account, session, user } from "./schema/auth";
import { branches, departments, designations, employmentTypes, grades } from "./schema/org";
import { employees } from "./schema/hr";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "./schema/leave";
import {
  employeeDocuments,
  employeeFamily,
  employeeQualifications,
  notices,
} from "./schema/selfservice";
import {
  leaveGroups,
  leaveSalaryEffects,
  leaveTypeEntitlements,
} from "./schema/leave-policy";
import {
  attendanceDays,
  attendanceRequests,
  shiftAssignments,
  shifts,
} from "./schema/attendance";
import { seedAttendance } from "./seed-attendance";
import {
  adToBs,
  bsToAd,
  formatBsKey,
  todayInNepal,
  workingDaysBetween,
  addDays,
} from "@/lib/bs";
import { SYSTEM_ROLE_TEMPLATES } from "@/modules/registry";
import { auth } from "@/lib/auth";
import { APP } from "@/lib/branding";

const ORG_CODE = "BELA";
const RESET = process.argv.includes("--reset");

function log(step: string, detail = "") {
  console.log(`  ${step.padEnd(26)} ${detail}`);
}

async function main() {
  console.log(`\nSeeding ${ORG_CODE}${RESET ? " (reset)" : ""}\n`);

  if (RESET) {
    // order matters: children before parents
    await db.delete(approvalSteps);
    await db.delete(attendanceRequests);
    await db.delete(attendanceDays);
    await db.delete(shiftAssignments);
    await db.delete(shifts);
    await db.delete(leaveRequests);
    await db.delete(leaveBalances);
    await db.delete(employeeDocuments);
    await db.delete(employeeQualifications);
    await db.delete(employeeFamily);
    await db.delete(notices);
    await db.delete(leaveSalaryEffects);
    await db.delete(leaveTypeEntitlements);
    await db.delete(leaveGroups);
    await db.delete(leaveTypes);
    await db.delete(auditLog);
    await db.delete(userRoles);
    await db.delete(userAccounts);
    await db.delete(session);
    await db.delete(account);
    await db.delete(user);
    await db.delete(roleGrants);
    await db.delete(roles);
    await db.execute(sql`UPDATE employees SET supervisor_id = NULL`);
    await db.delete(employees);
    await db.delete(holidays);
    await db.delete(fiscalYears);
    await db.delete(grades);
    await db.delete(employmentTypes);
    await db.delete(designations);
    await db.execute(sql`UPDATE departments SET parent_id = NULL`);
    await db.delete(departments);
    await db.execute(sql`UPDATE branches SET parent_id = NULL`);
    await db.delete(branches);
    await db.delete(organizations);
    log("cleared", "all tenant data");
  }

  // ---------------------------------------------------------------- organisation
  const [org] = await db
    .insert(organizations)
    .values({
      code: ORG_CODE,
      name: APP.company,
      nameNepali: APP.companyNepali,
      pan: "601234567",
      address: "Balaju Industrial District, Ward 16",
      district: "Kathmandu",
      phone: "01-4350120",
      email: "info@bela.example.np",
      defaultCalendar: "BS",
    })
    .onConflictDoUpdate({ target: organizations.code, set: { updatedAt: new Date() } })
    .returning();
  log("organisation", org.name);

  const orgId = org.id;

  // ---------------------------------------------------------------- fiscal years
  const today = todayInNepal();
  const currentBs = adToBs(today);
  const fyStartYear = currentBs.month >= 4 ? currentBs.year : currentBs.year - 1;

  const fyRows = [fyStartYear - 1, fyStartYear].map((startYear) => {
    const startBs = { year: startYear, month: 4, day: 1 };
    const endAd = addDays(bsToAd({ year: startYear + 1, month: 4, day: 1 }), -1);
    return {
      orgId,
      code: `${startYear}/${String(startYear + 1).slice(-2)}`,
      startDate: bsToAd(startBs),
      endDate: endAd,
      startDateBs: formatBsKey(startBs),
      endDateBs: formatBsKey(adToBs(endAd)),
      isCurrent: startYear === fyStartYear,
      isClosed: startYear !== fyStartYear,
    };
  });

  await db.insert(fiscalYears).values(fyRows).onConflictDoNothing();
  const [currentFy] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.orgId, orgId), eq(fiscalYears.isCurrent, true)))
    .limit(1);
  log("fiscal years", `${fyRows.map((f) => f.code).join(", ")} — current ${currentFy.code}`);

  // ---------------------------------------------------------------- holidays
  const holidayDefs: [month: number, day: number, name: string, np: string][] = [
    [1, 1, "Nepali New Year", "नयाँ वर्ष"],
    [2, 15, "Buddha Jayanti", "बुद्ध जयन्ती"],
    [5, 3, "Janai Purnima", "जनै पूर्णिमा"],
    [5, 10, "Krishna Janmashtami", "कृष्ण जन्माष्टमी"],
    [6, 10, "Ghatasthapana", "घटस्थापना"],
    [6, 17, "Vijaya Dashami", "विजया दशमी"],
    [7, 10, "Laxmi Puja", "लक्ष्मी पूजा"],
    [7, 12, "Bhai Tika", "भाइटीका"],
    [8, 5, "Chhath", "छठ"],
    [10, 1, "Maghe Sankranti", "माघे संक्रान्ति"],
    [11, 7, "Prithvi Jayanti", "पृथ्वी जयन्ती"],
    [11, 25, "Maha Shivaratri", "महाशिवरात्री"],
    [12, 5, "Holi", "फागु पूर्णिमा"],
  ];
  const holidayRows = holidayDefs.map(([month, day, name, np]) => {
    const bs = { year: month >= 4 ? fyStartYear : fyStartYear + 1, month, day };
    return {
      orgId,
      date: bsToAd(bs),
      dateBs: formatBsKey(bs),
      name,
      nameNepali: np,
    };
  });
  await db.insert(holidays).values(holidayRows).onConflictDoNothing();
  log("holidays", `${holidayRows.length} for ${currentFy.code}`);

  // ---------------------------------------------------------------- structure
  const [hq] = await db
    .insert(branches)
    .values({
      orgId,
      code: "HO",
      name: "Head Office",
      nameNepali: "प्रधान कार्यालय",
      district: "Kathmandu",
      address: "Balaju, Kathmandu",
      isHeadOffice: true,
    })
    .onConflictDoNothing()
    .returning();

  const hqId =
    hq?.id ??
    (
      await db
        .select()
        .from(branches)
        .where(and(eq(branches.orgId, orgId), eq(branches.code, "HO")))
        .limit(1)
    )[0].id;

  const branchDefs = [
    ["PLANT", "Balaju Plant", "Kathmandu"],
    ["BRT", "Biratnagar Depot", "Morang"],
    ["PKR", "Pokhara Sales Office", "Kaski"],
  ];
  await db
    .insert(branches)
    .values(
      branchDefs.map(([code, name, district]) => ({
        orgId,
        code,
        name,
        district,
        parentId: hqId,
      })),
    )
    .onConflictDoNothing();

  const deptDefs = [
    ["MGT", "Management"],
    ["HR", "Human Resources"],
    ["FIN", "Finance & Accounts"],
    ["PROD", "Production"],
    ["QA", "Quality Assurance"],
    ["SALES", "Sales & Marketing"],
    ["IT", "Information Technology"],
    ["STORE", "Stores & Logistics"],
  ];
  await db
    .insert(departments)
    .values(deptDefs.map(([code, name]) => ({ orgId, code, name })))
    .onConflictDoNothing();

  const desigDefs: [string, string, number][] = [
    ["MD", "Managing Director", 1],
    ["GM", "General Manager", 5],
    ["MGR", "Manager", 10],
    ["AMGR", "Assistant Manager", 15],
    ["SUP", "Supervisor", 20],
    ["SO", "Senior Officer", 25],
    ["OFF", "Officer", 30],
    ["ASST", "Assistant", 40],
    ["OPR", "Machine Operator", 45],
    ["HELP", "Helper", 50],
  ];
  await db
    .insert(designations)
    .values(desigDefs.map(([code, name, level]) => ({ orgId, code, name, hierarchyLevel: level })))
    .onConflictDoNothing();

  await db
    .insert(employmentTypes)
    .values([
      { orgId, code: "PERM", name: "Permanent", accruesLeave: true },
      { orgId, code: "CONT", name: "Contract", accruesLeave: true },
      { orgId, code: "PROB", name: "Probation", accruesLeave: false },
      { orgId, code: "INTERN", name: "Intern", accruesLeave: false },
    ])
    .onConflictDoNothing();

  await db
    .insert(grades)
    .values([
      { orgId, code: "L1", name: "Level 1 — Executive", hierarchyLevel: 5, basicSalary: "185000" },
      { orgId, code: "L2", name: "Level 2 — Senior Management", hierarchyLevel: 10, basicSalary: "120000" },
      { orgId, code: "L3", name: "Level 3 — Management", hierarchyLevel: 20, basicSalary: "78000" },
      { orgId, code: "L4", name: "Level 4 — Officer", hierarchyLevel: 30, basicSalary: "52000" },
      { orgId, code: "L5", name: "Level 5 — Assistant", hierarchyLevel: 40, basicSalary: "34000" },
      { orgId, code: "L6", name: "Level 6 — Support", hierarchyLevel: 50, basicSalary: "22000" },
    ])
    .onConflictDoNothing();

  log("structure", "4 branches, 8 departments, 10 designations, 6 grades");

  // lookups
  const branchByCode = new Map((await db.select().from(branches).where(eq(branches.orgId, orgId))).map((b) => [b.code, b.id]));
  const deptByCode = new Map((await db.select().from(departments).where(eq(departments.orgId, orgId))).map((d) => [d.code, d.id]));
  const desigByCode = new Map((await db.select().from(designations).where(eq(designations.orgId, orgId))).map((d) => [d.code, d.id]));
  const typeByCode = new Map((await db.select().from(employmentTypes).where(eq(employmentTypes.orgId, orgId))).map((t) => [t.code, t.id]));
  const gradeByCode = new Map((await db.select().from(grades).where(eq(grades.orgId, orgId))).map((g) => [g.code, g.id]));

  // ---------------------------------------------------------------- employees
  type Person = {
    code: string;
    first: string;
    last: string;
    np: string;
    gender: "male" | "female";
    dept: string;
    desig: string;
    grade: string;
    branch: string;
    type: string;
    join: string;
    supervisor?: string;
    salary: string;
  };

  const people: Person[] = [
    { code: "EMP001", first: "Rajendra", last: "Shrestha", np: "राजेन्द्र श्रेष्ठ", gender: "male", dept: "MGT", desig: "MD", grade: "L1", branch: "HO", type: "PERM", join: "2009-07-16", salary: "185000" },
    { code: "EMP002", first: "Sunita", last: "Maharjan", np: "सुनिता महर्जन", gender: "female", dept: "HR", desig: "GM", grade: "L2", branch: "HO", type: "PERM", join: "2012-04-15", supervisor: "EMP001", salary: "132000" },
    { code: "EMP003", first: "Bikash", last: "Adhikari", np: "विकास अधिकारी", gender: "male", dept: "FIN", desig: "GM", grade: "L2", branch: "HO", type: "PERM", join: "2013-01-14", supervisor: "EMP001", salary: "128000" },
    { code: "EMP004", first: "Anil", last: "Thapa", np: "अनिल थापा", gender: "male", dept: "PROD", desig: "GM", grade: "L2", branch: "PLANT", type: "PERM", join: "2011-09-05", supervisor: "EMP001", salary: "126000" },
    { code: "EMP005", first: "Kamala", last: "Gurung", np: "कमला गुरुङ", gender: "female", dept: "HR", desig: "MGR", grade: "L3", branch: "HO", type: "PERM", join: "2016-03-21", supervisor: "EMP002", salary: "84000" },
    { code: "EMP006", first: "Deepak", last: "Karki", np: "दीपक कार्की", gender: "male", dept: "FIN", desig: "MGR", grade: "L3", branch: "HO", type: "PERM", join: "2015-11-02", supervisor: "EMP003", salary: "82000" },
    { code: "EMP007", first: "Sarita", last: "Poudel", np: "सरिता पौडेल", gender: "female", dept: "QA", desig: "MGR", grade: "L3", branch: "PLANT", type: "PERM", join: "2017-06-12", supervisor: "EMP004", salary: "79000" },
    { code: "EMP008", first: "Prakash", last: "Bhattarai", np: "प्रकाश भट्टराई", gender: "male", dept: "SALES", desig: "MGR", grade: "L3", branch: "HO", type: "PERM", join: "2014-08-18", supervisor: "EMP001", salary: "88000" },
    { code: "EMP009", first: "Nabin", last: "Rai", np: "नविन राई", gender: "male", dept: "IT", desig: "AMGR", grade: "L3", branch: "HO", type: "PERM", join: "2018-02-05", supervisor: "EMP003", salary: "72000" },
    { code: "EMP010", first: "Rita", last: "Tamang", np: "रीता तामाङ", gender: "female", dept: "HR", desig: "SO", grade: "L4", branch: "HO", type: "PERM", join: "2019-07-01", supervisor: "EMP005", salary: "54000" },
    { code: "EMP011", first: "Suresh", last: "Lamichhane", np: "सुरेश लामिछाने", gender: "male", dept: "FIN", desig: "OFF", grade: "L4", branch: "HO", type: "PERM", join: "2019-09-16", supervisor: "EMP006", salary: "49000" },
    { code: "EMP012", first: "Mina", last: "Chaudhary", np: "मीना चौधरी", gender: "female", dept: "QA", desig: "OFF", grade: "L4", branch: "PLANT", type: "PERM", join: "2020-01-06", supervisor: "EMP007", salary: "47000" },
    { code: "EMP013", first: "Gopal", last: "Neupane", np: "गोपाल न्यौपाने", gender: "male", dept: "PROD", desig: "SUP", grade: "L4", branch: "PLANT", type: "PERM", join: "2016-12-11", supervisor: "EMP004", salary: "51000" },
    { code: "EMP014", first: "Bimala", last: "Khadka", np: "विमला खड्का", gender: "female", dept: "SALES", desig: "SO", grade: "L4", branch: "PKR", type: "PERM", join: "2018-10-22", supervisor: "EMP008", salary: "53000" },
    { code: "EMP015", first: "Ramesh", last: "Yadav", np: "रमेश यादव", gender: "male", dept: "STORE", desig: "SUP", grade: "L4", branch: "BRT", type: "PERM", join: "2017-04-09", supervisor: "EMP004", salary: "48000" },
    { code: "EMP016", first: "Pooja", last: "Sharma", np: "पूजा शर्मा", gender: "female", dept: "IT", desig: "OFF", grade: "L4", branch: "HO", type: "PERM", join: "2021-05-17", supervisor: "EMP009", salary: "46000" },
    { code: "EMP017", first: "Hari", last: "Bahadur Magar", np: "हरि बहादुर मगर", gender: "male", dept: "PROD", desig: "OPR", grade: "L5", branch: "PLANT", type: "PERM", join: "2019-02-25", supervisor: "EMP013", salary: "33000" },
    { code: "EMP018", first: "Sabina", last: "Basnet", np: "सविना बस्नेत", gender: "female", dept: "PROD", desig: "OPR", grade: "L5", branch: "PLANT", type: "PERM", join: "2020-08-03", supervisor: "EMP013", salary: "32000" },
    { code: "EMP019", first: "Krishna", last: "Pandey", np: "कृष्ण पाण्डे", gender: "male", dept: "STORE", desig: "ASST", grade: "L5", branch: "BRT", type: "PERM", join: "2021-11-15", supervisor: "EMP015", salary: "31000" },
    { code: "EMP020", first: "Anita", last: "Shakya", np: "अनिता शाक्य", gender: "female", dept: "SALES", desig: "ASST", grade: "L5", branch: "PKR", type: "CONT", join: "2022-06-20", supervisor: "EMP014", salary: "30000" },
    { code: "EMP021", first: "Dipesh", last: "Koirala", np: "दिपेश कोइराला", gender: "male", dept: "IT", desig: "ASST", grade: "L5", branch: "HO", type: "CONT", join: "2023-03-13", supervisor: "EMP009", salary: "29000" },
    { code: "EMP022", first: "Laxmi", last: "Bhandari", np: "लक्ष्मी भण्डारी", gender: "female", dept: "PROD", desig: "HELP", grade: "L6", branch: "PLANT", type: "PERM", join: "2022-01-10", supervisor: "EMP013", salary: "22000" },
    { code: "EMP023", first: "Santosh", last: "Limbu", np: "सन्तोष लिम्बु", gender: "male", dept: "QA", desig: "ASST", grade: "L5", branch: "PLANT", type: "PROB", join: addDays(today, -70), supervisor: "EMP007", salary: "28000" },
    { code: "EMP024", first: "Sneha", last: "Joshi", np: "स्नेहा जोशी", gender: "female", dept: "HR", desig: "ASST", grade: "L5", branch: "HO", type: "PROB", join: addDays(today, -40), supervisor: "EMP005", salary: "27000" },
  ];

  const existing = await db.select({ code: employees.employeeCode }).from(employees).where(eq(employees.orgId, orgId));
  const existingCodes = new Set(existing.map((e) => e.code));

  const toInsert = people.filter((p) => !existingCodes.has(p.code));
  if (toInsert.length) {
    await db.insert(employees).values(
      toInsert.map((p, i) => ({
        orgId,
        employeeCode: p.code,
        firstName: p.first,
        lastName: p.last,
        fullNameNepali: p.np,
        gender: p.gender,
        maritalStatus: (i % 3 === 0 ? "single" : "married") as "single" | "married",
        dateOfBirth: addDays(p.join, -(7000 + i * 137)),
        workEmail: `${p.first.toLowerCase()}.${p.last.split(" ")[0].toLowerCase()}@bela.example.np`,
        mobile: `98${String(41000000 + i * 137911).slice(0, 8)}`,
        district: "Kathmandu",
        permanentAddress: "Kathmandu, Bagmati Province",
        branchId: branchByCode.get(p.branch)!,
        departmentId: deptByCode.get(p.dept)!,
        designationId: desigByCode.get(p.desig)!,
        employmentTypeId: typeByCode.get(p.type)!,
        gradeId: gradeByCode.get(p.grade)!,
        status: (p.type === "PROB" ? "probation" : "active") as "probation" | "active",
        dateOfJoin: p.join,
        confirmationDate: p.type === "PROB" ? null : addDays(p.join, 180),
        panNumber: `6${String(10000000 + i * 7919).slice(0, 8)}`,
        ssfNumber: `SSF${String(100000 + i * 37)}`,
        pfNumber: `PF${String(200000 + i * 41)}`,
        bankName: "Nabil Bank Ltd.",
        bankAccountNumber: `01${String(1000000000 + i * 8171717)}`,
        basicSalary: p.salary,
      })),
    );
  }

  const empByCode = new Map(
    (await db.select().from(employees).where(eq(employees.orgId, orgId))).map((e) => [e.employeeCode, e]),
  );

  // supervisors need every row to exist first
  for (const p of people) {
    if (!p.supervisor) continue;
    const self = empByCode.get(p.code)!;
    const boss = empByCode.get(p.supervisor)!;
    if (self.supervisorId === boss.id) continue;
    await db.update(employees).set({ supervisorId: boss.id }).where(eq(employees.id, self.id));
  }

  // re-read: the rows above were fetched before supervisor_id was set, and the
  // approval chain below routes on it
  empByCode.clear();
  for (const e of await db.select().from(employees).where(eq(employees.orgId, orgId))) {
    empByCode.set(e.employeeCode, e);
  }
  log("employees", `${people.length} with reporting lines`);

  // department heads
  const headMap: [string, string][] = [
    ["HR", "EMP002"], ["FIN", "EMP003"], ["PROD", "EMP004"],
    ["QA", "EMP007"], ["SALES", "EMP008"], ["IT", "EMP009"], ["STORE", "EMP015"],
  ];
  for (const [dept, code] of headMap) {
    await db
      .update(departments)
      .set({ headEmployeeId: empByCode.get(code)!.id })
      .where(and(eq(departments.orgId, orgId), eq(departments.code, dept)));
  }

  // ---------------------------------------------------------------- roles
  for (const [code, tpl] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
    const [role] = await db
      .insert(roles)
      .values({ orgId, code, name: tpl.name, isSystem: true, description: `${tpl.permissions.length} permissions` })
      .onConflictDoNothing()
      .returning();

    const roleId =
      role?.id ??
      (await db.select().from(roles).where(and(eq(roles.orgId, orgId), eq(roles.code, code))).limit(1))[0].id;

    await db
      .insert(roleGrants)
      .values(tpl.permissions.map((permission) => ({ roleId, permission })))
      .onConflictDoNothing();
  }
  const roleByCode = new Map((await db.select().from(roles).where(eq(roles.orgId, orgId))).map((r) => [r.code, r.id]));
  log("roles", [...roleByCode.keys()].join(", "));

  // ---------------------------------------------------------------- logins
  const logins: [email: string, name: string, password: string, role: string, empCode: string | null][] = [
    ["admin@bela.example.np", "System Administrator", "Admin@123", "administrator", null],
    ["sunita.maharjan@bela.example.np", "Sunita Maharjan", "Hr@12345", "hr_manager", "EMP002"],
    ["gopal.neupane@bela.example.np", "Gopal Neupane", "Super@123", "supervisor", "EMP013"],
    ["hari.bahadur@bela.example.np", "Hari Bahadur Magar", "Staff@123", "employee", "EMP017"],
  ];

  for (const [email, name, password, roleCode, empCode] of logins) {
    const [found] = await db.select().from(user).where(eq(user.email, email)).limit(1);
    let userId = found?.id;

    if (!userId) {
      // go through Better Auth so the password is hashed exactly as sign-in expects
      const created = await auth.api.signUpEmail({ body: { email, password, name } });
      userId = created.user.id;
    }

    await db
      .insert(userAccounts)
      .values({
        userId,
        orgId,
        employeeId: empCode ? empByCode.get(empCode)!.id : null,
        isActive: true,
        // The seeded administrator holds the break-glass flag, so a fresh
        // database is never one role edit away from being unadministrable.
        // Re-applied on every seed: it is the recovery path, and a demo database
        // that has lost it is a demo database nobody can fix from the UI.
        isSystemAdmin: roleCode === "administrator",
      })
      .onConflictDoUpdate({
        target: userAccounts.userId,
        set: { isSystemAdmin: roleCode === "administrator" },
      });

    await db
      .insert(userRoles)
      .values({ userId, roleId: roleByCode.get(roleCode)! })
      .onConflictDoNothing();
  }
  log("logins", logins.map((l) => l[0].split("@")[0]).join(", "));

  // ---------------------------------------------------------------- leave policy
  type LeaveDef = {
    code: string;
    name: string;
    np: string;
    days: string;
    carry: boolean;
    max: string | null;
    notice: number;
    colour: string;
    appliesTo?: "all" | "male" | "female";
    paid?: boolean;
    deducts?: boolean;
    attachAfter?: number;
    /** What a day of it is, for attendance and payroll. */
    nature?: "official_work" | "paid" | "unpaid" | "absent" | "substitute" | "holiday" | "transit";
    /** 0-100 of salary. */
    pay?: string;
    lapse?: "none" | "monthly" | "yearly" | "service_period";
    encashable?: boolean;
    order?: number;
    /** Day ceilings for approval levels 1-3; level 4 is final authority. */
    limits?: [number | null, number | null, number | null];
  };

  const leaveDefs: LeaveDef[] = [
    { code: "HOME", name: "Home Leave", np: "घर बिदा", days: "18", carry: true, max: "45", notice: 7, colour: "#0f6e63",
      nature: "paid", pay: "100", lapse: "none", encashable: true, order: 20, limits: [5, 15, null] },
    { code: "SICK", name: "Sick Leave", np: "बिरामी बिदा", days: "12", carry: false, max: null, notice: 0, colour: "#8c3a2b", attachAfter: 3,
      nature: "paid", pay: "100", lapse: "none", encashable: true, order: 30, limits: [3, 10, null] },
    { code: "CASUAL", name: "Casual Leave", np: "आकस्मिक बिदा", days: "6", carry: false, max: null, notice: 1, colour: "#8a5b0c",
      nature: "paid", pay: "100", lapse: "yearly", order: 10, limits: [3, null, null] },
    { code: "MAT", name: "Maternity Leave", np: "प्रसूति बिदा", days: "98", carry: false, max: null, notice: 30, colour: "#7048a6", appliesTo: "female",
      nature: "paid", pay: "100", lapse: "service_period", order: 60 },
    { code: "PAT", name: "Paternity Leave", np: "पितृत्व बिदा", days: "15", carry: false, max: null, notice: 7, colour: "#2f6fae", appliesTo: "male",
      nature: "paid", pay: "100", lapse: "service_period", order: 61 },
    { code: "BER", name: "Bereavement Leave", np: "किरिया बिदा", days: "13", carry: false, max: null, notice: 0, colour: "#4a5755",
      nature: "paid", pay: "100", lapse: "yearly", order: 40 },
    { code: "UNPAID", name: "Leave Without Pay", np: "तलब कट्टी बिदा", days: "0", carry: false, max: null, notice: 3, colour: "#788582", paid: false, deducts: false,
      nature: "unpaid", pay: "0", lapse: "yearly", order: 90, limits: [null, 10, null] },
    // The two that prove the point: neither is an absence, and payroll pays both
    // in full — but one is a working day and the other is half-paid study time.
    { code: "FIELD", name: "Field Work", np: "फिल्ड कार्य", days: "0", carry: false, max: null, notice: 0, colour: "#1f7a8c", deducts: false,
      nature: "official_work", pay: "100", lapse: "none", order: 5 },
    { code: "STUDY", name: "Study Leave", np: "अध्ययन बिदा", days: "30", carry: false, max: null, notice: 30, colour: "#5b6ea8",
      nature: "paid", pay: "50", lapse: "service_period", order: 70, limits: [null, null, 15] },
  ];

  await db
    .insert(leaveTypes)
    .values(
      leaveDefs.map((l) => ({
        orgId,
        code: l.code,
        name: l.name,
        nameNepali: l.np,
        daysPerYear: l.days,
        allowCarryForward: l.carry,
        maxCarryForwardDays: l.max,
        minNoticeDays: l.notice,
        colour: l.colour,
        appliesTo: l.appliesTo ?? "all",
        isPaid: l.paid ?? true,
        deductsBalance: l.deducts ?? true,
        requiresAttachmentAfterDays: l.attachAfter ?? null,
        approvalLevels: l.code === "MAT" || l.code === "UNPAID" ? 2 : 1,
        nature: l.nature ?? "paid",
        paidPercent: l.pay ?? "100",
        lapseType: l.lapse ?? "yearly",
        isEncashable: l.encashable ?? false,
        leaveOrder: l.order ?? 50,
        level1LimitDays: l.limits?.[0] ?? null,
        level2LimitDays: l.limits?.[1] ?? null,
        level3LimitDays: l.limits?.[2] ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [leaveTypes.orgId, leaveTypes.code],
      set: {
        // Policy columns are re-applied on every seed so an existing demo
        // database picks up new settings without a wipe. Balances and requests
        // are keyed separately and are not touched.
        nature: sql`excluded.nature`,
        paidPercent: sql`excluded.paid_percent`,
        lapseType: sql`excluded.lapse_type`,
        isEncashable: sql`excluded.is_encashable`,
        leaveOrder: sql`excluded.leave_order`,
        level1LimitDays: sql`excluded.level1_limit_days`,
        level2LimitDays: sql`excluded.level2_limit_days`,
        level3LimitDays: sql`excluded.level3_limit_days`,
      },
    });

  const typeRows = await db.select().from(leaveTypes).where(eq(leaveTypes.orgId, orgId));
  const leaveTypeByCode = new Map(typeRows.map((t) => [t.code, t]));
  log("leave types", typeRows.length.toString());

  // ------------------------------------------------- groups and entitlements
  await db
    .insert(leaveGroups)
    .values([
      { orgId, code: "STAT", name: "Statutory", nameNepali: "कानुनी", sortOrder: 10 },
      { orgId, code: "WELF", name: "Welfare", nameNepali: "कल्याण", sortOrder: 20 },
      { orgId, code: "OPS", name: "Operational", nameNepali: "सञ्चालन", sortOrder: 30 },
    ])
    .onConflictDoNothing();

  // Entitlement genuinely differs by contract: a probationer gets casual leave
  // but no home leave, an intern gets neither. Modelling that as rows rather
  // than exceptions is what stops HR editing balances by hand every month.
  const entitlementPlan: [leaveCode: string, empCode: string, days: string][] = [
    ["HOME", "PERM", "18"], ["HOME", "CONT", "9"], ["HOME", "PROB", "0"], ["HOME", "INTERN", "0"],
    ["SICK", "PERM", "12"], ["SICK", "CONT", "8"], ["SICK", "PROB", "6"], ["SICK", "INTERN", "0"],
    ["CASUAL", "PERM", "6"], ["CASUAL", "CONT", "6"], ["CASUAL", "PROB", "3"], ["CASUAL", "INTERN", "3"],
    ["STUDY", "PERM", "30"], ["STUDY", "CONT", "0"], ["STUDY", "PROB", "0"], ["STUDY", "INTERN", "0"],
  ];

  const entitlementRows = entitlementPlan
    .map(([leaveCode, empCode, days]) => {
      const leaveTypeId = leaveTypeByCode.get(leaveCode)?.id;
      const employmentTypeId = typeByCode.get(empCode);
      return leaveTypeId && employmentTypeId
        ? { orgId, leaveTypeId, employmentTypeId, daysAllowed: days }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (entitlementRows.length) {
    await db.insert(leaveTypeEntitlements).values(entitlementRows).onConflictDoNothing();
  }

  // Study leave pays basic in full but only half of allowances — the case the
  // legacy salary-head relation existed for, and the reason paidPercent alone
  // is not enough.
  const studyId = leaveTypeByCode.get("STUDY")?.id;
  if (studyId) {
    await db
      .insert(leaveSalaryEffects)
      .values([
        { orgId, leaveTypeId: studyId, salaryHeadCode: "BASIC", payPercent: "100" },
        { orgId, leaveTypeId: studyId, salaryHeadCode: "ALLOWANCE", payPercent: "50" },
      ])
      .onConflictDoNothing();
  }

  log("leave entitlements", `${entitlementRows.length} rows, 3 groups`);

  // ------------------------------------------------------- employee desk data
  //
  // Family, qualifications, documents and notices, so the self-service screens
  // demonstrate something real rather than five empty states. Keyed on natural
  // business keys, so a re-seed tops up instead of duplicating.
  const deskPeople = ["EMP017", "EMP002", "EMP013", "EMP012"]
    .map((code) => empByCode.get(code))
    .filter((e): e is NonNullable<typeof e> => !!e);

  const familyRows = deskPeople.flatMap((e) => [
    {
      orgId,
      employeeId: e.id,
      fullName: `${e.lastName} Devi`,
      relationship: "spouse" as const,
      occupation: "Homemaker",
      contactNumber: "9841000111",
      isDependant: true,
      isNominee: true,
      nomineeSharePercent: 60,
      isEmergencyContact: true,
    },
    {
      orgId,
      employeeId: e.id,
      fullName: `${e.firstName} Kumar ${e.lastName}`,
      relationship: "son" as const,
      dateOfBirth: "2016-04-11",
      isDependant: true,
      isNominee: true,
      nomineeSharePercent: 40,
      isEmergencyContact: false,
    },
    {
      orgId,
      employeeId: e.id,
      fullName: `Krishna ${e.lastName}`,
      relationship: "father" as const,
      occupation: "Retired",
      isDependant: false,
      isNominee: false,
      isEmergencyContact: true,
    },
  ]);

  const existingFamily = await db
    .select({ employeeId: employeeFamily.employeeId, fullName: employeeFamily.fullName })
    .from(employeeFamily);
  const familySeen = new Set(existingFamily.map((f) => `${f.employeeId}:${f.fullName}`));
  const newFamily = familyRows.filter((f) => !familySeen.has(`${f.employeeId}:${f.fullName}`));
  if (newFamily.length) await db.insert(employeeFamily).values(newFamily);

  const qualRows = deskPeople.flatMap((e) => [
    { orgId, employeeId: e.id, kind: "education" as const, title: "Bachelor of Business Studies", institution: "Tribhuvan University", result: "First division", completedYear: 2014 },
    { orgId, employeeId: e.id, kind: "education" as const, title: "Higher Secondary (Management)", institution: "Kathmandu Model College", result: "78%", completedYear: 2010 },
    { orgId, employeeId: e.id, kind: "certification" as const, title: "Workplace Safety Level 2", institution: "Nepal Industrial Safety Council", completedYear: 2024, expiresOn: "2027-03-31" },
    { orgId, employeeId: e.id, kind: "training" as const, title: "Lean Manufacturing Basics", institution: "Bela Nepal Industries", completedYear: 2025 },
    { orgId, employeeId: e.id, kind: "skill" as const, title: "MS Excel - advanced", result: "Assessed" },
    { orgId, employeeId: e.id, kind: "language" as const, title: "Nepali", result: "Native" },
    { orgId, employeeId: e.id, kind: "language" as const, title: "English", result: "Professional" },
  ]);

  const existingQuals = await db
    .select({ employeeId: employeeQualifications.employeeId, title: employeeQualifications.title })
    .from(employeeQualifications);
  const qualSeen = new Set(existingQuals.map((q) => `${q.employeeId}:${q.title}`));
  const newQuals = qualRows.filter((q) => !qualSeen.has(`${q.employeeId}:${q.title}`));
  if (newQuals.length) await db.insert(employeeQualifications).values(newQuals);

  const docRows = deskPeople.flatMap((e) => [
    { orgId, employeeId: e.id, kind: "contract" as const, title: "Appointment letter", referenceNumber: `BNI/HR/${e.employeeCode}`, issuedOn: e.dateOfJoin, isVisibleToEmployee: true, uploadedBy: "HR Department" },
    { orgId, employeeId: e.id, kind: "citizenship" as const, title: "Citizenship certificate", referenceNumber: `27-01-70-${e.employeeCode.slice(-4)}`, isVisibleToEmployee: true, uploadedBy: "HR Department" },
    { orgId, employeeId: e.id, kind: "certificate" as const, title: "Safety training certificate", issuedOn: "2024-04-01", expiresOn: "2027-03-31", isVisibleToEmployee: true, uploadedBy: "HR Department" },
    // Deliberately hidden, so the visibility filter is demonstrably doing something.
    { orgId, employeeId: e.id, kind: "appraisal" as const, title: "Internal performance note", isVisibleToEmployee: false, uploadedBy: "HR Department" },
  ]);

  const existingDocs = await db
    .select({ employeeId: employeeDocuments.employeeId, title: employeeDocuments.title })
    .from(employeeDocuments);
  const docSeen = new Set(existingDocs.map((d) => `${d.employeeId}:${d.title}`));
  const newDocs = docRows.filter((d) => !docSeen.has(`${d.employeeId}:${d.title}`));
  if (newDocs.length) await db.insert(employeeDocuments).values(newDocs);

  const noticeRows = [
    {
      orgId,
      title: "Dashain holiday schedule confirmed",
      body: "The factory and all offices close from Ashwin 22 to Ashwin 28. Production staff on the night roster should confirm their handover with their supervisor before Ashwin 21.\n\nLeave applications overlapping these dates do not need to be filed - the days are already holidays and are not deducted from any balance.",
      priority: "important" as const,
      audience: "everyone" as const,
      publishFrom: "2026-08-20",
      isPinned: true,
      postedBy: "HR Department",
    },
    {
      orgId,
      title: "Attendance corrections close on the 5th",
      body: "Corrections for the previous Bikram Sambat month must be approved by the 5th. After that the period is locked for payroll and the correction screen will refuse the date.\n\nIf you have a missing punch, raise it from My Desk, then Fix my attendance.",
      priority: "normal" as const,
      audience: "everyone" as const,
      publishFrom: "2026-08-25",
      postedBy: "Payroll",
    },
    {
      orgId,
      title: "Safety shoes are mandatory on the production floor",
      body: "With immediate effect, safety shoes are mandatory anywhere past the blue line. Replacements are issued from the stores desk on production of your employee card.",
      priority: "urgent" as const,
      audience: "everyone" as const,
      publishFrom: "2026-09-01",
      isPinned: true,
      postedBy: "Plant Safety Officer",
    },
    {
      orgId,
      title: "New tea point on the first floor",
      body: "The first-floor tea point reopens on Bhadra 25 with extended hours, 7:30 to 18:30.",
      priority: "normal" as const,
      audience: "everyone" as const,
      publishFrom: "2026-09-05",
      publishTo: "2026-10-30",
      postedBy: "Administration",
    },
  ];

  const existingNotices = await db
    .select({ title: notices.title })
    .from(notices)
    .where(eq(notices.orgId, orgId));
  const noticeSeen = new Set(existingNotices.map((n) => n.title));
  const newNotices = noticeRows.filter((n) => !noticeSeen.has(n.title));
  if (newNotices.length) await db.insert(notices).values(newNotices);

  log(
    "employee desk",
    `${newFamily.length} family, ${newQuals.length} qualifications, ${newDocs.length} documents, ${newNotices.length} notices`,
  );

  // ---------------------------------------------------------------- balances
  const allEmployees = [...empByCode.values()];
  const balanceRows = [];
  for (const emp of allEmployees) {
    for (const lt of typeRows) {
      if (lt.appliesTo !== "all" && lt.appliesTo !== emp.gender) continue;
      if (!lt.deductsBalance) continue;
      const seniorityYears = Math.max(0, new Date(today).getFullYear() - new Date(emp.dateOfJoin).getFullYear());
      const carried = lt.allowCarryForward ? String(Math.min(seniorityYears * 3, 30)) : "0";
      balanceRows.push({
        orgId,
        employeeId: emp.id,
        leaveTypeId: lt.id,
        fiscalYearId: currentFy.id,
        entitled: lt.daysPerYear,
        carriedForward: carried,
        used: "0",
        pending: "0",
      });
    }
  }
  await db.insert(leaveBalances).values(balanceRows).onConflictDoNothing();
  log("leave balances", `${balanceRows.length} rows`);

  // ---------------------------------------------------------------- requests
  const holidaySet = new Set(holidayRows.map((h) => h.date));

  const requestDefs: {
    emp: string;
    type: string;
    from: string;
    to: string;
    reason: string;
    status: "pending" | "approved" | "rejected";
  }[] = [
    { emp: "EMP017", type: "HOME", from: addDays(today, 9), to: addDays(today, 13), reason: "Family wedding in Dhankuta", status: "pending" },
    { emp: "EMP018", type: "SICK", from: addDays(today, -3), to: addDays(today, -2), reason: "Viral fever, clinic visit", status: "approved" },
    { emp: "EMP022", type: "CASUAL", from: addDays(today, 4), to: addDays(today, 4), reason: "Citizenship renewal at ward office", status: "pending" },
    { emp: "EMP019", type: "HOME", from: addDays(today, 21), to: addDays(today, 27), reason: "Annual home visit to Janakpur", status: "pending" },
    { emp: "EMP021", type: "CASUAL", from: addDays(today, -10), to: addDays(today, -10), reason: "Personal work", status: "rejected" },
    { emp: "EMP012", type: "SICK", from: addDays(today, -20), to: addDays(today, -18), reason: "Dental surgery and recovery", status: "approved" },
    { emp: "EMP016", type: "HOME", from: addDays(today, 30), to: addDays(today, 34), reason: "Trek with family", status: "pending" },
    { emp: "EMP020", type: "CASUAL", from: addDays(today, 2), to: addDays(today, 2), reason: "Bank account formalities", status: "pending" },
  ];

  const existingRequests = await db
    .select({
      reference: leaveRequests.reference,
      employeeId: leaveRequests.employeeId,
      leaveTypeId: leaveRequests.leaveTypeId,
      fromDate: leaveRequests.fromDate,
    })
    .from(leaveRequests)
    .where(eq(leaveRequests.orgId, orgId));

  // Idempotency has to key on what identifies the request in the world — who,
  // which leave type, which day — not on the generated reference. Keying on the
  // reference makes a re-run mint a new one and insert a second copy.
  const seenRequests = new Set(
    existingRequests.map((r) => `${r.employeeId}:${r.leaveTypeId}:${r.fromDate}`),
  );

  let seq = existingRequests.length;
  for (const def of requestDefs) {
    const emp = empByCode.get(def.emp)!;
    const ltForKey = leaveTypeByCode.get(def.type)!;
    if (seenRequests.has(`${emp.id}:${ltForKey.id}:${def.from}`)) continue;

    seq += 1;
    const reference = `LV-${currentFy.code.split("/")[0]}-${String(seq).padStart(4, "0")}`;
    const lt = leaveTypeByCode.get(def.type)!;
    const days = workingDaysBetween(def.from, def.to, holidaySet);

    const [req] = await db
      .insert(leaveRequests)
      .values({
        orgId,
        reference,
        employeeId: emp.id,
        leaveTypeId: lt.id,
        fiscalYearId: currentFy.id,
        fromDate: def.from,
        toDate: def.to,
        fromDateBs: formatBsKey(adToBs(def.from)),
        toDateBs: formatBsKey(adToBs(def.to)),
        totalDays: String(days),
        reason: def.reason,
        status: def.status,
        currentLevel: def.status === "pending" ? 1 : null,
        submittedAt: new Date(),
        decidedAt: def.status === "pending" ? null : new Date(),
      })
      .returning();

    const approverId = emp.supervisorId;
    await db.insert(approvalSteps).values({
      orgId,
      entityType: "leave_request",
      entityId: req.id,
      level: 1,
      approverEmployeeId: approverId,
      approverLabel: "Reporting supervisor",
      decision: def.status === "pending" ? "pending" : def.status === "approved" ? "approved" : "rejected",
      comment: def.status === "rejected" ? "Peak production week — please reschedule." : null,
      decidedAt: def.status === "pending" ? null : new Date(),
    });

    // keep balances consistent with the request state
    const column = def.status === "approved" ? leaveBalances.used : leaveBalances.pending;
    if (def.status !== "rejected") {
      await db
        .update(leaveBalances)
        .set({ [def.status === "approved" ? "used" : "pending"]: sql`${column} + ${String(days)}` })
        .where(
          and(
            eq(leaveBalances.employeeId, emp.id),
            eq(leaveBalances.leaveTypeId, lt.id),
            eq(leaveBalances.fiscalYearId, currentFy.id),
          ),
        );
    }
  }
  log("leave requests", `${requestDefs.length} across pending/approved/rejected`);

  // ---------------------------------------------------------------- attendance
  // approved leave has to be known before attendance is generated, so a day on
  // leave is never also marked absent
  const approvedLeave = await db
    .select({
      employeeId: leaveRequests.employeeId,
      fromDate: leaveRequests.fromDate,
      toDate: leaveRequests.toDate,
    })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.status, "approved")));

  const leaveDates = new Set<string>();
  for (const l of approvedLeave) {
    for (let d = l.fromDate; d <= l.toDate; d = addDays(d, 1)) {
      leaveDates.add(`${l.employeeId}:${d}`);
    }
  }

  await seedAttendance({
    db,
    orgId,
    employees: allEmployees.map((e) => ({
      id: e.id,
      employeeCode: e.employeeCode,
      departmentId: e.departmentId,
      supervisorId: e.supervisorId,
      dateOfJoin: e.dateOfJoin,
    })),
    holidayDates: new Set(holidayRows.map((h) => h.date)),
    leaveDates,
    today,
    days: 75,
    log,
  });

  await db.insert(auditLog).values({
    orgId,
    action: "create",
    entityType: "organization",
    entityId: orgId,
    actorLabel: "seed",
    summary: `Demo dataset seeded for ${org.name}`,
  });

  console.log("\nDone. Sign in with:\n");
  for (const [email, , password, role] of logins) {
    console.log(`  ${email.padEnd(36)} ${password.padEnd(12)} ${role}`);
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSeed failed:\n", err);
    process.exit(1);
  });
