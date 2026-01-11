import { useState, useEffect } from 'react'
import { api, liveConnection } from '../api/client'
import type { Project, Agent, Run, TraceEvent, UpdateMessage } from '../api/client'
import { GraphView } from './GraphView'

type ViewMode = 'timeline' | 'graph'

interface SelectionState {
  projectId: string
  agentId: string
  runId: string
}

interface TraceViewerProps {
  selection: SelectionState
  onSelectionChange: (selection: SelectionState) => void
}

export function TraceViewer({ selection, onSelectionChange }: TraceViewerProps) {
  // Data state
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [events, setEvents] = useState<TraceEvent[]>([])

  // Local selection mirrors the shared state
  const selectedProjectId = selection.projectId
  const selectedAgentId = selection.agentId
  const selectedRunId = selection.runId

  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null)

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [loading, setLoading] = useState(false)

  // Load projects on mount
  useEffect(() => {
    api.projects.list().then(({ projects }) => setProjects(projects)).catch(console.error)
  }, [])

  // Load agents when project changes
  useEffect(() => {
    if (selectedProjectId) {
      api.projects.listAgents(selectedProjectId)
        .then(({ agents }) => setAgents(agents))
        .catch(console.error)
    } else {
      setAgents([])
    }
  }, [selectedProjectId])

  // Load runs when agent changes and subscribe to updates
  useEffect(() => {
    if (selectedAgentId) {
      const loadRuns = () => {
        api.agents.listRuns(selectedAgentId, { limit: 50 })
          .then(({ runs }) => setRuns(runs))
          .catch(console.error)
      }
      loadRuns()

      // Subscribe to agent updates for new/updated runs
      const unsubscribe = liveConnection.subscribeToAgent(selectedAgentId, (msg: UpdateMessage) => {
        if (msg.type === 'run_created' || msg.type === 'run_updated') {
          loadRuns()
        }
      })

      return () => unsubscribe()
    } else {
      setRuns([])
    }
  }, [selectedAgentId])

  // Load events when run changes and subscribe to updates
  useEffect(() => {
    if (selectedRunId) {
      const loadEvents = () => {
        api.traces.getEvents(selectedRunId, 500)
          .then(({ events }) => setEvents(events))
          .catch(console.error)
          .finally(() => setLoading(false))
      }
      setLoading(true)
      loadEvents()

      // Subscribe to run updates for real-time event updates
      const unsubscribe = liveConnection.subscribeToRun(selectedRunId, (msg: UpdateMessage) => {
        if (msg.type === 'event') {
          loadEvents()
        }
      })

      return () => unsubscribe()
    } else {
      setEvents([])
    }
    setSelectedEvent(null)
  }, [selectedRunId])

  const handleProjectChange = (projectId: string) => {
    onSelectionChange({ projectId, agentId: '', runId: '' })
  }

  const handleAgentChange = (agentId: string) => {
    onSelectionChange({ ...selection, agentId, runId: '' })
  }

  const handleRunChange = (runId: string) => {
    onSelectionChange({ ...selection, runId })
  }

  const selectedRun = runs.find(r => r.id === selectedRunId)

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
    <div className="space-y-6">
      {/* Selectors */}
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <h3 className="text-sm font-medium text-slate-400 mb-3">Select a Run to View</h3>
        <div className="grid grid-cols-3 gap-4">
          {/* Project Selector */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Project</label>
            <select
              value={selectedProjectId}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">Select project...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Agent Selector */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Agent</label>
            <select
              value={selectedAgentId}
              onChange={(e) => handleAgentChange(e.target.value)}
              disabled={!selectedProjectId}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            >
              <option value="">Select agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Run Selector */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Run</label>
            <select
              value={selectedRunId}
              onChange={(e) => handleRunChange(e.target.value)}
              disabled={!selectedAgentId}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            >
              <option value="">Select run...</option>
              {runs.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name || r.id.slice(0, 8)} ({r.total_calls} calls) - {r.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Show trace if loaded */}
      {selectedRun && events.length > 0 && (
        <>
          {/* Header Stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Total Events</div>
              <div className="text-2xl font-bold text-white">{events.length}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Avg Latency</div>
              <div className="text-2xl font-bold text-white">{avgLatency}ms</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Errors</div>
              <div className="text-2xl font-bold text-red-400">{errors}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Chaos Events</div>
              <div className="text-2xl font-bold text-orange-400">{chaosEvents}</div>
            </div>
          </div>

          {/* View Mode Toggle */}
          <div className="bg-slate-800 rounded-lg border border-slate-700">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="font-medium text-white">
                  {selectedRun.name || selectedRun.id.slice(0, 8)}
                </h2>
                <p className="text-sm text-slate-400">{selectedRun.target}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex bg-slate-700 rounded-lg">
                  <button
                    onClick={() => setViewMode('timeline')}
                    className={`px-4 py-2 text-sm rounded-l-lg transition-colors ${
                      viewMode === 'timeline' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Timeline
                  </button>
                  <button
                    onClick={() => setViewMode('graph')}
                    className={`px-4 py-2 text-sm rounded-r-lg transition-colors ${
                      viewMode === 'graph' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Graph
                  </button>
                </div>
              </div>
            </div>

            {viewMode === 'graph' ? (
              <div className="h-[500px]">
                <GraphView events={events} onSelectEvent={setSelectedEvent} />
              </div>
            ) : (
              <div className="flex">
                {/* Timeline */}
                <div className="flex-1 divide-y divide-slate-700 max-h-96 overflow-y-auto scrollbar-thin">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
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
                      {event.error_json && <span className="text-red-400">Error</span>}
                      {event.chaos_applied && <span className="text-orange-400">Chaos</span>}
                    </div>
                  ))}
                </div>

                {/* Selected Event Detail */}
                <div className="w-96 border-l border-slate-700 p-4 max-h-96 overflow-y-auto">
                  {selectedEvent ? (
                    <div className="space-y-4">
                      <h3 className="font-medium text-white">Event Details</h3>
                      <div className="space-y-3 text-sm">
                        <div>
                          <div className="text-slate-400 mb-1">Type</div>
                          <div className="text-white">{selectedEvent.event_type}</div>
                        </div>
                        {selectedEvent.method && (
                          <div>
                            <div className="text-slate-400 mb-1">Method</div>
                            <div className="text-white">{selectedEvent.method}</div>
                          </div>
                        )}
                        {selectedEvent.tool_name && (
                          <div>
                            <div className="text-slate-400 mb-1">Tool</div>
                            <div className="text-white">{selectedEvent.tool_name}</div>
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
                    <div className="text-slate-500 text-center py-8">
                      Select an event to view details
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center text-slate-400 py-8">
          Loading events...
        </div>
      )}

      {/* Empty state */}
      {!selectedRunId && (
        <div className="text-center text-slate-500 py-8 border-2 border-dashed border-slate-700 rounded-xl">
          <div className="text-4xl mb-4">📊</div>
          <h3 className="text-lg font-medium text-slate-300 mb-2">Select a Run to View</h3>
          <p className="text-slate-500">Choose a project, agent, and run from the dropdowns above</p>
        </div>
      )}

      {selectedRunId && events.length === 0 && !loading && (
        <div className="text-center text-slate-500 py-8">
          No events recorded for this run
        </div>
      )}
    </div>
  )
}
