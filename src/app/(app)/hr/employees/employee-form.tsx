"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { saveEmployee, type EmployeeFormState } from "./actions";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { BLOOD_GROUPS } from "@/modules/people/profile-fields";
import { PhotoUpload } from "./[id]/photo-upload";
import { PhotoPicker } from "./photo-picker";

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
  personalEmail: string | null;
  mobile: string | null;
  district: string | null;
  permanentAddress: string | null;
  temporaryAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  bloodGroup: string | null;
  nationality: string | null;
  religion: string | null;
  citizenshipNumber: string | null;
  passportNumber: string | null;
  citNumber: string | null;
  bankBranch: string | null;
  probationEndDate: string | null;
  noticePeriodDays: number | null;
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
  photoFileId: string | null;
  photoUrl: string | null;
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
        <CardHeader
          title="Identity"
          description={employeeId ? "The photograph saves as soon as you choose it." : "The photograph is saved with the new record."}
        />
        <div className="flex flex-col gap-4 p-4 md:flex-row">
          <div className="flex shrink-0 justify-center md:w-36 md:border-r md:border-line-soft md:pr-4">
            {employeeId ? (
              <PhotoUpload
                employeeId={employeeId}
                photoId={employee?.photoFileId ?? null}
                photoUrl={employee?.photoUrl ?? null}
                firstName={employee?.firstName ?? ""}
                lastName={employee?.lastName ?? ""}
                canEdit
              />
            ) : (
              <PhotoPicker error={err("photo")} />
            )}
          </div>
        <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Field label="Blood group" error={err("bloodGroup")}>
            <Select name="bloodGroup" defaultValue={employee?.bloodGroup ?? ""}>
              <option value="">Not recorded</option>
              {BLOOD_GROUPS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nationality" error={err("nationality")}>
            <Input name="nationality" defaultValue={employee?.nationality ?? "Nepali"} />
          </Field>
          <Field label="Religion" error={err("religion")}>
            <Input name="religion" defaultValue={employee?.religion ?? ""} />
          </Field>
        </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Work email" error={err("workEmail")}>
            <Input name="workEmail" type="email" defaultValue={employee?.workEmail ?? ""} />
          </Field>
          <Field label="Personal email" error={err("personalEmail")}>
            <Input name="personalEmail" type="email" defaultValue={employee?.personalEmail ?? ""} />
          </Field>
          <Field label="Mobile" error={err("mobile")}>
            <Input name="mobile" defaultValue={employee?.mobile ?? ""} placeholder="98XXXXXXXX" />
          </Field>
          <Field label="District" error={err("district")}>
            <Input name="district" defaultValue={employee?.district ?? ""} />
          </Field>
          <Field label="Current address" className="sm:col-span-2 lg:col-span-3">
            <Textarea name="temporaryAddress" defaultValue={employee?.temporaryAddress ?? ""} />
          </Field>
          <Field label="Permanent address" className="sm:col-span-2 lg:col-span-3">
            <Textarea name="permanentAddress" defaultValue={employee?.permanentAddress ?? ""} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Emergency contact" description="Who to call if something happens at work" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" error={err("emergencyContactName")}>
            <Input name="emergencyContactName" defaultValue={employee?.emergencyContactName ?? ""} />
          </Field>
          <Field label="Relationship" error={err("emergencyContactRelation")}>
            <Input name="emergencyContactRelation" defaultValue={employee?.emergencyContactRelation ?? ""} />
          </Field>
          <Field label="Phone" error={err("emergencyContactPhone")}>
            <Input name="emergencyContactPhone" defaultValue={employee?.emergencyContactPhone ?? ""} />
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
            name="probationEndDate"
            label="Probation ends"
            defaultValue={employee?.probationEndDate ?? ""}
            error={err("probationEndDate")}
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
            hint="Normally written by completing a separation"
            defaultValue={employee?.separationDate ?? ""}
            error={err("separationDate")}
          />
          <Field label="Notice period (days)" error={err("noticePeriodDays")}>
            <Input
              name="noticePeriodDays"
              inputMode="numeric"
              defaultValue={employee?.noticePeriodDays ?? ""}
              className="tabular"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Statutory & payment" description="PAN, SSF and provident fund identifiers" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="PAN" error={err("panNumber")}>
            <Input name="panNumber" defaultValue={employee?.panNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Citizenship number" error={err("citizenshipNumber")}>
            <Input name="citizenshipNumber" defaultValue={employee?.citizenshipNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Passport number" error={err("passportNumber")}>
            <Input name="passportNumber" defaultValue={employee?.passportNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="SSF number" error={err("ssfNumber")}>
            <Input name="ssfNumber" defaultValue={employee?.ssfNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Provident fund number" error={err("pfNumber")}>
            <Input name="pfNumber" defaultValue={employee?.pfNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="CIT number" error={err("citNumber")}>
            <Input name="citNumber" defaultValue={employee?.citNumber ?? ""} className="font-mono" />
          </Field>
          <Field label="Bank" error={err("bankName")}>
            <Input name="bankName" defaultValue={employee?.bankName ?? ""} />
          </Field>
          <Field label="Bank branch" error={err("bankBranch")}>
            <Input name="bankBranch" defaultValue={employee?.bankBranch ?? ""} />
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
          ) : null}
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
