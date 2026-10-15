/**
 * Who holds the case: a named official (name + hall email) or the office pool.
 * Residents use this to know who to contact; staff use it to see if the case
 * is still unassigned to a person.
 */
export function CaseOwner({
  official,
  empty,
  compact = false,
}: {
  official: { firstName: string; lastName: string; email: string } | null | undefined;
  empty: string;
  /** One line for tables; stacked name + mailto for the case sheet. */
  compact?: boolean;
}) {
  if (!official) {
    return <span className="text-ink-muted">{empty}</span>;
  }

  const name = `${official.firstName} ${official.lastName}`.trim();
  const mail = (
    <a
      href={`mailto:${official.email}`}
      className="font-normal text-brand-700 hover:underline"
    >
      {official.email}
    </a>
  );

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
