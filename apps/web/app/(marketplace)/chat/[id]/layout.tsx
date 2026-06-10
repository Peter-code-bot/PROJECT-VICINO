import type { ReactNode } from 'react';

export default function ChatDetailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {children}
    </div>
  );
}
