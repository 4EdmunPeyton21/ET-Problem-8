import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Search, Share2 } from 'lucide-react';
import { useEquipmentGraph } from '../hooks/queries';
import { EmptyState } from '../components/Common/EmptyState';

const LEGEND = [
  { type: 'Equipment', color: '#2F5233' },
  { type: 'Incident', color: '#ED7D31' },
  { type: 'Procedure', color: '#4472C4' },
  { type: 'Parameter', color: '#70AD47' },
  { type: 'Document', color: '#9B59B6' },
  { type: 'Regulation', color: '#FFC7CE' },
];

/** Renders a force-directed D3 graph into an SVG ref — no React reconciliation of nodes. */
function useForceGraph(svgRef, data) {
  useEffect(() => {
    if (!svgRef.current || !data) return;
    const nodes = data.nodes || [];
    const links = data.links || [];
    if (nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth || 640;
    const height = svgRef.current.clientHeight || 480;

    const linkNodes = links.map((l) => ({ ...l }));
    const graphNodes = nodes.map((n) => ({ ...n }));

    const simulation = d3
      .forceSimulation(graphNodes)
      .force('link', d3.forceLink(linkNodes).id((d) => d.id).distance(90).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(28));

    const g = svg.append('g');

    svg.call(
      d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => g.attr('transform', event.transform))
    );

    const link = g
      .append('g')
      .selectAll('line')
      .data(linkNodes)
      .join('line')
      .attr('stroke', '#28323f')
      .attr('stroke-width', 1.5);

    const linkLabel = g
      .append('g')
      .selectAll('text')
      .data(linkNodes)
      .join('text')
      .attr('font-size', 9)
      .attr('fill', '#64748b')
      .text((d) => d.label || '');

    const node = g
      .append('g')
      .selectAll('circle')
      .data(graphNodes)
      .join('circle')
      .attr('r', (d) => (d.type === 'Equipment' ? 14 : 9))
      .attr('fill', (d) => d.color || '#94A3B8')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2)
      .style('cursor', 'grab')
      .call(
        d3.drag()
          .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    const label = g
      .append('g')
      .selectAll('text')
      .data(graphNodes)
      .join('text')
      .attr('font-size', 11)
      .attr('font-weight', 500)
      .attr('fill', '#e2e8f0')
      .attr('dx', 16)
      .attr('dy', 4)
      .text((d) => d.label);

    node.append('title').text((d) => `${d.type}: ${d.label}`);

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      linkLabel
        .attr('x', (d) => (d.source.x + d.target.x) / 2)
        .attr('y', (d) => (d.source.y + d.target.y) / 2);
      node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
      label.attr('x', (d) => d.x).attr('y', (d) => d.y);
    });

    return () => simulation.stop();
  }, [svgRef, data]);
}

export const KnowledgeGraph = () => {
  const [input, setInput] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const { data, isLoading, error } = useEquipmentGraph(equipmentId);
  const svgRef = useRef(null);

  useForceGraph(svgRef, data);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) setEquipmentId(input.trim());
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Knowledge Graph</h1>
        <p className="mt-1 text-sm text-muted">Explore an equipment node's 2-hop neighborhood — incidents, procedures, parameters, documents.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter an equipment ID (e.g. PUMP-101)…"
            className="control pl-9"
          />
        </div>
        <button type="submit" disabled={!input.trim()} className="btn-primary shrink-0">
          Visualize
        </button>
      </form>

      {!equipmentId && (
        <EmptyState icon={Share2} title="No equipment selected" hint="Enter an equipment ID above to render its knowledge graph." />
      )}

      {error && <EmptyState icon={Share2} title="Couldn't load graph" hint={error.message} />}

      {equipmentId && !error && (
        <div className="surface overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3">
            {LEGEND.map(({ type, color }) => (
              <span key={type} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                {type}
              </span>
            ))}
          </div>
          <svg ref={svgRef} className="h-[520px] w-full" />
          {!isLoading && data?.nodes?.length === 0 && (
            <div className="p-8">
              <EmptyState title={`No graph data for "${equipmentId}"`} hint="This equipment may not exist yet, or has no recorded relationships." />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
