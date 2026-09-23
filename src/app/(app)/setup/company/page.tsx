import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "./company-form";

export const metadata = { title: "Company profile" };

export default async function CompanyProfilePage() {
  const viewer = await requirePermission("setup.structure.view");

  const active = (t: { orgId: PgColumn; isActive: PgColumn }) => and(eq(t.orgId, viewer.orgId), eq(t.isActive, true));

  const [[org], [b], [d], [dg], [g], [et], [staff]] = await Promise.all([
    db.select().from(organizations).where(eq(organizations.id, viewer.orgId)).limit(1),
    db.select({ n: count() }).from(branches).where(active(branches)),
    db.select({ n: count() }).from(departments).where(active(departments)),
    db.select({ n: count() }).from(designations).where(active(designations)),
    db.select({ n: count() }).from(grades).where(active(grades)),
    db.select({ n: count() }).from(employmentTypes).where(active(employmentTypes)),
    db
      .select({ n: count() })
      .from(employees)
      .where(and(eq(employees.orgId, viewer.orgId), inArray(employees.status, [...EMPLOYED_STATUSES]))),
  ]);

  const glance = [
    { label: "People employed", value: staff.n, href: "/hr/employees" },
    { label: "Branches", value: b.n, href: "/setup/branches" },
    { label: "Departments", value: d.n, href: "/setup/departments" },
    { label: "Designations", value: dg.n, href: "/setup/designations" },
    { label: "Grades", value: g.n, href: "/setup/grades" },
    { label: "Employment types", value: et.n, href: "/setup/employment-types" },
  ];

  return (
    <>
      <PageHeader
        title="Company profile"
        description="The organisation's own record, and a map of the structure hanging off it."
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {glance.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-accent hover:bg-accent-soft/40"
          >
            <p className="tabular text-xl font-semibold text-ink">{item.value}</p>
            <p className="text-xs text-ink-faint">{item.label}</p>
          </Link>
        ))}
      </div>

      <div className="max-w-3xl">
        <CompanyForm
          canManage={can(viewer, "setup.structure.manage")}
          values={{
            name: org.name,
            nameNepali: org.nameNepali,
            pan: org.pan,
            address: org.address,
            district: org.district,
            phone: org.phone,
            email: org.email,
            logoUrl: org.logoUrl,
            defaultCalendar: org.defaultCalendar,
          }}
        />
      </div>
    </>
  );
}
