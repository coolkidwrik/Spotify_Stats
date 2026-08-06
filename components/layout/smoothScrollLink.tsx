'use client';

import { usePathname } from 'next/navigation';

type SmoothScrollLinkProps = {
  href: string;
  targetId: string;
  children: React.ReactNode;
};

export default function SmoothScrollLink({ href, targetId, children }: SmoothScrollLinkProps) {
  const pathname = usePathname();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (pathname === href) {
      // If already on the target page, just scroll
      const section = document.getElementById(targetId);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      // If on a different page, navigate then scroll
      window.location.href = `${href}#${targetId}`;
    }
  };

  return (
    <button
      onClick={handleClick}
      className="hover:underline transition duration-300 bg-transparent"
    >
      {children}
    </button>
  );
}