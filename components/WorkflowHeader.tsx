export function WorkflowHeader({
  step,
  eyebrow,
  title,
  description,
  meta,
}: {
  step: string;
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <div className="page-intro">
      <div className="page-intro-index">{step}</div>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display-title mt-3">{title}</h1>
        <p className="mt-4 max-w-2xl text-sm leading-7 text-[#61747c]">{description}</p>
      </div>
      {meta && <p className="page-intro-meta">{meta}</p>}
    </div>
  );
}
