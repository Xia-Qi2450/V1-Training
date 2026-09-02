"""
V1//TRAINING backend — Flask + SQLite.

Run locally with:
    pip install -r requirements.txt
    python app.py

Then open:
    http://localhost:5000        -> the practice app (student view)
    http://localhost:5000/admin  -> the question manager (teacher view)

The database (v1_training.db) is created automatically next to this file
the first time you run the app, and seeded with a demo question bank so
there's enough content to run a full live demo out of the box. After that,
whatever you add or delete through the admin page persists across restarts.
"""

import os
import random
import sqlite3

from flask import Flask, g, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "v1_training.db")

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            question TEXT NOT NULL,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            option_c TEXT NOT NULL,
            option_d TEXT NOT NULL,
            answer INTEGER NOT NULL,
            explanation TEXT NOT NULL,
            ai_generated INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    # Migration for databases created before the ai_generated column existed.
    existing_cols = [r[1] for r in db.execute("PRAGMA table_info(questions)").fetchall()]
    if "ai_generated" not in existing_cols:
        db.execute("ALTER TABLE questions ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0")
    db.commit()
    count = db.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
    if count == 0:
        seed_questions(db)
    db.close()


def seed_questions(db):
    # Seed content is hand-written, not AI-generated — stored with ai_generated=0.
    seeded = [row + (0,) for row in SEED_DATA]
    db.executemany(
        """
        INSERT INTO questions (subject, question, option_a, option_b, option_c, option_d, answer, explanation, ai_generated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        seeded,
    )
    db.commit()


def row_to_dict(row):
    return {
        "id": row["id"],
        "subject": row["subject"],
        "question": row["question"],
        "options": [row["option_a"], row["option_b"], row["option_c"], row["option_d"]],
        "answer": row["answer"],
        "explanation": row["explanation"],
        "ai_generated": bool(row["ai_generated"]),
    }


# ---------------------------------------------------------------------------
# Static pages (plain HTML/CSS/JS files, no templating)
# ---------------------------------------------------------------------------

@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/admin")
def serve_admin():
    return send_from_directory(BASE_DIR, "admin.html")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.route("/api/subjects")
def api_subjects():
    db = get_db()
    rows = db.execute(
        "SELECT subject, COUNT(*) AS count FROM questions GROUP BY subject ORDER BY subject"
    ).fetchall()
    return jsonify([{"subject": r["subject"], "count": r["count"]} for r in rows])


@app.route("/api/questions")
def api_questions_list():
    db = get_db()
    subject = request.args.get("subject")
    if subject:
        rows = db.execute(
            "SELECT * FROM questions WHERE subject = ? ORDER BY id DESC", (subject,)
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM questions ORDER BY id DESC").fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/questions", methods=["POST"])
def api_questions_create():
    data = request.get_json(silent=True) or {}

    subject = (data.get("subject") or "").strip()
    question = (data.get("question") or "").strip()
    options = data.get("options") or []
    answer = data.get("answer")
    explanation = (data.get("explanation") or "").strip()
    ai_generated = 1 if data.get("ai_generated") else 0

    errors = []
    if not subject:
        errors.append("Subject is required.")
    if not question:
        errors.append("Question text is required.")
    if not isinstance(options, list) or len(options) != 4 or any(not str(o).strip() for o in options):
        errors.append("All four answer options are required.")
    if not isinstance(answer, int) or answer not in (0, 1, 2, 3):
        errors.append("A correct answer (A-D) must be selected.")
    if not explanation:
        errors.append("A brief explanation is required.")

    if errors:
        return jsonify({"error": " ".join(errors)}), 400

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO questions (subject, question, option_a, option_b, option_c, option_d, answer, explanation, ai_generated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (subject, question, options[0], options[1], options[2], options[3], answer, explanation, ai_generated),
    )
    db.commit()
    row = db.execute("SELECT * FROM questions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route("/api/questions/<int:question_id>", methods=["DELETE"])
def api_questions_delete(question_id):
    db = get_db()
    row = db.execute("SELECT id FROM questions WHERE id = ?", (question_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Question not found."}), 404
    db.execute("DELETE FROM questions WHERE id = ?", (question_id,))
    db.commit()
    return jsonify({"deleted": question_id})


@app.route("/api/mission")
def api_mission():
    subjects_param = request.args.get("subjects", "")
    subjects = [s for s in subjects_param.split(",") if s]
    try:
        count = int(request.args.get("count", 10))
    except ValueError:
        count = 10
    count = max(5, min(30, count))

    db = get_db()
    if subjects:
        placeholders = ",".join("?" for _ in subjects)
        rows = db.execute(
            f"SELECT * FROM questions WHERE subject IN ({placeholders})", subjects
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM questions").fetchall()

    pool = [row_to_dict(r) for r in rows]
    if not pool:
        return jsonify({"error": "No questions found for the selected subjects."}), 400

    bag = []
    while len(bag) < count:
        shuffled = pool[:]
        random.shuffle(shuffled)
        bag.extend(shuffled)
    return jsonify(bag[:count])


# ---------------------------------------------------------------------------
# Seed data — a demo question bank, not full syllabus coverage.
# Teachers extend this through the /admin page, not by editing this file.
# ---------------------------------------------------------------------------

SEED_DATA = [
    # Mathematics
    ("Mathematics", "Simplify: 3x + 5 = 20. What is x?", "3", "5", "15", "25", 1,
     "Subtract 5 from both sides to get 3x = 15, then divide by 3: x = 5."),
    ("Mathematics", "What is 15% of 200?", "20", "30", "15", "45", 1,
     "15% of 200 = 0.15 × 200 = 30."),
    ("Mathematics", "What is the value of π (pi), rounded to 2 decimal places?", "3.14", "3.41", "3.12", "3.16", 0,
     "π ≈ 3.14159..., which rounds to 3.14 at 2 decimal places."),
    ("Mathematics", "Solve for y: 2y − 4 = 10", "3", "5", "7", "14", 2,
     "Add 4 to both sides: 2y = 14, then divide by 2: y = 7."),
    ("Mathematics", "What is the area of a rectangle with length 8cm and width 5cm?", "13 cm²", "40 cm²", "26 cm²", "45 cm²", 1,
     "Area of a rectangle = length × width = 8 × 5 = 40 cm²."),
    ("Mathematics", "What is the value of 7² (7 squared)?", "14", "49", "21", "77", 1,
     "7² means 7 × 7, which equals 49."),
    # Physics
    ("Physics", "What is the SI unit of force?", "Joule", "Newton", "Watt", "Pascal", 1,
     "Force is measured in newtons (N), named after Sir Isaac Newton."),
    ("Physics", "Which equation is Newton's Second Law of Motion?", "F = ma", "E = mc²", "V = IR", "P = mgh", 0,
     "Newton's Second Law states force equals mass times acceleration (F = ma)."),
    ("Physics", "What type of energy does a moving object have?", "Potential", "Kinetic", "Thermal", "Chemical", 1,
     "A moving object has kinetic energy — energy due to its motion."),
    ("Physics", "Sound cannot travel through:", "Air", "Water", "Steel", "A vacuum", 3,
     "Sound needs a medium to travel; a vacuum has no particles to carry the vibration."),
    ("Physics", "What is the unit of electrical resistance?", "Volt", "Ampere", "Ohm", "Watt", 2,
     "Electrical resistance is measured in ohms (Ω)."),
    ("Physics", "Which of these is a renewable energy source?", "Coal", "Natural gas", "Solar", "Petroleum", 2,
     "Solar energy is renewable because it comes from the sun, an inexhaustible source on human timescales."),
    # Chemistry
    ("Chemistry", "What is the chemical symbol for sodium?", "So", "Na", "Sd", "S", 1,
     "Sodium's symbol, Na, comes from its Latin name 'natrium'."),
    ("Chemistry", "Which of these is a chemical change?", "Melting ice", "Boiling water", "Rusting iron", "Dissolving salt", 2,
     "Rusting forms a new substance (iron oxide), making it a chemical change; the others are physical changes."),
    ("Chemistry", "A solution with pH 3 is:", "Strongly alkaline", "Neutral", "Weakly acidic", "Strongly acidic", 3,
     "pH values below 7 are acidic, and the further below 7, the stronger the acid — pH 3 is strongly acidic."),
    ("Chemistry", "What gas is usually produced when a metal reacts with a dilute acid?", "Oxygen", "Hydrogen", "Nitrogen", "Carbon dioxide", 1,
     "Metals reacting with dilute acids typically produce hydrogen gas."),
    ("Chemistry", "What is the chemical formula for water?", "CO2", "H2O", "O2", "NaCl", 1,
     "Water's chemical formula is H2O — two hydrogen atoms bonded to one oxygen atom."),
    ("Chemistry", "Which particle has a negative charge?", "Proton", "Neutron", "Electron", "Nucleus", 2,
     "Electrons carry a negative charge and orbit the nucleus of an atom."),
    # Biology
    ("Biology", "Which organelle is the site of photosynthesis?", "Mitochondria", "Nucleus", "Chloroplast", "Ribosome", 2,
     "Chloroplasts contain chlorophyll and are where photosynthesis takes place."),
    ("Biology", "What is the basic structural unit of all living things?", "Tissue", "Organ", "Cell", "Organism", 2,
     "The cell is the basic structural and functional unit of life."),
    ("Biology", "Which blood component helps fight infection?", "Red blood cells", "White blood cells", "Platelets", "Plasma", 1,
     "White blood cells are part of the immune system and help fight infection."),
    ("Biology", "What process do living things use to release energy from glucose?", "Photosynthesis", "Respiration", "Transpiration", "Excretion", 1,
     "Respiration breaks down glucose to release energy, in both plants and animals."),
    ("Biology", "What is the powerhouse of the cell?", "Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus", 1,
     "Mitochondria generate most of the cell's energy (ATP), earning the nickname 'powerhouse of the cell'."),
    ("Biology", "Which system in the human body transports oxygen around the body?", "Digestive system", "Circulatory system", "Nervous system", "Skeletal system", 1,
     "The circulatory system, including blood and the heart, transports oxygen to cells throughout the body."),
    # English
    ("English", "Which sentence is punctuated correctly?", "Its raining outside.", "It’s raining outside.", "Its raining, outside.", "Its’ raining outside.", 1,
     "“It’s” is the contraction of “it is”. “Its” (no apostrophe) shows possession."),
    ("English", "Choose the word that best completes: \"She was too tired ___ continue.\"", "to", "for", "that", "of", 0,
     "'Too...to' is the correct construction here, e.g. 'too tired to continue'."),
    ("English", "Which word is a synonym for 'happy'?", "Furious", "Joyful", "Anxious", "Weary", 1,
     "'Joyful' means feeling or expressing happiness, making it a synonym."),
    ("English", "Which of these is spelled correctly?", "Recieve", "Receive", "Receeve", "Receve", 1,
     "The correct spelling is 'receive' — remember 'i before e except after c'."),
    ("English", "Which word is an antonym of 'generous'?", "Kind", "Stingy", "Giving", "Warm", 1,
     "'Stingy' means unwilling to give, the opposite of 'generous'."),
    ("English", "Identify the noun in this sentence: 'The dog ran quickly.'", "ran", "quickly", "dog", "the", 2,
     "'Dog' is the noun — the person, place, animal or thing in the sentence."),
    # Geography
    ("Geography", "What is the imaginary line at 0° longitude called?", "Equator", "Prime Meridian", "Tropic of Cancer", "International Date Line", 1,
     "The Prime Meridian is the line of 0° longitude, passing through Greenwich, London."),
    ("Geography", "Which climate is known for very low annual rainfall?", "Tropical", "Arid", "Temperate", "Polar", 1,
     "Arid climates receive very little rainfall, typically found in deserts."),
    ("Geography", "What mainly causes Singapore's monsoon seasons?", "Ocean currents alone", "Shifting wind belts", "Volcanic activity", "Tidal patterns", 1,
     "Singapore's monsoon seasons are driven by seasonal shifts in wind belts (the Northeast and Southwest Monsoons)."),
    ("Geography", "What term describes land being worn away by wind, water or ice?", "Deposition", "Erosion", "Precipitation", "Condensation", 1,
     "Erosion is the process by which soil and rock are worn away by natural forces."),
    ("Geography", "What is the term for a large area of flat land elevated above sea level?", "Valley", "Plateau", "Delta", "Basin", 1,
     "A plateau is a large, flat area of land raised above the surrounding land."),
    ("Geography", "Which of these is a renewable natural resource?", "Coal", "Forests", "Natural gas", "Oil", 1,
     "Forests can regrow over time, making them a renewable resource, unlike fossil fuels."),
    # History
    ("History", "In what year did Singapore become an independent nation?", "1959", "1963", "1965", "1971", 2,
     "Singapore became independent on 9 August 1965."),
    ("History", "Who was Singapore's first Prime Minister?", "Lee Kuan Yew", "Yusof Ishak", "Goh Chok Tong", "S. Rajaratnam", 0,
     "Lee Kuan Yew served as Singapore's first Prime Minister, from 1959."),
    ("History", "What was a major cause of World War I?", "The Cold War", "Rising nationalism and alliances", "The Great Depression", "Decolonisation", 1,
     "Rising nationalism and a web of military alliances were key factors that escalated the conflict."),
    ("History", "Which empire ruled Singapore before the Japanese Occupation?", "Dutch", "Portuguese", "British", "French", 2,
     "Singapore was a British colony before falling to Japanese Occupation in 1942."),
    ("History", "What event marked the start of the Japanese Occupation of Singapore?", "The Fall of Singapore in 1942", "The signing of the Treaty of Versailles", "The Federation of Malaya in 1948", "World War I", 0,
     "The Fall of Singapore in February 1942 marked the beginning of the Japanese Occupation."),
    ("History", "Singapore joined Malaysia in which year, before separating in 1965?", "1959", "1961", "1963", "1965", 2,
     "Singapore joined the Federation of Malaysia in 1963, before separating in 1965."),
    # Economics
    ("Economics", "What term describes the extra output from one more unit of input?", "Fixed cost", "Marginal product", "Total revenue", "Gross profit", 1,
     "Marginal product is the additional output from one more unit of a factor of production."),
    ("Economics", "What is 'opportunity cost'?", "The price of an item", "The next best alternative given up", "Total cost of production", "Cost after tax", 1,
     "Opportunity cost is the value of the next best alternative you give up when making a choice."),
    ("Economics", "GDP stands for:", "General Domestic Profit", "Gross Domestic Product", "Global Development Plan", "Government Data Program", 1,
     "GDP (Gross Domestic Product) measures the total value of goods and services produced in a country."),
    ("Economics", "When demand exceeds supply at a given price, this creates a:", "Surplus", "Shortage", "Equilibrium", "Recession", 1,
     "A shortage occurs when quantity demanded is greater than quantity supplied at that price."),
    ("Economics", "What term describes a general rise in prices over time?", "Deflation", "Inflation", "Recession", "Stagnation", 1,
     "Inflation refers to a sustained increase in the general price level over time."),
    ("Economics", "Which of these best describes 'supply'?", "The amount consumers want to buy", "The amount producers are willing to sell", "The price of a good", "Total government spending", 1,
     "Supply refers to the quantity of a good or service that producers are willing to offer for sale."),
    # Business Studies
    ("Business Studies", "What does 'B2B' stand for in business?", "Back to Basics", "Business to Business", "Bought to Bill", "Base to Branch", 1,
     "B2B (Business-to-Business) refers to transactions between two businesses."),
    ("Business Studies", "What is a 'sole proprietorship'?", "A business owned by one person", "A business owned by shareholders", "A government-run business", "A charity organisation", 0,
     "A sole proprietorship is a business owned and run by a single individual."),
    ("Business Studies", "The 4 Ps of the marketing mix are Product, Price, Place and:", "People", "Promotion", "Profit", "Process", 1,
     "The traditional marketing mix consists of Product, Price, Place, and Promotion."),
    ("Business Studies", "What is a business's 'break-even point'?", "Where profit is maximised", "Where total revenue equals total cost", "Where costs are zero", "Where sales are highest", 1,
     "The break-even point is where total revenue equals total costs — no profit, no loss."),
    ("Business Studies", "What does 'ROI' stand for in business?", "Rate of Interest", "Return on Investment", "Revenue over Income", "Ratio of Income", 1,
     "ROI (Return on Investment) measures the profitability of an investment relative to its cost."),
    ("Business Studies", "Which of these is a fixed cost?", "Raw materials", "Rent", "Delivery fuel", "Sales commission", 1,
     "Rent stays the same regardless of how much is produced, making it a fixed cost."),
    # Mother Tongue (Chinese)
    ("Mother Tongue (Chinese)", "What does “谢谢” (xièxiè) mean?", "Hello", "Goodbye", "Thank you", "Sorry", 2,
     "谢谢 (xièxiè) means “thank you” in Mandarin Chinese."),
    ("Mother Tongue (Chinese)", "Which pinyin matches “再见”?", "zàijiàn", "xǐhuān", "duíbùqǐ", "míngtiān", 0,
     "再见 is pronounced “zàijiàn” and means “goodbye”."),
    ("Mother Tongue (Chinese)", "Fill in the blank: 他 ___ 学生。(He ___ a student.)", "是", "很", "不", "也", 0,
     "“是” (shì) means “is/am/are”, correctly completing 他是学生 (He is a student)."),
    ("Mother Tongue (Chinese)", "What does “苹果” mean?", "Banana", "Apple", "Orange", "Grape", 1,
     "苹果 (píngguǒ) means “apple”."),
    ("Mother Tongue (Chinese)", "What does “老师” (lǎoshī) mean?", "Student", "Teacher", "Doctor", "Friend", 1,
     "老师 (lǎoshī) means “teacher” in Mandarin Chinese."),
    ("Mother Tongue (Chinese)", "Which pinyin matches “早上好”?", "zǎoshang hǎo", "wǎnshang hǎo", "xiàwǔ hǎo", "wǎonān", 0,
     "早上好 is pronounced “zǎoshang hǎo” and means “good morning”."),
]


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
