import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { can, requirePermission } from "@/lib/session";
import { loadEmployeeFormOptions } from "@/lib/options";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const viewer = await requirePermission("hr.employee.create");
  const options = await loadEmployeeFormOptions(viewer.orgId);

  return (
    <>
      <Link
        href="/hr/employees"
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Employees
      </Link>
      <PageHeader
        title="Add employee"
        description="Dates accept Bikram Sambat or Gregorian — the two stay in step."
      />
      <EmployeeForm options={options} canSeeSalary={can(viewer, "hr.employee.viewSalary")} />
    </>
  );
}
