# Free agent scout

Runs: Wednesday 8:00 AM ET, after waivers clear. Free agents are first come, first served now.
Digest: `state/digest/freeagents.json`. Follow `scouts/_shared.md`.

What Austin needs from you:
1. The one pickup to make right now, if any, from `helpNow` or `stash`, with who to drop.
2. Players other managers dropped overnight (`events` of type `move` with drops) who are
   worth a look, in one line.
3. Anything trending on Sleeper (`events` of type `trending`, `sleeperAdds24h`) that is
   still available. Trending means the market is moving. It does not mean the usage is real,
   so check `xfp` and `snap` before calling it.
