'use client';

import SalesReceptionistNumberBadge from './SalesReceptionistNumberBadge';

export default function SalesReceptionistNumberHeaderAside({ onHelpClick }) {
  return (
    <div className="flex items-center gap-2">
      <SalesReceptionistNumberBadge />
      <button
        type="button"
        onClick={onHelpClick}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-[#eff4ff] hover:text-[#004ac6]"
        aria-label="Show help for Sales Receptionist Number"
        title="What does this number do?"
      >
        <span className="material-symbols-outlined text-[20px]">info</span>
      </button>
    </div>
  );
}
