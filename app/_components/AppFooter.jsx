import Link from 'next/link';

export default function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200/70 bg-white/70 px-4 py-4 text-sm text-slate-500 md:px-8">
      <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-4">
        <div>
          EveryCall is a service of{' '}
          <Link href="https://creativedynamicinc.com" target="_blank" rel="noreferrer" className="font-medium text-slate-700 hover:text-[#004ac6] hover:underline">
            Creative Dynamic Co.
          </Link>{' '}
          © {year}
        </div>
        <a href="mailto:support@everycall.io" className="font-medium text-slate-700 hover:text-[#004ac6] hover:underline">
          support@everycall.io
        </a>
      </div>
    </footer>
  );
}
