// GET-only smoke checks. One failure-triggered retry, never a readiness loop.
const transientCodes = new Set(['EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
function details(error, depth = 0) {
  if (!error || depth > 4) return undefined;
  return {
    name: error.name,
    code: error.code,
    message: String(error.message || error).replace(/https?:\/\/\S+/g, '[URL]').replace(/(authorization|cookie|token|api[_-]?key|password)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 500),
    syscall: error.syscall,
    cause: details(error.cause, depth + 1),
    errors: Array.isArray(error.errors) ? error.errors.slice(0, 8).map(e => details(e, depth + 1)) : undefined,
  };
}
function transient(error, depth = 0) {
  if (!error || depth > 4) return false;
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.every(e => transient(e, depth + 1));
  return transientCodes.has(error.code) || error.name === 'TimeoutError' || transient(error.cause, depth + 1);
}
async function healthJson(url, options = {}, deps = {}) {
  const fetcher = deps.fetch || fetch;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const log = deps.log || (event => console.error(JSON.stringify(event)));
  const endpoint = new URL(url).origin + new URL(url).pathname;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetcher(url, { headers: options.headers, method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`Health HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Health response is not a JSON object');
      return value;
    } catch (error) {
      const retry = attempt === 1 && transient(error);
      log({ event: 'deployment-health-failure', endpoint, attempt, retry, status: error.status, error: details(error) });
      if (!retry) throw new Error(`Health check failed for ${endpoint}: ${JSON.stringify(details(error))}`, { cause: error });
      await sleep(5000);
    }
  }
}
module.exports = { healthJson, details, transient };
