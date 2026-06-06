export type MetricGridItem = {
  label: string;
  value: string;
};

export function MetricGrid({
  metrics,
  columns = 'md:grid-cols-4',
}: {
  metrics: MetricGridItem[];
  columns?: string;
}) {
  return (
    <div className={`mt-3 grid grid-cols-2 gap-2 ${columns}`}>
      {metrics.map((metric) => (
        <div key={metric.label}>
          <p className="text-admin-2xs text-admin-muted">{metric.label}</p>
          <p className="admin-num text-admin-sm font-semibold text-admin-text">{metric.value}</p>
        </div>
      ))}
    </div>
  );
}
