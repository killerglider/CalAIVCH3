export function LoadingState({ label = "Loading workspace data" }: { label?: string }) {
  return (
    <div className="card flex min-h-40 items-center justify-center gap-3 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-amber-500" />
      {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</div>;
}
