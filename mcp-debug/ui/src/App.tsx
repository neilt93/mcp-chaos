import { useState, useEffect, useCallback } from 'react'
import { DiffViewer } from './components/DiffViewer'
import { ProjectView } from './components/ProjectView'
import { GraphView } from './components/GraphView'
import { api, liveConnection } from './api/client'
import type { Run, TraceEvent, UpdateMessage } from './api/client'

type Tab = 'runs' | 'diff'

// Shared selection state for persisting across tabs
interface SelectionState {
  projectId: string
  agentId: string
  runId: string
}

// Project view selection state (separate, doesn't need runId)
interface ProjectSelectionState {
  projectId: string
  agentId: string
}

// Helper to load state from localStorage
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return defaultValue
}

// Helper to save state to localStorage
function saveToStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>(() => loadFromStorage('mcp-debug-tab', 'runs'))
  const [selectedRun, setSelectedRun] = useState<Run | null>(null)
  const [runEvents, setRunEvents] = useState<TraceEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null)
  const [runViewMode, setRunViewMode] = useState<'timeline' | 'graph'>(() => loadFromStorage('mcp-debug-viewMode', 'timeline'))
  const [loadingEvents, setLoadingEvents] = useState(false)

  // Shared selection state that persists across tabs (for Trace/Stress/Diff)
  const [sharedSelection, setSharedSelection] = useState<SelectionState>(() =>
    loadFromStorage('mcp-debug-sharedSelection', { projectId: '', agentId: '', runId: '' })
  )

  // Project view selection state (persists when viewing run details)
  const [projectSelection, setProjectSelection] = useState<ProjectSelectionState>(() =>
    loadFromStorage('mcp-debug-projectSelection', { projectId: '', agentId: '' })
  )

  // Restore selected run from localStorage on mount
  useEffect(() => {
    const savedRunId = loadFromStorage<string | null>('mcp-debug-runId', null)
    if (savedRunId) {
      api.runs.get(savedRunId)
        .then(({ run }) => setSelectedRun(run))
        .catch(() => {
          // Run no longer exists, clear storage
          saveToStorage('mcp-debug-runId', null)
        })
    }
  }, [])

  // Persist state changes to localStorage
  useEffect(() => { saveToStorage('mcp-debug-tab', activeTab) }, [activeTab])
  useEffect(() => { saveToStorage('mcp-debug-runId', selectedRun?.id ?? null) }, [selectedRun])
  useEffect(() => { saveToStorage('mcp-debug-viewMode', runViewMode) }, [runViewMode])
  useEffect(() => { saveToStorage('mcp-debug-sharedSelection', sharedSelection) }, [sharedSelection])
  useEffect(() => { saveToStorage('mcp-debug-projectSelection', projectSelection) }, [projectSelection])

  // Initialize WebSocket connection on mount
  useEffect(() => {
    liveConnection.connect().catch(console.error)
    return () => liveConnection.disconnect()
  }, [])

  // Callback to refresh events
  const refreshEvents = useCallback((runId: string) => {
    api.traces.getEvents(runId, 500)
      .then(({ events }) => setRunEvents(events))
      .catch(console.error)
  }, [])

  // Load events when a run is selected and subscribe to live updates
  useEffect(() => {
    if (selectedRun) {
      setLoadingEvents(true)
      api.traces.getEvents(selectedRun.id, 500)
        .then(({ events }) => setRunEvents(events))
        .catch(console.error)
        .finally(() => setLoadingEvents(false))

      // Subscribe to live updates for this run
      const unsubscribe = liveConnection.subscribeToRun(selectedRun.id, (msg: UpdateMessage) => {
        if (msg.type === 'event') {
          // Refresh events when a new event is added
          refreshEvents(selectedRun.id)
        } else if (msg.type === 'run_updated' && msg.run) {
          // Update run status
          setSelectedRun(msg.run)
        }
      })

      return () => unsubscribe()
    } else {
      setRunEvents([])
    }
  }, [selectedRun, refreshEvents])

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'runs', label: 'Projects', icon: '📁' },
    { id: 'diff', label: 'Compare Runs', icon: '📝' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-xl font-bold text-white">mcp-debug</h1>
                <p className="text-sm text-slate-400">MCP Reliability Testing Toolkit</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/neilt93/mcp-debug"
                target="_blank"
                className="text-slate-400 hover:text-white transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-800/50 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
                  activeTab === tab.id
                    ? 'text-blue-400 border-blue-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'runs' && (
          selectedRun ? (
            <RunDetail
              run={selectedRun}
              events={runEvents}
              loading={loadingEvents}
              viewMode={runViewMode}
              selectedEvent={selectedEvent}
              onBack={() => setSelectedRun(null)}
              onViewModeChange={setRunViewMode}
              onSelectEvent={setSelectedEvent}
            />
          ) : (
            <ProjectView
              onSelectRun={setSelectedRun}
              selection={projectSelection}
              onSelectionChange={setProjectSelection}
            />
          )
        )}
        {activeTab === 'diff' && (
          <div className="max-w-7xl mx-auto px-4 py-6 h-full overflow-auto">
            <DiffViewer
              selection={sharedSelection}
              onSelectionChange={setSharedSelection}
            />
          </div>
        )}
      </main>
    </div>
  )
}

