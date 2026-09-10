import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PiReporter } from './pi_events.mjs';
import { terminateChild } from './terminate_child.mjs';

const [reportPath, systemPath, inputPath, model, seconds = '1800'] = process.argv.slice(2);
if (!reportPath || !systemPath || !inputPath || !model) throw new Error('Missing Pi run arguments');
const logPath = join(dirname(reportPath), 'pi.log');
let lastActivity = Date.now();
const reporter = new PiReporter(text => {
  lastActivity = Date.now();
  appendFileSync(logPath, text);
  process.stdout.write(text);
}, [process.env.OPENAI_API_KEY]);
const heartbeat = setInterval(() => {
  if (Date.now() - lastActivity >= 30000) reporter.log('running', 'Waiting for the next message or tool result');
}, 30000);
const child = spawn('/bin/node', ['/app/pi_entry.mjs', systemPath, inputPath, model],
  { stdio: ['ignore', 'pipe', 'pipe'] });

let pending = '';
let stderr = '';
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  reporter.log('error', 'Agent time limit reached');
  terminateChild(child);
}, Number(seconds) * 1000);
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
function line(text) {
  if (!text.trim()) return;
  try { reporter.event(JSON.parse(text)); }
  catch { reporter.summary.failed = true; reporter.log('error', 'Invalid Pi event'); }
}
child.stdout.on('data', chunk => {
  pending += chunk;
  if (pending.length > 8 * 1024 * 1024) {
    reporter.summary.failed = true;
    reporter.log('error', 'Pi event exceeds output limit');
    terminateChild(child);
    pending = '';
    return;
  }
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    line(pending.slice(0, end));
    pending = pending.slice(end + 1);
  }
});
child.stderr.on('data', chunk => {
  stderr = (stderr + chunk).slice(-12000);
});
child.on('error', error => {
  reporter.summary.failed = true;
  reporter.log('error', error.message);
});
child.on('close', code => {
  clearTimeout(timer);
  clearInterval(heartbeat);
  line(pending);
  if (stderr) reporter.log('stderr', stderr);
  const summary = { ...reporter.summary, code, timedOut };
  summary.ok = code === 0 && !timedOut && !summary.failed && summary.ended && summary.lastStopReason === 'stop' && summary.successfulBashCalls > 0;
  writeFileSync(reportPath, JSON.stringify(summary));
  process.exitCode = summary.ok ? 0 : 1;
});
