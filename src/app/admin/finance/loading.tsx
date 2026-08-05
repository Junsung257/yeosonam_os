export default function FinanceCenterLoading() {
  return (
    <div className="space-y-5" role="status" aria-label="정산센터 불러오는 중">
      <div className="h-28 animate-pulse rounded-admin-lg bg-admin-surface-2" />
      <div className="h-12 animate-pulse rounded-admin-md bg-admin-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[...Array(5)].map((_, index) => <div key={index} className="h-28 animate-pulse rounded-admin-md bg-admin-surface-2" />)}
      </div>
    </div>
  );
}
