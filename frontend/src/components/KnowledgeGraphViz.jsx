import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_META = {
  Equipment:  { color: '#2F5233', ring: '#4ade80', radius: 22, icon: '⚙' },
  Procedure:  { color: '#4472C4', ring: '#60a5fa', radius: 18, icon: '📋' },
  Incident:   { color: '#ED7D31', ring: '#fb923c', radius: 18, icon: '⚠' },
  Parameter:  { color: '#70AD47', ring: '#a3e635', radius: 14, icon: '📊' },
  Regulation: { color: '#C0392B', ring: '#f87171', radius: 16, icon: '⚖' },
  Document:   { color: '#9B59B6', ring: '#c084fc', radius: 16, icon: '📄' },
  Default:    { color: '#64748b', ring: '#94a3b8', radius: 14, icon: '●' },
};

function getMeta(type) {
  return TYPE_META[type] || TYPE_META.Default;
}

// ── Tooltip component ─────────────────────────────────────────────────────────

function Tooltip({ node, position }) {
  if (!node) return null;
  const meta   = getMeta(node.type);
  const fields = [
    ['Type',        node.type],
    ['Status',      node.status],
    ['Severity',    node.severity],
    ['Value',       node.value],
    ['Description', node.description],
    ['Created',     node.createdAt],
    ['Updated',     node.lastUpdated],
  ].filter(([, v]) => v != null && v !== '');

  return (
    <div
      style={{
        position:  'fixed',
        left:      position.x + 14,
        top:       position.y - 12,
        zIndex:    100,
        maxWidth:  240,
        pointerEvents: 'none',
      }}
      className="bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header strip */}
      <div
        className="px-3 py-2 flex items-center gap-2"
        style={{ backgroundColor: meta.color + '22', borderBottom: `1px solid ${meta.color}44` }}
      >
        <span className="text-base">{meta.icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-100 truncate">{node.label}</p>
          <p className="text-[10px]" style={{ color: meta.ring }}>{node.type}</p>
        </div>
      </div>

      {/* Fields */}
      {fields.length > 0 && (
        <div className="px-3 py-2 space-y-1">
          {fields.map(([key, val]) => (
            <div key={key} className="flex gap-2">
              <span className="text-[10px] text-slate-500 shrink-0 w-16 uppercase tracking-wide">{key}</span>
              <span className="text-[10px] text-slate-300 truncate">{String(val)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const types = Object.entries(TYPE_META).filter(([k]) => k !== 'Default');
  return (
    <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2.5
                    backdrop-blur-sm flex flex-col gap-1.5 text-xs">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-0.5">Node Types</p>
      {types.map(([type, meta]) => (
        <div key={type} className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: meta.color }}
          />
          <span className="text-slate-300">{type}</span>
        </div>
      ))}
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

function Controls({ onZoomIn, onZoomOut, onReset, nodeCount, linkCount }) {
  return (
    <div className="absolute top-4 right-4 flex flex-col gap-2">
      {/* Stats */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 backdrop-blur-sm text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider">Nodes</p>
        <p className="text-sm font-bold text-slate-200">{nodeCount}</p>
        <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Links</p>
        <p className="text-sm font-bold text-slate-200">{linkCount}</p>
      </div>
      {/* Zoom controls */}
      <div className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-sm">
        <button
          onClick={onZoomIn}
          className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-sm font-bold border-b border-slate-800"
        >＋</button>
        <button
          onClick={onReset}
          className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-[10px] uppercase border-b border-slate-800"
        >Fit</button>
        <button
          onClick={onZoomOut}
          className="px-3 py-2 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors text-sm font-bold"
        >－</button>
      </div>
    </div>
  );
}

// ── Main D3 Canvas ────────────────────────────────────────────────────────────

function D3Graph({ nodes, links, width, height }) {
  const svgRef      = useRef(null);
  const simRef      = useRef(null);
  const zoomRef     = useRef(null);
  const [tooltip,   setTooltip]   = useState({ node: null, position: { x: 0, y: 0 } });

  // Zoom controls exposed via callbacks
  const handleZoomIn  = useCallback(() => {
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.4);
  }, []);
  const handleZoomOut = useCallback(() => {
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
  }, []);
  const handleReset   = useCallback(() => {
    d3.select(svgRef.current).transition().duration(400).call(
      zoomRef.current.transform,
      d3.zoomIdentity.translate(width / 2, height / 2)
    );
  }, [width, height]);

  useEffect(() => {
    if (!svgRef.current || !nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Zoom behaviour ──────────────────────────────────────────────────────
    const zoom = d3.zoom()
      .scaleExtent([0.15, 4])
      .on('zoom', ({ transform }) => g.attr('transform', transform));

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2));

    // Root group (transforms applied here)
    const g = svg.append('g');

    // ── Arrow markers for directed links ───────────────────────────────────
    svg.append('defs').selectAll('marker')
      .data(['default'])
      .join('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -4 10 8')
        .attr('refX', 28)
        .attr('refY', 0)
        .attr('markerWidth',  6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
      .append('path')
        .attr('fill', '#475569')
        .attr('d', 'M0,-4L10,0L0,4');

    // ── Force simulation ───────────────────────────────────────────────────
    const nodesCopy = nodes.map(n => ({ ...n }));
    const linksMap  = new Map(nodesCopy.map(n => [n.id, n]));
    const linksCopy = links
      .map(l => ({
        source: linksMap.get(l.source) || l.source,
        target: linksMap.get(l.target) || l.target,
        label:  l.label,
      }))
      .filter(l => l.source && l.target);

    const sim = d3.forceSimulation(nodesCopy)
      .force('link',   d3.forceLink(linksCopy).id(d => d.id).distance(100).strength(0.8))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collision', d3.forceCollide().radius(d => getMeta(d.type).radius + 8))
      .force('center', d3.forceCenter(0, 0));

    simRef.current = sim;

    // ── Link lines ─────────────────────────────────────────────────────────
    const linkGroup = g.append('g').attr('class', 'links');

    const linkEl = linkGroup.selectAll('line')
      .data(linksCopy)
      .join('line')
        .attr('stroke', '#334155')
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.7)
        .attr('marker-end', 'url(#arrow)');

    // Link labels
    const linkLabel = linkGroup.selectAll('text')
      .data(linksCopy)
      .join('text')
        .attr('text-anchor', 'middle')
        .attr('dy', -4)
        .attr('fill', '#64748b')
        .attr('font-size', 9)
        .attr('font-family', "'Inter', system-ui, sans-serif")
        .attr('pointer-events', 'none')
        .text(d => d.label);

    // ── Node groups ────────────────────────────────────────────────────────
    const nodeGroup = g.append('g').attr('class', 'nodes');

    const nodeEl = nodeGroup.selectAll('g')
      .data(nodesCopy)
      .join('g')
        .attr('class', 'node')
        .attr('cursor', 'grab')
        .call(
          d3.drag()
            .on('start', (event, d) => {
              if (!event.active) sim.alphaTarget(0.3).restart();
              d.fx = d.x; d.fy = d.y;
            })
            .on('drag', (event, d) => {
              d.fx = event.x; d.fy = event.y;
            })
            .on('end', (event, d) => {
              if (!event.active) sim.alphaTarget(0);
              d.fx = null; d.fy = null;
            })
        );

    // Outer glow ring (appears on hover)
    nodeEl.append('circle')
      .attr('r', d => getMeta(d.type).radius + 5)
      .attr('fill', 'none')
      .attr('stroke', d => getMeta(d.type).ring)
      .attr('stroke-width', 2)
      .attr('opacity', 0)
      .attr('class', 'ring');

    // Main filled circle
    nodeEl.append('circle')
      .attr('r', d => getMeta(d.type).radius)
      .attr('fill', d => getMeta(d.type).color)
      .attr('stroke', d => getMeta(d.type).ring)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0)   // start invisible for entrance animation
      .transition()
      .duration(600)
      .delay((_, i) => i * 30)
      .attr('opacity', 1);

    // Icon text inside circle
    nodeEl.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', d => getMeta(d.type).radius * 0.75)
      .attr('fill', 'white')
      .attr('pointer-events', 'none')
      .text(d => getMeta(d.type).icon);

    // Label below node
    nodeEl.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => getMeta(d.type).radius + 12)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 10)
      .attr('font-family', "'Inter', system-ui, sans-serif")
      .attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => d.label.length > 16 ? d.label.slice(0, 14) + '…' : d.label);

    // Hover interactions
    nodeEl
      .on('mouseenter', function (event, d) {
        d3.select(this).select('.ring')
          .transition().duration(150).attr('opacity', 0.7);
        d3.select(this).select('circle:not(.ring)')
          .transition().duration(150).attr('r', getMeta(d.type).radius * 1.15);
        setTooltip({ node: d, position: { x: event.clientX, y: event.clientY } });
      })
      .on('mousemove', (event) => {
        setTooltip(prev => ({ ...prev, position: { x: event.clientX, y: event.clientY } }));
      })
      .on('mouseleave', function (_, d) {
        d3.select(this).select('.ring')
          .transition().duration(200).attr('opacity', 0);
        d3.select(this).select('circle:not(.ring)')
          .transition().duration(200).attr('r', getMeta(d.type).radius);
        setTooltip({ node: null, position: { x: 0, y: 0 } });
      });

    // ── Simulation tick ────────────────────────────────────────────────────
    sim.on('tick', () => {
      linkEl
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      linkLabel
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2);

      nodeEl.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => {
      sim.stop();
      svg.on('.zoom', null);
    };
  }, [nodes, links, width, height]);

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="block"
        style={{ background: 'transparent' }}
      />
      <Tooltip node={tooltip.node} position={tooltip.position} />
      <Controls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
        nodeCount={nodes.length}
        linkCount={links.length}
      />
      <Legend />
    </>
  );
}

// ── Main Exported Component ───────────────────────────────────────────────────

export default function KnowledgeGraphViz({ equipmentId }) {
  const containerRef  = useRef(null);
  const [graph,       setGraph]       = useState({ nodes: [], links: [] });
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [dimensions,  setDimensions]  = useState({ width: 800, height: 600 });
  const [inputId,     setInputId]     = useState(equipmentId || '');
  const [activeId,    setActiveId]    = useState(equipmentId || '');

  // ── Responsive canvas size ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const rect = containerRef.current.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Fetch graph data ───────────────────────────────────────────────────────
  const fetchGraph = useCallback(async (id) => {
    if (!id?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/graph/equipment/${encodeURIComponent(id.trim())}/visualization`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setGraph({ nodes: data.nodes || [], links: data.links || [] });
      setActiveId(id.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch if equipmentId prop provided
  useEffect(() => {
    if (equipmentId) fetchGraph(equipmentId);
  }, [equipmentId, fetchGraph]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') fetchGraph(inputId); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col bg-slate-950 text-slate-100 min-h-screen"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-slate-800/60 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Knowledge Graph</h1>
          <p className="text-slate-400 text-xs mt-0.5">
            Interactive D3 force-directed visualization of the equipment subgraph
          </p>
        </div>

        {/* Equipment search */}
        <div className="flex gap-2">
          <input
            type="text"
            value={inputId}
            onChange={e => setInputId(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Equipment ID (e.g. PUMP-XYZ)"
            className="bg-slate-900 border border-slate-800 text-slate-200 text-sm placeholder-slate-600
                       rounded-xl px-4 py-2 w-56 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <button
            onClick={() => fetchGraph(inputId)}
            disabled={loading || !inputId.trim()}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              loading || !inputId.trim()
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"/>
                Loading…
              </span>
            ) : 'Visualize'}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mx-6 mt-4 bg-rose-950/30 border border-rose-800/40 text-rose-300 text-sm p-3
                        rounded-xl font-mono flex gap-2">
          <span>⚠️</span><span>{error}</span>
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ minHeight: 500 }}>

        {/* Empty states */}
        {!loading && graph.nodes.length === 0 && !activeId && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-6xl mb-4 opacity-30">🕸</div>
            <p className="text-slate-500 font-medium">Enter an equipment ID to explore its graph</p>
            <p className="text-slate-700 text-sm mt-1">
              Nodes will show Equipment, Incidents, Procedures, Parameters and more
            </p>
          </div>
        )}

        {!loading && graph.nodes.length === 0 && activeId && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-5xl mb-3 opacity-40">🔍</div>
            <p className="text-slate-500">No graph data found for <span className="font-mono text-slate-300">"{activeId}"</span></p>
            <p className="text-slate-700 text-xs mt-1">Make sure the equipment exists in the knowledge graph</p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full" />
              <div className="absolute inset-0 border-4 border-t-indigo-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
            </div>
            <p className="text-slate-400 text-sm">Building knowledge graph…</p>
          </div>
        )}

        {/* D3 canvas (always mounted when data available) */}
        {!loading && graph.nodes.length > 0 && (
          <D3Graph
            nodes={graph.nodes}
            links={graph.links}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {/* Node count tag */}
        {graph.nodes.length > 0 && activeId && (
          <div className="absolute top-4 left-4 bg-slate-900/90 border border-slate-800 rounded-lg
                          px-3 py-1.5 text-xs text-slate-400 backdrop-blur-sm">
            Showing subgraph for{' '}
            <span className="font-mono font-semibold text-indigo-400">{activeId}</span>
          </div>
        )}
      </div>
    </div>
  );
}
