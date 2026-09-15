"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { saveEmployee, type EmployeeFormState } from "./actions";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";

export type Option = { id: string; name: string };

export type EmployeeDefaults = Partial<{
  id: string;
  employeeCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  fullNameNepali: string | null;
  gender: string;
  maritalStatus: string | null;
  dateOfBirth: string | null;
  workEmail: string | null;
  mobile: string | null;
  district: string | null;
  permanentAddress: string | null;
  branchId: string | null;
  departmentId: string | null;
  designationId: string | null;
  employmentTypeId: string | null;
  gradeId: string | null;
  supervisorId: string | null;
  status: string;
  dateOfJoin: string;
  confirmationDate: string | null;
  separationDate: string | null;
  panNumber: string | null;
  ssfNumber: string | null;
  pfNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  basicSalary: string | null;
}>;

const initial: EmployeeFormState = { ok: false };

export function EmployeeForm({
  employee,
  options,
  canSeeSalary,
}: {
  employee?: EmployeeDefaults;
  options: {
    branches: Option[];
    departments: Option[];
    designations: Option[];
    employmentTypes: Option[];
    grades: Option[];
    supervisors: Option[];
  };
  canSeeSalary: boolean;
}) {
  const router = useRouter();
  const employeeId = employee?.id ?? null;
  const [state, action, pending] = useActionState(
    saveEmployee.bind(null, employeeId),
    initial,
  );

  useEffect(() => {
    if (state.ok && state.employeeId && !employeeId) {
      router.push(`/hr/employees/${state.employeeId}`);
    }
  }, [state, employeeId, router]);

  const err = (name: string) => state.fieldErrors?.[name];

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.message ? (
        <p
          className={`flex items-start gap-1.5 rounded px-3 py-2 text-sm ${
            state.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
          }`}
        >
          {state.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          )}
          {state.message}
        </p>
      ) : null}

      <Card>
        <CardHeader title="Identity" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee code" required error={err("employeeCode")}>
            <Input
              name="employeeCode"
              defaultValue={employee?.employeeCode ?? ""}
              placeholder="EMP025"
              className="font-mono"
            />
          </Field>
          <Field label="First name" required error={err("firstName")}>
            <Input name="firstName" defaultValue={employee?.firstName ?? ""} />
          </Field>
          <Field label="Middle name" error={err("middleName")}>
            <Input name="middleName" defaultValue={employee?.middleName ?? ""} />
          </Field>
          <Field label="Last name" required error={err("lastName")}>
            <Input name="lastName" defaultValue={employee?.lastName ?? ""} />
          </Field>
          <Field
            label="Full name (Nepali)"
            hint="Appears on payslips and official letters"
            error={err("fullNameNepali")}
          >
            <Input name="fullNameNepali" defaultValue={employee?.fullNameNepali ?? ""} />
          </Field>
          <Field label="Gender" required error={err("gender")}>
            <Select name="gender" defaultValue={employee?.gender ?? "male"}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Marital status" error={err("maritalStatus")}>
            <Select name="maritalStatus" defaultValue={employee?.maritalStatus ?? ""}>
              <option value="">Not recorded</option>
              <option value="single">Single</option>
              <option value="married">Married</option>
              <option value="divorced">Divorced</option>
              <option value="widowed">Widowed</option>
            </Select>
          </Field>
          <BsDateField
            name="dateOfBirth"
            label="Date of birth"
            defaultValue={employee?.dateOfBirth ?? ""}
            error={err("dateOfBirth")}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Work email" error={err("workEmail")}>
            <Input name="workEmail" type="email" defaultValue={employee?.workEmail ?? ""} />
          </Field>
          <Field label="Mobile" error={err("mobile")}>
            <Input name="mobile" defaultValue={employee?.mobile ?? ""} placeholder="98XXXXXXXX" />
          </Field>
          <Field label="District" error={err("district")}>
            <Input name="district" defaultValue={employee?.district ?? ""} />
          </Field>
          <Field label="Permanent address" className="sm:col-span-2 lg:col-span-3">
            <Textarea name="permanentAddress" defaultValue={employee?.permanentAddress ?? ""} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Placement" description="Drives approval routing and reporting" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Branch" error={err("branchId")}>
            <Select name="branchId" defaultValue={employee?.branchId ?? ""}>
              <option value="">Not assigned</option>
              {options.branches.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" error={err("departmentId")}>
            <Select name="departmentId" defaultValue={employee?.departmentId ?? ""}>
              <option value="">Not assigned</option>
              {options.departments.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Designation" error={err("designationId")}>
            <Select name="designationId" defaultValue={employee?.designationId ?? ""}>
              <option value="">Not assigned</option>
              {options.designations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employment type" error={err("employmentTypeId")}>
            <Select name="employmentTypeId" defaultValue={employee?.employmentTypeId ?? ""}>
              <option value="">Not assigned</option>
              {options.employmentTypes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grade" error={err("gradeId")}>
            <Select name="gradeId" defaultValue={employee?.gradeId ?? ""}>
              <option value="">Not assigned</option>
              {options.grades.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Reports to"
            hint="Leave requests route to this person first"
            error={err("supervisorId")}
          >
            <Select name="supervisorId" defaultValue={employee?.supervisorId ?? ""}>
              <option value="">No supervisor</option>
              {options.supervisors
                .filter((s) => s.id !== employeeId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Service" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Status" required error={err("status")}>
            <Select name="status" defaultValue={employee?.status ?? "probation"}>
              <option value="probation">Probation</option>
              <option value="active">Active</option>
              <option value="on_leave">On leave</option>
              <option value="suspended">Suspended</option>
              <option value="resigned">Resigned</option>
              <option value="terminated">Terminated</option>
              <option value="retired">Retired</option>
            </Select>
          </Field>
          <BsDateField
            name="dateOfJoin"
            label="Date of join"
            required
            defaultValue={employee?.dateOfJoin ?? ""}
            error={err("dateOfJoin")}
          />
          <BsDateField
            name="confirmationDate"
            label="Confirmation date"
            defaultValue={employee?.confirmationDate ?? ""}
            error={err("confirmationDate")}
          />
          <BsDateField
            name="separationDate"
            label="Separation date"
            defaultValue={employee?.separationDate ?? ""}
            error={err("separationDate")}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Statutory & payment" description="PAN, SSF and provident fund identifiers" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="PAN" error={err("panNumber")}>
            <Input name="panNumber" defaultValue={employee?.panNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="SSF number" error={err("ssfNumber")}>
            <Input name="ssfNumber" defaultValue={employee?.ssfNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Provident fund number" error={err("pfNumber")}>
            <Input name="pfNumber" defaultValue={employee?.pfNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Bank" error={err("bankName")}>
            <Input name="bankName" defaultValue={employee?.bankName ?? ""} />
          </Field>
          <Field label="Bank account" error={err("bankAccountNumber")}>
            <Input
              name="bankAccountNumber"
              defaultValue={employee?.bankAccountNumber ?? ""}
              className="font-mono"
            />
          </Field>
          {canSeeSalary ? (
            <Field label="Basic salary (NPR)" error={err("basicSalary")}>
              <Input
                name="basicSalary"
                inputMode="decimal"
                defaultValue={employee?.basicSalary ?? ""}
                className="tabular"
              />
            </Field>
          ) : (
            <input type="hidden" name="basicSalary" value={employee?.basicSalary ?? ""} />
          )}
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {employeeId ? "Save changes" : "Add employee"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
