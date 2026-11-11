#!/usr/bin/env node
// Exports the current floor (areas, collision grid, furniture footprints, your position) from the
// running Gather desktop app for the Spot Picker page.
//   node tools/export-map.mjs [output.json]      default: picker/data.json
// The file is replaced only after a successful export.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PORT, listTargets, findGatherPage, evaluate } from "../lib/cdp.mjs"

const out = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../picker/data.json"))
const page = findGatherPage(await listTargets())
if (!page) { console.error(`No Gather office page on port ${PORT}. Start Gather with --remote-debugging-port=${PORT} and enter the office.`); process.exit(1) }

const inPage = () => {
  const su = gatherDev.Repos.gameSpace.currentSpaceUser, m = su.floor.activeMapOrThrow, Pos = su.position.constructor
  const list = (v) => Array.isArray(v) ? v : v?.values ? [...v.values()] : Object.values(v ?? {})
  const d = m.dimensionsInTiles, collisions = []
  for (let y = 0; y < d.height; y++) { let r = ""; for (let x = 0; x < d.width; x++) { let b = false; try { b = m.collisions.blockedAtPosition(new Pos({ x, y })) } catch {} r += b ? "#" : "." } collisions.push(r) }
  const objects = []
  for (const o of list(m.mapObjects)) { try { if (o.isSoftDeleted) continue; const p = o.topLeftAbsolutePosition, s = o.getDimensionsInTiles(); objects.push([+p.x.toFixed(2), +p.y.toFixed(2), +s.width.toFixed(2), +s.height.toFixed(2), o.isSeat ? 1 : o.isDesk ? 2 : 0]) } catch {} }
  return { floor: su.floor.name, dims: { width: d.width, height: d.height }, me: { x: su.x, y: su.y },
    areas: list(m.areas).map((a) => ({ name: a.displayName ?? a.name, type: a.mapAreaType, tiles: (a.positions || []).map((p) => [p.x, p.y]) })),
    collisions, objects }
}
try {
  const data = await evaluate(page, `(${inPage})()`, { timeout: 30000 })
  if (!data?.areas?.length) throw new Error("the export came back empty")
  const tmp = `${out}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, out)
  console.log(`wrote ${out}: floor "${data.floor}", ${data.areas.length} areas, ${data.objects.length} objects`)
  process.exit(0)
} catch (e) { console.error(`export failed, ${out} left untouched: ${e.message}`); process.exit(1) }
