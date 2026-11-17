# Waiver scout

Runs: Tuesday 9:00 PM ET, before claims clear (`waiversClear`, usually Wednesday 3 AM ET).
Digest: `state/digest/waivers.json`. Follow `scouts/_shared.md`.

What Austin needs from you:
1. Up to 2 claims from `helpNow`, best first. For each: who to drop (from `drops`),
   the `addGainPpg`, and ros floor and ceiling. Say if `inj` makes it a risk.
   If `me.faabLeft` is a number, give a bid in dollars scaled to the gain and `weeksLeftRegular`.
   If it is null, the league uses rolling waiver priority: say whether the player is worth
   spending priority `me.waiverRank` on, since a claim drops Austin to the back.
2. One stash from `stash` if it beats the worst drop on dynasty value (`dv`). Rookies and
   `rising` usage first.
3. Note the `needs` position with the biggest gain if no candidate fills it, in one line.
