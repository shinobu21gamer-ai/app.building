export function FaqList({
  items,
  limit,
}: {
  items: readonly { question: string; answer: string }[];
  limit?: number;
}) {
  const visible = limit ? items.slice(0, limit) : items;

  return (
    <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {visible.map((item) => (
        <details key={item.question} className="group px-5 py-1">
          <summary className="cursor-pointer list-none py-3 text-sm font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-start justify-between gap-3">
              {item.question}
              <span
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-slate-400 transition-transform group-open:rotate-45"
              >
                +
              </span>
            </span>
          </summary>
          <p className="pb-4 text-sm leading-relaxed text-ink-muted group-open:animate-fade-in">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
