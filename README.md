# Usage Meter

A band that sits just above the chat box and keeps the numbers that matter in view while Claude works.

- **Task %** — how much of the current checklist is done (from Claude's TodoWrite / TaskCreate / TaskUpdate calls), as a progress bar with `done/total` and the step it is on now.
- **Context** — how full the conversation's context window is.
- **5h limit / 7-day limit** — percent of your plan's usage windows used, with time until reset (`↻2h14`).
- **~$ est.** — estimated session cost, an estimate and not your bill.

Figures turn yellow at 80% and red at 95%, and a toast warns once per threshold (again only after the figure drops back below 80%, e.g. after a reset or compaction). Use the band's `[-]` to collapse it.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-meter --marketplace fmoliv/usage-meter
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install usage-meter --marketplace fmoliv/usage-meter
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `fmoliv/usage-meter`, then **Add plugin**.
