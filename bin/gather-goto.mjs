#!/usr/bin/env node
// gather-goto — walk (or teleport) your Gather 2.0 avatar to a place.
//
//   gather-goto "Koi Pond"        walk to the area with that name (case-insensitive, substring ok)
//   gather-goto desk              walk to your own desk
//   gather-goto customer          walk to the nearest free "Kunde" area (nobody standing in it)
//   gather-goto 80,75             walk to a tile coordinate on the current floor
//   gather-goto koi               a preset from ~/.config/gather-goto/locations.json
//   gather-goto --list            print all areas on the current floor
//   Every successful move first mutes the mic and turns the camera off.
//   options: --keep-av (leave mic/camera as they are), --teleport (jump instead of walk),
//            --relaunch (restart Gather with the debug port without asking),
//            --no-prompt (never show a dialog; exit 2 instead), --focus (bring the Gather window to the front)
//
// Gather must be running with its Chrome DevTools port open:
//   open -a GatherV2 --args --remote-debugging-port=9222
// If Gather is not running, this script starts it that way itself. If Gather runs without the
// port (opened from the Dock or Spotlight), a dialog asks whether to relaunch it.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PORT, listTargets, isGatherTargets, findGatherPage, evaluate } from "../lib/cdp.mjs"

const CONFIG = path.join(os.homedir(), ".config/gather-goto/locations.json")
const APP = "GatherV2"
const READY = "!!globalThis.gatherDev?.Repos?.gameSpace?.currentSpaceUserOrUndefined"

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const words = argv.filter((a) => !a.startsWith("--"))
const has = (f) => flags.has(f)
const fail = (msg, code = 1) => { console.error(msg); process.exit(code) }

if (has("--help") || (!words.length && !has("--list"))) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"))
  process.exit(0)
}

// ---------- resolve the target ----------
const loadPresets = () => {
  let raw
  try { raw = fs.readFileSync(CONFIG, "utf8") } catch { return new Map() }
  try { return new Map(Object.entries(JSON.parse(raw)).map(([k, v]) => [k.trim().toLowerCase(), v])) }
  catch (e) { fail(`${CONFIG} is not valid JSON: ${e.message}`) }
}
const target = { teleport: has("--teleport"), keepAv: has("--keep-av") }
if (has("--list")) target.list = true
else {
  const raw = words.join(" ").trim(), key = raw.toLowerCase()
  const preset = loadPresets().get(key)   // names match case-insensitively
  const m = raw.match(/^(\d+)\s*,\s*(\d+)$/)
  if (preset) Object.assign(target, preset)
  else if (key === "desk") target.desk = true
  else if (["customer", "customer call", "kunde", "kundencall"].includes(key)) target.free = "Kunde"
  else if (m) target.tile = { x: Number(m[1]), y: Number(m[2]) }
  else target.area = raw
}

// ---------- find or start Gather ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isRunning = () => spawnSync("pgrep", ["-x", APP]).status === 0

/** Wait until the office page exists and the space is loaded; undefined on timeout. */
const waitReady = async (seconds) => {
  for (let i = 0; i < seconds; i++) {
    const page = findGatherPage(await listTargets())
    if (page) { try { if (await evaluate(page, READY, { timeout: 5000 })) return page } catch {} }
    await sleep(1000)
  }
}

const launch = async () => {
  if (isRunning()) {
    process.stderr.write("Quitting Gather.\n")
    spawnSync("osascript", ["-e", `quit app "${APP}"`])
    for (let i = 0; i < 40 && isRunning(); i++) await sleep(500)
    if (isRunning()) {   // quit refused or hung: `open --args` on a running app would silently drop the port flag
      spawnSync("pkill", ["-x", APP])
      for (let i = 0; i < 20 && isRunning(); i++) await sleep(500)
    }
    if (isRunning()) fail("Gather could not be quit, so it cannot be restarted with the debug port. Quit it by hand and run this again.", 2)
    await sleep(1000)
  }
  process.stderr.write(`Starting Gather with --remote-debugging-port=${PORT}.\n`)
  const r = spawnSync("open", ["-a", APP, "--args", `--remote-debugging-port=${PORT}`], { encoding: "utf8" })
  if (r.status !== 0) fail(`Could not start ${APP}: ${r.stderr.trim()}`, 2)
  const page = await waitReady(120)
  if (!page) {
    const list = await listTargets()
    fail(list === null ? `Gather started but port ${PORT} did not open.`
      : !isGatherTargets(list) ? `Port ${PORT} is used by another application, so Gather cannot open it. Set GATHER_DEBUG_PORT to a free port.`
      : "Gather started but the office did not load within 2 minutes (are you signed in?).", 2)
  }
  return page
}

