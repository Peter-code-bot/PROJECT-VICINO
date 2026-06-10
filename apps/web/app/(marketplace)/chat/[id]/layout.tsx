import type { ReactNode } from 'react';

export default function ChatDetailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3.5rem)]">
      {children}
    </div>
  );
}
