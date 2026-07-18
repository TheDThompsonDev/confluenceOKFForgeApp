import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, router } from '@forge/bridge';
import * as d3 from 'd3';
import './App.css';

const TYPE_COLORS = {
  concept: '#A78BFA',
  entity: '#52D6A2',
  source: '#F4C95D',
  inbox: '#65A8FF',
  page: '#91A4B7',
};

const TYPE_LABELS = {
  concept: 'Concept',
  entity: 'Entity',
  source: 'Source',
  inbox: 'Inbox',
  page: 'Page',
};

const FILTER_TYPES = Object.keys(TYPE_LABELS);

const DISPLAY_HEIGHT = window.screen.availHeight || window.screen.height;
const CANVAS_HEIGHT = Math.max(520, Math.min(760, DISPLAY_HEIGHT - 490));

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
  const [query, setQuery] = useState('');
  const [visibleTypes, setVisibleTypes] = useState(FILTER_TYPES);
  const [orphansOnly, setOrphansOnly] = useState(false);

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

  const toggleType = (type) => {
    setVisibleTypes((current) => (
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    ));
  };

  const isWatched = watched.includes(spaceKey);
  const noOkfContent = !loading && graph &&
    graph.stats.concept + graph.stats.entity + graph.stats.source === 0;
  const selectedSpace = spaces.find((space) => space.key === spaceKey);

  return (
    <main className="app-shell">
      <header className="page-header">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <span>Apps</span>
          <i aria-hidden="true" />
          <span aria-current="page">Knowledge Graph</span>
        </nav>
        <div className="page-heading-row">
          <div className="app-title-block">
            <span className="app-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <h1>Knowledge Graph</h1>
              <p>Explore connected Confluence pages structured with the Open Knowledge Format.</p>
            </div>
          </div>
          <div className={`watch-status ${isWatched ? 'is-watched' : ''}`}>
            <span className="status-pulse" aria-hidden="true" />
            {isWatched ? 'Monitoring active' : 'Not monitored'}
          </div>
        </div>
      </header>

      <section className="command-bar" aria-label="Knowledge graph controls">
        <div className="field-group space-field">
          <label htmlFor="space-select">Space</label>
          <div className="select-wrap">
            <span className="space-symbol" aria-hidden="true"><i /></span>
            <select
              id="space-select"
              value={spaceKey}
              onChange={(e) => setSpaceKey(e.target.value)}
            >
              {spaces.length === 0 && <option value="">No spaces found</option>}
              {spaces.map((space) => (
                <option key={space.key} value={space.key}>{space.name} ({space.key})</option>
              ))}
            </select>
          </div>
        </div>

        <div className="command-actions">
          <button className="button button-quiet" onClick={() => loadGraph(spaceKey)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button className="button button-quiet" onClick={toggleWatch} disabled={!spaceKey}>
            {isWatched ? 'Stop watching' : 'Watch this space'}
          </button>
          <button className="button button-primary" onClick={runCheck} disabled={!spaceKey || checking}>
            {checking ? 'Checking...' : 'Run health check'}
          </button>
          {noOkfContent && (
            <button className="button button-primary" onClick={seedDemo} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed demo data'}
            </button>
          )}
        </div>
      </section>

      {error && <div className="message message-error" role="alert">{error}</div>}
      {lastCheck && (
        <div className="message message-success" role="status">
          <span className="message-mark" aria-hidden="true">OK</span>
          <span>
            Health check complete. Found {lastCheck.stats.orphans} orphaned page(s) and{' '}
            {lastCheck.stats.unresolvedLinks} unresolved link(s). The report was written to{' '}
            <strong>Knowledge Graph Health</strong> in {lastCheck.spaceKey}.
          </span>
        </div>
      )}

      {graph && <StatsBar stats={graph.stats} />}

      <section className="graph-card" aria-label="Interactive knowledge graph">
        <div className="graph-card-header">
          <div>
            <h2>Knowledge map</h2>
            <span className="graph-context">
              {selectedSpace ? `${selectedSpace.name} (${selectedSpace.key})` : 'Select a Confluence space'}
            </span>
          </div>
          <div className="graph-tools">
            <label className="search-field">
              <span className="search-icon" aria-hidden="true" />
              <span className="sr-only">Search notes</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a note..."
              />
              {query && (
                <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search">
                  <span aria-hidden="true" />
                </button>
              )}
            </label>
            <button
              className={`filter-button ${orphansOnly ? 'is-active is-warning' : ''}`}
              onClick={() => setOrphansOnly((value) => !value)}
              aria-pressed={orphansOnly}
            >
              Orphans only
            </button>
          </div>
        </div>

        <div className="filter-row" aria-label="Filter by note type">
          {FILTER_TYPES.map((type) => {
            const active = visibleTypes.includes(type);
            return (
              <button
                key={type}
                className={`type-filter ${active ? 'is-active' : ''}`}
                onClick={() => toggleType(type)}
                aria-pressed={active}
              >
                <span className="type-dot" style={{ backgroundColor: TYPE_COLORS[type] }} />
                {TYPE_LABELS[type]}
                {graph && <span className="filter-count">{graph.stats[type] || 0}</span>}
              </button>
            );
          })}
          <span className="interaction-hint">
            <span>Drag to arrange</span>
            <span>Scroll to zoom</span>
            <span>Double-click to open</span>
          </span>
        </div>

        <GraphCanvas
          graph={graph}
          loading={loading}
          query={query}
          visibleTypes={visibleTypes}
          orphansOnly={orphansOnly}
        />
      </section>
    </main>
  );
}

