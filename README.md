# Scout desk

Austin's private scouting team for the Woodson dynasty league (team: Toe Guano).
It reads the league and the Dynasty Companion app's data, does the math in code,
and three Claude scouts turn the results into short advice. Nothing here touches the app,
and nothing here makes moves in ESPN.

```
ESPN league + NFL scoreboard + Sleeper trends + the app's public data
   |  every 15 min on game days and nights, hourly otherwise (GitHub Actions, no AI)
   v
watcher/run.js  ->  state/events.json   (what changed)
                ->  state/digest/*.json (about 3.5 KB per scout)
   |
   v
Scouts (Claude routines)  ->  one short post, or silence when nothing needs you
```

## Scouts

| Scout | When (ET) | Reads |
|---|---|---|
| Lineup and news | Thu 7:30 PM, Sun 11:55 AM, 3:20 PM, 7:30 PM | `state/digest/lineup.json` |
| Waivers | Tue 9:00 PM | `state/digest/waivers.json` |
| Free agents | Wed 8:00 AM | `state/digest/freeagents.json` |

Instructions for each are in `scouts/`. A scout posts nothing when its digest says `"quiet": true`.

## Values

The desk uses the app's own numbers: dynasty value (FantasyCalc + DynastyProcess, 50/50),
win-now value, rest-of-season points in league scoring, and the app's lineup and usage engines
(`edge-leverage.js`, `edge-risers.js`). One change: tight ends are valued at **1.5x** instead
of the app's 1.2x cap. Set `teMultiplier` in `config.json` to change it.

## Setup

1. Push this folder to the private repo `itsshorizon/scout-desk`.
2. Actions turns on by itself. Run "Watch the league" once by hand (Actions tab, Run workflow).
   The first run only records a baseline. Events start on the second run.
3. If the league is ever made private, add repo secrets `ESPN_S2` and `SWID`.
4. In March, when daylight saving starts, move every cron in `.github/workflows/watch.yml`
   one hour earlier.

## Tuning (`config.json`)

- `teMultiplier`: tight end bump (1.5).
- `thresholds.swapGainPts`: smallest lineup change worth a post (2 points).
- `thresholds.addGainPpg`: smallest pickup worth a post (1 point per game).
- `thresholds.stashDv`: dynasty value that makes a free agent worth stashing (1,200).
- `thresholds.trendingAdds`: Sleeper adds in 24 hours that count as trending (300).
- `thresholds.valueMovePct`: daily value move on your players worth logging (5%).

## Costs

- GitHub: about 180 watcher runs a week, roughly 800 of the 2,000 free private-repo minutes a month.
- Claude: 6 scout runs a week. Each reads one digest (about 1,000 tokens of data). Quiet runs stop early.

## Tests

`APP_DIR=<path to the app checkout> node --test test/*.test.js`. They build fake ESPN payloads
from the app's real player data and check events and digests end to end.

## Known limits

- ESPN's league API is unofficial. If ESPN changes it, the watcher fails and the scouts say
  the data is stale.
- GitHub can delay scheduled runs by 5 to 15 minutes on busy days.
- Waiver and free-agent lists come from the app's data, refreshed three times a day,
  minus anyone the watcher sees on a roster since.
