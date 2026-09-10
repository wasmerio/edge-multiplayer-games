export class PiReporter {
  constructor(write, secrets = []) {
    this.write = write;
    this.secrets = secrets.filter(Boolean);
    this.tools = new Map();
    this.summary = { bashCalls: 0, successfulBashCalls: 0, messages: 0, ended: false, failed: false };
  }

  log(label, value = '') {
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    for (const secret of this.secrets) text = text.split(secret).join('[REDACTED]');
    this.write(`[pi ${label}] ${text.slice(0, 12000)}\n`);
  }

  event(event) {
    if (event.type === 'agent_start') this.log('start');
    if (event.type === 'tool_execution_start') {
      this.tools.set(event.toolCallId, event.toolName);
      if (event.toolName === 'bash') this.summary.bashCalls++;
      this.log(`tool ${event.toolName}`, event.args);
    }
    if (event.type === 'tool_execution_end') {
      if (this.tools.get(event.toolCallId) === 'bash' && !event.isError) this.summary.successfulBashCalls++;
      this.tools.delete(event.toolCallId);
      const text = (event.result?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
      this.log(event.isError ? 'tool failed' : 'tool done', text);
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      this.summary.messages++;
      this.summary.lastStopReason = event.message.stopReason;
      for (const part of event.message.content ?? []) {
        if (part.type === 'text') this.log('message', part.text);
      }
      if (['error', 'aborted', 'length'].includes(event.message.stopReason)) {
        this.summary.failed = true;
        this.log('error', event.message.errorMessage || event.message.stopReason);
      }
    }
    if (event.type === 'agent_end') {
      this.summary.ended = true;
      this.log('done');
    }
  }
}
