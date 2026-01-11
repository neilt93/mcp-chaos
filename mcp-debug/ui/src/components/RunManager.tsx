import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { Run } from '../api/client';

interface RunManagerProps {
  onSelectRun?: (run: Run) => void;
}

export function RunManager({ onSelectRun }: RunManagerProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const loadRuns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { runs } = await api.runs.list({
        status: statusFilter || undefined,
        limit: 50,
      });
      setRuns(runs);
    } catch (err) {
      setError('Failed to load runs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this run?')) return;
    try {
      await api.runs.delete(id);
      setRuns(runs.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to delete run:', err);
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Runs</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={loadRuns}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Refresh
          </button>
        </div>
        <div className="text-sm text-gray-400">
          Run <code className="bg-gray-700 px-1 rounded">mcp-chaos proxy --target "..."</code> to record
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-center text-gray-400 py-8">Loading...</div>
        ) : error ? (
          <div className="text-center text-red-400 py-8">{error}</div>
        ) : runs.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No runs yet. Create one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-400 border-b border-gray-700">
              <tr>
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Target</th>
                <th className="py-2 px-2">Status</th>
                <th className="py-2 px-2">Calls</th>
                <th className="py-2 px-2">Errors</th>
                <th className="py-2 px-2">Created</th>
                <th className="py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer"
                  onClick={() => onSelectRun?.(run)}
                >
                  <td className="py-2 px-2 font-medium">
                    {run.name || run.id.slice(0, 8)}
                  </td>
                  <td className="py-2 px-2 text-gray-400 max-w-xs truncate">
                    {run.target}
                  </td>
                  <td className="py-2 px-2">{statusBadge(run.status)}</td>
                  <td className="py-2 px-2">{run.total_calls}</td>
                  <td className="py-2 px-2">
                    {run.total_errors > 0 ? (
                      <span className="text-red-400">{run.total_errors}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="py-2 px-2 text-gray-400">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="py-2 px-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(run.id);
                      }}
                      className="text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
