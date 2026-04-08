import Link from 'next/link';

export default function BrandLogo({
  href = '',
  label = 'EveryCall',
  className = 'h-10 w-[172px]',
  imageClassName = 'h-full w-full object-contain',
  priority = false
}) {
  const logo = (
    <div className={className.trim()}>
      <img
        src="/branding/everycall-logo.svg"
        alt={label}
        className={`object-cover object-center ${imageClassName}`.trim()}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    </div>
  );

  if (!href) {
    return logo;
  }

  return (
    <Link href={href} aria-label={label} className="block">
      {logo}
    </Link>
  );
}
