import express from 'express';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import OpenAI from 'openai';

// Load .env file (override shell variables)
config({ override: true });

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Configuration
const WORKSPACE = '/private/tmp/demo-workspace';
const PROJECT_NAME = process.env.PROJECT || 'demo';
const AGENT_NAME = process.env.AGENT_NAME || 'filesystem';
const TARGET = process.env.TARGET || `npx -y @modelcontextprotocol/server-filesystem ${WORKSPACE}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error('Error: OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// MCP Client State
let proxyProcess: ChildProcess | null = null;
let requestId = 0;
const pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let mcpTools: any[] = [];
let currentRunId: string | null = null;

// Conversation history
let conversationHistory: OpenAI.Chat.ChatCompletionMessageParam[] = [
  {
    role: 'system',
    content: `You are a helpful assistant that can access the user's filesystem.
You have access to tools that let you list directories, read files, and write files.
The user's workspace is at /private/tmp/demo-workspace - always use this as the base path.
When the user asks about files or folders, use the appropriate tools to help them.
Be concise and helpful. Show relevant file contents when asked.`
  }
];

function killProxy(): void {
  if (proxyProcess) {
    proxyProcess.kill();
    proxyProcess = null;
    currentRunId = null;
    console.log('Killed existing proxy process');
  }
}

async function startProxy(forceRestart = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (proxyProcess) {
      if (forceRestart) {
        killProxy();
      } else {
        resolve();
        return;
      }
    }

    console.log('Starting MCP proxy:', { project: PROJECT_NAME, agent: AGENT_NAME, target: TARGET });

    proxyProcess = spawn('npx', [
      'tsx', join(__dirname, '../src/cli.ts'), 'proxy',
      '--project', PROJECT_NAME,
      '--name', AGENT_NAME,
      '--target', TARGET
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: join(__dirname, '..'),
    });

    proxyProcess.stderr?.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[mcp]', msg);
        // Extract run ID from log output
        const runMatch = msg.match(/"runId":"([^"]+)"/);
        if (runMatch) {
          currentRunId = runMatch[1];
          console.log('📝 Run ID:', currentRunId);
        }
      }
    });

    const rl = createInterface({ input: proxyProcess.stdout! });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
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

    proxyProcess.on('error', reject);
    proxyProcess.on('exit', (code) => {
      console.log('Proxy exited:', code);
      proxyProcess = null;
    });

    // Initialize MCP connection
    setTimeout(async () => {
      try {
        await sendMcpRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'chat-demo', version: '1.0.0' }
        });
        sendMcpNotification('notifications/initialized', {});

        // Get available tools
        const result = await sendMcpRequest('tools/list', {});
        mcpTools = result.tools || [];
        console.log('Available tools:', mcpTools.map((t: any) => t.name).join(', '));

        resolve();
      } catch (e) {
        reject(e);
      }
    }, 1000);
  });
}

function sendMcpRequest(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!proxyProcess) {
      reject(new Error('Proxy not running'));
      return;
    }

    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    pendingRequests.set(id, { resolve, reject });
    proxyProcess.stdin?.write(msg + '\n');

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

function sendMcpNotification(method: string, params: any): void {
  if (!proxyProcess) return;
  proxyProcess.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

// Save chat message to the run via API
async function saveChatMessage(role: 'user' | 'assistant', content: string, toolCalls?: any[]): Promise<void> {
  if (!currentRunId) return;

  try {
    await fetch('http://localhost:3001/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'event',
        runId: currentRunId,
        event: {
          t: 'chat_message',
          role,
          content,
          toolCalls,
          ts: new Date().toISOString()
        }
      })
    });
  } catch {
    // Ignore errors - server may not be running
  }
}

// Convert MCP tools to OpenAI format
function getOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
  return mcpTools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });

    // Save user message to run
    saveChatMessage('user', message);

    const toolCalls: Array<{ name: string; args: any; result: any }> = [];

    // Call OpenAI
    let response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversationHistory,
      tools: getOpenAITools(),
      tool_choice: 'auto',
    });

    let assistantMessage = response.choices[0].message;

    // Process tool calls
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      // Add assistant message with tool calls to history
      conversationHistory.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);

        console.log(`Calling tool: ${name}`, args);

        let result: any;
        try {
          result = await sendMcpRequest('tools/call', { name, arguments: args });
          toolCalls.push({ name, args, result });
        } catch (e: any) {
          result = { error: e.message };
          toolCalls.push({ name, args, result });
        }

        // Add tool result to history
        conversationHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      // Continue the conversation
      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversationHistory,
        tools: getOpenAITools(),
        tool_choice: 'auto',
      });

      assistantMessage = response.choices[0].message;
    }

    // Add final assistant message to history
    conversationHistory.push(assistantMessage);

    // Save assistant message to run
    saveChatMessage('assistant', assistantMessage.content || '', toolCalls.length > 0 ? toolCalls : undefined);

    res.json({
      response: assistantMessage.content,
      toolCalls
    });
  } catch (e: any) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Reset conversation and optionally restart proxy
app.post('/api/reset', async (req, res) => {
  conversationHistory = [conversationHistory[0]]; // Keep system message

  // Restart proxy for a fresh run
  try {
    await startProxy(true); // force restart
    res.json({ success: true, runId: currentRunId });
  } catch (err) {
    res.json({ success: true, warning: 'Conversation reset but proxy restart failed' });
  }
});

// Get current status (run ID, whether it's a fresh session)
app.get('/api/status', (req, res) => {
  res.json({
    runId: currentRunId,
    ready: !!proxyProcess && !!currentRunId
  });
});

// Serve chat UI
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>MCP Chat Demo - ${PROJECT_NAME}/${AGENT_NAME}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      text-align: center;
      padding: 20px 0;
    }
    h1 {
      color: #00d9ff;
      font-size: 1.8em;
      margin-bottom: 5px;
    }
    .subtitle {
      color: #888;
      font-size: 0.9em;
    }
    .chat-container {
      flex: 1;
      overflow-y: auto;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
    }
    .message {
      margin-bottom: 20px;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .message.user {
      text-align: right;
    }
    .message.user .bubble {
      background: #0f3460;
      display: inline-block;
      max-width: 80%;
      text-align: left;
    }
    .message.assistant .bubble {
      background: #1a3a5c;
      max-width: 80%;
    }
    .bubble {
      padding: 12px 16px;
      border-radius: 12px;
      line-height: 1.5;
    }
    .tool-call {
      background: rgba(0, 217, 255, 0.1);
      border-left: 3px solid #00d9ff;
      padding: 10px 15px;
      margin: 10px 0;
      border-radius: 0 8px 8px 0;
      font-size: 0.9em;
    }
    .tool-call .name {
      color: #00d9ff;
      font-weight: bold;
    }
    .tool-call .args {
      color: #888;
      font-family: monospace;
      font-size: 0.85em;
      margin-top: 5px;
    }
    .tool-call .result {
      color: #00ff88;
      font-family: monospace;
      font-size: 0.85em;
      margin-top: 8px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }
    .input-area {
      display: flex;
      gap: 10px;
    }
    input[type="text"] {
      flex: 1;
      padding: 15px 20px;
      border: none;
      border-radius: 25px;
      background: #0f3460;
      color: white;
      font-size: 1em;
      outline: none;
    }
    input[type="text"]::placeholder {
      color: #666;
    }
    button {
      padding: 15px 30px;
      border: none;
      border-radius: 25px;
      background: #00d9ff;
      color: #000;
      font-weight: bold;
      cursor: pointer;
      transition: transform 0.2s, background 0.2s;
    }
    button:hover {
      background: #00b8d9;
      transform: scale(1.02);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .reset-btn {
      background: #333;
      color: #888;
      padding: 8px 16px;
      font-size: 0.8em;
      margin-top: 10px;
    }
    .reset-btn:hover {
      background: #444;
      color: #fff;
    }
    .typing {
      display: inline-block;
    }
    .typing span {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #00d9ff;
      border-radius: 50%;
      margin: 0 2px;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .typing span:nth-child(1) { animation-delay: -0.32s; }
    .typing span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 15px;
    }
    .suggestion {
      background: rgba(0, 217, 255, 0.1);
      border: 1px solid rgba(0, 217, 255, 0.3);
      color: #00d9ff;
      padding: 8px 16px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.85em;
      transition: all 0.2s;
    }
    .suggestion:hover {
      background: rgba(0, 217, 255, 0.2);
      border-color: #00d9ff;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>MCP Chat Demo</h1>
      <p class="subtitle">Project: <code>${PROJECT_NAME}</code> · Agent: <code>${AGENT_NAME}</code> · GPT-4 + MCP</p>
    </header>

    <div class="chat-container" id="chat">
      <div class="message assistant">
        <div class="bubble">
          Hi! I can help you explore your demo workspace. Try asking me to list files, read documents, or create new files!
        </div>
      </div>
    </div>

    <div class="suggestions">
      <span class="suggestion" onclick="sendSuggestion('What files are in my workspace?')">What files are in my workspace?</span>
      <span class="suggestion" onclick="sendSuggestion('Read the sales report')">Read the sales report</span>
      <span class="suggestion" onclick="sendSuggestion('Show me the todo list')">Show me the todo list</span>
      <span class="suggestion" onclick="sendSuggestion('List the projects folder')">List the projects folder</span>
    </div>

    <div class="input-area">
      <input type="text" id="input" placeholder="Ask me about your files..." onkeypress="if(event.key==='Enter')sendMessage()">
      <button onclick="sendMessage()" id="sendBtn">Send</button>
    </div>
    <center><button class="reset-btn" onclick="resetChat()">Reset Conversation</button></center>
  </div>

  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');

    function addMessage(role, content, toolCalls = []) {
      const div = document.createElement('div');
      div.className = 'message ' + role;

      let html = '<div class="bubble">';

      // Show tool calls if any
      for (const tc of toolCalls) {
        html += '<div class="tool-call">';
        html += '<div class="name">Tool: ' + tc.name + '</div>';
        html += '<div class="args">' + JSON.stringify(tc.args) + '</div>';
        if (tc.result) {
          const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2);
          html += '<div class="result">' + escapeHtml(resultStr).slice(0, 500) + (resultStr.length > 500 ? '...' : '') + '</div>';
        }
        html += '</div>';
      }

      if (content) {
        html += escapeHtml(content).replace(/\\n/g, '<br>');
      }
      html += '</div>';

      div.innerHTML = html;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function addTypingIndicator() {
      const div = document.createElement('div');
      div.className = 'message assistant';
      div.id = 'typing';
      div.innerHTML = '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    function removeTypingIndicator() {
      const el = document.getElementById('typing');
      if (el) el.remove();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function sendSuggestion(text) {
      input.value = text;
      sendMessage();
    }

    async function sendMessage() {
      const message = input.value.trim();
      if (!message) return;

      input.value = '';
      sendBtn.disabled = true;

      addMessage('user', message);
      addTypingIndicator();

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });

        removeTypingIndicator();

        if (!res.ok) {
          const err = await res.json();
          addMessage('assistant', 'Error: ' + (err.error || 'Something went wrong'));
        } else {
          const data = await res.json();
          addMessage('assistant', data.response, data.toolCalls || []);
        }
      } catch (e) {
        removeTypingIndicator();
        addMessage('assistant', 'Error: ' + e.message);
      }

      sendBtn.disabled = false;
      input.focus();
    }

    async function resetChat() {
      await fetch('/api/reset', { method: 'POST' });
      chat.innerHTML = '<div class="message assistant"><div class="bubble">Conversation reset! How can I help you?</div></div>';
    }

    input.focus();
  </script>
</body>
</html>`);
});

// Start server
const PORT = process.env.PORT || 3002;

startProxy()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Chat demo running at http://localhost:${PORT}`);
      console.log(`📁 Workspace: ${WORKSPACE}`);
      console.log(`🤖 Agent: ${PROJECT_NAME}/${AGENT_NAME}`);
      console.log(`🔧 MCP Debug UI: http://localhost:3001\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

// Cleanup
process.on('SIGINT', () => {
  if (proxyProcess) proxyProcess.kill();
  process.exit();
});
