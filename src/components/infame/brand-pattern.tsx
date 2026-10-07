/** Approved Infame motif, shared by the public site and Talaqee platform shells. */
export function InfameBrandPattern({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const artwork = <div className="infame-story-art" aria-hidden="true" data-infame-brand-pattern>
    <span /><span /><span /><span className="infame-story-spark">✳</span>
  </div>;
  return compact ? <div className={`infame-brand-pattern-compact ${className}`} aria-hidden="true">{artwork}</div>
    : <div className={className}>{artwork}</div>;
}
