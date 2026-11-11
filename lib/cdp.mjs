// Shared Chrome DevTools Protocol helpers for talking to the GatherV2 desktop app.
export const PORT = Number(process.env.GATHER_DEBUG_PORT ?? 9222)
export const GATHER_ORIGIN = "https://app.v2.gather.town/"

/**
 * The CDP target list of whatever listens on the port.
 * Returns null when nothing listens, "foreign" when something answers that is not a DevTools
 * endpoint, otherwise the array of targets.
 */
export const listTargets = async (port = PORT) => {
  let res
  try { res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) }) } catch { return null }
  try { const list = await res.json(); return Array.isArray(list) ? list : "foreign" } catch { return "foreign" }
}

/** True when the target list belongs to the Gather desktop app (any of its windows). */
export const isGatherTargets = (list) => Array.isArray(list) &&
  list.some((t) => /^gather-desktop:|GatherV2\.app|^https:\/\/app\.v2\.gather\.town\//.test(t.url ?? ""))

/** The office page inside Gather, or undefined while it has not loaded yet. */
export const findGatherPage = (list) => Array.isArray(list)
  ? list.find((t) => t.type === "page" && (t.url ?? "").startsWith(GATHER_ORIGIN))
  : undefined

/**
 * Evaluate an expression in a page and return its value. Rejects with a readable Error on a
 * JavaScript exception, a protocol error, a closed socket, or a timeout.
 */
export const evaluate = (page, expression, { timeout = 20000 } = {}) => new Promise((resolve, reject) => {
  let done = false
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { ws.close() } catch {} fn(v) }
  const timer = setTimeout(() => finish(reject, new Error(`Gather did not answer within ${timeout / 1000} s`)), timeout + 2000)
  ws.onerror = () => finish(reject, new Error("could not connect to the Gather page"))
  ws.onclose = () => finish(reject, new Error("connection to Gather closed before it answered"))
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true, timeout } }))
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data) } catch { return }
    if (m.id !== 1) return
    if (m.error) return finish(reject, new Error(m.error.message ?? JSON.stringify(m.error)))
    const ex = m.result?.exceptionDetails
    if (ex) return finish(reject, new Error(ex.exception?.description ?? ex.text ?? JSON.stringify(ex)))
    finish(resolve, m.result?.result?.value)
  }
})
