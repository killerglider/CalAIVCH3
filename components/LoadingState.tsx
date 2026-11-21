export function LoadingState({ label = "Loading workspace data" }: { label?: string }) {
  return (
    <div className="luxury-panel flex min-h-52 items-center justify-center gap-3 text-sm text-[#728188]">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#d7dcdd] border-t-[#a7823a]" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return <div className="border border-[#d9a8a3] bg-[#fff7f5] p-4 text-sm text-[#8e4138]">{message}</div>;
}
