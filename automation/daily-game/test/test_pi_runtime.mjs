import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createAgentSession, createBashToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, createEditToolDefinition,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager }
  from '/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js';
import { createBashOperations } from '/app/bash_operations.mjs';

const cwd = mkdtempSync('/tmp/pi-package-check-');
const credentials = {
  async read() {}, async list() { return []; },
  async modify() { throw new Error('No credential writes in the package check'); },
  async delete() { throw new Error('No credential writes in the package check'); },
};
const settingsManager = SettingsManager.inMemory({ transport: 'sse' });
const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
const model = modelRuntime.getModel('openai', 'gpt-6-astra');
assert.ok(model, 'Packaged OpenAI model metadata is available');
const resourceLoader = new DefaultResourceLoader({
  cwd, agentDir: `${cwd}/agent`, settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
});
await resourceLoader.reload();
const bash = createBashToolDefinition(cwd, { operations: createBashOperations() });
const { session } = await createAgentSession({
  cwd, modelRuntime, model, settingsManager, resourceLoader,
  sessionManager: SessionManager.inMemory(cwd), customTools: [bash],
});
try {
  await createWriteToolDefinition(cwd).execute('write-fixture', { path: 'fixture.txt', content: 'before edit\n' });
  await createEditToolDefinition(cwd).execute('edit-fixture', {
    path: 'fixture.txt', edits: [{ oldText: 'before edit', newText: 'packaged Pi can read files' }],
  });
  const read = await createReadToolDefinition(cwd).execute('read-fixture', { path: 'fixture.txt' });
  assert.ok(read.content.some(part => part.text?.includes('packaged Pi can read files')));
  const result = await bash.execute('bash-fixture', { command: "printf 'packaged Pi can read files\\n'", timeout: 10 });
  assert.ok(result.content.some(part => part.text?.includes('packaged Pi can read files')));
} finally {
  session.dispose();
}
console.log('PASS packaged Pi SDK, session, model metadata, read/write/edit tools, and Bash without a model request');
