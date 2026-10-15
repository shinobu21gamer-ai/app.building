/**
 * Who holds the case: a named official (name + hall email) or the office
 * contact. Residents use this to know who to email if something happens.
 */

export function contactHref(contact: string): string | null {
  const trimmed = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }
  const dialable = trimmed.replace(/[\s().-]/g, "");
  if (/^\+?\d{5,}$/.test(dialable)) return `tel:${dialable}`;
  return null;
}

export type CaseOfficial = {
  firstName: string;
  lastName: string;
  email: string;
} | null | undefined;

export type CaseOffice = {
  name: string;
  contact: string | null;
  headOfficer: string | null;
} | null | undefined;

function LinkedContact({ value }: { value: string }) {
  const href = contactHref(value);
  if (!href) {
    return <span className="break-words font-medium text-ink">{value}</span>;
  }
  return (
    <a
      href={href}
      className="break-all font-normal text-brand-700 hover:underline"
    >
      {value}
    </a>
  );
}

export function CaseOwner({
  official,
  office,
  empty,
  compact = false,
}: {
  official: CaseOfficial;
  office?: CaseOffice;
  empty: string;
  compact?: boolean;
}) {
  if (official) {
    const name = `${official.firstName} ${official.lastName}`.trim();
    const mail = <LinkedContact value={official.email} />;
    if (compact) {
      return (
        <span className="text-ink">
          <span className="font-medium">{name}</span>
          <span className="text-ink-subtle"> · </span>
          {mail}
        </span>
      );
    }
    return (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{name}</span>
        {mail}
      </span>
    );
  }

  if (office?.contact) {
    const contact = <LinkedContact value={office.contact} />;
    if (compact) {
      return (
        <span className="text-ink">
          <span className="font-medium">{office.name}</span>
          <span className="text-ink-subtle"> · </span>
          {contact}
        </span>
      );
    }
    return (
      <span className="flex flex-col">
        <span className="font-medium text-ink">{office.name}</span>
        {contact}
      </span>
    );
  }

  return <span className="text-ink-muted">{empty}</span>;
}

/** Prominent “who to email” block after a resident files, and on the case sheet. */
export function CaseContactCard({
  official,
  office,
  title,
  lead,
  officialLabel,
  officeLabel,
  headLabel,
  empty,
}: {
  official: CaseOfficial;
  office: CaseOffice;
  title: string;
  lead: string;
  officialLabel: string;
  officeLabel: string;
  headLabel: string;
  empty: string;
}) {
  return (
    <div className="rounded-card border border-brand-100 bg-brand-50 p-4">
      <p className="text-sm font-semibold text-brand-950">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-brand-900">{lead}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-brand-800">
            {officialLabel}
          </dt>
          <dd className="mt-0.5">
            <CaseOwner official={official} office={null} empty={empty} />
          </dd>
        </div>
        {office ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-brand-800">
              {officeLabel}
            </dt>
            <dd className="mt-0.5 flex flex-col text-brand-950">
              <span className="font-medium">{office.name}</span>
              {office.headOfficer ? (
                <span className="text-xs text-brand-800">
                  {headLabel.replace("{name}", office.headOfficer)}
                </span>
              ) : null}
              {office.contact ? (
                <LinkedContact value={office.contact} />
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
