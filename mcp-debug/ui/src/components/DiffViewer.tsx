import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { Project, Agent, Run, TraceEvent } from '../api/client'

interface SelectionState {
  projectId: string
  agentId: string
  runId: string
}

interface DiffViewerProps {
  selection: SelectionState
  onSelectionChange: (selection: SelectionState) => void
}

interface RunSelection {
  projectId: string
  agentId: string
  runId: string
  projects: Project[]
  agents: Agent[]
  runs: Run[]
  events: TraceEvent[]
}

interface CallDiff {
  method: string
  tool?: string
  params?: unknown
  index: number
}

interface CallChange {
  method: string
  tool?: string
  index: number
  baselineParams?: unknown
  currentParams?: unknown
  baselineResult?: unknown
  currentResult?: unknown
}

interface LatencyChange {
  method: string
  tool?: string
  index: number
  baselineLatency: number
  currentLatency: number
  changePercent: number
}

interface Comparison {
  baselineCalls: number
  currentCalls: number
  added: CallDiff[]
  removed: CallDiff[]
  changed: CallChange[]
  latencyChanges: LatencyChange[]
}

function RunSelector({
  label,
  selection,
  onChange,
  otherRunId
}: {
  label: string
  selection: RunSelection
  onChange: (sel: Partial<RunSelection>) => void
  otherRunId?: string
}) {
  const selectedRun = selection.runs.find(r => r.id === selection.runId)
  const selectedAgent = selection.agents.find(a => a.id === selection.agentId)
  const selectedProject = selection.projects.find(p => p.id === selection.projectId)

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <h3 className="text-lg font-medium text-slate-200 mb-4">{label}</h3>

      {/* Project */}
      <div className="mb-3">
        <label className="block text-xs text-slate-500 mb-1">Project</label>
        <select
          value={selection.projectId}
          onChange={(e) => onChange({ projectId: e.target.value, agentId: '', runId: '', agents: [], runs: [], events: [] })}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">Select project...</option>
          {selection.projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Agent */}
      <div className="mb-3">
        <label className="block text-xs text-slate-500 mb-1">Agent</label>
        <select
          value={selection.agentId}
          onChange={(e) => onChange({ agentId: e.target.value, runId: '', runs: [], events: [] })}
          disabled={!selection.projectId}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
        >
          <option value="">Select agent...</option>
          {selection.agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Run */}
      <div className="mb-3">
        <label className="block text-xs text-slate-500 mb-1">Run</label>
        <select
          value={selection.runId}
          onChange={(e) => onChange({ runId: e.target.value, events: [] })}
          disabled={!selection.agentId}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
        >
          <option value="">Select run...</option>
          {selection.runs.map(r => (
            <option key={r.id} value={r.id} disabled={r.id === otherRunId}>
              {r.name || r.id.slice(0, 8)} ({r.total_calls} calls) - {r.status}
            </option>
          ))}
        </select>
      </div>

      {/* Selected info */}
      {selectedRun && (
        <div className="text-sm text-slate-400 mt-4 p-3 bg-slate-700/50 rounded">
          <div><span className="text-slate-500">Project:</span> {selectedProject?.name}</div>
          <div><span className="text-slate-500">Agent:</span> {selectedAgent?.name}</div>
          <div><span className="text-slate-500">Run:</span> {selectedRun.id.slice(0, 8)}...</div>
          <div><span className="text-slate-500">Events:</span> {selection.events.length}</div>
        </div>
      )}
    </div>
  )
}