// Run Detail View Component
interface RunDetailProps {
  run: Run
  events: TraceEvent[]
  loading: boolean
  viewMode: 'timeline' | 'graph'
  selectedEvent: TraceEvent | null
  onBack: () => void
  onViewModeChange: (mode: 'timeline' | 'graph') => void
  onSelectEvent: (event: TraceEvent | null) => void
}

function RunDetail({
  run,
  events,
  loading,
  viewMode,
  selectedEvent,
  onBack,
  onViewModeChange,
  onSelectEvent,
}: RunDetailProps) {
  const statusColors: Record<Run['status'], string> = {
    pending: 'bg-gray-500',
    running: 'bg-blue-500 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
  }

  // Color helpers from TraceViewer
  const getMethodColor = (method: string | null) => {
    if (!method) return 'bg-slate-500/20 text-slate-300 border-slate-500/30'
    if (method.includes('initialize')) return 'bg-purple-500/20 text-purple-300 border-purple-500/30'
    if (method.includes('tools/list')) return 'bg-blue-500/20 text-blue-300 border-blue-500/30'
    if (method.includes('tools/call')) return 'bg-green-500/20 text-green-300 border-green-500/30'
    if (method.includes('notification')) return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
    return 'bg-slate-500/20 text-slate-300 border-slate-500/30'
  }

  const getLatencyColor = (ms: number | null) => {
    if (ms === null) return 'text-slate-500'
    if (ms < 100) return 'text-green-400'
    if (ms < 500) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getEventTypeColor = (type: string) => {
    if (type === 'tool_call') return 'bg-green-500/20 text-green-300'
    if (type === 'tool_result') return 'bg-blue-500/20 text-blue-300'
    if (type === 'rpc_request') return 'bg-purple-500/20 text-purple-300'
    if (type === 'rpc_response') return 'bg-orange-500/20 text-orange-300'
    return 'bg-slate-500/20 text-slate-300'
  }

  // Calculate stats
  const avgLatency = events.filter(e => e.latency_ms !== null).length > 0
    ? Math.round(events.filter(e => e.latency_ms !== null).reduce((a, b) => a + (b.latency_ms || 0), 0) / events.filter(e => e.latency_ms !== null).length)
    : 0
  const errors = events.filter(e => e.error_json).length
  const chaosEvents = events.filter(e => e.chaos_applied).length

  return (
    <div className="h-full flex flex-col bg-slate-900">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="text-slate-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>Run</span>
              <code className="text-sm bg-slate-700 px-2 py-0.5 rounded font-mono">
                {run.id.slice(0, 8)}
              </code>
            </h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${statusColors[run.status]}`}>
              {run.status}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-700 rounded-lg">
              <button
                onClick={() => onViewModeChange('timeline')}
                className={`px-4 py-2 text-sm rounded-l-lg transition-colors ${
                  viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Timeline
              </button>
              <button
                onClick={() => onViewModeChange('graph')}
                className={`px-4 py-2 text-sm rounded-r-lg transition-colors ${
                  viewMode === 'graph' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Graph
              </button>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <div className="text-xs text-slate-400">Total Events</div>
            <div className="text-xl font-bold text-white">{events.length}</div>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <div className="text-xs text-slate-400">Avg Latency</div>
            <div className="text-xl font-bold text-white">{avgLatency}ms</div>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <div className="text-xs text-slate-400">Errors</div>
            <div className={`text-xl font-bold ${errors > 0 ? 'text-red-400' : 'text-white'}`}>{errors}</div>
          </div>
          <div className="bg-slate-700/50 rounded-lg p-3 border border-slate-600">
            <div className="text-xs text-slate-400">Chaos Events</div>
            <div className={`text-xl font-bold ${chaosEvents > 0 ? 'text-orange-400' : 'text-white'}`}>{chaosEvents}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Loading events...
          </div>
        ) : viewMode === 'graph' ? (
          <div className="flex-1 relative">
            <GraphView events={events} onSelectEvent={onSelectEvent} />
          </div>
        ) : (
          <div className="flex-1 flex">
            {/* Event List */}
            <div className="flex-1 divide-y divide-slate-700 overflow-auto">
              {events.map((event) => (
                <div
                  key={event.id}
                  onClick={() => onSelectEvent(event)}
                  className={`p-3 flex items-center gap-4 cursor-pointer transition-colors ${
                    selectedEvent?.id === event.id ? 'bg-slate-700' : 'hover:bg-slate-700/50'
                  }`}
                >
                  <div className="w-20 text-xs text-slate-500 font-mono">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                  <div className={`px-2 py-0.5 rounded text-xs ${getEventTypeColor(event.event_type)}`}>
                    {event.event_type}
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-mono border ${getMethodColor(event.method)}`}>
                    {event.tool_name || event.method || '-'}
                  </div>
                  <div className="flex-1" />
                  <div className={`text-sm font-mono ${getLatencyColor(event.latency_ms)}`}>
                    {event.latency_ms !== null ? `${event.latency_ms}ms` : '-'}
                  </div>
                  {event.error_json && <span className="text-red-400 text-xs">Error</span>}
                  {event.chaos_applied && <span className="text-orange-400 text-xs">Chaos</span>}
                </div>
              ))}
              {events.length === 0 && (
                <div className="text-center text-slate-400 py-8">
                  No events recorded
                </div>
              )}
            </div>

            {/* Event Detail */}
            <div className="w-96 border-l border-slate-700 p-4 overflow-auto bg-slate-800/50">
              {selectedEvent ? (
                <div className="space-y-4">
                  <h3 className="font-medium text-white">Event Details</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <div className="text-slate-400 mb-1">Type</div>
                      <div className={`inline-block px-2 py-0.5 rounded text-xs ${getEventTypeColor(selectedEvent.event_type)}`}>
                        {selectedEvent.event_type}
                      </div>
                    </div>
                    {selectedEvent.method && (
                      <div>
                        <div className="text-slate-400 mb-1">Method</div>
                        <div className={`inline-block px-2 py-1 rounded text-xs font-mono border ${getMethodColor(selectedEvent.method)}`}>
                          {selectedEvent.method}
                        </div>
                      </div>
                    )}
                    {selectedEvent.tool_name && (
                      <div>
                        <div className="text-slate-400 mb-1">Tool</div>
                        <div className="text-white font-mono">{selectedEvent.tool_name}</div>
                      </div>
                    )}
                    {selectedEvent.latency_ms !== null && (
                      <div>
                        <div className="text-slate-400 mb-1">Latency</div>
                        <div className={`font-mono ${getLatencyColor(selectedEvent.latency_ms)}`}>
                          {selectedEvent.latency_ms}ms
                        </div>
                      </div>
                    )}
                    {selectedEvent.params_json && (
                      <div>
                        <div className="text-slate-400 mb-1">Parameters</div>
                        <pre className="bg-slate-900 p-2 rounded text-xs overflow-x-auto max-h-32 text-slate-300">
                          {JSON.stringify(JSON.parse(selectedEvent.params_json), null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedEvent.result_json && (
                      <div>
                        <div className="text-slate-400 mb-1">Result</div>
                        <pre className="bg-slate-900 p-2 rounded text-xs overflow-x-auto max-h-32 text-green-300">
                          {JSON.stringify(JSON.parse(selectedEvent.result_json), null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedEvent.error_json && (
                      <div>
                        <div className="text-slate-400 mb-1">Error</div>
                        <pre className="bg-slate-900 p-2 rounded text-xs overflow-x-auto max-h-32 text-red-300">
                          {JSON.stringify(JSON.parse(selectedEvent.error_json), null, 2)}
                        </pre>
                      </div>
                    )}
                    {selectedEvent.chaos_applied && (
                      <div>
                        <div className="text-slate-400 mb-1">Chaos Applied</div>
                        <div className="text-orange-300">{selectedEvent.chaos_applied}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-gray-400 text-center py-8">
                  Select an event to view details
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
