import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import * as d3 from 'd3';

const TYPE_COLORS = {
  concept: '#8270DB',
  entity: '#4BCE97',
  source: '#F5CD47',
  page: '#8C9BAB',
};

const TYPE_LABELS = {
  concept: 'Concept',
  entity: 'Entity',
  source: 'Source',
  page: 'Page',
};

function App() {
  const [spaces, setSpaces] = useState([]);
  const [spaceKey, setSpaceKey] = useState('');
  const [graph, setGraph] = useState(null);
  const [watched, setWatched] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);

  useEffect(() => {
    Promise.all([invoke('getSpaces'), invoke('getWatchedSpaces')])
      .then(([spaceList, watchedList]) => {
        setSpaces(spaceList);
        setWatched(watchedList);
        if (spaceList.length) setSpaceKey(spaceList[0].key);
      })
      .catch((e) => setError(e.message));
  }, []);

  const loadGraph = useCallback((key) => {
    if (!key) return;
    setLoading(true);
    setError(null);
    setLastCheck(null);
    invoke('getGraph', { spaceKey: key })
      .then(setGraph)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadGraph(spaceKey);
  }, [spaceKey, loadGraph]);

  const toggleWatch = () => {
    const action = watched.includes(spaceKey) ? 'unwatchSpace' : 'watchSpace';
    invoke(action, { spaceKey }).then(setWatched).catch((e) => setError(e.message));
  };

  const runCheck = () => {
    setChecking(true);
    invoke('runHealthCheck', { spaceKey })
      .then((summary) => setLastCheck(summary))
      .catch((e) => setError(e.message))
      .finally(() => setChecking(false));
  };

  const seedDemo = () => {
    setSeeding(true);
    invoke('seedDemo', { spaceKey })
      .then(() => loadGraph(spaceKey))
      .catch((e) => setError(e.message))
      .finally(() => setSeeding(false));
  };

  const isWatched = watched.includes(spaceKey);
  const noOkfContent = !loading && graph &&
    graph.stats.concept + graph.stats.entity + graph.stats.source === 0;

  return (
    <div style={styles.app}>
      <div style={styles.toolbar}>
        <label htmlFor="space-select" style={styles.label}>Space</label>
        <select
          id="space-select"
          style={styles.select}
          value={spaceKey}
          onChange={(e) => setSpaceKey(e.target.value)}
        >
          {spaces.length === 0 && <option value="">No spaces found</option>}
          {spaces.map((s) => (
            <option key={s.key} value={s.key}>{s.name} ({s.key})</option>
          ))}
        </select>
        <button style={styles.button} onClick={() => loadGraph(spaceKey)} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button style={styles.button} onClick={toggleWatch} disabled={!spaceKey}>
          {isWatched ? '★ Watched (daily checks on)' : '☆ Watch this space'}
        </button>
        <button style={styles.button} onClick={runCheck} disabled={!spaceKey || checking}>
          {checking ? 'Checking…' : 'Run health check now'}
        </button>
        {noOkfContent && (
          <button style={styles.button} onClick={seedDemo} disabled={seeding}>
            {seeding ? 'Seeding…' : '✨ Seed demo data'}
          </button>
        )}
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {lastCheck && (
        <div style={styles.notice}>
          Health check complete: {lastCheck.stats.orphans} orphaned page(s),{' '}
          {lastCheck.stats.unresolvedLinks} unresolved link(s). Report written to the
          “Knowledge Graph Health” page in {lastCheck.spaceKey}.
        </div>
      )}

      {graph && <StatsBar stats={graph.stats} />}
      <GraphCanvas graph={graph} loading={loading} />
      <Legend />
    </div>
  );
}