function StatsBar({ stats }) {
  const cards = [
    { label: 'Notes', value: stats.pages, caption: 'in this space', tone: 'neutral' },
    { label: 'Connections', value: stats.links, caption: 'knowledge trails', tone: 'violet' },
    { label: 'Concepts', value: stats.concept, caption: 'ideas in motion', tone: 'purple' },
    { label: 'Sources', value: stats.source, caption: 'evidence anchors', tone: 'gold' },
    {
      label: 'Graph health',
      value: stats.orphans + stats.unresolvedLinks,
      caption: stats.orphans + stats.unresolvedLinks === 0
        ? 'all notes connected'
        : `${stats.orphans} orphaned, ${stats.unresolvedLinks} unresolved`,
      tone: stats.orphans + stats.unresolvedLinks === 0 ? 'green' : 'coral',
    },
  ];

  return (
    <section className="stats-grid" aria-label="Knowledge graph summary">
      {cards.map((card) => (
        <article key={card.label} className={`stat-card stat-${card.tone}`}>
          <span className="stat-label">{card.label}</span>
          <strong>{card.value}</strong>
          <span className="stat-caption">{card.caption}</span>
        </article>
      ))}
    </section>
  );
}

function GraphCanvas({ graph, loading, query, visibleTypes, orphansOnly }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const fitRef = useRef(null);
  const sceneRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState(null);

  const filteredGraph = useMemo(() => {
    if (!graph) return null;
    const permitted = new Set(visibleTypes);
    const nodes = graph.nodes.filter((node) => permitted.has(node.type) && (!orphansOnly || node.orphan));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const links = graph.links.filter((link) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });
    return { nodes, links };
  }, [graph, visibleTypes, orphansOnly]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDims((current) => (
        Math.abs(current.width - width) > 4 || Math.abs(current.height - height) > 4
          ? { width, height }
          : current
      ));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!filteredGraph || !svgRef.current || !containerRef.current) return undefined;

    const width = dims.width || containerRef.current.clientWidth || 960;
    const height = dims.height || containerRef.current.clientHeight || 640;
    const nodes = filteredGraph.nodes.map((node) => ({ ...node }));
    const links = filteredGraph.links.map((link) => ({ ...link }));
    const degree = new Map(nodes.map((node) => [node.id, 0]));

    links.forEach((link) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
      degree.set(targetId, (degree.get(targetId) || 0) + 1);
    });
    nodes.forEach((node) => { node.degree = degree.get(node.id) || 0; });

    const neighbors = new Map(nodes.map((node) => [node.id, new Set([node.id])]));
    links.forEach((link) => {
      const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
      const targetId = typeof link.target === 'object' ? link.target.id : link.target;
      neighbors.get(sourceId)?.add(targetId);
      neighbors.get(targetId)?.add(sourceId);
    });

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', [0, 0, width, height]);

    const defs = svg.append('defs');
    const glow = defs.append('filter')
      .attr('id', 'node-glow')
      .attr('x', '-80%')
      .attr('y', '-80%')
      .attr('width', '260%')
      .attr('height', '260%');
    glow.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
    const zoom = d3.zoom()
      .scaleExtent([0.28, 4])
      .on('zoom', (event) => zoomLayer.attr('transform', event.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const fitView = (animate = true) => {
      if (!nodes.length || nodes.some((node) => !Number.isFinite(node.x))) return;
      const xs = nodes.map((node) => node.x);
      const ys = nodes.map((node) => node.y);
      const pad = 100;
      const dx = Math.max(d3.max(xs) - d3.min(xs), 1);
      const dy = Math.max(d3.max(ys) - d3.min(ys), 1);
      const scale = Math.min(1.65, 0.88 * Math.min(width / (dx + pad * 2), height / (dy + pad * 2)));
      const centerX = (d3.min(xs) + d3.max(xs)) / 2;
      const centerY = (d3.min(ys) + d3.max(ys)) / 2;
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY);
      (animate ? svg.transition().duration(650).ease(d3.easeCubicOut) : svg)
        .call(zoom.transform, transform);
    };
    fitRef.current = fitView;

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((node) => node.id).distance((link) => (
        link.source.degree > 4 || link.target.degree > 4 ? 105 : 82
      )).strength(0.45))
      .force('charge', d3.forceManyBody().strength((node) => -250 - node.degree * 34))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.045))
      .force('y', d3.forceY(height / 2).strength(0.045))
      .force('collide', d3.forceCollide((node) => nodeRadius(node) + (node.degree >= 3 ? 34 : 18)));

    const linkLayer = zoomLayer.append('g').attr('class', 'links');
    const link = linkLayer.selectAll('path')
      .data(links)
      .join('path')
      .attr('class', 'knowledge-link')
      .attr('fill', 'none')
      .attr('stroke', '#6F8194')
      .attr('stroke-opacity', 0.34)
      .attr('stroke-width', 1.25);

    const node = zoomLayer.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'knowledge-node')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (item) => `${item.title}, ${TYPE_LABELS[item.type] || item.type}, ${item.degree} connections`)
      .call(
        d3.drag()
          .on('start', (event, item) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            item.fx = item.x;
            item.fy = item.y;
          })
          .on('drag', (event, item) => {
            item.fx = event.x;
            item.fy = event.y;
          })
          .on('end', (event, item) => {
            if (!event.active) simulation.alphaTarget(0);
            item.fx = null;
            item.fy = null;
          })
      );

    node.append('circle')
      .attr('class', 'node-halo')
      .attr('r', (item) => nodeRadius(item) + (item.orphan ? 7 : 5))
      .attr('fill', 'none')
      .attr('stroke', (item) => (item.orphan ? '#FF806F' : TYPE_COLORS[item.type] || TYPE_COLORS.page))
      .attr('stroke-width', (item) => (item.orphan ? 2 : 1))
      .attr('stroke-opacity', (item) => (item.orphan ? 0.72 : 0.16));

    node.append('circle')
      .attr('class', 'node-core')
      .attr('r', nodeRadius)
      .attr('fill', (item) => TYPE_COLORS[item.type] || TYPE_COLORS.page)
      .attr('stroke', '#111A27')
      .attr('stroke-width', 2.5);

    node.append('circle')
      .attr('class', 'node-highlight')
      .attr('cx', (item) => -nodeRadius(item) * 0.28)
      .attr('cy', (item) => -nodeRadius(item) * 0.3)
      .attr('r', (item) => Math.max(1.4, nodeRadius(item) * 0.2))
      .attr('fill', '#FFFFFF')
      .attr('opacity', 0.45)
      .attr('pointer-events', 'none');

    const labels = node.append('g')
      .attr('class', 'node-label')
      .attr('transform', (item) => `translate(0, ${nodeRadius(item) + 17})`)
      .attr('pointer-events', 'none');

    labels.append('text')
      .text((item) => truncateTitle(item.title))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#DCE7F2')
      .attr('font-size', (item) => (item.degree >= 4 ? 12.5 : 11.5))
      .attr('font-weight', (item) => (item.degree >= 4 ? 650 : 500));

    labels.each(function addLabelBackground() {
      const group = d3.select(this);
      const textNode = group.select('text').node();
      if (!textNode) return;
      const box = textNode.getBBox();
      group.insert('rect', 'text')
        .attr('x', box.x - 7)
        .attr('y', box.y - 4)
        .attr('width', box.width + 14)
        .attr('height', box.height + 8)
        .attr('rx', 7)
        .attr('fill', '#111A27')
        .attr('fill-opacity', 0.88)
        .attr('stroke', '#314154')
        .attr('stroke-opacity', 0.7);
    });

    node.append('title').text((item) => `${item.title}, ${TYPE_LABELS[item.type] || item.type}, ${item.degree} connection(s)`);

    let hoveredId = null;
    let selectedId = null;

    const applyFocus = (focusId = selectedId || hoveredId, searchValue = '') => {
      const normalizedQuery = searchValue.trim().toLowerCase();
      const matches = normalizedQuery
        ? new Set(nodes.filter((item) => item.title.toLowerCase().includes(normalizedQuery)).map((item) => item.id))
        : null;
      const neighborhood = focusId ? neighbors.get(focusId) : null;

      node
        .attr('opacity', (item) => {
          if (matches) return matches.has(item.id) ? 1 : 0.16;
          if (neighborhood) return neighborhood.has(item.id) ? 1 : 0.13;
          return 1;
        })
        .classed('is-focused', (item) => item.id === focusId)
        .classed('is-search-match', (item) => Boolean(matches?.has(item.id)));

      labels.attr('opacity', (item) => {
        if (matches) return matches.has(item.id) ? 1 : 0;
        if (neighborhood) return neighborhood.has(item.id) ? 1 : 0;
        return item.orphan || item.type === 'source' || item.degree >= 3 ? 1 : 0;
      });

      link
        .attr('stroke-opacity', (item) => {
          if (matches) return matches.has(item.source.id) || matches.has(item.target.id) ? 0.78 : 0.04;
          if (focusId) return item.source.id === focusId || item.target.id === focusId ? 0.88 : 0.035;
          return 0.34;
        })
        .attr('stroke-width', (item) => (
          focusId && (item.source.id === focusId || item.target.id === focusId) ? 2.2 : 1.25
        ));
    };

    sceneRef.current = {
      applyFocus: (focusId, searchValue) => {
        selectedId = focusId;
        applyFocus(focusId, searchValue);
      },
    };

    node
      .on('mouseenter', (event, item) => {
        hoveredId = item.id;
        applyFocus(selectedId || hoveredId, query);
      })
      .on('mouseleave', () => {
        hoveredId = null;
        applyFocus(selectedId, query);
      })
      .on('click', (event, item) => {
        event.stopPropagation();
        selectedId = selectedId === item.id ? null : item.id;
        setSelectedNode(selectedId ? item : null);
        applyFocus(selectedId, query);
      })
      .on('dblclick', (event, item) => {
        event.stopPropagation();
        if (item.url) router.open(item.url);
      })
      .on('keydown', (event, item) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectedId = item.id;
          setSelectedNode(item);
          applyFocus(selectedId, query);
        }
      });

    svg.on('click', () => {
      selectedId = null;
      setSelectedNode(null);
      applyFocus(null, query);
    });

    simulation.on('tick', () => {
      link.attr('d', (item) => curvedPath(item.source, item.target));
      node.attr('transform', (item) => `translate(${item.x},${item.y})`);
    });

    simulation.on('end', () => {
      applyFocus(selectedId, query);
      fitView();
    });

    return () => {
      sceneRef.current = null;
      simulation.stop();
    };
  }, [filteredGraph, dims]);

  useEffect(() => {
    sceneRef.current?.applyFocus(selectedNode?.id || null, query);
  }, [query, selectedNode]);

  useEffect(() => {
    if (selectedNode && !filteredGraph?.nodes.some((node) => node.id === selectedNode.id)) {
      setSelectedNode(null);
    }
  }, [filteredGraph, selectedNode]);

  const visibleCount = filteredGraph?.nodes.length || 0;

  return (
    <div className="canvas-wrap">
      <div ref={containerRef} className="graph-canvas" style={{ height: CANVAS_HEIGHT }}>
        {loading && (
          <div className="canvas-overlay">
            <span className="loader-orbit" aria-hidden="true" />
            Mapping knowledge trails...
          </div>
        )}
        {!loading && graph && visibleCount === 0 && (
          <div className="canvas-overlay empty-overlay">
            <span className="empty-glyph" aria-hidden="true">○</span>
            <strong>No notes match these filters</strong>
            <span>Restore a note type or turn off “Orphans only” to widen the map.</span>
          </div>
        )}
        {!loading && !graph && (
          <div className="canvas-overlay">Choose a Confluence space to begin.</div>
        )}
        <svg ref={svgRef} className="graph-svg" />

        {graph && visibleCount > 0 && (
          <div className="canvas-actions">
            <button onClick={() => fitRef.current?.()} title="Zoom to fit all visible notes">
              Fit view
            </button>
          </div>
        )}

        <div className="canvas-legend" aria-label="Graph legend">
          <span><i className="legend-line" /> Connection</span>
          <span><i className="legend-orphan" /> Orphan</span>
          <span className="visible-note-count">{visibleCount} visible notes</span>
        </div>

        {selectedNode && (
          <aside className="node-inspector" aria-label="Selected note details">
            <button className="inspector-close" onClick={() => setSelectedNode(null)} aria-label="Close note details">
              <span aria-hidden="true" />
            </button>
            <span className="inspector-kicker">
              <i style={{ backgroundColor: TYPE_COLORS[selectedNode.type] || TYPE_COLORS.page }} />
              {TYPE_LABELS[selectedNode.type] || selectedNode.type}
            </span>
            <h3>{selectedNode.title}</h3>
            <div className="inspector-meta">
              <span><strong>{selectedNode.degree}</strong> connections</span>
              <span className={selectedNode.orphan ? 'orphan-state' : 'connected-state'}>
                {selectedNode.orphan ? 'Needs a connection' : 'Connected'}
              </span>
            </div>
            <p>
              {selectedNode.orphan
                ? 'This note is waiting for a meaningful link into the knowledge network.'
                : 'Its immediate neighborhood is highlighted in the constellation.'}
            </p>
            {selectedNode.url && (
              <button className="open-note" onClick={() => router.open(selectedNode.url)}>
                Open in Confluence
              </button>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function nodeRadius(node) {
  const baseRadius = node.type === 'source' ? 10.5 : 8.5;
  return Math.min(18, baseRadius + Math.sqrt(node.degree || 0) * 2.1);
}

function truncateTitle(title) {
  return title.length > 34 ? `${title.slice(0, 32)}…` : title;
}

function curvedPath(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const curve = Math.min(26, distance * 0.12);
  const middleX = (source.x + target.x) / 2 - (dy / distance) * curve;
  const middleY = (source.y + target.y) / 2 + (dx / distance) * curve;
  return `M${source.x},${source.y} Q${middleX},${middleY} ${target.x},${target.y}`;
}

export default App;