export function DiffViewer({ selection: _selection, onSelectionChange: _onSelectionChange }: DiffViewerProps) {
  // Initialize both selectors with shared projects list
  const [projects, setProjects] = useState<Project[]>([])

  const [baseline, setBaseline] = useState<RunSelection>({
    projectId: '',
    agentId: '',
    runId: '',
    projects: [],
    agents: [],
    runs: [],
    events: [],
  })

  const [current, setCurrent] = useState<RunSelection>({
    projectId: '',
    agentId: '',
    runId: '',
    projects: [],
    agents: [],
    runs: [],
    events: [],
  })

  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [loading, setLoading] = useState(false)

  // Load projects on mount
  useEffect(() => {
    api.projects.list().then(({ projects }) => {
      setProjects(projects)
      setBaseline(b => ({ ...b, projects }))
      setCurrent(c => ({ ...c, projects }))
    }).catch(console.error)
  }, [])

  // Load agents when baseline project changes
  useEffect(() => {
    if (baseline.projectId) {
      api.projects.listAgents(baseline.projectId)
        .then(({ agents }) => setBaseline(b => ({ ...b, agents })))
        .catch(console.error)
    }
  }, [baseline.projectId])

  // Load agents when current project changes
  useEffect(() => {
    if (current.projectId) {
      api.projects.listAgents(current.projectId)
        .then(({ agents }) => setCurrent(c => ({ ...c, agents })))
        .catch(console.error)
    }
  }, [current.projectId])

  // Load runs when baseline agent changes
  useEffect(() => {
    if (baseline.agentId) {
      api.agents.listRuns(baseline.agentId, { limit: 50 })
        .then(({ runs }) => setBaseline(b => ({ ...b, runs })))
        .catch(console.error)
    }
  }, [baseline.agentId])

  // Load runs when current agent changes
  useEffect(() => {
    if (current.agentId) {
      api.agents.listRuns(current.agentId, { limit: 50 })
        .then(({ runs }) => setCurrent(c => ({ ...c, runs })))
        .catch(console.error)
    }
  }, [current.agentId])

  // Load events when baseline run changes
  useEffect(() => {
    if (baseline.runId) {
      api.traces.getEvents(baseline.runId, 500)
        .then(({ events }) => setBaseline(b => ({ ...b, events })))
        .catch(console.error)
    }
    setComparison(null)
  }, [baseline.runId])

  // Load events when current run changes
  useEffect(() => {
    if (current.runId) {
      api.traces.getEvents(current.runId, 500)
        .then(({ events }) => setCurrent(c => ({ ...c, events })))
        .catch(console.error)
    }
    setComparison(null)
  }, [current.runId])

  const handleBaselineChange = (changes: Partial<RunSelection>) => {
    setBaseline(b => ({ ...b, ...changes }))
  }

  const handleCurrentChange = (changes: Partial<RunSelection>) => {
    setCurrent(c => ({ ...c, ...changes }))
  }

  const compareRuns = useCallback(() => {
    if (baseline.events.length === 0 || current.events.length === 0) return

    setLoading(true)

    // Filter for only tool_call events - these are the actual MCP tool invocations
    const baselineToolCalls = baseline.events.filter(e => e.event_type === 'tool_call')
    const currentToolCalls = current.events.filter(e => e.event_type === 'tool_call')

    const result: Comparison = {
      baselineCalls: baselineToolCalls.length,
      currentCalls: currentToolCalls.length,
      added: [],
      removed: [],
      changed: [],
      latencyChanges: [],
    }

    // Group tool calls by tool name for comparison
    const groupEvents = (events: TraceEvent[]) => {
      const map = new Map<string, TraceEvent[]>()
      for (const event of events) {
        const key = event.tool_name || 'unknown'
        const existing = map.get(key) ?? []
        existing.push(event)
        map.set(key, existing)
      }
      return map
    }

    const baselineByKey = groupEvents(baselineToolCalls)
    const currentByKey = groupEvents(currentToolCalls)

    // Find added methods/tools
    for (const [key, events] of currentByKey) {
      if (!baselineByKey.has(key)) {
        for (const event of events) {
          let params: unknown
          try {
            if (event.params_json) params = JSON.parse(event.params_json)
          } catch { /* ignore */ }
          result.added.push({
            method: event.method || '',
            tool: event.tool_name || undefined,
            params,
            index: event.id,
          })
        }
      }
    }

    // Find removed methods/tools
    for (const [key, events] of baselineByKey) {
      if (!currentByKey.has(key)) {
        for (const event of events) {
          let params: unknown
          try {
            if (event.params_json) params = JSON.parse(event.params_json)
          } catch { /* ignore */ }
          result.removed.push({
            method: event.method || '',
            tool: event.tool_name || undefined,
            params,
            index: event.id,
          })
        }
      }
    }

    // Compare matching tools - check if arguments differ
    for (const [key, baselineCalls] of baselineByKey) {
      const currentCalls = currentByKey.get(key)
      if (!currentCalls) continue

      const minLen = Math.min(baselineCalls.length, currentCalls.length)
      for (let i = 0; i < minLen; i++) {
        const b = baselineCalls[i]
        const c = currentCalls[i]

        let bParams: unknown, cParams: unknown
        try {
          if (b.params_json) bParams = JSON.parse(b.params_json)
          if (c.params_json) cParams = JSON.parse(c.params_json)
        } catch { /* ignore */ }

        // Check for parameter changes (arguments to tool call)
        if (JSON.stringify(bParams) !== JSON.stringify(cParams)) {
          result.changed.push({
            method: b.method || '',
            tool: b.tool_name || undefined,
            index: i,
            baselineParams: bParams,
            currentParams: cParams,
          })
        }
      }

      // Track count differences as well
      if (baselineCalls.length > currentCalls.length) {
        // Some calls were removed
        for (let i = currentCalls.length; i < baselineCalls.length; i++) {
          let params: unknown
          try {
            const pj = baselineCalls[i].params_json
            if (pj) params = JSON.parse(pj)
          } catch { /* ignore */ }
          result.removed.push({
            method: '',
            tool: key,
            params,
            index: i,
          })
        }
      } else if (currentCalls.length > baselineCalls.length) {
        // Some calls were added
        for (let i = baselineCalls.length; i < currentCalls.length; i++) {
          let params: unknown
          try {
            const pj = currentCalls[i].params_json
            if (pj) params = JSON.parse(pj)
          } catch { /* ignore */ }
          result.added.push({
            method: '',
            tool: key,
            params,
            index: i,
          })
        }
      }
    }

    // Compare latencies - correlate tool_result with tool_call by sequence
    // Build a map: for each tool, get latencies from tool_result events
    // by matching the nth tool_result with the nth tool_call of the same tool

    // Get latencies by correlating tool_call sequence with tool_result sequence
    const getLatenciesByTool = (events: TraceEvent[]) => {
      const toolCalls = events.filter(e => e.event_type === 'tool_call')
      const toolResults = events.filter(e => e.event_type === 'tool_result')
      const latencies = new Map<string, number[]>()

      // Match by sequence - nth tool_result corresponds to nth tool_call
      for (let i = 0; i < Math.min(toolCalls.length, toolResults.length); i++) {
        const toolName = toolCalls[i].tool_name || 'unknown'
        const latency = toolResults[i].latency_ms
        if (latency) {
          const existing = latencies.get(toolName) ?? []
          existing.push(latency)
          latencies.set(toolName, existing)
        }
      }
      return latencies
    }

    const baselineLatencies = getLatenciesByTool(baseline.events)
    const currentLatencies = getLatenciesByTool(current.events)

    // Compare average latencies per tool (only for tools in both runs)
    for (const [toolName, bLatencies] of baselineLatencies) {
      const cLatencies = currentLatencies.get(toolName)
      if (!cLatencies || cLatencies.length === 0) continue

      const bAvg = bLatencies.reduce((a, b) => a + b, 0) / bLatencies.length
      const cAvg = cLatencies.reduce((a, b) => a + b, 0) / cLatencies.length

      const latencyChange = ((cAvg - bAvg) / bAvg) * 100
      if (Math.abs(latencyChange) > 20) {
        result.latencyChanges.push({
          method: '',
          tool: toolName,
          index: 0,
          baselineLatency: Math.round(bAvg),
          currentLatency: Math.round(cAvg),
          changePercent: latencyChange,
        })
      }
    }

    setComparison(result)
    setLoading(false)
  }, [baseline.events, current.events])

  const canCompare = baseline.runId && current.runId && baseline.runId !== current.runId
  const hasChanges = comparison ? (comparison.added.length > 0 || comparison.removed.length > 0 || comparison.changed.length > 0) : false

  return (
    <div className="space-y-6">
      {/* Two independent selectors */}
      <div className="grid grid-cols-2 gap-6">
        <RunSelector
          label="Baseline Run"
          selection={baseline}
          onChange={handleBaselineChange}
          otherRunId={current.runId}
        />
        <RunSelector
          label="Current Run"
          selection={current}
          onChange={handleCurrentChange}
          otherRunId={baseline.runId}
        />
      </div>

      {/* Compare Button */}
      {canCompare && !comparison && (
        <div className="text-center">
          <button
            onClick={compareRuns}
            disabled={loading || baseline.events.length === 0 || current.events.length === 0}
            className="px-6 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Comparing...' : 'Compare Runs'}
          </button>
        </div>
      )}

      {baseline.runId === current.runId && baseline.runId !== '' && (
        <div className="text-center text-yellow-400">
          Select two different runs to compare
        </div>
      )}

      {/* Comparison Results */}
      {comparison && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Baseline Tool Calls</div>
              <div className="text-2xl font-bold text-white">{comparison.baselineCalls}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Current Tool Calls</div>
              <div className="text-2xl font-bold text-white">{comparison.currentCalls}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Added</div>
              <div className="text-2xl font-bold text-green-400">{comparison.added.length}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Removed</div>
              <div className="text-2xl font-bold text-red-400">{comparison.removed.length}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <div className="text-sm text-slate-400">Changed Args</div>
              <div className="text-2xl font-bold text-yellow-400">{comparison.changed.length}</div>
            </div>
          </div>

          {/* Status */}
          <div className={`p-4 rounded-lg border ${hasChanges ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
            <span className={hasChanges ? 'text-yellow-300' : 'text-green-300'}>
              {hasChanges ? '⚠️ Changes detected - review below' : '✓ No behavioral changes detected'}
            </span>
            <button
              onClick={() => setComparison(null)}
              className="float-right text-sm text-slate-400 hover:text-white"
            >
              Compare Different Runs
            </button>
          </div>

          {/* Added Tool Calls */}
          {comparison.added.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700">
              <div className="p-4 border-b border-slate-700 bg-green-500/10">
                <h2 className="font-medium text-green-300">Added Tool Calls ({comparison.added.length})</h2>
              </div>
              <div className="divide-y divide-slate-700">
                {comparison.added.map((call, i) => (
                  <div key={i} className="p-3 flex items-center gap-4">
                    <span className="text-green-400">+</span>
                    <span className="font-mono text-blue-300">{call.tool || call.method}</span>
                    <span className="text-sm text-slate-400 truncate flex-1">
                      {call.params ? JSON.stringify(call.params).slice(0, 60) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Removed Tool Calls */}
          {comparison.removed.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700">
              <div className="p-4 border-b border-slate-700 bg-red-500/10">
                <h2 className="font-medium text-red-300">Removed Tool Calls ({comparison.removed.length})</h2>
              </div>
              <div className="divide-y divide-slate-700">
                {comparison.removed.map((call, i) => (
                  <div key={i} className="p-3 flex items-center gap-4">
                    <span className="text-red-400">-</span>
                    <span className="font-mono text-blue-300">{call.tool || call.method}</span>
                    <span className="text-sm text-slate-400 truncate flex-1">
                      {call.params ? JSON.stringify(call.params).slice(0, 60) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Changed Tool Arguments */}
          {comparison.changed.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700">
              <div className="p-4 border-b border-slate-700 bg-yellow-500/10">
                <h2 className="font-medium text-yellow-300">Changed Tool Arguments ({comparison.changed.length})</h2>
              </div>
              <div className="divide-y divide-slate-700">
                {comparison.changed.map((change, i) => (
                  <div key={i} className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-yellow-400">~</span>
                      <span className="font-mono text-blue-300">{change.tool || change.method}</span>
                      <span className="text-sm text-slate-500">call #{change.index + 1}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-red-400 mb-1">Baseline</div>
                        <pre className="bg-red-500/10 p-2 rounded text-xs overflow-x-auto text-slate-300">
                          {JSON.stringify(change.baselineParams, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-green-400 mb-1">Current</div>
                        <pre className="bg-green-500/10 p-2 rounded text-xs overflow-x-auto text-slate-300">
                          {JSON.stringify(change.currentParams, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Latency Changes */}
          {comparison.latencyChanges.length > 0 && (
            <div className="bg-slate-800 rounded-lg border border-slate-700">
              <div className="p-4 border-b border-slate-700">
                <h2 className="font-medium text-white">Latency Changes (&gt;20%)</h2>
              </div>
              <div className="p-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-left">
                      <th className="pb-2">Method/Tool</th>
                      <th className="pb-2">Baseline</th>
                      <th className="pb-2">Current</th>
                      <th className="pb-2">Change</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {comparison.latencyChanges.map((change, i) => (
                      <tr key={i} className="border-t border-slate-700">
                        <td className="py-2 font-mono text-blue-300">{change.tool || change.method}</td>
                        <td className="py-2">{change.baselineLatency}ms</td>
                        <td className="py-2">{change.currentLatency}ms</td>
                        <td className={`py-2 ${change.changePercent > 0 ? 'text-red-400' : 'text-green-400'}`}>
                          {change.changePercent > 0 ? '+' : ''}{change.changePercent.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {projects.length === 0 && (
        <div className="text-center text-slate-500 py-8 border-2 border-dashed border-slate-700 rounded-xl">
          <div className="text-4xl mb-4">📝</div>
          <h3 className="text-lg font-medium text-slate-300 mb-2">Compare Runs Across Projects</h3>
          <p className="text-slate-500">Select a project, agent, and run for each side to compare</p>
        </div>
      )}
    </div>
  )
}
