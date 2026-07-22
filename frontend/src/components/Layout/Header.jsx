import { useUIStore } from '../../stores/uiStore';
import { Menu, Bell } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';

export const Header = () => {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const toggleMobileNav = useUIStore((state) => state.toggleMobileNav);
  const { isConnected } = useSocket();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface/70 px-4 backdrop-blur-md sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobileNav}
          aria-label="Toggle navigation"
          className="inline-flex rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:hidden"
        >
          <Menu className="size-[18px]" />
        </button>
        <button
          onClick={toggleSidebar}
          aria-label="Collapse sidebar"
          className="hidden rounded-lg p-2 text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:inline-flex"
        >
          <Menu className="size-[18px]" />
        </button>

        <div className="hidden items-center gap-2 rounded-full border border-border bg-surface-2 py-1 pl-1 pr-3 text-xs text-muted sm:flex">
          <span className="relative flex size-2">
            {isConnected && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            )}
            <span className={`relative inline-flex size-2 rounded-full ${isConnected ? 'bg-success' : 'bg-warning'}`} />
          </span>
          {isConnected ? 'Live' : 'Offline / mock'}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button aria-label="Notifications" className="btn-ghost relative !p-2">
          <Bell className="size-[18px]" />
        </button>
        <div className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-2 font-mono text-xs font-medium text-ink">
          AB
        </div>
      </div>
    </header>
  );
};
