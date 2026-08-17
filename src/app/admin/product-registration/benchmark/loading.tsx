export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="검수 화면 불러오는 중">
      <div className="h-10 w-72 rounded bg-admin-border" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[640px] rounded-admin-md bg-admin-border" />
        <div className="h-[640px] rounded-admin-md bg-admin-border" />
      </div>
    </div>
  );
}