function StatsBar({ stats }) {
  const items = [
    ['Pages', stats.pages],
    ['Links', stats.links],
    ['Concepts', stats.concept],
    ['Entities', stats.entity],
    ['Sources', stats.source],
    ['Orphans', stats.orphans],
    ['Unresolved', stats.unresolvedLinks],
  ];
  return (
    <div style={styles.stats}>
      {items.map(([label, value]) => (
        <span key={label} style={styles.stat}>
          <strong>{value}</strong> {label}
        </span>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div style={styles.legend}>
      {Object.entries(TYPE_LABELS).map(([type, label]) => (
        <span key={type} style={styles.legendItem}>
          <span style={{ ...styles.swatch, background: TYPE_COLORS[type] }} />
          {label}
        </span>
      ))}
      <span style={styles.legendItem}>
        <span style={{ ...styles.swatch, background: 'transparent', border: '2px solid #F87462' }} />
        Orphan
      </span>
    </div>
  );
}

function GraphCanvas({ graph, loading }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!graph || !svgRef.current) return undefined;

    const width = containerRef.current.clientWidth || 960;
    const height = 560;

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.links.map((l) => ({ ...l }));

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', [0, 0, width, height]);

    const zoomLayer = svg.append('g');
    svg.call(
      d3.zoom()
        .scaleExtent([0.25, 4])
        .on('zoom', (event) => zoomLayer.attr('transform', event.transform))
    );

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(70).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(24));

    const link = zoomLayer.append('g')
      .attr('stroke', '#5C6C7A')
      .attr('stroke-opacity', 0.5)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', 1.2);

    const node = zoomLayer.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3.drag()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    node.append('circle')
      .attr('r', (d) => (d.type === 'source' ? 12 : 9))
      .attr('fill', (d) => TYPE_COLORS[d.type] || TYPE_COLORS.page)
      .attr('stroke', (d) => (d.orphan ? '#F87462' : '#1D2125'))
      .attr('stroke-width', (d) => (d.orphan ? 2.5 : 1.5));

    node.append('text')
      .text((d) => d.title)
      .attr('x', 0)
      .attr('y', (d) => (d.type === 'source' ? 26 : 22))
      .attr('text-anchor', 'middle')
      .attr('fill', '#B6C2CF')
      .attr('font-size', '11px')
      .attr('font-family', 'inherit');

    node.append('title').text((d) => `${d.title} (${TYPE_LABELS[d.type] || d.type})`);

    node.on('click', (event, d) => {
      if (d.url) router.open(d.url);
    });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [graph]);

  return (
    <div ref={containerRef} style={styles.canvas}>
      {loading && <div style={styles.overlay}>Building graph…</div>}
      {!loading && graph && graph.nodes.length === 0 && (
        <div style={styles.overlay}>
          No pages in this space yet. Ingest some knowledge and refresh.
        </div>
      )}
      <svg ref={svgRef} style={{ width: '100%', height: 560, display: 'block' }} />
    </div>
  );
}

const styles = {
  app: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    padding: 16,
    color: '#172B4D',
  },
  toolbar: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  label: { fontWeight: 600 },
  select: {
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid #8C9BAB',
    minWidth: 220,
  },
  button: {
    padding: '6px 12px',
    borderRadius: 4,
    border: '1px solid #8C9BAB',
    background: '#FFFFFF',
    cursor: 'pointer',
  },
  error: {
    background: '#FFECEB',
    color: '#AE2E24',
    padding: '8px 12px',
    borderRadius: 4,
    marginBottom: 12,
  },
  notice: {
    background: '#E9F2FF',
    color: '#0055CC',
    padding: '8px 12px',
    borderRadius: 4,
    marginBottom: 12,
  },
  stats: {
    display: 'flex',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 12,
    fontSize: 13,
  },
  stat: { color: '#44546F' },
  canvas: {
    position: 'relative',
    background: '#1D2125',
    borderRadius: 8,
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#B6C2CF',
    fontSize: 14,
    pointerEvents: 'none',
  },
  legend: {
    display: 'flex',
    gap: 16,
    marginTop: 12,
    fontSize: 13,
    color: '#44546F',
    flexWrap: 'wrap',
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    display: 'inline-block',
  },
};

export default App;
