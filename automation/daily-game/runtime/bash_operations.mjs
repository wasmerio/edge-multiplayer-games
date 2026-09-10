import { spawn } from 'node:child_process';
import { terminateChild } from './terminate_child.mjs';

// WASIX supports child processes but not detached process groups.
export function createBashOperations(onTimeout = () => {}) {
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Bash command aborted'));
        const child = spawn('/bin/bash', ['-c', command], {
          cwd, env, detached: false, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let failure;
        const stop = (message, timedOut = false) => {
          if (failure) return;
          failure = new Error(message);
          cleanup();
          try { terminateChild(child); }
          finally {
            reject(failure);
            if (timedOut) onTimeout(failure);
          }
        };
        const abort = () => stop('Bash command aborted');
        signal?.addEventListener('abort', abort, { once: true });
        const timer = timeout ? setTimeout(() => stop(`Command timed out after ${timeout} seconds`, true), timeout * 1000) : undefined;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', error => { cleanup(); reject(error); });
        child.on('close', exitCode => {
          cleanup();
          if (failure) reject(failure);
          else resolve({ exitCode });
        });
      });
    },
  };
}

export const bashOperations = createBashOperations();
