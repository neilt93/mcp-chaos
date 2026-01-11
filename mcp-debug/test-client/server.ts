import express from 'express';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Store the proxy process and pending requests
let proxyProcess: ChildProcess | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

// Agent ID - update this to your agent ID
const AGENT_ID = process.env.AGENT_ID || 'd26eb1ba-01ef-4a10-a6f7-91d938dc62b9';

function startProxy(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (proxyProcess) {
      resolve();
      return;
    }

    console.log('Starting proxy with agent:', AGENT_ID);

    proxyProcess = spawn('npx', ['tsx', join(__dirname, '../src/cli.ts'), 'proxy', '--agent', AGENT_ID], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: join(__dirname, '..'),
    });

    proxyProcess.stderr?.on('data', (data) => {
      console.error('[proxy]', data.toString().trim());
    });

    const rl = createInterface({ input: proxyProcess.stdout! });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        console.log('[proxy response]', JSON.stringify(msg).slice(0, 200));

        if (msg.id !== undefined && pendingRequests.has(msg.id)) {
          const { resolve, reject } = pendingRequests.get(msg.id)!;
          pendingRequests.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {
        // ignore non-JSON
      }
    });

    proxyProcess.on('error', (err) => {
      console.error('Proxy error:', err);
      reject(err);
    });

    proxyProcess.on('exit', (code) => {
      console.log('Proxy exited with code:', code);
      proxyProcess = null;
    });

    // Send initialize request
    setTimeout(async () => {
      try {
        await sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' }
        });

        // Send initialized notification
        sendNotification('notifications/initialized', {});

        resolve();
      } catch (e) {
        reject(e);
      }
    }, 1000);
  });
}

function sendRequest(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!proxyProcess) {
      reject(new Error('Proxy not running'));
      return;
    }

    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    console.log('[sending]', msg.slice(0, 200));

    pendingRequests.set(id, { resolve, reject });
    proxyProcess.stdin?.write(msg + '\n');

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

function sendNotification(method: string, params: unknown): void {
  if (!proxyProcess) return;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  proxyProcess.stdin?.write(msg + '\n');
}

