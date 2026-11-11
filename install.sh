#!/bin/zsh
# Installs gather-goto on this Mac.
#   ./install.sh                 CLI + config only
#   ./install.sh --launch-agent  also replace Gather's login item with a LaunchAgent that
#                                starts Gather with the DevTools port at login
#   ./install.sh --shortcuts     also build and open the macOS Shortcuts
#   ./install.sh --teams         also run gather-goto automatically when a Teams call starts
set -e
here=${0:a:h}
node_bin=$(command -v node) || { echo "Node 22 or newer is required: brew install node"; exit 1; }
node_major=$("$node_bin" -p 'process.versions.node.split(".")[0]')
(( node_major >= 22 )) || { echo "Node 22 or newer is required (found $("$node_bin" -v)): brew upgrade node"; exit 1; }

share=~/.local/share/gather-goto
mkdir -p ~/.local/bin ~/.config/gather-goto $share/bin $share/lib
cp "$here/bin/gather-goto.mjs" $share/bin/
cp "$here/lib/cdp.mjs" $share/lib/
# Wrapper with an absolute node path: Shortcuts runs scripts with a minimal PATH.
cat > ~/.local/bin/gather-goto <<WRAP
#!/bin/sh
exec "$node_bin" "$share/bin/gather-goto.mjs" "\$@"
WRAP
chmod +x ~/.local/bin/gather-goto
[ -f ~/.config/gather-goto/locations.json ] || cp "$here/config/locations.example.json" ~/.config/gather-goto/locations.json
echo "installed ~/.local/bin/gather-goto (config: ~/.config/gather-goto/locations.json)"

for arg in "$@"; do
  case $arg in
    --launch-agent)
      osascript -e 'tell application "System Events" to delete login item "GatherV2"' >/dev/null 2>&1 && echo "removed Gather login item" || true
      mkdir -p ~/Library/LaunchAgents
      plist=~/Library/LaunchAgents/gather-goto.debug-launch.plist
      cp "$here/launchd/gather-goto.debug-launch.plist" $plist
      domain=gui/$(id -u)
      launchctl bootout $domain/gather-goto.debug-launch 2>/dev/null || true
      # bootout is asynchronous; retry the bootstrap briefly instead of failing on the race
      ok=0; for i in 1 2 3 4 5; do launchctl bootstrap $domain $plist 2>/dev/null && { ok=1; break; }; sleep 1; done
      (( ok )) && echo "LaunchAgent installed: Gather starts with --remote-debugging-port=9222 at login" \
               || echo "warning: could not load the LaunchAgent now; it will load at next login ($plist)";;
    --shortcuts) python3 "$here/shortcuts/build_shortcuts.py";;
    --teams)
      # Runs gather-goto when a Teams call starts. Needs the Swift compiler (xcode-select --install).
      command -v swiftc >/dev/null || { echo "swiftc not found: run xcode-select --install"; exit 1; }
      mkdir -p $share/teams
      swiftc -O "$here/teams/mic-watch.swift" -o $share/teams/mic-watch
      cp "$here/teams/gather-teams-watch" $share/teams/ && chmod +x $share/teams/gather-teams-watch
      [ -f ~/.config/gather-goto/teams.conf ] || cp "$here/config/teams.example.conf" ~/.config/gather-goto/teams.conf
      mkdir -p ~/Library/LaunchAgents
      plist=~/Library/LaunchAgents/gather-goto.teams-watch.plist
      sed "s|__HOME__|$HOME|g" "$here/launchd/gather-goto.teams-watch.plist" > $plist
      domain=gui/$(id -u)
      launchctl bootout $domain/gather-goto.teams-watch 2>/dev/null || true
      ok=0; for i in 1 2 3 4 5; do launchctl bootstrap $domain $plist 2>/dev/null && { ok=1; break; }; sleep 1; done
      (( ok )) && echo "Teams watcher installed (settings: ~/.config/gather-goto/teams.conf, log: ~/.config/gather-goto/teams-watch.log)" \
               || echo "warning: could not load the Teams watcher now; it will load at next login";;
    *) echo "unknown option: $arg"; exit 1;;
  esac
done
