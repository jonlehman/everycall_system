import Link from 'next/link';

function toneClass(tone) {
  if (tone === 'bad') return 'client-status bad';
  if (tone === 'ok') return 'client-status ok';
  if (tone === 'warn') return 'client-status warn';
  return 'client-status';
}

export default function ClientPage({ title, subtitle = '', status = null, primaryAction = null, children }) {
  const renderPrimaryAction = () => {
    if (!primaryAction) return null;
    const className = `btn${primaryAction.brand ? ' brand' : ''}`;
    if (primaryAction.onClick) {
      return (
        <button className={className} type="button" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
          {primaryAction.label}
        </button>
      );
    }
    return (
      <Link className={className} href={primaryAction.href}>
        {primaryAction.label}
      </Link>
    );
  };

  return (
    <section className="client-page">
      <div className="topbar">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p className="muted" style={{ margin: '4px 0 0' }}>{subtitle}</p> : null}
        </div>
        <div className="top-actions">
          {renderPrimaryAction()}
        </div>
      </div>

      {status?.message ? (
        <div className={toneClass(status.tone)}>
          {status.message}
        </div>
      ) : null}

      {children}
    </section>
  );
}
