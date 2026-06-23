# Dino Stomp Roadmap

Autonomous beneficial care — Pantheon Wonder's action cousin. *Happy stomp* 🦖❤️

## Locked phases

| Phase | Status | Autonomy | What Dino does alone |
|-------|--------|----------|----------------------|
| **v0.1** | ✅ Shipped | `notes_only` | Warm markdown notes, benefit gate, journal, Stomp now |
| **v0.2** | ✅ Shipped | `gentle` | + Tidy whitelist folders (Downloads, Desktop) — move only, undo manifest |
| **v0.3** | ✅ Shipped | `helpful` | + Daily log (`document`), staged missions (`prepare`) |
| **v0.4** | ✅ Shipped | all | + Random read-only check-ins (Documents, Pictures, Videos, Music — configurable) |
| **v0.5** | Planned | — | Pattern learning, Pantheon bridge handoffs |

## Benefit gate (all phases)

- No stomp during active Mission / queue
- Idle floor (default 5 min)
- Daily caps: notes vs actions (separate)
- Min spacing between stomps (90 min)
- Quiet hours: notes only 10pm–7am; **no file moves** in quiet hours
- Dismiss streak → cooldown (6 h)
- Salience threshold + held buffer
- **Never:** delete, send messages, shell outside allowlist, paths outside whitelist

## Autonomy levels

| Level | Notes | Tidy | Document | Prepare |
|-------|-------|------|----------|---------|
| `off` | — | — | — | — |
| `notes_only` | ✅ | — | — | — |
| `gentle` | ✅ | ✅ whitelist | — | — |
| `helpful` | ✅ | ✅ | ✅ daily log | ✅ staged mission |
| `full` | ✅ | ✅ custom paths | ✅ | ✅ + approval queue hook |

## v0.2 tidy rules

- Whitelist only: `%USERPROFILE%\Downloads`, `%USERPROFILE%\Desktop` (editable)
- Trigger: ≥20 loose files (depth 0) in a whitelisted folder
- Action: sort into `DinoSorted/{images,documents,archives,installers,other}/`
- Cap: 80 moves per stomp, `dailyActionCap` (default 3) per 24h
- Undo: journal entry stores `undoManifest` — one-click reverse

## v0.3 document + prepare

- **document:** append `notes/daily-log-YYYY-MM-DD.md` — runs, mood, one Dino line
- **prepare:** write `notes/staged-mission-*.md` — suggested next mission from patterns; operator runs manually or approves later

## Files

```
electron/
  dino-stomp.ts       # engine + gate + execute
  dino-stomp-types.ts
  stomp-catalog.ts    # propose candidates
  stomp-journal.ts    # note files
  stomp-tidy.ts       # scan + move + undo
  stomp-document.ts   # daily log
```

## Success metrics

- Engage rate > dismiss rate over 7 days
- Zero destructive ops without operator intent
- Undo used < 5% (means we're not reckless)

---

*Tiny arms, big help. — Dino Buddy*