// Serve static HTML
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>MCP Test Client</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
      background: #1a1a2e;
      color: #eee;
    }
    h1 { color: #00d9ff; }
    .card {
      background: #16213e;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    button {
      background: #0f3460;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      margin: 5px;
      font-size: 14px;
    }
    button:hover { background: #1a5276; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    input, textarea {
      background: #0f3460;
      border: 1px solid #1a5276;
      color: white;
      padding: 10px;
      border-radius: 6px;
      width: 100%;
      margin: 5px 0;
    }
    pre {
      background: #0f0f23;
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 400px;
      overflow-y: auto;
    }
    .success { color: #00ff88; }
    .error { color: #ff6b6b; }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
    }
    .status {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
    }
    .status.connected { background: #00ff88; color: black; }
    .status.disconnected { background: #ff6b6b; color: white; }
  </style>
</head>
<body>
  <h1>MCP Test Client</h1>

  <div class="card">
    <h3>Connection <span id="status" class="status disconnected">Disconnected</span></h3>
    <button onclick="connect()">Connect to Proxy</button>
    <button onclick="listTools()">List Tools</button>
  </div>

  <div class="card">
    <h3>Available Tools</h3>
    <div id="tools" class="tools-grid">Click "List Tools" to load</div>
  </div>

  <div class="card">
    <h3>Quick Actions</h3>
    <div>
      <button onclick="listDirectory('/tmp')">List /tmp</button>
      <button onclick="listDirectory('/private/tmp')">List /private/tmp</button>
      <button onclick="createTestFile()">Create Test File</button>
      <button onclick="readTestFile()">Read Test File</button>
    </div>
    <div style="margin-top: 10px">
      <input type="text" id="customPath" placeholder="Enter path..." value="/tmp">
      <button onclick="listDirectory(document.getElementById('customPath').value)">List Directory</button>
    </div>
  </div>

  <div class="card">
    <h3>Call Tool</h3>
    <input type="text" id="toolName" placeholder="Tool name (e.g., list_directory)">
    <textarea id="toolArgs" rows="4" placeholder='{"path": "/tmp"}'></textarea>
    <button onclick="callTool()">Call Tool</button>
  </div>

  <div class="card">
    <h3>Result</h3>
    <pre id="result">No result yet</pre>
  </div>

  <script>
    let connected = false;

    async function api(endpoint, body) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json();
    }

    function showResult(data, isError = false) {
      const el = document.getElementById('result');
      el.className = isError ? 'error' : 'success';
      el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }

    async function connect() {
      showResult('Connecting...');
      try {
        const result = await api('/connect', {});
        connected = true;
        document.getElementById('status').className = 'status connected';
        document.getElementById('status').textContent = 'Connected';
        showResult(result);
      } catch (e) {
        showResult('Failed to connect: ' + e.message, true);
      }
    }

    async function listTools() {
      if (!connected) await connect();
      try {
        const result = await api('/tools/list', {});
        showResult(result);

        // Render tools as buttons
        const toolsEl = document.getElementById('tools');
        if (result.tools) {
          toolsEl.innerHTML = result.tools.map(t =>
            '<button onclick="selectTool(\\'' + t.name + '\\')" title="' + (t.description || '') + '">' + t.name + '</button>'
          ).join('');
        }
      } catch (e) {
        showResult('Failed: ' + e.message, true);
      }
    }

    function selectTool(name) {
      document.getElementById('toolName').value = name;
      document.getElementById('toolArgs').value = '{}';
      document.getElementById('toolArgs').focus();
    }

    async function callTool() {
      if (!connected) await connect();
      const name = document.getElementById('toolName').value;
      let args = {};
      try {
        args = JSON.parse(document.getElementById('toolArgs').value || '{}');
      } catch (e) {
        showResult('Invalid JSON in arguments', true);
        return;
      }

      showResult('Calling ' + name + '...');
      try {
        const result = await api('/tools/call', { name, arguments: args });
        showResult(result);
      } catch (e) {
        showResult('Failed: ' + e.message, true);
      }
    }

    async function listDirectory(path) {
      if (!connected) await connect();
      showResult('Listing ' + path + '...');
      try {
        const result = await api('/tools/call', { name: 'list_directory', arguments: { path } });
        showResult(result);
      } catch (e) {
        showResult('Failed: ' + e.message, true);
      }
    }

    async function createTestFile() {
      if (!connected) await connect();
      const content = 'Hello from MCP Test Client!\\nTimestamp: ' + new Date().toISOString();
      showResult('Creating test file...');
      try {
        const result = await api('/tools/call', {
          name: 'write_file',
          arguments: { path: '/private/tmp/mcp-test.txt', content }
        });
        showResult(result);
      } catch (e) {
        showResult('Failed: ' + e.message, true);
      }
    }

    async function readTestFile() {
      if (!connected) await connect();
      showResult('Reading test file...');
      try {
        const result = await api('/tools/call', {
          name: 'read_file',
          arguments: { path: '/private/tmp/mcp-test.txt' }
        });
        showResult(result);
      } catch (e) {
        showResult('Failed: ' + e.message, true);
      }
    }
  </script>
</body>
</html>
  `);
});

// API endpoints
app.post('/connect', async (req, res) => {
  try {
    await startProxy();
    res.json({ success: true, message: 'Connected to proxy' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/tools/list', async (req, res) => {
  try {
    const result = await sendRequest('tools/list', {});
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/tools/call', async (req, res) => {
  try {
    const { name, arguments: args } = req.body;
    const result = await sendRequest('tools/call', { name, arguments: args });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Cleanup on exit
process.on('SIGINT', () => {
  if (proxyProcess) {
    proxyProcess.kill();
  }
  process.exit();
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Test client running at http://localhost:${PORT}`);
  console.log(`Using agent ID: ${AGENT_ID}`);
});
