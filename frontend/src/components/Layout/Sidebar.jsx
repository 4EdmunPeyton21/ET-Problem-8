import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../stores/uiStore';
import { LayoutGrid, UploadCloud, Cpu, FileSearch, Radio } from 'lucide-react';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/ingestion', label: 'Ingestion', icon: UploadCloud },
  { to: '/equipment', label: 'Equipment', icon: Cpu },
  { to: '/rca', label: 'RCA Assistant', icon: FileSearch },
];

export const Sidebar = () => {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const mobileNavOpen = useUIStore((state) => state.mobileNavOpen);
  const closeMobileNav = useUIStore((state) => state.closeMobileNav);
  const collapsed = !sidebarOpen;

  return (
    <>
      {mobileNavOpen && (
        <div
          onClick={closeMobileNav}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-surface border-r border-border',
          'transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:translate-x-0 lg:transition-[width]',
          collapsed ? 'lg:w-[68px]' : 'lg:w-64',
        ].join(' ')}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Radio className="size-5 shrink-0 text-primary" strokeWidth={2.25} />
          <span className={`font-semibold tracking-tight text-ink whitespace-nowrap ${collapsed ? 'lg:hidden' : ''}`}>
            IKI Platform
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {LINKS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={closeMobileNav}
              title={label}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                  collapsed ? 'lg:justify-center lg:px-0' : '',
                  isActive
                    ? 'bg-primary/12 text-primary'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')
              }
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={2} />
              <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`border-t border-border px-4 py-3 text-xs text-muted ${collapsed ? 'lg:text-center lg:px-0' : ''}`}>
          <span className={collapsed ? 'lg:hidden' : ''}>v1.0.0 · MVP</span>
          <span className={`hidden ${collapsed ? 'lg:inline' : ''}`}>·</span>
        </div>
      </aside>
    </>
  );
};
