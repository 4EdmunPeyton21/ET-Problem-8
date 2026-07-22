import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Cpu, MapPin } from 'lucide-react';
import { useEquipment } from '../hooks/queries';
import { useUIStore } from '../stores/uiStore';
import { EmptyState } from '../components/Common/EmptyState';
import { SkeletonCard } from '../components/Common/Skeleton';

const STATUS_STYLE = {
  OPERATIONAL: 'bg-success/12 text-success border-success/25',
  WARNING: 'bg-warning/12 text-warning border-warning/25',
  CRITICAL: 'bg-error/12 text-error border-error/25',
};

export const EquipmentList = () => {
  const filter = useUIStore((state) => state.equipmentTypeFilter);
  const setFilter = useUIStore((state) => state.setEquipmentTypeFilter);
  const { data, isLoading, error } = useEquipment(filter);
  const [search, setSearch] = useState('');

  const equipment = data?.equipment || [];
  const filteredEquipment = equipment.filter(
    (eq) =>
      (eq.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (eq.equipmentId || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Equipment</h1>
          <p className="mt-1 text-sm text-muted">Registered assets and their extracted status.</p>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="control pl-9"
            />
          </div>
          <select
            value={filter || ''}
            onChange={(e) => setFilter(e.target.value || null)}
            className="control w-32 shrink-0"
          >
            <option value="">All types</option>
            <option value="pump">Pumps</option>
            <option value="motor">Motors</option>
            <option value="compressor">Compressors</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {error && (
        <EmptyState icon={Cpu} title="Couldn't load equipment" hint={error.message} />
      )}

      {!isLoading && !error && filteredEquipment.length === 0 && (
        <EmptyState
          icon={Cpu}
          title="No equipment found"
          hint="Try a different search term or filter, or ingest a document that references equipment."
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredEquipment.map((eq) => (
          <Link
            key={eq.equipmentId}
            to={`/equipment/${eq.equipmentId}`}
            className="surface group p-5 transition-colors duration-150 hover:border-muted"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-ink group-hover:text-primary transition-colors duration-150">
                  {eq.name}
                </h3>
                <span className="mt-1 block font-mono text-xs text-muted">{eq.equipmentId}</span>
              </div>
              <span className={`badge shrink-0 ${STATUS_STYLE[(eq.status || '').toUpperCase()] || 'bg-surface-2 text-muted border-border'}`}>
                {(eq.status || 'unknown').toLowerCase()}
              </span>
            </div>

            <div className="mt-5 flex items-center justify-between text-xs">
              <span className="rounded-md bg-surface-2 px-2 py-1 text-muted">{eq.type || 'Unclassified'}</span>
              {eq.location && (
                <span className="flex items-center gap-1 text-muted">
                  <MapPin className="size-3.5" /> {eq.location}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};
