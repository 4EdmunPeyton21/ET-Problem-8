export const EmptyState = ({ icon: Icon, title, hint, action }) => (
  <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
    {Icon && <Icon className="mb-4 size-10 text-muted" strokeWidth={1.5} />}
    <h3 className="text-lg font-medium text-ink">{title}</h3>
    {hint && <p className="mt-1.5 max-w-sm text-sm text-muted">{hint}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
