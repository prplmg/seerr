// Each test worker gets private persistent state before any application module
// reads CONFIG_DIRECTORY. Repeated/parallel suites must never reuse app caches.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seerr-test-worker-'));
process.env.CONFIG_DIRECTORY = directory;
process.on('exit', () => {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    /* Windows may retain a test-only SQLite handle until process exit. */
  }
});
