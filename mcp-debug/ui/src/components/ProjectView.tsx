import { useState, useEffect, useCallback } from 'react';
import { api, liveConnection } from '../api/client';
import type { Project, Agent, Run, UpdateMessage, TraceEvent } from '../api/client';

interface SelectionState {
  projectId: string;
  agentId: string;
}

interface ProjectViewProps {
  onSelectRun?: (run: Run) => void;
  selection?: SelectionState;
  onSelectionChange?: (selection: SelectionState) => void;
}

export function ProjectView({ onSelectRun, selection, onSelectionChange }: ProjectViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [latestStress, setLatestStress] = useState<{ run: Run; events: TraceEvent[] } | null>(null);
  const [stressLoading, setStressLoading] = useState(false);
  const [showStressResults, setShowStressResults] = useState(false);

  // Use selection prop if provided, otherwise maintain local state
  const [localProjectId, setLocalProjectId] = useState<string>('');
  const [localAgentId, setLocalAgentId] = useState<string>('');

  const selectedProjectId = selection?.projectId ?? localProjectId;
  const selectedAgentId = selection?.agentId ?? localAgentId;

  const selectedProject = projects.find(p => p.id === selectedProjectId) || null;
  const selectedAgent = agents.find(a => a.id === selectedAgentId) || null;

  const setSelectedProject = (project: Project | null) => {
    const newProjectId = project?.id ?? '';
    if (onSelectionChange) {
      onSelectionChange({ projectId: newProjectId, agentId: '' });
    } else {
      setLocalProjectId(newProjectId);
      setLocalAgentId('');
    }
  };

  const setSelectedAgent = (agent: Agent | null) => {
    const newAgentId = agent?.id ?? '';
    if (onSelectionChange) {
      onSelectionChange({ projectId: selectedProjectId, agentId: newAgentId });
    } else {
      setLocalAgentId(newAgentId);
    }
  };

  // Load projects
  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const { projects } = await api.projects.list();
      setProjects(projects);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Load agents when project is selected
  useEffect(() => {
    if (selectedProjectId) {
      api.projects.listAgents(selectedProjectId)
        .then(({ agents }) => setAgents(agents))
        .catch(console.error);
    } else {
      setAgents([]);
    }
    setRuns([]);
  }, [selectedProjectId]);

  // Load runs when agent is selected and subscribe to updates
  useEffect(() => {
    if (selectedAgentId) {
      // Initial load
      const loadRuns = () => {
        api.agents.listRuns(selectedAgentId, { limit: 50 })
          .then(({ runs }) => setRuns(runs))
          .catch(console.error);
      };
      loadRuns();

      // Subscribe to agent updates for new/updated runs
      const unsubscribe = liveConnection.subscribeToAgent(selectedAgentId, (msg: UpdateMessage) => {
        if (msg.type === 'run_created' || msg.type === 'run_updated') {
          // Refresh runs list
          loadRuns();
        }
      });

      return () => unsubscribe();
    } else {
      setRuns([]);
    }
  }, [selectedAgentId]);

  // Load latest stress results when agent is selected
  useEffect(() => {
    if (selectedAgentId) {
      api.stress.getLatestStress(selectedAgentId)
        .then((data) => setLatestStress(data))
        .catch(() => setLatestStress(null));
    } else {
      setLatestStress(null);
    }
  }, [selectedAgentId]);

  const handleStartStress = async () => {
    if (!selectedAgentId) return;
    try {
      setStressLoading(true);
      await api.stress.startStress(selectedAgentId);
      // Poll for results and refresh runs list
      const pollStress = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const data = await api.stress.getLatestStress(selectedAgentId);
            setLatestStress(data);
            // Refresh runs list to show new stress run
            api.agents.listRuns(selectedAgentId, { limit: 50 })
              .then(({ runs }) => setRuns(runs))
              .catch(console.error);
            if (data.run.status !== 'running') {
              break;
            }
          } catch {
            // Keep polling
          }
        }
        setStressLoading(false);
      };
      pollStress();
    } catch (err) {
      console.error('Failed to start stress test:', err);
      setStressLoading(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Delete this project and all its agents?')) return;
    try {
      await api.projects.delete(id);
      setProjects(projects.filter(p => p.id !== id));
      if (selectedProject?.id === id) {
        setSelectedProject(null);
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    try {
      await api.agents.delete(id);
      setAgents(agents.filter(a => a.id !== id));
      if (selectedAgent?.id === id) {
        setSelectedAgent(null);
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
    }
  };

  const statusBadge = (status: Run['status']) => {
    const colors = {
      pending: 'bg-gray-500',
      running: 'bg-blue-500 animate-pulse',
      completed: 'bg-green-500',
      failed: 'bg-red-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${colors[status]}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex">
      {/* Projects Sidebar */}
      <div className="w-64 border-r border-gray-700 flex flex-col">
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-white">Projects</h3>
          <button
            onClick={() => setShowNewProjectModal(true)}
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {projects.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No projects yet
            </div>
          ) : (
            projects.map(project => (
              <div
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className={`p-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 ${
                  selectedProject?.id === project.id ? 'bg-gray-800' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{project.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Delete
                  </button>
                </div>
                {project.description && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{project.description}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Agents Panel */}
      <div className="w-72 border-r border-gray-700 flex flex-col">
        <div className="p-3 border-b border-gray-700 flex items-center justify-between">
          <h3 className="font-semibold text-white">
            {selectedProject ? 'Agents' : 'Select a Project'}
          </h3>
          {selectedProject && (
            <button
              onClick={() => setShowNewAgentModal(true)}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              + New
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!selectedProject ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              Select a project to see agents
            </div>
          ) : agents.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No agents in this project
            </div>
          ) : (
            agents.map(agent => (
              <div
                key={agent.id}
                onClick={() => setSelectedAgent(agent)}
                className={`p-3 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 ${
                  selectedAgent?.id === agent.id ? 'bg-gray-800' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">{agent.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteAgent(agent.id);
                    }}
                    className="text-red-400 hover:text-red-300 text-xs"
                  >
                    Delete
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1 truncate font-mono">{agent.target}</p>
                <div className="mt-2 text-xs text-gray-500">
                  ID: <code className="bg-gray-700 px-1 rounded">{agent.id.slice(0, 8)}</code>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Runs Panel */}
      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-white">
              {selectedAgent ? `Runs for ${selectedAgent.name}` : 'Select an Agent'}
            </h3>
            {selectedAgent && (
              <button
                onClick={handleStartStress}
                disabled={stressLoading}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 px-3 py-1 rounded text-white text-sm flex items-center gap-1"
              >
                {stressLoading ? 'Testing...' : 'Run Stress Test'}
              </button>
            )}
          </div>
          {selectedAgent && (
            <p className="text-xs text-gray-400 mt-1">
              Run: <code className="bg-gray-700 px-1 rounded">mcp-debug proxy --agent {selectedAgent.id.slice(0, 8)}</code>
            </p>
          )}
          {/* Stress Results Summary */}
          {selectedAgent && latestStress && (
            <div className="mt-3 p-3 bg-gray-800 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-white">Latest Stress Results</span>
                <button
                  onClick={() => setShowStressResults(!showStressResults)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {showStressResults ? 'Hide' : 'Details'}
                </button>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    latestStress.run.status === 'running' ? 'bg-blue-500 animate-pulse' :
                    latestStress.run.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  <span className="text-xs text-gray-400">{latestStress.run.status}</span>
                </div>
                <div className="text-sm">
                  <span className="font-bold text-white">{latestStress.run.stress_score}%</span>
                  <span className="text-gray-400 ml-1">reliability</span>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="text-green-400">{latestStress.run.stress_passed} pass</span>
                  <span className="text-yellow-400">{latestStress.run.stress_graceful} graceful</span>
                  <span className="text-red-400">{latestStress.run.stress_crashed} crash</span>
                </div>
              </div>
              {showStressResults && latestStress.events.length > 0 && (
                <div className="mt-3 max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-gray-400">
                      <tr>
                        <th className="pb-1">Tool</th>
                        <th className="pb-1">Mutation</th>
                        <th className="pb-1">Outcome</th>
                        <th className="pb-1">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestStress.events.map(e => {
                        const data = e.params_json ? JSON.parse(e.params_json) : {};
                        return (
                          <tr key={e.id} className="border-t border-gray-700">
                            <td className="py-1 font-mono">{e.tool_name}</td>
                            <td className="py-1 text-gray-400">{(data.mutation?.description || '').slice(0, 30)}...</td>
                            <td className="py-1">
                              <span className={`px-1.5 py-0.5 rounded ${
                                data.outcome === 'pass' ? 'bg-green-500/20 text-green-400' :
                                data.outcome === 'graceful_fail' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-red-500/20 text-red-400'
                              }`}>
                                {(data.outcome || '').replace('_', ' ')}
                              </span>
                            </td>
                            <td className="py-1 text-gray-400">{e.latency_ms}ms</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!selectedAgent ? (
            <div className="p-8 text-center text-gray-400">
              Select an agent to see its runs
            </div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <p>No runs yet for this agent</p>
              <p className="text-sm mt-2">
                Run <code className="bg-gray-700 px-1 rounded">mcp-debug proxy --agent {selectedAgent.id}</code>
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-gray-400 border-b border-gray-700 sticky top-0 bg-gray-900">
                <tr>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Run ID</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Calls</th>
                  <th className="py-2 px-3">Score</th>
                  <th className="py-2 px-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun?.(run)}
                    className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                  >
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        run.run_type === 'stress'
                          ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {run.run_type}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <code className="text-xs bg-gray-800 px-1.5 py-0.5 rounded font-mono">
                        {run.id.slice(0, 8)}
                      </code>
                    </td>
                    <td className="py-2 px-3">{statusBadge(run.status)}</td>
                    <td className="py-2 px-3">{run.total_calls}</td>
                    <td className="py-2 px-3">
                      {run.run_type === 'stress' ? (
                        <span className={`font-medium ${
                          run.stress_score >= 90 ? 'text-green-400' :
                          run.stress_score >= 70 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {run.stress_score}%
                        </span>
                      ) : (
                        run.total_errors > 0 ? (
                          <span className="text-red-400">{run.total_errors} err</span>
                        ) : <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-400">
                      {new Date(run.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <NewProjectModal
          onClose={() => setShowNewProjectModal(false)}
          onCreated={(project) => {
            setProjects([project, ...projects]);
            setShowNewProjectModal(false);
            setSelectedProject(project);
          }}
        />
      )}

      {/* New Agent Modal */}
      {showNewAgentModal && selectedProject && (
        <NewAgentModal
          projectId={selectedProject.id}
          onClose={() => setShowNewAgentModal(false)}
          onCreated={(agent) => {
            setAgents([agent, ...agents]);
            setShowNewAgentModal(false);
            setSelectedAgent(agent);
          }}
        />
      )}
    </div>
  );
}

// New Project Modal
function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      setCreating(true);
      const { project } = await api.projects.create({ name: name.trim(), description: description.trim() || undefined });
      onCreated(project);
    } catch (err) {
      console.error('Failed to create project:', err);
      alert('Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4 text-white">New Project</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-app"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Testing my MCP servers"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded text-white"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// New Agent Modal
function NewAgentModal({ projectId, onClose, onCreated }: { projectId: string; onClose: () => void; onCreated: (a: Agent) => void }) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !target.trim()) return;
    try {
      setCreating(true);
      const { agent } = await api.projects.createAgent(projectId, { name: name.trim(), target: target.trim() });
      onCreated(agent);
    } catch (err) {
      console.error('Failed to create agent:', err);
      alert('Failed to create agent');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4 text-white">New Agent</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="filesystem-server"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Target Command</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white font-mono text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !target.trim() || creating}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded text-white"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