const askRelaunch = () => {
  const timeout = Number(process.env.GATHER_PROMPT_TIMEOUT ?? 90)
  const text = "Gather is running without its control port, so gather-goto cannot steer it.\n\nRelaunch Gather now? You will leave any call you are in and rejoin the office in a few seconds."
  const r = spawnSync("osascript", ["-e", "activate", "-e",
    `display dialog ${JSON.stringify(text)} with title "gather-goto" buttons {"Cancel", "Relaunch Gather"} default button "Relaunch Gather" cancel button "Cancel" with icon caution giving up after ${timeout}`], { encoding: "utf8" })
  return r.status === 0 && r.stdout.includes("Relaunch Gather") && !r.stdout.includes("gave up:true")
}

const connect = async () => {
  if (has("--relaunch")) return launch()
  const list = await listTargets()
  if (list === null) {                       // nothing listens on the port
    if (!isRunning()) return launch()
    if (has("--no-prompt")) fail(`Gather is running but its debug port ${PORT} is closed. Run again with --relaunch, or start Gather with:\n  open -a ${APP} --args --remote-debugging-port=${PORT}`, 2)
    if (!askRelaunch()) fail("Relaunch declined; nothing done.", 2)
    return launch()
  }
  if (!isGatherTargets(list)) fail(`Port ${PORT} is used by another application, not Gather. Set GATHER_DEBUG_PORT to a free port and start Gather with it.`, 2)
  // Gather owns the port; the office may still be loading (just started, sign-in or update screen)
  const page = await waitReady(60)
  if (!page) fail("Gather is running but the office has not loaded (are you signed in?).", 2)
  return page
}

