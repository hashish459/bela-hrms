"use client";

import { Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import type { FieldDef } from "@/modules/people/profile-fields";

type Value = string | number | boolean | null | undefined;

/**
 * Renders a personnel-file section from its definition. The same definition the
 * server validates against, so a field cannot appear on the form without the
 * service knowing what to do with it.
 */
export function SectionFields({
  fields,
  values = {},
  errors = {},
}: {
  fields: FieldDef[];
  values?: Record<string, Value>;
  errors?: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const value = values[f.name];
        const error = errors[f.name];

        if (f.type === "checkbox") {
          return (
            <label key={f.name} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                name={f.name}
                defaultChecked={value === true}
                className="size-4 rounded border-line accent-[var(--color-accent)]"
              />
              {f.label}
            </label>
          );
        }

        if (f.type === "date") {
          return (
            <BsDateField
              key={f.name}
              name={f.name}
              label={f.label}
              required={f.required}
              defaultValue={typeof value === "string" ? value : ""}
              error={error}
              hint={f.hint}
            />
          );
        }

        const wide = f.type === "textarea";
        return (
          <Field
            key={f.name}
            label={f.label}
            required={f.required}
            error={error}
            hint={f.hint}
            className={wide ? "sm:col-span-2" : undefined}
          >
            {f.type === "select" ? (
              <Select name={f.name} defaultValue={value == null ? "" : String(value)}>
                <option value="">{f.required ? "Select…" : "Not recorded"}</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "textarea" ? (
              <Textarea name={f.name} defaultValue={value == null ? "" : String(value)} maxLength={f.max} />
            ) : (
              <Input
                name={f.name}
                type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}
                defaultValue={value == null ? "" : String(value)}
                maxLength={f.max}
                inputMode={f.type === "number" ? "numeric" : undefined}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
