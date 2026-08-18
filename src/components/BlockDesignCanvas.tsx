import { useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStoreApi,
  type EdgeMouseHandler,
  type Connection,
  type OnNodeDrag,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { BlockDesignDocument, BlockPort } from "../model";
import type { LayoutResult, SelectionRef, StudioFlowEdge, StudioFlowNode } from "../studio/types";
import { BlockNodeComponent } from "./BlockNode";
import { InterfaceEdgeComponent } from "./InterfaceEdge";

const nodeTypes = { block: BlockNodeComponent };
const edgeTypes = { interface: InterfaceEdgeComponent };
const FIT_PADDING = 0.28;

const toneColors: Record<string, string> = {
  ui: "#2878a9",
  core: "#b34a3b",
  tool: "#3f7e47",
  platform: "#a76b1d",
  plugin: "#7457a6",
  neutral: "#65716a",
};

function fitDuration(): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
}

function CanvasInner({
  document,
  layout,
  selection,
  fitRequest,
  routeRevision,
  onSelect,
  onToggleHierarchy,
  onMoveNode,
  onCreateConnection,
}: {
  document: BlockDesignDocument;
  layout: LayoutResult;
  selection: SelectionRef;
  fitRequest: number;
  routeRevision: number;
  onSelect: (selection: SelectionRef) => void;
  onToggleHierarchy: (levelId: string) => void;
  onMoveNode: (levelId: string, nodeId: string, position: { x: number; y: number }) => void;
  onCreateConnection: (connection: {
    levelId: string;
    source: { nodeId: string; portId: string; label: string };
    target: { nodeId: string; portId: string; label: string };
  }) => void;
}) {
  const { fitView } = useReactFlow();
  const store = useStoreApi();
  const baseNodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          toggleHierarchy: onToggleHierarchy,
          inspectPort: (nodeId: string, port: BlockPort) =>
            onSelect({ kind: "port", levelId: node.data.levelId, nodeId, portId: port.id }),
        },
      })),
    [layout.nodes, onSelect, onToggleHierarchy],
  );
  const baseEdges = useMemo<StudioFlowEdge[]>(
    () =>
      layout.edges.map<StudioFlowEdge>((edge) => {
        const data = edge.data;
        if (!data) throw new Error(`Layout edge ${edge.id} is missing interface data.`);
        return {
          ...edge,
          data: {
            ...data,
            laneSeparation: layout.edges.length > 8,
            inspect: () =>
              onSelect({ kind: "connection", levelId: data.levelId, connectionId: data.connection.id }),
          },
        };
      }),
    [layout.edges, onSelect],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioFlowNode>(baseNodes);
  const edges = useMemo<StudioFlowEdge[]>(
    () => baseEdges.map((edge) => ({
      ...edge,
      selected:
        selection.kind === "connection" &&
        selection.levelId === edge.data?.levelId &&
        selection.connectionId === edge.data.connection.id,
      data: edge.data ? { ...edge.data, routeRevision } : edge.data,
    })),
    [baseEdges, routeRevision, selection],
  );

  useEffect(() => {
    setNodes(baseNodes);
  }, [baseNodes, setNodes]);

  useEffect(() => {
    if (baseNodes.length === 0) return;
    const retry = window.setTimeout(() => {
      const state = store.getState();
      const updates = new Map();
      baseNodes.forEach((node) => {
        const nodeElement = state.domNode?.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${node.id}"]`,
        );
        if (nodeElement) updates.set(node.id, { id: node.id, nodeElement, force: true });
      });
      state.updateNodeInternals(updates, { triggerFitView: false });
    }, 120);
    return () => window.clearTimeout(retry);
  }, [baseNodes, store]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      selected:
        selection.kind === "node" &&
        selection.levelId === node.data.levelId &&
        selection.nodeId === node.data.block.id,
    })));
  }, [selection, setNodes]);

  useEffect(() => {
    if (fitRequest <= 0) return;
    const timer = window.setTimeout(() => fitView({ padding: FIT_PADDING, duration: fitDuration() }), 60);
    return () => window.clearTimeout(timer);
  }, [fitRequest, fitView]);

  const onNodeClick: NodeMouseHandler<StudioFlowNode> = (_, node) => {
    onSelect({ kind: "node", levelId: node.data.levelId, nodeId: node.data.block.id });
  };
  const onNodeDoubleClick: NodeMouseHandler<StudioFlowNode> = (_, node) => {
    if (node.data.block.hierarchy) onToggleHierarchy(node.data.block.hierarchy.childLevelId);
  };
  const onEdgeClick: EdgeMouseHandler<StudioFlowEdge> = (_, edge) => {
    if (!edge.data) return;
    onSelect({ kind: "connection", levelId: edge.data.levelId, connectionId: edge.data.connection.id });
  };

  const resolveEndpoint = (flowNodeId: string | null, handleId: string | null | undefined) => {
    if (!flowNodeId || !handleId) return undefined;
    const flowNode = baseNodes.find((node) => node.id === flowNodeId);
    const port = flowNode?.data.block.ports.find((candidate) => candidate.id === handleId);
    if (!flowNode || !port) return undefined;
    return {
      levelId: flowNode.data.levelId,
      nodeId: flowNode.data.block.id,
      portId: port.id,
      label: port.label,
      direction: port.direction,
    };
  };

  const normalizedConnection = (connection: Connection | StudioFlowEdge) => {
    const first = resolveEndpoint(connection.source, connection.sourceHandle);
    const second = resolveEndpoint(connection.target, connection.targetHandle);
    if (!first || !second || first.levelId !== second.levelId) return undefined;
    if (first.nodeId === second.nodeId && first.portId === second.portId) return undefined;
    if (first.direction !== "input" && second.direction !== "output") {
      return { levelId: first.levelId, source: first, target: second };
    }
    if (second.direction !== "input" && first.direction !== "output") {
      return { levelId: first.levelId, source: second, target: first };
    }
    return undefined;
  };

  const onNodeDragStop: OnNodeDrag<StudioFlowNode> = (_, node) => {
    if (!node.data.positionEditable) return;
    const original = baseNodes.find((candidate) => candidate.id === node.id);
    if (!original) return;
    onMoveNode(node.data.levelId, node.data.block.id, {
      x: Math.round(node.data.designPosition.x + node.position.x - original.position.x),
      y: Math.round(node.data.designPosition.y + node.position.y - original.position.y),
    });
  };

  const entryLevel = document.levels.find((level) => level.id === document.entryLevelId)!;

  return (
    <ReactFlow<StudioFlowNode, StudioFlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onEdgeClick={onEdgeClick}
      onConnect={(connection) => {
        const normalized = normalizedConnection(connection);
        if (normalized) onCreateConnection(normalized);
      }}
      isValidConnection={(connection) => Boolean(normalizedConnection(connection))}
      onError={(code, message) => console.warn(`[React Flow ${code}] ${message}`)}
      onPaneClick={() => onSelect({ kind: "level", levelId: document.entryLevelId })}
      connectionMode={ConnectionMode.Loose}
      nodesConnectable
      edgesReconnectable={false}
      snapToGrid
      snapGrid={[16, 16]}
      minZoom={0.18}
      maxZoom={2.4}
      panOnScroll
      selectionOnDrag
      fitView
      fitViewOptions={{ padding: FIT_PADDING }}
      proOptions={{ hideAttribution: true }}
      deleteKeyCode={null}
      className="bd-react-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#c7ccc8" />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(node) => toneColors[(node as StudioFlowNode).data.block.tone] ?? toneColors.neutral}
        maskColor="rgba(226, 230, 226, 0.72)"
      />
      <Panel
        position="top-left"
        className="bd-canvas-caption"
      >
        <strong>{entryLevel.title}</strong>
        <span>{entryLevel.description}</span>
      </Panel>
    </ReactFlow>
  );
}

export function BlockDesignCanvas(props: Parameters<typeof CanvasInner>[0]) {
  return <CanvasInner {...props} />;
}
