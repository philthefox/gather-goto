# gather-goto

Walk your Gather 2.0 avatar to a place from the command line, a macOS Shortcut, a hotkey
or a Stream Deck button. Works with the **GatherV2 desktop app** on macOS.

```
gather-goto "Koi Pond"        walk to the area with that name (case-insensitive, substring ok)
gather-goto desk              walk to your own desk
gather-goto customer          nearest "Kunde" area where nobody is standing
gather-goto afk               a saved region: free seat, away from other avatars
gather-goto 80,75             a tile coordinate on the current floor
gather-goto koi --teleport    jump instead of walk
gather-goto --list            all areas on the current floor
gather-goto koi --keep-av     leave mic and camera as they are
```

Every successful move first **mutes the microphone and turns the camera off** (the same setters
Gather's own "turn off audio/video" uses). A command that fails, for example a misspelled area,
changes nothing. Pass `--keep-av` to skip the muting.

This is an unofficial hobby tool. It is not affiliated with or endorsed by Gather, and it
relies on undocumented internals of the Gather app that can change at any time.

## How it works

Gather 2.0 has no public API for movement, but the desktop app is Electron. Started with
`--remote-debugging-port=9222` it exposes the Chrome DevTools Protocol on localhost, and the
web app inside it exposes its own movement controller as `gatherDev.MoveController`.
`gather-goto` connects over CDP and calls that controller, so the avatar uses Gather's own
pathfinding and the walk is indistinguishable from a mouse click.

Nothing is sent anywhere but `127.0.0.1:9222`. Note that while the port is open, any local
process can drive Gather the same way.

## Install

```
git clone https://github.com/philthefox/gather-goto.git
cd gather-goto
./install.sh --launch-agent --shortcuts
```

- `install.sh` copies the CLI to `~/.local/share/gather-goto`, puts a wrapper in `~/.local/bin`
  (with an absolute node path, because Shortcuts runs scripts with a minimal `PATH`) and creates
  `~/.config/gather-goto/locations.json`. Run it again after pulling changes.
- `--launch-agent` removes Gather's own login item and installs a LaunchAgent that starts
  Gather with the debug port at login.
- If Gather was started without the port (Dock, Spotlight, or Gather restarting itself after
  an update), the next `gather-goto` run shows a dialog asking whether to relaunch Gather.
  Relaunching drops you out of any current call and rejoins the office in a few seconds.
  `--relaunch` skips the question, `--no-prompt` never asks and exits with status 2 instead.
- If Gather has the port but the office is still loading, the CLI waits up to a minute. If
  another application holds the port it says so; set `GATHER_DEBUG_PORT` to use a different one.
- `--shortcuts` builds the Shortcuts below and opens them for import.

Requires Node 22 or newer (`brew install node`; the installer checks), macOS 13 or newer,
GatherV2 ≥ 0.66. Exit status: 0 moved, 1 target not found or busy, 2 Gather not reachable.

## Presets: `~/.config/gather-goto/locations.json`

A preset maps a name to one of these targets:

| Shape | Meaning |
|---|---|
| `{"area": "Koi Pond"}` | walk into the named Gather area; seats are preferred by Gather itself |
| `{"tile": {"x": 83, "y": 69}}` | walk to one tile |
| `{"free": "Kunde"}` | nearest area whose name starts with the prefix and where no connected person stands ("Kunde" is German for customer: the author's office has several small call booths named that way; use your own prefix) |
| `{"tiles": [[x,y],...], "seats": true, "spacing": 3}` | custom region: skip blocked tiles and tiles with people on them, prefer furniture seats, keep `spacing` tiles from every other avatar, nearest such seat to you; `"seats": false` to stand instead |

Preset names are matched case-insensitively in both directions, so a Shortcut menu entry
"Customer call" resolves a preset stored as `customer call` or `Customer Call`.

## Spot Picker (define regions on a floor plan)

`picker/` is a single-page floor plan built from Gather's own data (areas, furniture
footprints, collision grid). The repository ships a synthetic demo floor
(`picker/data.example.json`); your own export goes to `picker/data.json`, which is ignored by
git because it contains your office layout and the names on its desks. Click tiles or drag rectangles, name the selection, save, and
copy the generated JSON into `locations.json`.

```
node tools/export-map.mjs      # writes picker/data.json from the running, debuggable Gather
python3 picker/build.py        # writes picker/index.html (generated, not committed)
```

A failed export leaves the previous `data.json` untouched. On a touch screen, tap tiles to
toggle them, or switch the "Drag scrolls" button to "Drag selects".

Open `picker/index.html` locally, or publish it as a Claude artifact with the `db`
capability so saved spots persist and Claude can read them back.

## macOS Shortcuts

`shortcuts/build_shortcuts.py` generates, signs (`shortcuts sign --mode anyone`) and opens:

- **Gather - Desk / AFK / Customer call / Koi Pond**: one command each, meant for a hotkey
  (open the shortcut, ⓘ, "Add Keyboard Shortcut").
- **Gather - Go to**: a menu of destinations.

Shortcuts > Settings > Advanced > "Allow Running Scripts" must be on. Re-importing creates a
second copy; delete the older one.

## Automatic move when a Teams call starts

`./install.sh --teams` installs a small background watcher that runs `gather-goto` when
Microsoft Teams starts a call. Teams no longer offers a local API for this (retired in June
2026), so the watcher recognises a call by Teams capturing the microphone. `teams/mic-watch.swift`
uses the CoreAudio process objects of macOS 14 or newer and is notified by the system; it does
not poll and uses no CPU while idle.

Settings live in `~/.config/gather-goto/teams.conf`:

| Setting | Default | Meaning |
|---|---|---|
| `ON_START` | `customer` | target when a call starts (nearest free Kunde area), empty for none |
| `ON_END` | `desk` | target once the call has ended, empty for none |
| `START_AFTER` | `3` | seconds of microphone use before it counts as a call |
| `END_AFTER` | `20` | seconds without microphone use before the call counts as ended |

After editing run `launchctl kickstart -k gui/$(id -u)/gather-goto.teams-watch`. The
log is `~/.config/gather-goto/teams-watch.log`. `mic-watch` on its own lists the apps using the
microphone right now; `mic-watch --watch [bundle-prefix]` prints start and stop events.

Teams keeps the microphone open while you are muted in a call, so muting does not end the
"call" (verified with Teams on macOS 26). Limit: the Teams device test and the pre-join screen
also open the microphone and therefore trigger the move; `END_AFTER` bridges short gaps. Needs the Swift compiler (`xcode-select --install`).

## Tools

- `tools/cdp.mjs '<js>'` evaluates JavaScript inside the Gather page, e.g.
  `node tools/cdp.mjs 'Object.keys(gatherDev.MoveController)'`.
- `tools/export-map.mjs` dumps the current floor for the picker.
- `lib/cdp.mjs` holds the shared DevTools connection code used by the CLI and both tools.

## Caveats

- Gather's internals (`gatherDev.*`) are undocumented and can change with any Gather release.
  Version 0.66.2 is known to work.
- Occupancy is judged by where connected avatars stand right now, not by desk assignment.
- Only the current floor is handled.

## License

MIT, see [LICENSE](LICENSE).
