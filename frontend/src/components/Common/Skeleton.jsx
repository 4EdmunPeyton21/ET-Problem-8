export const Skeleton = ({ className = '' }) => (
  <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />
);

export const SkeletonCard = () => (
  <div className="surface space-y-4 p-5">
    <div className="flex items-start justify-between">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <Skeleton className="h-4 w-20" />
    <div className="flex items-center justify-between pt-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-16" />
    </div>
  </div>
);
