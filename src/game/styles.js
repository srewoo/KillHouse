/**
 * Game-layer overlay stylesheet: compass, objective tracker, world markers,
 * interact prompt, radio captions, banners, score strip and the mission cards.
 * Same visual language as the HUD (condensed caps, hard text shadow, no panels in
 * play). Cards are the one place with a backing — they are menus, not HUD.
 *
 * OWNER: game (src/game/**).
 */
export const GAME_CSS = /* css */`
#game-ui {
  position: fixed; inset: 0; z-index: 62; pointer-events: none; overflow: hidden;
  font-family: "Barlow Condensed","Oswald","Roboto Condensed","Arial Narrow",Helvetica,Arial,sans-serif;
  font-stretch: 75%; text-transform: uppercase; color: rgba(232,235,237,.86);
  --sh: 0 1px 2px rgba(0,0,0,.92), 0 0 9px rgba(0,0,0,.55);
  --amber: #c8a24a; --good: #6fd08c; --bad: #d0644c;
  text-shadow: var(--sh);
}
#game-ui[hidden], #game-ui [hidden] { display: none !important; }
#game-ui .play { position: absolute; inset: 0; transition: opacity .5s; }
#game-ui.cinema .play { opacity: 0; }

/* compass */
#game-ui .compass { position: absolute; left: 50%; top: 2.2vh; width: min(520px, 46vw); height: 30px;
  transform: translateX(-50%); overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
#game-ui .compass .tape { position: absolute; left: 50%; top: 0; height: 100%; }
#game-ui .compass .ct { position: absolute; top: 4px; transform: translateX(-50%); font-size: 12px; letter-spacing: .14em; color: rgba(226,231,234,.6); }
#game-ui .compass .ct.cardinal { color: rgba(240,236,226,.95); font-size: 14px; top: 2px; }
#game-ui .compass .ct.minor { top: 9px; width: 1px; height: 6px; background: rgba(226,231,234,.4); font-size: 0; }
#game-ui .compass .cm { position: absolute; top: 18px; width: 8px; height: 8px; margin-left: -4px; transform: rotate(45deg);
  background: var(--amber); box-shadow: 0 0 0 1px rgba(0,0,0,.6); }
#game-ui .compass .cm.ex { background: var(--good); }
#game-ui .compass .needle { position: absolute; left: 50%; bottom: 0; width: 2px; height: 7px; margin-left: -1px; background: rgba(240,236,226,.9); }

/* tracker */
#game-ui .tracker { position: absolute; left: 3.4vw; top: 8vh; max-width: 34vw; line-height: 1.5; }
#game-ui .tracker .op { font-size: 10px; letter-spacing: .32em; color: rgba(226,231,234,.45); }
#game-ui .tracker .obj { font-size: 15px; letter-spacing: .16em; color: rgba(240,236,226,.95); margin-top: 2px; }
#game-ui .tracker .obj::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 9px;
  transform: rotate(45deg) translateY(-2px); background: var(--amber); }
#game-ui .tracker .pips { display: flex; gap: 6px; margin-top: 7px; }
#game-ui .tracker .pip { font-size: 10px; letter-spacing: .2em; padding: 1px 6px; border: 1px solid rgba(226,231,234,.3); color: rgba(226,231,234,.6); }
#game-ui .tracker .pip.done { border-color: var(--good); color: var(--good); }
#game-ui .tracker .timer { font-size: 12px; letter-spacing: .22em; color: rgba(226,231,234,.6); margin-top: 6px; font-variant-numeric: tabular-nums; }

/* score strip (deathmatch) */
#game-ui .score { position: absolute; left: 50%; top: 5.4vh; transform: translateX(-50%); display: flex; gap: 18px;
  align-items: baseline; font-variant-numeric: tabular-nums; letter-spacing: .2em; }
#game-ui .score .us { font-size: 22px; color: rgba(255,228,178,.95); }
#game-ui .score .them { font-size: 22px; color: rgba(226,231,234,.7); }
#game-ui .score .mid { font-size: 11px; color: rgba(226,231,234,.55); text-align: center; line-height: 1.4; }

/* world markers */
#game-ui .wm { position: absolute; left: 0; top: 0; width: 0; height: 0; will-change: transform, opacity; }
#game-ui .wm i { position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; transform: rotate(45deg);
  border: 2px solid var(--amber); box-shadow: 0 0 0 1px rgba(0,0,0,.5); }
#game-ui .wm.ex i { border-color: var(--good); }
#game-ui .wm.crate i { border-color: rgba(226,231,234,.6); width: 10px; height: 10px; left: -5px; top: -5px; }
#game-ui .wm b { position: absolute; left: 0; top: 12px; transform: translateX(-50%); font-weight: 400; font-size: 11px; letter-spacing: .18em; white-space: nowrap; }
#game-ui .wm em { position: absolute; left: 0; top: -28px; transform: translateX(-50%); font-style: normal; font-size: 12px; letter-spacing: .2em; color: var(--amber); white-space: nowrap; }
#game-ui .wm.ex em { color: var(--good); }

/* interact prompt */
#game-ui .prompt { position: absolute; left: 50%; top: 61vh; transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
  font-size: 14px; letter-spacing: .2em; opacity: 0; transition: opacity .15s; }
#game-ui .prompt.on { opacity: 1; }
#game-ui .prompt kbd { font: inherit; font-size: 12px; border: 1px solid rgba(240,236,226,.7); padding: 1px 7px; }
#game-ui .prompt svg { width: 34px; height: 34px; transform: rotate(-90deg); }
#game-ui .prompt circle { fill: none; stroke-width: 3; }
#game-ui .prompt .bg { stroke: rgba(226,231,234,.2); }
#game-ui .prompt .fg { stroke: var(--amber); stroke-dasharray: 88; stroke-dashoffset: 88; }

/* radio captions */
#game-ui .subs { position: absolute; left: 50%; bottom: 17vh; transform: translateX(-50%); width: min(760px, 80vw); text-align: center;
  text-transform: none; font-size: 17px; letter-spacing: .03em; line-height: 1.4; }
#game-ui .subs .line { display: inline-block; padding: 3px 12px; background: rgba(0,0,0,.42); margin-top: 4px; opacity: 0; transition: opacity .25s; }
#game-ui .subs .line.on { opacity: 1; }
#game-ui .subs .who { text-transform: uppercase; letter-spacing: .2em; font-size: 12px; color: var(--amber); margin-right: 10px; }
#game-ui .subs .who.enemy { color: var(--bad); }

/* banner + intro card */
#game-ui .banner { position: absolute; left: 50%; top: 27vh; transform: translateX(-50%); text-align: center; opacity: 0;
  transition: opacity .3s, transform .3s; }
#game-ui .banner.on { opacity: 1; transform: translateX(-50%) translateY(-6px); }
#game-ui .banner .t { font-size: 24px; letter-spacing: .3em; color: rgba(240,236,226,.95); }
#game-ui .banner .s { font-size: 12px; letter-spacing: .28em; color: rgba(226,231,234,.6); margin-top: 4px; }
#game-ui .banner.warn .t { color: var(--bad); }
#game-ui .banner.good .t { color: var(--good); }
#game-ui .intro { position: absolute; left: 6vw; bottom: 22vh; opacity: 0; transition: opacity .8s; }
#game-ui .intro.on { opacity: 1; }
#game-ui .intro .a { font-size: 12px; letter-spacing: .4em; color: var(--amber); }
#game-ui .intro .b { font-size: 34px; letter-spacing: .24em; margin-top: 4px; }
#game-ui .intro .c { font-size: 12px; letter-spacing: .3em; color: rgba(226,231,234,.6); margin-top: 6px; }
#game-ui .fade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity .9s; }
#game-ui .fade.on { opacity: 1; }

/* equipment, health bar, respawn */
#game-ui .gren { position: absolute; right: 3.4vw; bottom: calc(6vh + 112px); display: flex; gap: 5px; align-items: center; font-size: 11px; letter-spacing: .2em; color: rgba(226,231,234,.55); }
#game-ui .gren i { width: 7px; height: 11px; border-radius: 3px 3px 2px 2px; background: rgba(226,231,234,.8); box-shadow: 0 0 0 1px rgba(0,0,0,.5); }
#game-ui .gren i.off { background: rgba(226,231,234,.18); }
#game-ui .charge { position: absolute; left: 50%; top: calc(50% + 34px); width: 70px; height: 3px; margin-left: -35px; background: rgba(226,231,234,.2); opacity: 0; }
#game-ui .charge.on { opacity: 1; }
#game-ui .charge i { display: block; height: 100%; width: 0; background: rgba(240,236,226,.9); }
#game-ui .charge.hot i { background: var(--bad); }
#game-ui .hbar { position: absolute; left: 3.4vw; bottom: 6vh; width: 180px; }
#game-ui .hbar .v { font-size: 13px; letter-spacing: .2em; font-variant-numeric: tabular-nums; }
#game-ui .hbar .b { height: 4px; background: rgba(226,231,234,.18); margin-top: 4px; }
#game-ui .hbar .b i { display: block; height: 100%; background: rgba(240,236,226,.9); }
#game-ui .hbar.low .b i { background: var(--bad); }
#game-ui .respawn { position: absolute; left: 50%; top: 58vh; transform: translateX(-50%); text-align: center; font-size: 13px; letter-spacing: .26em; color: rgba(226,231,234,.75); }

/* critical health pulse */
#game-ui .crit { position: absolute; inset: 0; opacity: 0;
  background: radial-gradient(ellipse closest-side at 50% 50%, transparent 60%, rgba(150,10,0,.55) 100%); }
#game-ui .crit.on { animation: kh-crit 1.05s ease-in-out infinite; }
#game-ui.cb .crit { background: radial-gradient(ellipse closest-side at 50% 50%, transparent 60%, rgba(10,60,160,.55) 100%); }
@keyframes kh-crit { 0%, 100% { opacity: .25; } 45% { opacity: .9; } }

/* cards (death / results) */
#game-ui .card-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: rgba(4,6,8,.72); backdrop-filter: blur(3px); pointer-events: auto; text-shadow: none; }
#game-ui .card-wrap[hidden] { display: none; }
#game-ui .card { width: min(560px, 100%); border: 1px solid #2c3238; background: rgba(10,13,16,.92); padding: 26px 28px; }
#game-ui .card .eyebrow { font-size: 11px; letter-spacing: .36em; color: var(--amber); }
#game-ui .card h2 { font-size: 34px; letter-spacing: .2em; font-weight: 700; margin-top: 6px; color: #e8e4dc; }
#game-ui .card h2.bad { color: var(--bad); }
#game-ui .card h2.good { color: var(--good); }
#game-ui .card .why { font-size: 13px; letter-spacing: .14em; color: #8a939b; margin-top: 4px; text-transform: none; }
#game-ui .card dl { display: grid; grid-template-columns: 1fr auto; gap: 7px 16px; margin-top: 20px; font-size: 14px; letter-spacing: .16em; }
#game-ui .card dt { color: #8a939b; }
#game-ui .card dd { text-align: right; font-variant-numeric: tabular-nums; color: #e8e4dc; }
#game-ui .card dd.best { color: var(--good); }
#game-ui .card .rating { margin-top: 18px; font-size: 13px; letter-spacing: .3em; color: #8a939b; }
#game-ui .card .rating b { display: block; font-size: 30px; letter-spacing: .26em; color: var(--amber); margin-top: 4px; }
#game-ui .card table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; letter-spacing: .14em; }
#game-ui .card th { text-align: right; color: #6c757d; font-weight: 400; padding: 3px 0; }
#game-ui .card th:first-child, #game-ui .card td:first-child { text-align: left; }
#game-ui .card td { text-align: right; padding: 3px 0; font-variant-numeric: tabular-nums; color: #c8ccd0; }
#game-ui .card tr.you td { color: rgba(255,228,178,.95); }
#game-ui .card .btns { display: flex; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
#game-ui .card button { flex: 1; min-width: 140px; font: inherit; font-size: 14px; letter-spacing: .28em; text-transform: uppercase;
  color: #e8e4dc; background: #12161a; border: 1px solid #2c3238; padding: 13px; cursor: pointer; }
#game-ui .card button.primary { border-color: var(--amber); }
#game-ui .card button:hover { background: rgba(200,162,74,.14); }
#game-ui .card button:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
#game-ui .card .hint { font-size: 11px; letter-spacing: .2em; color: #6c757d; margin-top: 10px; }

@media (prefers-reduced-motion: reduce) {
  #game-ui .crit.on { animation: none; opacity: .5; }
  #game-ui .banner, #game-ui .banner.on { transition: opacity .2s; transform: translateX(-50%); }
}
#game-ui.rm .crit.on { animation: none; opacity: .5; }
`;

export function injectGameStyles(doc = document) {
  if (doc.getElementById('game-style')) return;
  const s = doc.createElement('style');
  s.id = 'game-style';
  s.textContent = GAME_CSS;
  doc.head.appendChild(s);
}
