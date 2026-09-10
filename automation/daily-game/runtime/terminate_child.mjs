// Descendants can inherit pipes even after the immediate child exits.
export function terminateChild(child) {
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.kill('SIGKILL');
}
