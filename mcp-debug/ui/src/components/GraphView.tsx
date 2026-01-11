import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
} from 'reactflow';
import type { Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import type { TraceEvent } from '../api/client';

interface GraphViewProps {
  events: TraceEvent[];
  onSelectEvent?: (event: TraceEvent) => void;
}

// Color coding based on latency and success
function getNodeColor(event: TraceEvent): string {
  if (event.error_json) {
    return '#ef4444'; // Red for errors
  }
  const latency = event.latency_ms ?? 0;
  if (latency < 100) {
    return '#22c55e'; // Green < 100ms
  } else if (latency < 500) {
    return '#eab308'; // Yellow 100-500ms
  } else {
    return '#f97316'; // Orange > 500ms
  }
}

function getNodeBorderColor(event: TraceEvent): string {
  if (event.chaos_applied) {
    return '#a855f7'; // Purple for chaos
  }
  return 'transparent';
}

// Custom node component
function EventNode({ data }: { data: { event: TraceEvent; label: string } }) {
  const { event, label } = data;
  const bgColor = getNodeColor(event);
  const borderColor = getNodeBorderColor(event);
  const hasChaos = !!event.chaos_applied;

  return (
    <div
      className="px-3 py-2 rounded-lg shadow-lg text-white text-sm font-medium min-w-[120px] text-center"
      style={{
        backgroundColor: bgColor,
        border: hasChaos ? `3px solid ${borderColor}` : '1px solid rgba(255,255,255,0.2)',
      }}
    >
      <div className="font-bold truncate max-w-[150px]">{label}</div>
      {event.latency_ms !== null && (
        <div className="text-xs opacity-80 mt-1">{event.latency_ms}ms</div>
      )}
      {hasChaos && (
        <div className="text-xs mt-1 bg-purple-700 rounded px-1">chaos</div>
      )}
    </div>
  );
}

const nodeTypes = {
  event: EventNode,
};

export function GraphView({ events, onSelectEvent }: GraphViewProps) {
  // Show all meaningful events (exclude session_start/end)
  const displayEvents = useMemo(() =>
    events.filter(e =>
      e.event_type === 'rpc_request' ||
      e.event_type === 'rpc_response' ||
      e.event_type === 'tool_call' ||
      e.event_type === 'tool_result' ||
      e.method === 'tools/call' ||
      e.tool_name
    ),
    [events]
  );

  // Create nodes from events
  const nodes: Node[] = useMemo(() => {
    return displayEvents.map((event, index) => {
      // Create a descriptive label
      let label = event.tool_name || event.method || event.event_type || `Event ${event.id}`;
      // Shorten common method names
      if (label.startsWith('tools/')) label = label.replace('tools/', '');
      if (label.startsWith('resources/')) label = label.replace('resources/', 'res/');

      return {
        id: String(event.id),
        type: 'event',
        position: { x: index * 200, y: 100 + (index % 2) * 80 },
        data: {
          event,
          label,
        },
      };
    });
  }, [displayEvents]);

  // Create edges connecting sequential events
  const edges: Edge[] = useMemo(() => {
    if (displayEvents.length < 2) return [];
    return displayEvents.slice(1).map((event, index) => ({
      id: `e${displayEvents[index].id}-${event.id}`,
      source: String(displayEvents[index].id),
      target: String(event.id),
      animated: true,
      style: { stroke: '#6b7280', strokeWidth: 2 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: '#6b7280',
        width: 20,
        height: 20,
      },
    }));
  }, [displayEvents]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const event = displayEvents.find(e => String(e.id) === node.id);
      if (event && onSelectEvent) {
        onSelectEvent(event);
      }
    },
    [displayEvents, onSelectEvent]
  );

  if (displayEvents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        No events to visualize
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#6b7280', strokeWidth: 2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={20} />
        <Controls className="bg-gray-800 border-gray-700" />
        <MiniMap
          nodeColor={(node) => getNodeColor(node.data.event)}
          className="bg-gray-900 border-gray-700"
        />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-gray-800 rounded-lg p-3 text-xs">
        <div className="font-medium mb-2 text-gray-300">Legend</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-500"></div>
            <span className="text-gray-400">&lt; 100ms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-500"></div>
            <span className="text-gray-400">100-500ms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-orange-500"></div>
            <span className="text-gray-400">&gt; 500ms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500"></div>
            <span className="text-gray-400">Error</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded border-2 border-purple-500"></div>
            <span className="text-gray-400">Chaos applied</span>
          </div>
        </div>
      </div>
    </div>
  );
}
