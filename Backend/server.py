from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS
import sqlite3, os, datetime, jwt
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import safe_join
from dotenv import load_dotenv

# Load .env when running locally (no-op in production where vars are injected by the platform)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

app = Flask(__name__, static_folder='.', static_url_path='')

# --- FIX: restrict CORS to your real frontend origin in production ---
# Set FRONTEND_ORIGIN as an env var, e.g. https://your-app.netlify.app
FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN', '*')
CORS(app, resources={r"/*": {"origins": FRONTEND_ORIGIN}})

# --- FIX: DB path no longer depends on a sibling "Database" folder that ---
# --- doesn't exist in the uploaded project. It now lives next to this file. ---
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'expenses.db')

# --- FIX: secret pulled from env var instead of hardcoded in source ---
SECRET = os.environ.get('JWT_SECRET', 'dev-only-change-me')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                name     TEXT NOT NULL,
                email    TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS expenses (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER REFERENCES users(id),
                title    TEXT NOT NULL,
                amount   REAL NOT NULL,
                category TEXT NOT NULL,
                type     TEXT NOT NULL,
                date     TEXT NOT NULL,
                note     TEXT
            );
        ''')
        cols = [r[1] for r in conn.execute("PRAGMA table_info(expenses)").fetchall()]
        if 'user_id' not in cols:
            conn.execute("ALTER TABLE expenses ADD COLUMN user_id INTEGER")


# --- FIX: salted, slow hash instead of raw sha256 ---
def hash_pw(pw):
    return generate_password_hash(pw)


def check_pw(pw, hashed):
    return check_password_hash(hashed, pw)


def make_token(user_id, name):
    payload = {
        'id':   user_id,
        'name': name,
        'exp':  datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET, algorithm='HS256')


def get_user():
    auth  = request.headers.get('Authorization', '')
    token = auth.replace('Bearer ', '')
    try:
        return jwt.decode(token, SECRET, algorithms=['HS256'])
    except Exception:
        return None


# ── Serve frontend ───────────────────────────────────────────
# All static files are served only from the Frontend/ subdirectory,
# preventing path traversal attacks (e.g. ../../etc/passwd, server.py).
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Frontend')
FRONTEND_DIR = os.path.normpath(FRONTEND_DIR)

ALLOWED_EXTENSIONS = {'.html', '.js', '.css', '.ico', '.png', '.jpg', '.svg', '.woff', '.woff2', '.ttf'}


@app.route('/')
def serve_root():
    return send_from_directory(FRONTEND_DIR, 'login.html')


@app.route('/<path:filename>')
def serve_static(filename):
    # Block directory traversal and restrict to allowed file types
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        abort(404)
    try:
        safe_path = safe_join(FRONTEND_DIR, filename)
    except Exception:
        abort(404)
    if not os.path.isfile(safe_path):
        abort(404)
    return send_from_directory(FRONTEND_DIR, filename)


# ── Auth ──────────────────────────────────────────────────────
@app.route('/register', methods=['POST'])
def register():
    d = request.get_json(force=True, silent=True) or {}
    if not d.get('name') or not d.get('email') or not d.get('password'):
        return jsonify({'error': 'All fields required'}), 400
    if len(d['password']) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    try:
        with get_db() as conn:
            cur = conn.execute(
                'INSERT INTO users (name, email, password) VALUES (?,?,?)',
                (d['name'], d['email'], hash_pw(d['password']))
            )
        token = make_token(cur.lastrowid, d['name'])
        return jsonify({'token': token, 'name': d['name']})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already registered'}), 400


@app.route('/login', methods=['POST'])
def login():
    d = request.get_json(force=True, silent=True) or {}
    with get_db() as conn:
        user = conn.execute(
            'SELECT * FROM users WHERE email=?',
            (d.get('email', ''),)
        ).fetchone()
    if not user or not check_pw(d.get('password', ''), user['password']):
        return jsonify({'error': 'Invalid email or password'}), 401
    return jsonify({'token': make_token(user['id'], user['name']), 'name': user['name']})


# ── Expenses ──────────────────────────────────────────────────
@app.route('/expenses', methods=['GET'])
def get_expenses():
    user = get_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    month = request.args.get('month', '')
    with get_db() as conn:
        if month:
            rows = conn.execute(
                "SELECT * FROM expenses WHERE user_id=? AND date LIKE ? ORDER BY date DESC",
                (user['id'], f'{month}%')
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM expenses WHERE user_id=? ORDER BY date DESC",
                (user['id'],)
            ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/expenses', methods=['POST'])
def add_expense():
    user = get_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    d = request.get_json(force=True, silent=True) or {}
    required = ('title', 'amount', 'category', 'type', 'date')
    if not all(k in d for k in required):
        return jsonify({'error': 'Missing fields'}), 400

    # Validate amount
    try:
        amount = float(d['amount'])
    except (TypeError, ValueError):
        return jsonify({'error': 'Amount must be a number'}), 400
    if amount <= 0:
        return jsonify({'error': 'Amount must be greater than zero'}), 400

    # Validate type
    if d['type'] not in ('income', 'expense'):
        return jsonify({'error': 'Type must be income or expense'}), 400

    # Validate date format (YYYY-MM-DD)
    try:
        datetime.date.fromisoformat(d['date'])
    except ValueError:
        return jsonify({'error': 'Date must be in YYYY-MM-DD format'}), 400

    with get_db() as conn:
        conn.execute(
            'INSERT INTO expenses (user_id,title,amount,category,type,date,note) VALUES (?,?,?,?,?,?,?)',
            (user['id'], d['title'], amount, d['category'], d['type'], d['date'], d.get('note', ''))
        )
    return jsonify({'message': 'Added'})


@app.route('/expenses/<int:eid>', methods=['DELETE'])
def delete_expense(eid):
    user = get_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    with get_db() as conn:
        conn.execute('DELETE FROM expenses WHERE id=? AND user_id=?', (eid, user['id']))
    return jsonify({'message': 'Deleted'})


@app.route('/summary', methods=['GET'])
def summary():
    user = get_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    month = request.args.get('month', datetime.date.today().strftime('%Y-%m'))
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM expenses WHERE user_id=? AND date LIKE ?",
            (user['id'], f'{month}%')
        ).fetchall()
    data    = [dict(r) for r in rows]
    income  = sum(r['amount'] for r in data if r['type'] == 'income')
    expense = sum(r['amount'] for r in data if r['type'] == 'expense')
    by_cat  = {}
    for r in data:
        if r['type'] == 'expense':
            by_cat[r['category']] = by_cat.get(r['category'], 0) + r['amount']
    return jsonify({'income': income, 'expense': expense,
                    'balance': income - expense, 'by_category': by_cat})


init_db()

if __name__ == '__main__':
    # --- FIX: bind 0.0.0.0 so the host's reverse proxy can reach it, ---
    # --- read PORT from env (Render/Railway/Heroku inject this), and ---
    # --- turn debug off by default (the Werkzeug debugger is a remote ---
    # --- code execution risk if left on in production). ---
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=port, debug=debug)