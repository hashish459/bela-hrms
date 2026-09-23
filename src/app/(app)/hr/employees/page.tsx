import Link from "next/link";
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { branches, departments, designations } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { adToBs, formatBsKey } from "@/lib/bs";
import { formatNpr } from "@/lib/utils";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { Avatar } from "@/components/avatar";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { EmployeeFilters } from "./filters";

export const metadata = { title: "Employees" };


export default async function EmployeesPage({ searchParams }: PageProps<"/hr/employees">) {
  const viewer = await requirePermission("hr.employee.view");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const dept = typeof params.dept === "string" ? params.dept : "";
  const status = typeof params.status === "string" ? params.status : "employed";
  // The total is needed before the page can be resolved: a page number past the
  // end must land on the last page, not on an empty table. The old code trusted
  // `?page=999` and rendered nothing, which reads as "no employees".
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;

  const filters: SQL[] = [eq(employees.orgId, viewer.orgId)];

  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(
        ilike(employees.firstName, like),
        ilike(employees.lastName, like),
        ilike(employees.employeeCode, like),
        ilike(employees.workEmail, like),
      )!,
    );
  }
  if (dept) filters.push(eq(employees.departmentId, dept));
  if (status === "employed") filters.push(inArray(employees.status, [...EMPLOYED_STATUSES]));
  else if (status && status !== "all") {
    filters.push(eq(employees.status, status as (typeof employees.status.enumValues)[number]));
  }

  const where = and(...filters);

  const [total] = await db.select({ n: count() }).from(employees).where(where);

  const page = offsetPage({
    page: pageParam,
    total: Number(total.n),
    defaultSize: PAGE_SIZE.compact,
  });
  const pageSize = page.limit;
  const pageOffset = page.offset;

  const [rows, deptOptions] = await Promise.all([
    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        nameNepali: employees.fullNameNepali,
        photoFileId: employees.photoFileId,
        photoUrl: employees.photoUrl,
        status: employees.status,
        dateOfJoin: employees.dateOfJoin,
        basicSalary: employees.basicSalary,
        department: departments.name,
        designation: designations.name,
        branch: branches.name,
        supervisor: sql<string | null>`sup.first_name || ' ' || sup.last_name`,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(branches, eq(branches.id, employees.branchId))
      .leftJoin(sql`employees sup`, sql`sup.id = ${employees.supervisorId}`)
      .where(where)
      .orderBy(asc(employees.employeeCode))
      .limit(pageSize)
      .offset(pageOffset),

    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.orgId, viewer.orgId))
      .orderBy(asc(departments.name)),
  ]);

  const showSalary = can(viewer, "hr.employee.viewSalary");

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${total.n} matching ${Number(total.n) === 1 ? "record" : "records"}`}
        action={
          can(viewer, "hr.employee.create") ? (
            <ButtonLink href="/hr/employees/new">
              <Plus className="size-4" />
              Add employee
            </ButtonLink>
          ) : null
        }
      />

      <EmployeeFilters departments={deptOptions} />

      <div className="mt-4">
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              title="No employees match these filters"
              hint="Try clearing the search box or switching the status filter to All."
            />
          </Card>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Designation</Th>
                <Th>Department</Th>
                <Th>Branch</Th>
                <Th>Reports to</Th>
                <Th>Joined (BS)</Th>
                {showSalary ? <Th className="text-right">Basic</Th> : null}
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono text-xs text-ink-soft">{e.code}</Td>
                  <Td>
                    <Link
                      href={`/hr/employees/${e.id}`}
                      className="flex items-center gap-2 font-medium text-ink hover:text-accent"
                    >
                      <Avatar
                        photoId={e.photoFileId}
                        photoUrl={e.photoUrl}
                        firstName={e.firstName}
                        lastName={e.lastName}
                        seed={e.id}
                        size="sm"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {e.firstName} {e.lastName}
                        </span>
                        {e.nameNepali ? (
                          <span className="block truncate text-xs font-normal text-ink-faint">
                            {e.nameNepali}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{e.designation ?? "—"}</Td>
                  <Td className="text-ink-soft">{e.department ?? "—"}</Td>
                  <Td className="text-ink-soft">{e.branch ?? "—"}</Td>
                  <Td className="text-ink-soft">{e.supervisor ?? "—"}</Td>
                  <Td className="tabular text-ink-soft">
                    {formatBsKey(adToBs(e.dateOfJoin))}
                  </Td>
                  {showSalary ? (
                    <Td className="tabular text-right text-ink-soft">
                      {formatNpr(e.basicSalary)}
                    </Td>
                  ) : null}
                  <Td>
                    <StatusBadge value={e.status} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>

      <OffsetPagination
        page={page}
        params={params}
        label="employees"
        className="mt-3 rounded-md border border-line bg-surface"
      />

    </>
  );
}
