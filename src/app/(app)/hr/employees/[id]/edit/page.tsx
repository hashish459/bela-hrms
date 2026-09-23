import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { can, requirePermission } from "@/lib/session";
import { loadEmployeeFormOptions } from "@/lib/options";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "../../employee-form";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: PageProps<"/hr/employees/[id]/edit">) {
  const viewer = await requirePermission("hr.employee.update");
  const { id } = await params;

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.orgId, viewer.orgId), isNull(employees.deletedAt)))
    .limit(1);

  if (!employee) notFound();
  const options = await loadEmployeeFormOptions(viewer.orgId);
  const canSeeSalary = can(viewer, "hr.employee.viewSalary");
  // Never serialise a figure to the browser that the viewer may not see; the
  // save action leaves salary untouched for them anyway.
  const defaults = canSeeSalary ? employee : { ...employee, basicSalary: null };

  return (
    <>
      <Link
        href={`/hr/employees/${id}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        {employee.firstName} {employee.lastName}
      </Link>
      <PageHeader title="Edit employee" description={employee.employeeCode} />
      <EmployeeForm employee={defaults} options={options} canSeeSalary={canSeeSalary} />
    </>
  );
}
