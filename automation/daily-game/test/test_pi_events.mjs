import assert from 'node:assert/strict';
const { PiReporter } = await import(process.env.PI_EVENTS_MODULE || '../runtime/pi_events.mjs');
const lines = [];
const reporter = new PiReporter(line => { lines.push(line); process.stdout.write(line); }, ['fixture-secret']);
reporter.event({ type: 'agent_start' });
reporter.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [
  { type: 'thinking', thinking: 'internal text must not be printed' },
  { type: 'text', text: 'Fixture: I will run the simulation checks.' },
] } });
reporter.event({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'node test/run.mjs' } });
assert.equal(lines.length, 3, 'Print tool activity before completion');
reporter.event({ type: 'tool_execution_end', isError: false, result: { content: [
  { type: 'text', text: 'Fixture checks passed; fixture-secret' },
] } });
reporter.event({ type: 'agent_end' });
assert.equal(reporter.summary.bashCalls, 1);
assert.equal(reporter.summary.successfulBashCalls, 1);
reporter.event({ type: 'tool_execution_start', toolCallId: 'failed-bash', toolName: 'bash', args: { command: 'false' } });
reporter.event({ type: 'tool_execution_end', toolCallId: 'failed-bash', isError: true, result: { content: [{type: 'text', text: 'spawn ENOSYS'}] } });
assert.equal(reporter.summary.bashCalls, 2);
assert.equal(reporter.summary.successfulBashCalls, 1, 'A failed Bash call must not count as a successful check');
assert.equal(reporter.summary.ended, true);
assert.equal(reporter.summary.failed, false);
assert(!lines.join('').includes('fixture-secret'));
assert(!lines.join('').includes('internal text'));
assert(lines.join('').includes('[REDACTED]'));
reporter.event({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Fixture API failure' } });
assert.equal(reporter.summary.failed, true, 'Provider failures must fail the run even if the CLI exits zero');
console.log('PASS Pi output fixture: immediate activity, results, redaction, and failure detection');
