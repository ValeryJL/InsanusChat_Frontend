import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  User,
  Bot,
  Wrench,
  CornerDownRight,
  Crosshair,
  Minimize2,
  LayoutGrid,
} from 'lucide-react';
import { ChatMessage } from '../types';

interface TreeGraphViewProps {
  messages: ChatMessage[];
  activePathIds: Set<string>;
  selectedNodeId: string | null;
  onSelectNode: (messageId: string) => void;
  onBranchFromNode: (message: ChatMessage) => void;
}

type GraphDisplayMode = 'detailed' | 'compact' | 'collapsed';

interface PositionedNode {
  msg: ChatMessage;
  x: number;
  y: number;
  depth: number;
  branchIndex: number;
  siblingCount: number;
  collapsedCount: number;
}

export const TreeGraphView: React.FC<TreeGraphViewProps> = ({
  messages,
  activePathIds,
  selectedNodeId,
  onSelectNode,
  onBranchFromNode,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displayMode, setDisplayMode] = useState<GraphDisplayMode>('detailed');
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [zoom, setZoom] = useState(0.95);
  const [pan, setPan] = useState({ x: 40, y: 36 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);

  const nodeWidth = displayMode === 'compact' ? 176 : 232;
  const nodeHeight = displayMode === 'compact' ? 62 : 98;
  const hGap = displayMode === 'compact' ? 28 : 42;
  const vGap = displayMode === 'compact' ? 40 : 58;

  const { nodes, edges, canvasWidth, canvasHeight, positionedMap } = useMemo(() => {
    if (!messages.length) {
      return {
        nodes: [] as PositionedNode[],
        edges: [] as { from: PositionedNode; to: PositionedNode; collapsedCount: number }[],
        canvasWidth: 800,
        canvasHeight: 500,
        positionedMap: new Map<string, PositionedNode>(),
      };
    }

    const byId = new Map<string, ChatMessage>();
    messages.forEach((m) => byId.set(m._id, m));

    const childrenMap = new Map<string, ChatMessage[]>();
    const roots: ChatMessage[] = [];

    messages.forEach((m) => {
      if (!m.parent_id || !byId.has(m.parent_id)) {
        roots.push(m);
      } else {
        const list = childrenMap.get(m.parent_id) || [];
        list.push(m);
        childrenMap.set(m.parent_id, list);
      }
    });

    const isKeyNode = (m: ChatMessage): boolean => {
      if (displayMode !== 'collapsed') return true;
      if (!m.parent_id || !byId.has(m.parent_id)) return true;
      const kids = childrenMap.get(m._id) || [];
      if (kids.length !== 1) return true;
      const parentKids = childrenMap.get(m.parent_id) || [];
      if (parentKids.length > 1) return true;
      if (m._id === selectedNodeId) return true;
      return false;
    };

    const effectiveChildren = new Map<string, { child: ChatMessage; skipped: number }[]>();

    const resolveNextKeyDescendants = (
      startNode: ChatMessage
    ): { child: ChatMessage; skipped: number }[] => {
      const directKids = childrenMap.get(startNode._id) || [];
      const result: { child: ChatMessage; skipped: number }[] = [];

      for (const k of directKids) {
        let curr = k;
        let skipped = 0;
        while (!isKeyNode(curr)) {
          const nextKids = childrenMap.get(curr._id) || [];
          if (nextKids.length === 1) {
            skipped += 1;
            curr = nextKids[0];
          } else {
            break;
          }
        }
        result.push({ child: curr, skipped });
      }
      return result;
    };

    const visibleNodesSet = new Set<string>();
    const queue = [...roots];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visibleNodesSet.has(curr._id)) continue;
      visibleNodesSet.add(curr._id);
      const nexts = resolveNextKeyDescendants(curr);
      effectiveChildren.set(curr._id, nexts);
      nexts.forEach((n) => queue.push(n.child));
    }

    const positioned = new Map<string, PositionedNode>();
    let leafCursor = 0;
    let maxDepth = 0;

    function layoutDFS(
      node: ChatMessage,
      depth: number,
      bIdx: number,
      sibCount: number,
      collapsedBefore: number
    ): number {
      maxDepth = Math.max(maxDepth, depth);
      const childrenEntries = effectiveChildren.get(node._id) || [];
      let myX = 0;

      if (childrenEntries.length === 0) {
        myX = leafCursor * (nodeWidth + hGap);
        leafCursor += 1;
      } else {
        const childXs = childrenEntries.map((entry, idx) =>
          layoutDFS(entry.child, depth + 1, idx, childrenEntries.length, entry.skipped)
        );
        myX = (childXs[0] + childXs[childXs.length - 1]) / 2;
      }

      const myY = depth * (nodeHeight + vGap);
      positioned.set(node._id, {
        msg: node,
        x: myX,
        y: myY,
        depth,
        branchIndex: bIdx,
        siblingCount: sibCount,
        collapsedCount: collapsedBefore,
      });
      return myX;
    }

    roots.forEach((r, idx) => layoutDFS(r, 0, idx, roots.length, 0));

    const nodeList = Array.from(positioned.values());
    const edgeList: { from: PositionedNode; to: PositionedNode; collapsedCount: number }[] = [];

    nodeList.forEach((n) => {
      const entries = effectiveChildren.get(n.msg._id) || [];
      entries.forEach((entry) => {
        const targetPos = positioned.get(entry.child._id);
        if (targetPos) {
          edgeList.push({
            from: n,
            to: targetPos,
            collapsedCount: entry.skipped,
          });
        }
      });
    });

    const width = Math.max(800, leafCursor * (nodeWidth + hGap) + 240);
    const height = Math.max(500, (maxDepth + 1) * (nodeHeight + vGap) + 240);

    return {
      nodes: nodeList,
      edges: edgeList,
      canvasWidth: width,
      canvasHeight: height,
      positionedMap: positioned,
    };
  }, [messages, displayMode, selectedNodeId, nodeWidth, nodeHeight, hGap, vGap]);

  const centerOnNode = useCallback(
    (node: PositionedNode, customZoom?: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const z = customZoom ?? zoom;
      const targetX = rect.width / 2 - (node.x + nodeWidth / 2) * z;
      const targetY = rect.height / 2 - (node.y + nodeHeight / 2) * z;
      setPan({ x: Math.round(targetX), y: Math.round(targetY) });
    },
    [zoom, nodeWidth, nodeHeight]
  );

  const fitTreeToScreen = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + nodeWidth);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + nodeHeight);
    });

    const treeW = Math.max(1, maxX - minX);
    const treeH = Math.max(1, maxY - minY);
    const padding = 68;
    const scaleX = (rect.width - padding * 2) / treeW;
    const scaleY = (rect.height - padding * 2) / treeH;
    const newZoom = Math.max(0.3, Math.min(1.15, +Math.min(scaleX, scaleY).toFixed(2)));

    const centerX = minX + treeW / 2;
    const centerY = minY + treeH / 2;
    setZoom(newZoom);
    setPan({
      x: Math.round(rect.width / 2 - centerX * newZoom),
      y: Math.round(rect.height / 2 - centerY * newZoom),
    });
  }, [nodes, nodeWidth, nodeHeight]);

  const prevMsgCountRef = useRef<number>(0);
  useEffect(() => {
    if (nodes.length === 0) return;
    const targetNode =
      (selectedNodeId && positionedMap.get(selectedNodeId)) || nodes[nodes.length - 1];

    if (autoFollow && targetNode) {
      centerOnNode(targetNode);
    } else if (messages.length > prevMsgCountRef.current && targetNode) {
      centerOnNode(targetNode);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, selectedNodeId, displayMode]);

  // Mouse pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-tree-node]')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setDragging(false);

  // Touch pan & pinch-to-zoom (móvil / tablet)
  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('[data-tree-node]')) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      setDragging(true);
      setDragStart({ x: t.clientX - pan.x, y: t.clientY - pan.y });
      pinchStartRef.current = null;
    } else if (e.touches.length === 2) {
      setDragging(false);
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartRef.current = { dist: Math.hypot(dx, dy), zoom };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && dragging) {
      const t = e.touches[0];
      setPan({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y });
    } else if (e.touches.length === 2 && pinchStartRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchStartRef.current.dist > 0) {
        const ratio = dist / pinchStartRef.current.dist;
        const nextZoom = Math.max(0.25, Math.min(1.6, +(pinchStartRef.current.zoom * ratio).toFixed(2)));
        setZoom(nextZoom);
      }
    }
  };

  const handleTouchEnd = () => {
    setDragging(false);
    pinchStartRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      setZoom((z) => Math.max(0.25, Math.min(1.6, +(z + delta).toFixed(2))));
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-[#09090b] overflow-hidden select-none flex flex-col"
    >
      {/* Top-Left Floating Pill: Modos de visualización del árbol */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-0.5 p-0.5 rounded-lg bg-[#11131a]/90 border border-white/[0.08] backdrop-blur-md shadow-xl shadow-black/50 text-[11px]">
        <button
          type="button"
          onClick={() => setDisplayMode('detailed')}
          className={`h-7 px-2.5 rounded-md font-medium transition ${
            displayMode === 'detailed'
              ? 'bg-white/[0.11] text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Ver todos los mensajes con detalle"
        >
          Detallado
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('compact')}
          className={`h-7 px-2.5 rounded-md font-medium transition ${
            displayMode === 'compact'
              ? 'bg-white/[0.11] text-zinc-100'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Nodos compactos para ver más árbol"
        >
          Compacto
        </button>
        <button
          type="button"
          onClick={() => {
            setDisplayMode('collapsed');
            setTimeout(fitTreeToScreen, 60);
          }}
          className={`h-7 px-2.5 rounded-md font-medium flex items-center gap-1 transition ${
            displayMode === 'collapsed'
              ? 'bg-amber-500/20 text-amber-300'
              : 'text-zinc-400 hover:text-amber-300'
          }`}
          title="Colapsar tramos lineales y mostrar solo raíces, bifurcaciones y puntas"
        >
          <Minimize2 className="w-3 h-3" />
          <span>Ramas</span>
        </button>
      </div>

      {/* Bottom-Right Floating Bar (Estilo Figma / Linear): Navegación & Zoom */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-0.5 p-0.5 rounded-lg bg-[#11131a]/90 border border-white/[0.08] backdrop-blur-md shadow-xl shadow-black/50 text-[11px]">
        <button
          type="button"
          onClick={() => {
            const next = !autoFollow;
            setAutoFollow(next);
            if (next && nodes.length > 0) {
              const target =
                (selectedNodeId && positionedMap.get(selectedNodeId)) || nodes[nodes.length - 1];
              if (target) centerOnNode(target);
            }
          }}
          className={`h-7 px-2 rounded-md flex items-center gap-1 font-medium transition ${
            autoFollow
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
          }`}
          title="Seguir automáticamente el nodo activo"
        >
          <Crosshair className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Seguir</span>
        </button>

        <button
          type="button"
          onClick={fitTreeToScreen}
          className="h-7 px-2 rounded-md hover:bg-white/[0.06] text-zinc-300 flex items-center gap-1 font-medium transition"
          title="Encuadrar todo el árbol"
        >
          <LayoutGrid className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">Encuadrar</span>
        </button>

        <div className="h-4 w-px bg-white/[0.08] mx-0.5" />

        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.15).toFixed(2)))}
          className="w-7 h-7 rounded-md hover:bg-white/[0.06] text-zinc-300 flex items-center justify-center transition"
          title="Alejar"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] font-mono text-zinc-400 px-1 tabular-nums min-w-[38px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
          className="w-7 h-7 rounded-md hover:bg-white/[0.06] text-zinc-300 flex items-center justify-center transition"
          title="Acercar"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (nodes.length > 0) {
              const target =
                (selectedNodeId && positionedMap.get(selectedNodeId)) || nodes[nodes.length - 1];
              if (target) centerOnNode(target);
            }
          }}
          className="w-7 h-7 rounded-md hover:bg-white/[0.06] text-zinc-300 flex items-center justify-center transition"
          title="Centrar en nodo seleccionado"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lienzo Pan & Zoom con soporte táctil */}
      <div
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
        className={`flex-1 w-full h-full touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: canvasWidth,
            height: canvasHeight,
            transition: dragging ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
          className="relative"
        >
          {/* Conexiones SVG (Curvas Bézier) */}
          <svg width={canvasWidth} height={canvasHeight} className="absolute inset-0 pointer-events-none">
            {edges.map((edge, idx) => {
              const x1 = edge.from.x + nodeWidth / 2;
              const y1 = edge.from.y + nodeHeight;
              const x2 = edge.to.x + nodeWidth / 2;
              const y2 = edge.to.y;
              const cy1 = y1 + vGap * 0.5;
              const cy2 = y2 - vGap * 0.5;
              const isActiveEdge =
                activePathIds.has(edge.from.msg._id) && activePathIds.has(edge.to.msg._id);
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;

              return (
                <g key={idx}>
                  <path
                    d={`M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={isActiveEdge ? '#10b981' : '#27272a'}
                    strokeWidth={isActiveEdge ? 2.25 : 1.5}
                    strokeDasharray={edge.collapsedCount > 0 ? '5 4' : isActiveEdge ? undefined : '4 3'}
                  />
                  {edge.collapsedCount > 0 && (
                    <g transform={`translate(${midX - 42}, ${midY - 10})`}>
                      <rect
                        width="84"
                        height="20"
                        rx="10"
                        fill="#11131a"
                        stroke={isActiveEdge ? '#10b981' : '#3f3f46'}
                        strokeWidth="1"
                      />
                      <text
                        x="42"
                        y="13"
                        textAnchor="middle"
                        fill={isActiveEdge ? '#6ee7b7' : '#a1a1aa'}
                        fontSize="10"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        +{edge.collapsedCount} ocultos
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Nodos de Mensajes */}
          {nodes.map((node) => {
            const { msg } = node;
            const isUser = msg.role === 'user';
            const isInActiveBranch = activePathIds.has(msg._id);
            const isSelected = selectedNodeId === msg._id;
            const childCount = msg.children_ids?.length || 0;
            const isLeafTip = childCount === 0;
            const isForkPoint = childCount > 1;

            return (
              <div
                key={msg._id}
                data-tree-node="true"
                onClick={() => {
                  centerOnNode(node);
                  onSelectNode(msg._id);
                }}
                style={{
                  left: node.x,
                  top: node.y,
                  width: nodeWidth,
                  height: nodeHeight,
                }}
                className={`absolute rounded-xl p-2.5 flex flex-col justify-between cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-[#161922] border-amber-400/70 ring-1 ring-amber-400/40 shadow-lg shadow-black/60'
                    : isInActiveBranch
                    ? isUser
                      ? 'bg-[#13191d] border-emerald-500/45 shadow-md shadow-black/50'
                      : 'bg-[#14171f] border-white/[0.16] shadow-md shadow-black/50'
                    : 'bg-[#11131a]/75 border-white/[0.06] opacity-65 hover:opacity-100'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px]">
                  <span
                    className={`flex items-center gap-1 font-medium truncate ${
                      isUser ? 'text-emerald-400' : 'text-zinc-300'
                    }`}
                  >
                    {isUser ? <User className="w-3 h-3 shrink-0" /> : <Bot className="w-3 h-3 shrink-0 text-sky-400" />}
                    <span>{isUser ? 'Vos' : 'Agente'}</span>
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    {node.siblingCount > 1 && (
                      <span className="px-1.5 rounded bg-amber-500/15 text-amber-300 font-mono text-[9px]">
                        {node.branchIndex + 1}/{node.siblingCount}
                      </span>
                    )}
                    {isForkPoint && (
                      <span className="px-1.5 rounded bg-white/[0.08] text-zinc-300 text-[9px]">
                        {childCount} ramas
                      </span>
                    )}
                  </div>
                </div>

                <p
                  className={`text-[11px] text-zinc-300 leading-snug ${
                    displayMode === 'compact' ? 'line-clamp-1' : 'line-clamp-2'
                  }`}
                >
                  {msg.content.replace(/[#*`>]/g, '').slice(0, 85)}
                </p>

                {displayMode !== 'compact' && (
                  <div className="flex items-center justify-between pt-1 border-t border-white/[0.05] text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1.5 font-mono">
                      {msg.tool_calls && msg.tool_calls.length > 0 && (
                        <span className="flex items-center gap-0.5 text-zinc-400">
                          <Wrench className="w-2.5 h-2.5 text-emerald-400" />
                          {msg.tool_calls.length}
                        </span>
                      )}
                      <span>#{node.depth + 1}</span>
                    </span>

                    {!isLeafTip && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          centerOnNode(node);
                          onBranchFromNode(msg);
                        }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-emerald-500/20 text-zinc-300 hover:text-emerald-300 transition"
                        title="Abrir una nueva rama desde aquí"
                      >
                        <CornerDownRight className="w-2.5 h-2.5" />
                        <span>Ramificar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
