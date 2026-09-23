"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { saveCompanyAction, type MasterState } from "../masters/actions";

export type CompanyValues = {
  name: string;
  nameNepali: string | null;
  pan: string | null;
  address: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  defaultCalendar: "BS" | "AD";
};

const initial: MasterState = {};

/**
 * The organisation's own record — what appears on payslips, letters and the
 * header of every page. Read-only for anybody without structure rights, rather
 * than hidden: the PAN and address are things staff legitimately look up.
 */
export function CompanyForm({ values, canManage }: { values: CompanyValues; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveCompanyAction, initial);
  const err = (k: string) => state.fieldErrors?.[k];
  const disabled = !canManage;

  return (
    <form action={action}>
      <Card>
        <CardHeader
          title="Legal identity"
          description="As registered — it is printed on payslips, offer letters and statutory returns."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          {state.ok ? (
            <p className="flex items-center gap-1.5 rounded bg-ok-soft px-3 py-2 text-sm text-ok sm:col-span-2" role="status">
              <CheckCircle2 className="size-4" aria-hidden />
              {state.ok}
            </p>
          ) : null}
          {state.error ? (
            <p className="flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">
              <AlertCircle className="size-4" aria-hidden />
              {state.error}
            </p>
          ) : null}

          <Field label="Legal name" required error={err("name")} className="sm:col-span-2">
            <Input name="name" defaultValue={values.name} maxLength={160} required disabled={disabled} />
          </Field>
          <Field label="Name (Nepali)" error={err("nameNepali")} className="sm:col-span-2">
            <Input name="nameNepali" defaultValue={values.nameNepali ?? ""} maxLength={160} disabled={disabled} />
          </Field>
          <Field label="PAN" hint="Nine digits, issued by the Inland Revenue Department." error={err("pan")}>
            <Input
              name="pan"
              defaultValue={values.pan ?? ""}
              inputMode="numeric"
              maxLength={9}
              className="font-mono tracking-wider"
              disabled={disabled}
            />
          </Field>
          <Field label="Calendar shown first" hint="Dates are always stored in AD; this is what the UI leads with." error={err("defaultCalendar")}>
            <Select name="defaultCalendar" defaultValue={values.defaultCalendar} disabled={disabled}>
              <option value="BS">Bikram Sambat (BS)</option>
              <option value="AD">Gregorian (AD)</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Contact" description="The registered office, and where official correspondence goes." />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Registered address" error={err("address")} className="sm:col-span-2">
            <Input name="address" defaultValue={values.address ?? ""} maxLength={200} disabled={disabled} />
          </Field>
          <Field label="District" error={err("district")}>
            <Input name="district" defaultValue={values.district ?? ""} maxLength={60} disabled={disabled} />
          </Field>
          <Field label="Phone" error={err("phone")}>
            <Input name="phone" defaultValue={values.phone ?? ""} maxLength={20} disabled={disabled} />
          </Field>
          <Field label="Email" error={err("email")}>
            <Input name="email" type="email" defaultValue={values.email ?? ""} maxLength={160} disabled={disabled} />
          </Field>
          <Field label="Logo URL" hint="An https:// link to the logo used on printed documents." error={err("logoUrl")}>
            <Input name="logoUrl" type="url" defaultValue={values.logoUrl ?? ""} maxLength={500} disabled={disabled} />
          </Field>
        </div>
      </Card>

      {canManage ? (
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save company profile
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">Read-only — changing the company profile needs the “Manage organisation structure” permission.</p>
      )}
    </form>
  );
}
