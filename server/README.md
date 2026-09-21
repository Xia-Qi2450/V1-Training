# V1//TRAINING - Flask + SQLite version

This is the database-backed version of the practice app. Questions live in a
local SQLite database instead of being hard-coded into the page, and can be
added or removed through a simple web page, no SQL or Python knowledge
needed.

The original single-file version (no server, no database, just double-click
to open) still exists separately and still works. This is an additional,
more scalable version, not a replacement. (Honestly speaking, this is
way better compared to the standalone one.)

## What's in this folder

- `app.py` - the Flask server. Creates and seeds the database on first run.
- `index.html` - the practice app your students use (same game as before,
  now fetching its questions from the server).
- `admin.html` - the question manager, for adding/viewing/deleting questions.
- `requirements.txt` - the one dependency (Flask).
- `v1_training.db` - the SQLite database. Created automatically the first
  time you run `app.py`. Delete this file if you ever want to reset back to
  the seeded demo question bank.

## Running it

You need Python 3 installed. Then, in this folder:

```
pip install -r requirements.txt
python app.py
```

Leave that terminal window open, that's your server. Then open a browser to:

- **<http://localhost:5000>** - the practice app (students use)
- **<http://localhost:5000/admin>** - the question manager (what a teacher uses)

To stop the server, go back to the terminal and press `Ctrl+C` or you
can just close the terminal or if you want to be fancy, find the process
ID of the process, kill it and end the process.

## Demoing the actual point of this version

The story that answers "adding questions is tedious" is:

1. Open `/admin` in one tab.
2. Add a question - pick a subject (or type a new one), fill in the four
   options, mark the correct one, add a short explanation, click **Add
   Question**. No code, no restart needed.
3. Switch to the practice app tab, start a mission on that subject, and your
   new question can come up.
4. Back in `/admin`, you can also delete any question you no longer want.

The question list is paginated (10 at a time) and searchable - the search
box checks the question text, all four options, and the explanation, so
you can find something even if you only remember a phrase from an option.
Both `/admin` and the practice app show a loading screen while fetching
data, so a slow connection is visible rather than looking frozen.

## AI-assisted question writing (optional)

Teachers who want to use AI to help draft questions don't need any API
key (I am also too broke to afford any API keys) - `/admin` has an
"AI-Assisted Generation" section that:

1. Builds a ready-to-use prompt from a subject, optional topic/level, and
   question count you choose.
2. You copy that prompt into whatever AI chatbot you already use (ChatGPT,
   Claude, Gemini, etc.) and copy its reply back.
3. Paste the reply in - it's parsed and shown to you as a normal preview
   (question, options, correct answer, explanation) so you can read every
   question before anything is saved.
4. Untick anything you don't want, then import the rest.

Every question added this way is tagged **AI Generated** - you'll see an
amber badge for it in `/admin`, and students see the same warning badge on
the question itself during practice ("AI can make mistakes"). Nothing
imports automatically or silently; a human always reviews the content
first.

## Notes

- The database comes pre-seeded with 6 demo questions in each of 10
  subjects (60 total) - enough to run a full live demo without touching
  `/admin` first, if you'd rather just show the practice app on its own.
- This is a **local-only development setup**: `app.py` runs Flask's built-in
  dev server, which is fine for a demo on your own laptop but isn't meant to
  be exposed to the internet as-is.
- There are no user accounts here - anyone who can open `/admin` on your
  machine can edit the question bank. That's fine for a hackathon demo, but
  worth knowing.
