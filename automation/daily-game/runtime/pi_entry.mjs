import { readFileSync, writeSync } from 'node:fs';
import { createAgentSession, createBashToolDefinition, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager }
  from '/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js';
import { createBashOperations } from './bash_operations.mjs';

const bashOperations = createBashOperations(error => {
  writeSync(2, `${error.message}; stopping the Pi invocation\n`);
  process.exit(1);
});

const [systemPath, inputPath, modelId] = process.argv.slice(2);
const cwd = process.cwd();
const credentials = {
  async read() { return undefined; },
  async list() { return []; },
  async modify() { throw new Error('Persistent credentials are disabled in this job'); },
  async delete() { throw new Error('Persistent credentials are disabled in this job'); },
};
const settingsManager = SettingsManager.inMemory({ transport: 'sse' });
const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
const model = modelRuntime.getModel('openai', modelId);
if (!model) throw new Error(`Pi does not contain model openai/${modelId}`);
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  appendSystemPrompt: [readFileSync(systemPath, 'utf8')],
});
await resourceLoader.reload();
const { session } = await createAgentSession({
  cwd, modelRuntime, model, settingsManager, resourceLoader,
  sessionManager: SessionManager.inMemory(cwd),
  customTools: [createBashToolDefinition(cwd, { operations: bashOperations })],
});
session.subscribe(event => {
  if (event.type === 'message_end' && event.message?.role === 'assistant') {
    const message = { ...event.message, content: event.message.content.filter(part => part.type !== 'thinking') };
    process.stdout.write(JSON.stringify({ type: event.type, message }) + '\n');
  } else if (['agent_start', 'agent_end'].includes(event.type)) {
    process.stdout.write(JSON.stringify({ type: event.type }) + '\n');
  } else if (['tool_execution_start', 'tool_execution_end'].includes(event.type)) {
    process.stdout.write(JSON.stringify(event) + '\n');
  }
});
try {
  await session.prompt(readFileSync(inputPath, 'utf8'));
} finally {
  session.dispose();
}
