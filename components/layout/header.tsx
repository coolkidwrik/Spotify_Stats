// components/Header.tsx
import SmoothScrollLink from './smoothScrollLink';
 
const LINKS = [
  { targetId: 'now', label: 'Now' },
  { targetId: 'charts', label: 'Charts' },
  { targetId: 'timeline', label: 'Timeline' },
  { targetId: 'covers', label: 'Covers' },
];
 
export default function Header() {
  return (
    <header className="fixed top-0 left-0 w-full z-50 px-6 sm:px-8 py-4 flex flex-col sm:flex-row justify-center sm:justify-between items-center gap-3 sm:gap-6 bg-black/40 text-white backdrop-blur-md">
      <SmoothScrollLink href="/" targetId="now">
        <span className="text-lg sm:text-xl font-semibold tracking-tight whitespace-nowrap">
          CKWrik&rsquo;s <span className="text-(--accent)">Spotify Stats</span>
        </span>
      </SmoothScrollLink>
 
      <nav className="flex flex-wrap justify-center sm:justify-end gap-6 sm:gap-10 text-base sm:text-lg font-medium">
        {LINKS.map((link) => (
          <SmoothScrollLink key={link.targetId} href="/" targetId={link.targetId}>
            {link.label}
          </SmoothScrollLink>
        ))}
      </nav>
    </header>
  );
}