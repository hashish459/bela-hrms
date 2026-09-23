# Milestone 0 — Database recovery: findings

**Date:** 18 September 2026
**Input:** `hrms_Live_2022_06_28_08.bak` — full backup of `hrms_Live`, taken 28 Jun 2022 08:58 from server `HRMS\PRUD`
**Status:** Complete. All of Milestone 0's six objectives met or answered.

Everything below is **OBSERVED** from the restored production database unless marked
otherwise. It supersedes the inferences in
[`phase-0-reverse-engineering-report.md`](phase-0-reverse-engineering-report.md) wherever
the two disagree; corrections to that report are listed in §8.

---

## 1. What was restored

| | |
|---|---|
| Restored as | `NIMBLE_LEGACY` on `(localdb)\MSSQLLocalDB` |
| Files | `C:\Users\ashish\Downloads\hrms_Live_2022_06_28_08\_restore\` (2.3 GB) |
| Mode | **`READ_ONLY`** — set immediately after restore, before any query |
| Source engine | SQL Server 2019 (v15, DatabaseVersion 904), uncompressed, `IsDamaged = False` |
| Restore time | 22 seconds |
| Compatibility level | **100 (SQL Server 2008)** — carried forward unchanged for over a decade |
| Collation | `SQL_Latin1_General_CP1_CI_AS` |
| Recovery model | SIMPLE |

`READ_ONLY` is not a `RESTORE` option — the sequence is `RESTORE … WITH RECOVERY` then
`ALTER DATABASE … SET READ_ONLY`. (The runbook in §25 of the main report said otherwise;
corrected there.)

> **Gotcha, found the hard way: `SET READ_ONLY` does not survive LocalDB's `AUTO_CLOSE`.**
> A restored database arrives with `AUTO_CLOSE = ON`. LocalDB closes it when the last
> connection drops, and the read-only flag was observed reverting to `False` across that
> cycle — a write probe subsequently succeeded and created a table, which was then dropped.
> The correct sequence, verified by an explicitly rejected write afterwards, is:
>
> ```sql
> ALTER DATABASE [NIMBLE_LEGACY] SET AUTO_CLOSE OFF WITH ROLLBACK IMMEDIATE;
> ALTER DATABASE [NIMBLE_LEGACY] SET READ_ONLY  WITH ROLLBACK IMMEDIATE;
> ```
>
> **Always verify with an actual write attempt**, not by reading `sys.databases.is_read_only`
> once. Current verified state: `is_read_only = True`, `is_auto_close_on = False`,
> 705 tables (original count), writes rejected.

### Identity confirmed

The backup is the matching production database for the deployed 2022 build:

- `Settings` has exactly **110 columns** and `EmpLogin` **19** — matching the EF model
  extracted from the assemblies column-for-column.
- Procedure `modify_date`s run to **21 Apr 2022**, consistent with the 16–17 Jun 2022
  module build dates.
- All framework tables present: `EmpLogin`, `UserList`, `Menu`, `MenuPermission`,
  `UserGroup`, `Modules`, `AuditTrailRegistration`.

---

## 2. Object inventory

| Object type | Count |
|---|---:|
| User tables | **705** |
| Stored procedures | **643** |
| Views | 165 |
| Scalar functions | 39 |
| Inline table-valued functions | 32 |
| Table-valued functions | 13 |
| Primary keys | 638 |
| Unique constraints | 247 |
| Default constraints | 246 |
| **Foreign keys** | **89** |

**89 foreign keys across 705 tables confirms defect D-2 against the real deployed
schema** — it was previously an inference from the extracted EF model. 67 tables have no
primary key (638 PKs / 705 tables).

---

## 3. The headline finding: 66% of the schema is empty

| | |
|---|---:|
| Tables | 705 |
| **Completely empty (0 rows)** | **465 (66%)** |
| Holding 1–1,000 rows | 208 |
| **Holding more than 1,000 rows** | **32** |
| Total rows | 2,117,850 |
| Total size | 576 MB |

**The "993-table, 7,805-action ERP" is, in production, a 240-table system with 32 tables of
substance.** That is the single most scope-reducing fact recovered, and it validates the
rebuild's 51-table design as the right order of magnitude rather than an oversimplification.

### Largest tables

| Table | Rows | Cols | MB |
|---|---:|---:|---:|
| `DeviceLogs` | 924,498 | 29 | 155.7 |
| `AttendanceLogs` | 354,312 | **96** | 208.2 |
| `EmpShiftDetail` | 230,591 | 11 | 18.5 |
| `DeviceRawLog` | 184,439 | 11 | 12.4 |
| `UserAccessLog` | 142,825 | 8 | 106.2 |
| `MonthlySalaryHead` | 64,345 | 18 | 9.3 |
| `EmpTDSSheet` | 50,822 | 13 | 9.7 |
| `ManualAttendance` | 42,466 | 12 | 7.9 |
| `MonthlySalarySheet` | 12,701 | **86** | 8.4 |
| `MonthlyAttendence` | 11,345 | 43 | 4.1 |
| `LeaveOpening` | 9,353 | 5 | 0.7 |
| `LeaveEmpRelation` | 8,209 | 27 | 2.8 |
| `LeaveDetail` | 7,196 | 11 | 0.9 |

**Attendance is 80% of the data.** `DeviceLogs` + `AttendanceLogs` + `DeviceRawLog` +
`EmpShiftDetail` + `ManualAttendance` = 1.74 M of 2.12 M rows.

---

## 4. What this customer actually used

The `Modules` registry settles it directly: **40 modules registered, 19 installed, 9 live,
3 licensed.**

### The 9 live modules

Attendance · Common · **Fixed Asset** · **Fixed Asset Utilities** · HRM · Leave · Misc ·
Payroll · Nimble MIS Framework

### Adoption, measured by rows

| Module | Tables | Non-empty | Rows | Verdict |
|---|---:|---:|---:|---|
| Attendance (incl. unprefixed) | 10+ | 6 | ~1,740,000 | **Core. Heavily used.** |
| HRM | 78 | 30 | ~324,000 | **Core. Heavily used.** |
| Framework (menu, users, logs) | 12 | 10 | ~448,000 | **Core.** |
| Payroll (incl. unprefixed) | 7+ | 2+ | ~140,000 | **Core. Used.** |
| Leave | 24 | 16 | 44,810 | **Used** — but see §6. |
| Appraisal | 55 | 6 | **77** | Configured, never adopted |
| StaffAdvance | 24 | 4 | **22** | Never adopted |
| Training | 14 | 3 | **9** | Never adopted |
| ExpenseClaim | 18 | 1 | **6** | Never adopted |
| **FixedAsset** | 31 | 1 | **1** | **Licensed and live, never adopted** |
| StaffInsurance | 17 | 0 | **0** | Never used |
| ProjectManagement | 41 | 0 | **0** | Never used |
| Inventory | 4 | 0 | **0** | Never used |
| TaskManager | 7 | 0 | **0** | Never used |
| TravelOrder | — | — | **0** | Not deployed |

**This answers the question Milestone 6 of the main report deferred.** Ten of the fourteen
planned modules in `src/modules/registry.ts` correspond to legacy modules that carry
**essentially no production data**: Appraisal, Training, Travel & TADA, Expense Claims,
Procurement, Inventory, Fixed Assets, and the staff-advance portion of Expense.

They should not be rebuilt on the assumption that they replace working functionality. They
are either new development justified on its own merits, or they are out of scope. That is a
decision for the business, but it should now be made with this table in front of it.

### Organisation scale

| | |
|---|---:|
| Employees (all-time, `EmployeeInfo`) | **459** |
| Logins (`EmpLogin`) | 428 |
| Branches | **52** |
| Departments | 19 |
| Roles (`UserGroup`) | 10 |
| Salary heads | 31 |
| Leave types (`LeaveInfo`) | 11 |
| Fiscal year settings | 12 |
| Companies | 1 |

**52 branches for 459 employees** — a genuinely distributed organisation. This makes the
missing branch/department data scoping (finding **N-03**) a materially larger gap than it
appeared: role-based permissions with no branch scope means every HR user sees all 52
branches.

### Data coverage

| | First | Last |
|---|---|---|
| `AttendanceLogs` | **2012-07-16** | 2022-06-27 |
| `DeviceLogs` | 2015-04-07 | 2022-06-23 |

**Ten years of attendance history.** Migration must decide explicitly how much of it moves;
see §7.

---

## 5. Stored procedure recovery — the primary objective

The `_revive` kit recorded 453 procedures called by the application code and judged them
unrecoverable. They are now recovered, once the naming convention is accounted for.

**The code stores bare names (`sp_AdvanceIssue`); the database stores module-prefixed names
(`adv_sp_AdvanceIssue`).** Matching on the bare name alone finds only 85 of 453 (19%);
prefix-aware matching finds **299 (66%)**.

| | |
|---|---:|
| Procedures called by application code | 453 |
| **Recovered** | **299 (66%)** — 85 exact, 214 prefixed |
| Not present in this database | 154 |

### Recovery rate for the modules that matter

| Module | Called | Recovered | Rate |
|---|---:|---:|---:|
| **CoreExtension** | 31 | 29 | **94%** |
| **Hrm** | 56 | 47 | **84%** |
| **Attendance** | 36 | 28 | **78%** |
| **Payroll** | 36 | 25 | **69%** |
| Common | 28 | 22 | 79% |
| StaffExitProcess | 11 | 8 | 73% |
| **Leave** | 18 | 8 | **44%** |
| Appraisal | 28 | 14 | 50% |
| FixedAsset | 71 | 38 | 54% |
| Inventory | 35 | 19 | 54% |
| TravelOrder | 26 | **0** | **0%** |
| ProjectManagement / TaskManager / Security | 6 | 0 | 0% |

The 0% and 50-ish% modules are exactly the ones §4 shows were never adopted — their
procedures were never deployed to this customer's database. **The gaps are not losses; they
are evidence of non-use.**

### The procedures that unblock Payroll

All present:

| Procedure | Size | What it holds |
|---|---:|---|
| `attend_sp_MonthlySummaryDetails` | 77.3 KB | Monthly attendance summarisation |
| `payroll_sp_PostToTDS` | 40.5 KB | **Nepal income tax calculation** |
| `attend_sp_DetailAttendanceReport` | 38.2 KB | Attendance reporting logic |
| `payroll_sp_GenerateSalarySheet` | 33.3 KB | **The payroll run** |
| `payroll_sp_MonthlySalaryDeduction` | — | Deductions |
| `payroll_sp_EmployeeSalaryEligibility` | — | Who gets paid |
| `attend_sp_OverTimeCalc` | — | Overtime |
| `attend_sp_calc_UpdateOvertimeOnAttendanceLog` | — | Overtime posting |
| `Att_sp_GenerateAttendence` | — | Attendance generation |
| `Att_sp_SaveLeaveEntered` | — | **Leave → attendance effect** |
| `hrm_sp_GratuityProvisionDetail` | — | Gratuity |
| `leave_sp_LeaveProvisionDetail` | — | Leave provisioning |
| `Sp_Leave_LeaveAllocationCalculation` | — | Leave entitlement allocation |

**One notable absence: `sp_CalculateAttendance` is not in the database.** The daily
attendance calculation is implemented in `Nimble.Modules.Attendance.Services.dll` and
remains locked in IL. The surrounding procedures (generation, overtime, monthly summary)
are recovered, so the rule set is largely reconstructible, but the per-day calculation
itself is not directly readable. **INFERRED:** decompilation of that one assembly, or
behavioural comparison against the running legacy app, is the remaining route.

### A precision finding on currency

`payroll_sp_GenerateSalarySheet` declares its working variables as `NUMERIC(12,2)`:

```sql
DECLARE @Fval NUMERIC(12,2)
DECLARE @Tval NUMERIC(12,2)
DECLARE @TvalUnion NUMERIC(12,2)
```

**The calculation is decimal; the storage is float.** Defect D-1 is therefore narrower and
more tractable than the main report stated: rounding error enters at *persistence*, not
during computation. Migration can round to 2 dp at the transform boundary with reasonable
confidence that it recovers the intended value — but §7's reconciliation requirement stands.

---

## 6. The real navigation tree and permission matrix

Previously inferable only from route names. Now extracted: `menu_tree.csv` (1,012 rows) and
`permission_matrix.csv` (1,291 grants).

### The live permission matrix — all 10 roles

| Role | Type | Menus | View | Add | Edit | Delete | Print | FullAccess |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Admin It | Super Admin | 488 | 488 | 488 | 488 | 488 | 488 | 488 |
| Admin | Admin | 334 | 334 | 334 | 334 | 334 | 334 | 334 |
| **Payroll** | User | 149 | 149 | **0** | **0** | **0** | 0 | **149** |
| **CEO** | User | 149 | 149 | **0** | **0** | **0** | 149 | **149** |
| **Employee** | Employee | 56 | 56 | **55** | 15 | **15** | 56 | **56** |
| Account | User | 43 | 43 | 43 | 43 | 43 | 43 | 43 |
| Supervisor | Supervisor | 29 | 29 | 29 | 29 | 29 | 29 | 29 |
| Attendance | User | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| diauser | User | 0 | — | — | — | — | — | — |
| Super Admin | Super Admin | 0 | — | — | — | — | — | — |

Three findings, all new:

**P-1 — `FullAccess` contradicts the verb flags.** `Payroll` and `CEO` hold
`FullAccess = 1` on all 149 of their menus while `AllowAdd`, `AllowEdit` and `AllowDelete`
are all `0`. Either `FullAccess` overrides the verbs — in which case both roles have
unrestricted rights while the administration screen displays them as read-only — or it does
not, in which case the flag is meaningless. **INFERRED** that it overrides, from the name and
from its separate treatment in `routes.csv` (104 actions require `FullAccess` specifically).
Either way the matrix cannot be read correctly by the people administering it. **This is a
latent privilege-escalation surface hiding behind a misleading UI.**

**P-2 — the `Employee` self-service role is over-broad.** 56 menus with `FullAccess`,
`AllowAdd` on 55 and `AllowDelete` on 15. A self-service role should not hold delete rights
on fifteen screens.

**P-3 — two dead roles.** `diauser` and `Super Admin` hold zero grants. `Super Admin` being
empty while `Admin It` (also type Super Admin) holds 488 suggests role duplication that was
never cleaned up.

### Menu tree integrity — testing diagnosis B-1

| | |
|---|---:|
| Menu rows | 1,012 |
| Active | 1,008 |
| Rows whose `UnderMenuID` is null / `''` / `'0'` | **0** |
| Rows whose parent resolves | 992 |
| **Rows whose parent does not exist** | **20 (2%)** |

**This refines B-1 rather than confirming it.** Orphaned parent references do exist in
production — 20 of them — but production plainly worked, so the 20 are **INFERRED** to be
the tree's roots by some other convention (no row uses the null/empty/zero convention at
all). The catastrophic failure `_revive` hit was caused by the *mismatched 2016 seed*, not by
this pattern. The structural criticism stands — a self-referencing tree with no declared
root convention and no foreign key is fragile — but the main report overstated it as a
production outage.

### Diagnosis B-2 is disproved

`Menu.ForLoginMode` in production: **788 Admin (1), 159 Self-Service (2), 65 All (10)** —
correctly populated throughout. The "every row defaulted to 0" failure was an artifact of the
`_revive` reconstruction, **not a production defect.** Removed from the bug list.

### Module licensing is real and restrictive

**3 of 40 modules licensed; 19 installed; 9 live.** `_revive` listed licensing as a "likely"
secondary cause of its permission failure. Production confirms the mechanism is real and
actively gates the module list — and explains why the customer's usable surface was always a
fraction of the 7,805 actions shipped.

---

## 7. What this changes for the rebuild

### Scope — dramatically reduced, with evidence

The rebuild currently declares 14 functional modules. Production data says four of them are
the product:

| Priority | Module | Justification |
|---|---|---|
| 1 | **Attendance** | 1.74 M rows, 10 years, the dominant workload. 7 of 10 screens already built. |
| 2 | **Payroll** | 140 K rows, procedures recovered, the business's measure of success. Not started. |
| 3 | **HRM / Employees** | 324 K rows, 459 employees. 2 of 7 screens built. |
| 4 | **Leave** | 44 K rows. 7 of 9 screens built — **the most complete module replaces the fourth-largest workload.** |
| — | Everything else | ≤ 77 rows each. New development, not replacement. |

**RECOMMENDED — put the Milestone 6 module list to the business with §4's adoption table.**
Ten planned modules replace nothing. Deleting them from the roadmap, or explicitly
re-justifying them as new capability, is the cheapest scope decision available and it is now
evidence-backed.

### A correction to the rebuild's own priorities

Leave is the rebuild's most complete module (7 of 9 screens) and the *fourth* largest legacy
workload. Attendance is 39× larger by row count. This is not wasted work — leave policy is
where the legacy data model was most confused, and the rebuild's `nature` / `paidPercent` /
`lapseType` design fixes a real defect. But **the ordering was not driven by usage**, and
Payroll — the largest unbuilt gap — should not be deferred further.

### Leave requests were barely used online

`LeaveRequest` holds **25 rows**; `LeaveEntry` holds 3,629 and `LeaveDetail` 7,196.

Leave was recorded by HR as back-office entries, not submitted by employees through the
request workflow. This corroborates the finding that `SelfService` shipped as a stub (73
actions, 0 views). **The rebuild's self-service leave flow is new capability, not a
migration of an existing practice** — which means user adoption and training matter more
than fidelity to the old screens, and there is no legacy behaviour to be faithful to.

### Migration facts now known

| | |
|---|---|
| Employees to migrate | 459 (all-time; active subset to be determined) |
| Branches / departments | 52 / 19 |
| Roles | 10 (8 real, 2 dead) |
| Leave types | 11 |
| Salary heads | 31 |
| Attendance history | 10 years, ~1.74 M rows |
| Payroll history | `MonthlySalarySheet` 12,701 · `MonthlySalaryHead` 64,345 · `EmpTDSSheet` 50,822 |
| Total payload | 576 MB, 2.1 M rows |

This is a **small migration**. 2.1 M rows is a single overnight run, not a phased programme.
The open question is not feasibility but **how much attendance history to carry** — ten years
at 1.74 M rows is affordable to move and expensive to validate. **RECOMMENDED:** migrate
current + previous fiscal year in full, and archive the rest to a read-only reporting table
rather than into the live model.

---

## 8. Corrections to the Phase 0 report

| Section | Was | Now |
|---|---|---|
| §9 | 993 tables (from the EF model) | **705 deployed**, 465 of them empty |
| §9 | 89–99 FKs, inferred | **89 confirmed** against production |
| §12 S-08 | 453 procedures unrecoverable, SQL-injection risk unassessable | **299 recovered**; review now possible |
| §17 B-1 | Orphaned menu parents took production down | **20 orphans (2%) in production; the outage was `_revive`-specific** |
| §17 B-2 | `ForLoginMode = 0` is a production bug | **Disproved** — correct in production; a reconstruction artifact |
| §9 D-1 | Currency computed and stored as float | **Computed in `NUMERIC(12,2)`, stored as float** — narrower defect |
| §25 | `RESTORE … WITH RECOVERY, READ_ONLY` | `RESTORE … WITH RECOVERY`, then `ALTER DATABASE … SET READ_ONLY` |
| §25 M6 | "Re-rank once profiling shows which modules are used" | **Answered** — see §4 |
| New | — | **P-1** `FullAccess` contradicts verb flags (privilege surface) |
| New | — | **P-2** `Employee` role holds delete on 15 screens |
| New | — | Compatibility level 100 (SQL Server 2008) |
| New | — | 52 branches → **N-03 (no branch scoping) is a larger gap than assessed** |

---

## 9. Artefacts

All extraction output is at
`C:\Users\ashish\Downloads\hrms_Live_2022_06_28_08\_extract\` — 896 files, 4.3 MB:

| Path | Contents |
|---|---|
| `procedures/` | **643 stored procedure bodies** |
| `views/` | 165 view definitions |
| `functions/` | 84 scalar and table-valued functions |
| `index.csv` | every object with type, size, create and modify dates |
| `table_profile.csv` | all 705 tables with row counts, column counts and size |
| `menu_tree.csv` | the real 1,012-row navigation tree |
| `permission_matrix.csv` | 1,291 live permission grants across 10 roles |

**None of these contain employee data** — they are schema, code and configuration only, and
are safe to keep and to review. The restored database at `_restore\` (2.3 GB) does contain
real salary, bank and personal data and is set `READ_ONLY`.

> ### Housekeeping risk
>
> `C:\Users\ashish` is a git repository, and `Downloads\hrms_Live_2022_06_28_08\` is
> **untracked but not ignored**. A `git add -A` in your home directory would stage the
> 1.49 GB production backup and the 2.3 GB restore, both containing real HR data. This
> predates this work — the `.bak` was already there — but it should be fixed:
>
> ```
> Downloads/hrms_Live_2022_06_28_08/
> ```
>
> added to `C:\Users\ashish\.gitignore`.

---

## 10. Next steps

Milestone 0 is complete. Revised order:

1. **Put §4's adoption table to the business.** Ten planned modules replace nothing.
   This is the largest and cheapest scope decision available, and it gates Milestone 6.
2. **Read `payroll_sp_GenerateSalarySheet` and `payroll_sp_PostToTDS` in full**, and write
   the payroll rules down as a specification. This is now possible and was not before.
3. **Fix N-01** (`disableSignUp: true`) — unchanged, still cheap, still required before any
   external deployment.
4. **Design N-03 (branch scoping) now.** 52 branches makes this a confidentiality
   requirement, not a refinement.
5. **Review the 299 recovered procedures for dynamic SQL** (S-08) — now assessable.
6. **Decide the attendance history policy** (§7) before writing migration scripts.
7. **Optional, high value:** point `_revive\run.ps1` at `NIMBLE_LEGACY` to get a running
   reference implementation. Note this needs a *writable* copy — restore a second time
   without `READ_ONLY`, and expect module licensing (3 of 40) to gate what it will show.