// ---------- the part that runs inside the Gather page ----------
const inPage = async (t) => {
  const su = gatherDev.Repos.gameSpace.currentSpaceUserOrUndefined
  if (!su) return { error: "not in a space yet" }
  const MC = gatherDev.MoveController
  const Pos = su.position.constructor
  const list = (v) => Array.isArray(v) ? v : v?.values ? [...v.values()] : Object.values(v ?? {})
  const map = su.floor.activeMapOrThrow
  const areas = list(map.areas)
  const nameOf = (a) => a.displayName ?? a.name ?? ""
  const key = (p) => `${p.x},${p.y}`
  const from = [su.x, su.y]
  const dims = map.dimensionsInTiles
  const inside = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < dims.width && p.y < dims.height
  const others = () => list(su.space.spaceUsers).filter((u) => u.id !== su.id && u.connected && !u.isBot && u.floorId === su.floorId)
  if (t.list) return { areas: areas.map((a) => ({ name: nameOf(a), type: a.mapAreaType })) }

  // Called only once the target is resolved: mute mic and camera (the setters Gather's own
  // "turn off" uses), then move. A failed lookup returns before this and changes nothing.
  const go = (label, move) => {
    let av = "kept"
    if (!t.keepAv) {
      const lm = gatherDev.Repos.localMediaSelfInfo
      const changed = [!lm.audioMuteClicked && "mic muted", !lm.videoMuteClicked && "camera off"].filter(Boolean)
      lm.setAudioMuteClicked(true); lm.setVideoMuteClicked(true)
      av = changed.length ? changed.join(", ") : "already off"
    }
    move()
    return { ok: label, from, av }
  }
  const toArea = (a) => () => MC.moveSpaceUserToMapArea(a, { forceTeleport: !!t.teleport })
  const toTile = (p) => () => { const pos = new Pos(p); if (t.teleport) MC.teleport(pos, true); else MC.moveSpaceUserToTile(pos, su.floorId) }

  if (t.desk) {
    if (!su.desk) return { error: "you have no desk assigned" }
    return go(`desk (${nameOf(su.desk)})`, toArea(su.desk))
  }
  if (t.tiles && t.tiles.length) {
    // custom region: skip blocked tiles and tiles with people on them, prefer furniture seats,
    // keep `spacing` tiles from every other avatar, nearest such tile to me
    const people = others()
    const taken = new Set(people.map(key))
    const ok = t.tiles.map(([x, y]) => ({ x, y })).filter((p) => inside(p) && !taken.has(key(p)) && !map.collisions.blockedAtPosition(new Pos(p)))
    if (!ok.length) return { error: `all ${t.tiles.length} tiles of that spot are taken, blocked or outside this floor` }
    const seatSet = new Set()
    if (t.seats !== false) for (const o of list(map.mapObjects)) { try { for (const st of o.activeSittableAbsoluteTiles ?? []) seatSet.add(key(st)) } catch {} }
    const seats = ok.filter((p) => seatSet.has(key(p)))
    const pool = seats.length ? seats : ok
    const gap = (p) => people.reduce((m, u) => Math.min(m, Math.max(Math.abs(u.x - p.x), Math.abs(u.y - p.y))), Infinity)
    const near = (p) => Math.abs(p.x - su.x) + Math.abs(p.y - su.y)
    const spacing = t.spacing ?? 3
    const roomy = pool.filter((p) => gap(p) >= spacing).sort((a, b) => near(a) - near(b))
    const pick = roomy[0] ?? [...pool].sort((a, b) => gap(b) - gap(a) || near(a) - near(b))[0]
    const g = gap(pick), kind = seats.length ? "seat" : "tile"
    return go(`${kind} ${pick.x},${pick.y} (${pool.length} free ${kind}s${g === Infinity ? ", nobody nearby" : `, nearest avatar ${g} tiles away`})`, toTile(pick))
  }
  if (t.tile) {
    if (!inside(t.tile)) return { error: `tile ${t.tile.x},${t.tile.y} is outside this floor (${dims.width} × ${dims.height} tiles)` }
    return go(`tile ${t.tile.x},${t.tile.y}`, toTile(t.tile))
  }
  if (t.free) {
    const q = t.free.toLowerCase()
    const cands = areas.filter((x) => nameOf(x).toLowerCase().startsWith(q))
    if (!cands.length) return { error: `no areas starting with "${t.free}" on this floor` }
    const people = others()
    const occupied = (a) => { const tiles = new Set((a.positions || []).map(key)); return people.some((u) => tiles.has(key(u))) }
    const dist = (a) => {
      const ps = a.positions || []
      if (!ps.length) return Infinity
      return Math.abs(ps.reduce((s, p) => s + p.x, 0) / ps.length - su.x) + Math.abs(ps.reduce((s, p) => s + p.y, 0) / ps.length - su.y)
    }
    const free = cands.filter((a) => !occupied(a)).sort((a, b) => dist(a) - dist(b))
    if (!free.length) return { error: `all ${cands.length} "${t.free}" areas are occupied right now` }
    return go(`${nameOf(free[0])} (${free.length} of ${cands.length} free)`, toArea(free[0]))
  }
  if (t.area) {
    const q = t.area.toLowerCase()
    const a = areas.find((x) => nameOf(x).toLowerCase() === q) ?? areas.find((x) => nameOf(x).toLowerCase().includes(q))
    if (!a) return { error: `no area named "${t.area}" on this floor (try --list)` }
    return go(nameOf(a), toArea(a))
  }
  return { error: "nothing to do" }
}

// ---------- run ----------
try {
  const page = await connect()
  const result = await evaluate(page, `(${inPage})(${JSON.stringify(target)})`)
  if (!result || result.error) fail(result?.error ?? "Gather returned no result")
  if (result.areas) {
    const w = Math.max(0, ...result.areas.map((a) => a.name.length))
    for (const a of result.areas) console.log(a.name.padEnd(w), " ", a.type)
  } else {
    console.log(`${target.teleport ? "Teleporting" : "Walking"} from ${result.from.join(",")} to ${result.ok}` + (result.av === "kept" ? "" : ` · mic/camera: ${result.av}`))
  }
  if (has("--focus")) spawnSync("osascript", ["-e", `tell application "${APP}" to activate`])
  process.exit(0)
} catch (e) {
  fail(`gather-goto: ${e.message}`)
}
