import { notFound } from "next/navigation";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";
import {
  documents,
  family,
  profile,
  qualifications,
  serviceHistory,
} from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";
import { adToBs, formatBs, todayInNepal } from "@/lib/bs";
import { Badge, Card, PageHeader, TableShell, Td, Th, Tr } from "@/components/ui";
import { Avatar, DeskTabs, Facts, Muted, Panel, PanelEmpty } from "../parts";

export const metadata = { title: "My profile" };

type Search = { [key: string]: string | string[] | undefined };

const TABS = ["overview", "service", "family", "education", "documents"] as const;
type Tab = (typeof TABS)[number];

/**
 * The employee's own record, in the five sections the manual describes.
 *
 * Read-only, and that is a decision rather than an omission. A self-service
 * screen that lets somebody edit their own bank account, PAN or date of joining
 * is a fraud surface; those fields are changed through HR with an audit trail.
 * What an employee may correct — contact details, family, qualifications — is a
 * request workflow, which belongs with the other request workflows and not on a
 * profile page pretending to be a form.
 */
export default async function MyProfilePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSelf("self.profile.view");
  const params = await searchParams;

  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "overview";

  const [me, history, kin, quals, docs] = await Promise.all([
    profile(ctx),
    serviceHistory(ctx),
    family(ctx),
    qualifications(ctx),
    documents(ctx),
  ]);

  if (!me) notFound();

  const e = me.employee;
  const today = todayInNepal();
  const expiring = docs.filter(
    (d) => d.expiresOn && d.expiresOn >= today && d.expiresOn <= addMonths(today, 3),
  );
  const expired = docs.filter((d) => d.expiresOn && d.expiresOn < today);

  const fullName = [e.firstName, e.middleName, e.lastName].filter(Boolean).join(" ");
  const serviceYears = yearsSince(e.dateOfJoin, today);

  return (
    <>
      <PageHeader
        title="My profile"
        description="Your record as HR holds it. Anything wrong here is corrected by HR, not on this page."
      />

      {/* ------------------------------------------------------------ identity */}
      <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
        <Avatar
          name={fullName}
          photoUrl={e.photoFileId ? `/api/files/${e.photoFileId}` : e.photoUrl}
          size={56}
        />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">{fullName}</p>
          {e.fullNameNepali ? (
            <p className="text-[13px] text-ink-soft">{e.fullNameNepali}</p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
            <span className="font-mono text-[11px] text-ink-faint">{e.employeeCode}</span>
            <span aria-hidden>·</span>
            <span>{me.designation ?? "—"}</span>
            <span aria-hidden>·</span>
            <span>{me.department ?? "—"}</span>
            <span aria-hidden>·</span>
            <span>{me.branch ?? "—"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={e.status === "active" ? "ok" : "warn"}>{e.status.replace(/_/g, " ")}</Badge>
          {me.employmentType ? <Badge tone="neutral">{me.employmentType}</Badge> : null}
          <Badge tone="accent">{serviceYears}</Badge>
        </div>
      </Card>

      {(expired.length > 0 || expiring.length > 0) && tab !== "documents" ? (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {expired.length > 0
            ? `${expired.length} of your documents ${expired.length === 1 ? "has" : "have"} expired.`
            : `${expiring.length} of your documents expire within three months.`}
        </p>
      ) : null}

      <DeskTabs
        active={`/me/profile${tab === "overview" ? "" : `?tab=${tab}`}`}
        items={[
          { href: "/me/profile", label: "Overview" },
          { href: "/me/profile?tab=service", label: "Job & service", count: history.length },
          { href: "/me/profile?tab=family", label: "Family", count: kin.length },
          { href: "/me/profile?tab=education", label: "Education & skills", count: quals.length },
          { href: "/me/profile?tab=documents", label: "Documents", count: docs.length },
        ]}
      />

      {/* ------------------------------------------------------------ overview */}
      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Personal" description="As recorded on your employee file">
            <Facts
              rows={[
                ["Full name", fullName],
                ["Name (Nepali)", e.fullNameNepali],
                ["Gender", <span key="g" className="capitalize">{e.gender}</span>],
                ["Marital status", e.maritalStatus ? <span className="capitalize">{e.maritalStatus}</span> : null],
                [
                  "Date of birth",
                  e.dateOfBirth ? (
                    <span className="tabular">
                      {formatBs(adToBs(e.dateOfBirth))} BS
                      <Muted> · {gregorian(e.dateOfBirth)}</Muted>
                    </span>
                  ) : null,
                ],
                ["District", e.district],
                ["Permanent address", e.permanentAddress],
                ["Current address", e.temporaryAddress],
              ]}
            />
          </Panel>

          <Panel title="Contact" description="Used for approvals, payslips and notices">
            <Facts
              rows={[
                ["Work email", e.workEmail],
                ["Personal email", e.personalEmail],
                ["Mobile", e.mobile],
                ["Emergency contact", e.emergencyContactName],
                ["Emergency number", e.emergencyContactPhone],
              ]}
            />
          </Panel>

          <Panel title="Employment" description="Placement and reporting line">
            <Facts
              rows={[
                ["Employee code", <span key="c" className="font-mono text-xs">{e.employeeCode}</span>],
                ["Designation", me.designation],
                ["Department", me.department],
                ["Branch", me.branch],
                ["Employment type", me.employmentType],
                ["Grade", me.grade],
                [
                  "Reports to",
                  me.supervisorName ? (
                    <>
                      {me.supervisorName}
                      <Muted> · {me.supervisorCode}</Muted>
                    </>
                  ) : (
                    <span className="text-warn">Not set — tell HR, approvals cannot route</span>
                  ),
                ],
                [
                  "Date of joining",
                  <span key="j" className="tabular">
                    {formatBs(adToBs(e.dateOfJoin))} BS<Muted> · {gregorian(e.dateOfJoin)}</Muted>
                  </span>,
                ],
                ["Confirmed on", e.confirmationDate ? gregorian(e.confirmationDate) : null],
                ["Length of service", serviceYears],
              ]}
            />
          </Panel>

          {/*
            Statutory identifiers are shown masked. An employee needs to confirm
            the number on file is theirs; nobody needs the whole of it rendered
            onto a screen in an open-plan office, and the legacy profile printed
            all four in full.
          */}
          <Panel
            title="Statutory"
            description="Partly masked — enough to check, not enough to copy"
            action={<ShieldCheck className="size-4 text-ink-faint" aria-hidden />}
          >
            <Facts
              rows={[
                ["PAN", mask(e.panNumber)],
                ["Citizenship", mask(e.citizenshipNumber)],
                ["SSF", mask(e.ssfNumber)],
                ["Provident fund", mask(e.pfNumber)],
                ["CIT", mask(e.citNumber)],
                ["Bank", e.bankName ? `${e.bankName}${e.bankBranch ? ` · ${e.bankBranch}` : ""}` : null],
                ["Account", mask(e.bankAccountNumber)],
              ]}
            />
          </Panel>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- service */}
      {tab === "service" ? (
        <Panel
          title="Service history"
          description="Every placement change, newest first. This is what payroll reads to answer what was true on a date."
        >
          {history.length === 0 ? (
            <PanelEmpty>No placement changes recorded.</PanelEmpty>
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Designation</Th>
                  <Th>Department</Th>
                  <Th>Branch</Th>
                  <Th>Grade</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.id}>
                    <Td className="tabular">{h.effectiveFrom}</Td>
                    <Td className="tabular">
                      {h.effectiveTo ?? <Badge tone="ok">current</Badge>}
                    </Td>
                    <Td className="text-ink">{h.designation ?? "—"}</Td>
                    <Td className="text-ink-soft">{h.department ?? "—"}</Td>
                    <Td className="text-ink-soft">{h.branch ?? "—"}</Td>
                    <Td className="text-ink-soft">{h.grade ?? "—"}</Td>
                    <Td className="text-xs text-ink-faint">{h.reason ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>
      ) : null}

      {/* -------------------------------------------------------------- family */}
      {tab === "family" ? (
        <Panel
          title="Family and dependants"
          description="Nominees are who a gratuity or death benefit is paid to. Keep this current with HR."
        >
          {kin.length === 0 ? (
            <PanelEmpty>No family details on file. HR can add them.</PanelEmpty>
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Relationship</Th>
                  <Th>Date of birth</Th>
                  <Th>Occupation</Th>
                  <Th>Contact</Th>
                  <Th>Flags</Th>
                </tr>
              </thead>
              <tbody>
                {kin.map((f) => (
                  <Tr key={f.id}>
                    <Td className="font-medium text-ink">{f.fullName}</Td>
                    <Td className="text-ink-soft capitalize">{f.relationship.replace(/_/g, " ")}</Td>
                    <Td className="tabular text-ink-soft">
                      {f.dateOfBirth ? gregorian(f.dateOfBirth) : "—"}
                    </Td>
                    <Td className="text-ink-soft">{f.occupation ?? "—"}</Td>
                    <Td className="tabular text-ink-soft">{f.contactNumber ?? "—"}</Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {f.isNominee ? (
                          <Badge tone="accent">
                            nominee{f.nomineeSharePercent ? ` ${f.nomineeSharePercent}%` : ""}
                          </Badge>
                        ) : null}
                        {f.isDependant ? <Badge tone="info">dependant</Badge> : null}
                        {f.isEmergencyContact ? <Badge tone="warn">emergency</Badge> : null}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>
      ) : null}

      {/* ----------------------------------------------------------- education */}
      {tab === "education" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["education", "certification", "training", "skill", "language"] as const).map((kind) => {
            const items = quals.filter((q) => q.kind === kind);
            if (items.length === 0) return null;
            return (
              <Panel key={kind} title={KIND_LABEL[kind]}>
                <ul className="divide-y divide-line-soft">
                  {items.map((q) => (
                    <li key={q.id} className="px-4 py-2.5">
                      <p className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium text-ink">{q.title}</span>
                        {q.completedYear ? (
                          <span className="tabular text-[11px] text-ink-faint">
                            {q.completedYear}
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {q.institution ?? <Muted>—</Muted>}
                        {q.result ? <span className="text-ink-faint"> · {q.result}</span> : null}
                      </p>
                      {q.expiresOn ? (
                        <p
                          className={`mt-1 text-[11px] ${q.expiresOn < today ? "text-danger" : "text-ink-faint"}`}
                        >
                          {q.expiresOn < today ? "Expired" : "Valid until"} {gregorian(q.expiresOn)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
          {quals.length === 0 ? (
            <Panel title="Education and skills">
              <PanelEmpty>Nothing recorded. Send your certificates to HR to have them added.</PanelEmpty>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {/* ----------------------------------------------------------- documents */}
      {tab === "documents" ? (
        <Panel
          title="My documents"
          description="Documents on your personnel file that are shared with you. Some HR records are not."
        >
          {docs.length === 0 ? (
            <PanelEmpty>No documents shared with you.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {docs.map((d) => {
                const isExpired = d.expiresOn ? d.expiresOn < today : false;
                const isExpiring =
                  d.expiresOn && !isExpired ? d.expiresOn <= addMonths(today, 3) : false;
                return (
                  <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded bg-sunk text-ink-soft">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {d.title}
                      </span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        <span className="capitalize">{d.kind.replace(/_/g, " ")}</span>
                        {d.referenceNumber ? ` · ${d.referenceNumber}` : ""}
                        {d.issuedOn ? ` · issued ${gregorian(d.issuedOn)}` : ""}
                      </span>
                    </span>
                    {d.expiresOn ? (
                      <Badge tone={isExpired ? "danger" : isExpiring ? "warn" : "neutral"}>
                        {isExpired ? "expired" : "expires"} {gregorian(d.expiresOn)}
                      </Badge>
                    ) : null}
                    {d.status === "rejected" ? (
                      <Badge tone="danger" className="max-w-52 truncate">
                        {d.reviewNote ? `rejected — ${d.reviewNote}` : "rejected"}
                      </Badge>
                    ) : d.status === "verified" ? (
                      <Badge tone="ok">verified</Badge>
                    ) : null}
                    {d.fileId ?? d.fileUrl ? (
                      <a
                        href={d.fileId ? `/api/files/${d.fileId}` : (d.fileUrl as string)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-sunk hover:text-ink"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="shrink-0 text-[11px] text-ink-faint">no file</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  education: "Education",
  certification: "Certifications",
  training: "Training",
  skill: "Skills",
  language: "Languages",
};

/** Shows enough of an identifier to recognise it, not enough to reuse it. */
function mask(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function gregorian(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function yearsSince(iso: string, today: string): string {
  const from = new Date(iso);
  const to = new Date(today);
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years <= 0 && months <= 0) return "Joined this month";
  if (years <= 0) return `${months} month${months === 1 ? "" : "s"} of service`;
  return `${years}y ${months}m of service`;
}
