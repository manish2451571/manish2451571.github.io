// FIX: was hardcoded to 'http://localhost:5000', which only works when the
// browser itself is on your dev machine. Since server.py now also serves
// these HTML/JS files, using an empty string makes fetch() calls relative
// to whatever origin the page is loaded from (works in dev AND production).
const API = '';

// Redirect to dashboard if already logged in
if (localStorage.getItem('et_token')) {
  window.location.replace('index.html');
}

function showView(view) {
  document.getElementById('login-view').classList.toggle('hidden', view !== 'login');
  document.getElementById('register-view').classList.toggle('hidden', view !== 'register');
}

function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  btn.innerHTML = `<i class="fas fa-eye${isText ? '' : '-slash'}"></i>`;
}

function showAlert(id, msg, type) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `alert ${type}`;
  setTimeout(() => el.className = 'alert hidden', 4000);
}

// ── Login ─────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Logging in...';
  btn.disabled = true;

  try {
    const res  = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email:    document.getElementById('l-email').value.trim(),
        password: document.getElementById('l-pass').value
      })
    });
    const data = await res.json();
    if (!res.ok) { showAlert('login-alert', data.error, 'error'); return; }

    localStorage.setItem('et_token', data.token);
    localStorage.setItem('et_user',  data.name);
    window.location.replace('index.html');
  } catch {
    showAlert('login-alert', 'Cannot connect to server.', 'error');
  } finally {
    btn.textContent = 'Login';
    btn.disabled = false;
  }
});

// ── Register ──────────────────────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pass = document.getElementById('r-pass').value;
  if (pass.length < 6) { showAlert('reg-alert', 'Password must be at least 6 characters.', 'error'); return; }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.textContent = 'Creating...';
  btn.disabled = true;

  try {
    const res  = await fetch(`${API}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:     document.getElementById('r-name').value.trim(),
        email:    document.getElementById('r-email').value.trim(),
        password: pass
      })
    });
    const data = await res.json();
    if (!res.ok) { showAlert('reg-alert', data.error, 'error'); return; }

    showAlert('reg-alert', 'Account created! Logging you in...', 'success');
    localStorage.setItem('et_token', data.token);
    localStorage.setItem('et_user',  data.name);
    setTimeout(() => window.location.replace('index.html'), 1200);
  } catch {
    showAlert('reg-alert', 'Cannot connect to server.', 'error');
  } finally {
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
});