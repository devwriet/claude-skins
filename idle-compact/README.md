# idle-compact

Compacts the conversation after 55 idle minutes, while the 1-hour prompt cache should still be warm.
The next prompt then starts from a short summary instead of paying to rebuild the whole context.

## Install

Inside Claude Code:

```
/plugin marketplace add devwriet/claude-skins
```

```
/plugin install idle-compact@srit-mods
```

Open sessions pick it up after a restart. Tested on Claude Code 2.1.331.

## What it does

- The countdown starts when a turn ends. A new turn cancels it. Subagent turns do not count.
- At 55 minutes it compacts if the context holds at least 100K tokens, and a toast says how long you were idle.
- If an hour has passed since the turn ended (the machine slept), it does nothing: the cache is gone.
  The same if the clock moved back past the turn's end.
- Every session has its own countdown.
- With [smart-compact](https://github.com/hellosverre/smart-compact) (tested with 0.3.2): if Claude asked to compact
  and the offer is still unanswered, the summary keeps what Claude asked for. After "Not now" it compacts plainly.
  The offer stays on screen until your next prompt. Do not press it then: it compacts a second time.

It assumes the 1-hour prompt cache. Check `/usage` first: on the 5-minute cache, 55 minutes is too late.
Claude Code's own idle compaction covers contexts over 200K. This mod covers 100K to 200K, and the times
the built-in one does not fire.

A reload, a restart or a resume starts the 55 minutes again, and cannot tell that an older cache has expired.

## Countdown in the status line (optional, macOS and Linux)

The mod writes its state to `~/.claude/idle-compact/<session id>`. A plugin cannot draw in your own
status line, so add this to your status line script. It needs `jq`, and `$input` holding the JSON that
Claude Code sends on stdin (`input=$(cat)`). Set `"refreshInterval": 1` under `statusLine` in
`~/.claude/settings.json` so the countdown moves.

```bash
# idle-compact mod: countdown to the idle compaction. The mod skips contexts under 100K, so hide it there.
IFS='|' read -r session_id pct_int ctx_size_int < <(jq -r '[.session_id // "",
  (.context_window.used_percentage // 0 | floor), .context_window.context_window_size // 0] | join("|")' <<< "$input")
ic_text=""
ic_file="$HOME/.claude/idle-compact/${session_id}"
if [[ -n "$session_id" && -f "$ic_file" ]]; then
  ic_state=""; ic_a=""; ic_b=""
  read -r ic_state ic_a ic_b < "$ic_file" || true
  if [[ "$ic_state" == "armed" && "$ic_a" =~ ^[0-9]+$ ]] && (( pct_int * ctx_size_int >= 10000000 )); then
    ic_left=$(( 10#$ic_a - $(date +%s) ))
    if (( ic_left > 0 )); then
      ic_min=$(( (ic_left + 59) / 60 ))
      if (( ic_min > 20 )); then ic_style="\033[32m●"
      elif (( ic_min > 5 )); then ic_style="\033[33m◐"
      else ic_style="\033[1m\033[31m○"; fi
      ic_text="${ic_style} automatically compacts in ${ic_min}m\033[0m"
    fi
  elif [[ "$ic_state" == "active" && "$ic_a" =~ ^[0-9]+$ ]] && (( pct_int * ctx_size_int >= 10000000 )); then
    ic_text="\033[90m● automatically compacts in ${ic_a}m\033[0m"
  elif [[ "$ic_state" == "done" && "$ic_a" =~ ^[0-9]+$ && "$ic_b" =~ ^[0-9]+$ ]]; then
    ic_text="\033[35mcompacted after ${ic_a}m idle (${ic_b}K)\033[0m"
  fi
fi
if [[ -n "$ic_text" ]]; then printf '%b\n' "$ic_text"; fi
```

It hides when the last request held less than about 100K tokens. The mod checks the current size, so near 100K
it can still compact while the countdown is hidden.

| Time left | Style |
|---|---|
| over 20 min | green `●` |
| 6 to 20 min | yellow `◐` |
| 5 min or less | bold red `○` |
| Claude is working | gray `●`, held at 55 min |

## Settings

`IDLE_MS`, `CACHE_TTL_MS` and `MIN_TOKENS` at the top of `hooks/register.ts`.

## Test

```bash
claude plugin test idle-compact
```
