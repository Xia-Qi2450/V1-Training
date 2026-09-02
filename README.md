# V1//TRAINING

A practice-question web app for secondary school students who are below a
passing grade, built around the idea that a bit of retro-FPS-style
"momentum" - ranks, streaks, points, unlockable perks - is more motivating
than just a plain worksheet. Built for a school hackathon.

**The challenge:** How can technology help students better balance
schoolwork, co-curricular activities and mental well-being?

**Our angle:** students without a passing average often don't lack
material to study from, they lack a reason to open it. **V1//TRAINING** wraps
ordinary multiple-choice revision in the presentation of a fast, stylish
arcade shooter (visually inspired by *ULTRAKILL*) so that finishing a
practice set feels like clearing a level, not doing homework.

> **Info:**
> This is a hackathon prototype for demonstration purposes. It does not
> diagnose, treat, or monitor mental health, and it does not claim to
> improve academic performance — it's a motivation-focused practice tool.

## Two ways to run this

This repo contains two versions of the same idea, built at different
stages of the project:

| | [`standalone/`](./standalone) | [`server/`](./server) |
| --- | --- | --- |
| **What it is** | One self-contained HTML file | Flask + SQLite backend, two web pages |
| **Setup** | None — double-click to open | `pip install`, `python app.py` |
| **Questions** | Hard-coded in the file | Stored in a database, editable without touching code |
| **Best for** | A guaranteed-to-work demo with zero moving parts | Showing how a teacher would actually maintain content over time |

Both implement the same core loop — dashboard, difficulty & subject
selection, timed multiple-choice practice, an ULTRAKILL-style end-of-mission
rank reveal, an in-game currency ("P") and a power-up shop.

### Quick demo (no setup)

Open [`standalone/v1-training.html`](./standalone/v1-training.html) directly
in any browser. Nothing to install, nothing to run, works offline.
No need to worry when there is a dead internet (as if we don't
have one already).

### Full version (database-backed)

```bash
cd server
pip install -r requirements.txt
python app.py
```

Then open:

- `http://localhost:5000` — the student-facing practice app
- `http://localhost:5000/admin` — the question manager (add / view / delete
  questions, no SQL or Python needed)

See [`server/README.md`](./server/README.md) for the full walkthrough,
including how the AI-assisted question generation flow works.

## Features

- **Dashboard** - XP, in-game currency ("P"), streak, missions completed,
  best rank achieved, and per-subject progress.
- **Mission setup** - choose a difficulty (Harmless → Brutal, plus a
  locked "ULTRAKILL MUST DIE" tier, matching the game's actual difficulty
  ladder. Will be unlocked when that difficulty finally gets added to the
  real game), which subjects to practice, and how many questions (5–30).
- **Practice loop** - multiple-choice questions with instant feedback,
  a live "style meter" that rewards fast, accurate answers with a
  combo multiplier, and a retry-or-accept choice when you get one wrong.
- **Mission Complete screen** - a sequential, ULTRAKILL-style reveal:
  Time, Questions, and Accuracy each count up and flash into a letter
  rank, followed by the aggregate rank and a breakdown of P earned.
- **Shop** - spend P on single-use mission perks (remove two wrong
  answers, freeze the clock, forgive one mistake).
- **10 subjects** across Math, Sciences (split into Physics / Chemistry /
  Biology), Humanities, and Mother Tongue, with a demo question bank to
  match.
- **(Server version only)** a question database a teacher can edit
  through a web page, plus an optional AI-assisted authoring flow that
  turns a topic into a ready-to-paste prompt for any chatbot, previews
  the result, and clearly tags anything AI-written before it ever reaches
  a student.

## Project structure

```
.
├── standalone/
│   └── v1-training.html      # zero-setup, all-in-one demo
├── server/
│   ├── app.py                 # Flask app + SQLite schema/API
│   ├── requirements.txt
│   ├── index.html             # student-facing app (page shell)
│   ├── admin.html             # question manager (page shell)
│   ├── static/
│   │   ├── css/
│   │   │   ├── theme.css      # shared variables & building blocks
│   │   │   ├── app.css        # index.html-specific styles
│   │   │   └── admin.css      # admin.html-specific styles
│   │   └── js/
│   │       ├── app.js         # index.html's logic
│   │       └── admin.js       # admin.html's logic
│   └── README.md              # setup + demo walkthrough
├── LICENSE
└── README.md
```

## Tech stack

- Vanilla HTML / CSS / JavaScript on the frontend — no build step, no
  frameworks. Way easier in that case cause too much frameworks could
  lead to confilicts
- Python + Flask + SQLite on the backend (server version only).
- Data is stored locally: `localStorage` in the browser for player
  progress, a local SQLite file for the question bank. No accounts, no
  cloud services, nothing leaves the machine it's running on. Also
  because I am broke and can't afford a server.

## Limitations & honesty notes

- This is a hackathon prototype, not a finished product. The question
  bank is a small demo set, not full syllabus coverage.
- The server version runs Flask's development server, which is fine for
  a local demo but isn't meant to be exposed to the internet as-is, and
  the admin page has no login — anyone with access to the machine can
  edit questions.
- The visual style is inspired by *ULTRAKILL* (New Blood Interactive /
  Hakita); this project is a student hackathon submission, is not
  affiliated with or endorsed by them, and reuses no original game
  assets — only an original interpretation of its HUD/rank aesthetic.

## License

MIT — see [LICENSE](./LICENSE).
