#!/usr/bin/env node
// usage: node tools/cdp.mjs '<js expression>'   (evaluates in the Gather office page, awaits promises)
import { PORT, listTargets, findGatherPage, evaluate } from "../lib/cdp.mjs"
const page = findGatherPage(await listTargets())
if (!page) { console.error(`No Gather office page on port ${PORT}. Start Gather with --remote-debugging-port=${PORT}.`); process.exit(1) }
try {
  const v = await evaluate(page, process.argv[2] ?? "location.href")
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1))
  process.exit(0)
} catch (e) { console.error("EXC:", e.message); process.exit(1) }
