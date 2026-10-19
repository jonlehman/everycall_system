'use client';
import { displayStatus } from './salesApi';

export function Card({ children, className = '' }) {
  return (
    <section className={`min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function StatusPill({ status, tone }) {
  const normalized = String(status || '').toLowerCase();
  let colors = 'border-slate-200 bg-slate-50 text-slate-700';
  if (tone === 'good' || ['ready', 'demo_ready', 'connected', 'completed', 'account_ready'].includes(normalized)) {
    colors = 'border-emerald-200 bg-emerald-50 text-emerald-800';
  } else if (tone === 'bad' || ['failed', 'error', 'blocked', 'suppressed', 'attention_required'].includes(normalized)) {
    colors = 'border-red-200 bg-red-50 text-red-700';
  } else if (tone === 'warn' || ['preparing', 'queued', 'pending', 'dialing'].includes(normalized)) {
    colors = 'border-amber-200 bg-amber-50 text-amber-800';
  } else if (tone === 'blue' || ['live', 'ai_live', 'prospect_connected'].includes(normalized)) {
    colors = 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return (
    <span className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${colors}`}>
      <span className="truncate">{displayStatus(status)}</span>
    </span>
  );
}

export function ActionButton({
  ariaPressed,
  children,
  disabled = false,
  onClick,
  tone = 'primary',
  title,
  type = 'button',
  className = ''
}) {
  const tones = {
    primary: 'border-[#004ac6] bg-[#004ac6] text-white hover:bg-[#003fa8]',
    secondary: 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
    danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
    amber: 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={ariaPressed}
      title={title}
      className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#004ac6] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      className={`min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#004ac6] focus:ring-2 focus:ring-[#004ac6]/15 disabled:bg-slate-100 ${props.className || ''}`}
    />
  );
}

export function ErrorNotice({ title = 'Action failed', message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 break-words">{message}</div>
    </div>
  );
}

export function Detail({ label, value, children }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{children ?? value ?? '—'}</div>
    </div>
  );
}
