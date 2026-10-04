// FIX: was hardcoded to 'http://localhost:5000'. Empty string means
// requests go to whatever origin served this page (dev and prod both work).
const API = '';
const CUR = '₹';
let allTx = [], pieChart, barChart;

// ── Auth guard ────────────────────────────────────────────────
const token = localStorage.getItem('et_token');
if (!token) {
  window.location.replace('login.html');
  throw new Error('Not authenticated');
}
document.getElementById('user-name').textContent = localStorage.getItem('et_user') || '';

function logout() {
  localStorage.removeItem('et_token');
  localStorage.removeItem('et_user');
  window.location.href = 'login.html';
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

function showFormAlert(msg, type) {
  const el = document.getElementById('form-alert');
  el.textContent = msg;
  el.className = `alert ${type}`;
  setTimeout(() => el.className = 'alert hidden', 4000);
}

const ICONS = {
  Food:'🍔', Transport:'🚗', Shopping:'🛍️', Health:'💊',
  Entertainment:'🎬', Bills:'💡', Education:'📚', Salary:'💰', Other:'📦'
};

// ── Month picker ──────────────────────────────────────────────
const picker = document.getElementById('month-picker');
picker.value = new Date().toISOString().slice(0, 7);
picker.addEventListener('change', loadAll);

// ── Load all data ─────────────────────────────────────────────
async function loadAll() {
  const month = picker.value;
  try {
    const [txRes, sumRes] = await Promise.all([
      fetch(`${API}/expenses?month=${month}`, { headers: authHeaders() }),
      fetch(`${API}/summary?month=${month}`,  { headers: authHeaders() })
    ]);
    allTx = await txRes.json();
    const sum = await sumRes.json();
    updateSummary(sum);
    renderCharts(sum);
    renderList(allTx);
  } catch (err) {
    console.error('Server error:', err);
    document.getElementById('tx-list').innerHTML =
      '<div class="empty">⚠️ Unable to load data. Please refresh or try again later.</div>';
  }
}

// ── Summary cards ─────────────────────────────────────────────
function updateSummary(s) {
  document.getElementById('s-income').textContent  = CUR + s.income.toFixed(2);
  document.getElementById('s-expense').textContent = CUR + s.expense.toFixed(2);
  const bal = document.getElementById('s-balance');
  bal.textContent = CUR + Math.abs(s.balance).toFixed(2);
  bal.style.color = s.balance >= 0 ? 'var(--income)' : 'var(--expense)';
}

// ── Charts ────────────────────────────────────────────────────
function renderCharts(sum) {
  const cats   = Object.keys(sum.by_category);
  const vals   = Object.values(sum.by_category);
  const colors = ['#6c63ff','#f87171','#48c78e','#fbbf24','#60a5fa','#f472b6','#34d399','#a78bfa'];

  // Doughnut — spending by category
  if (pieChart) pieChart.destroy();
  if (cats.length === 0) {
    document.getElementById('pie-chart').getContext('2d').clearRect(0, 0, 999, 999);
  } else {
    pieChart = new Chart(document.getElementById('pie-chart'), {
      type: 'doughnut',
      data: {
        labels: cats,
        datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${CUR}${ctx.parsed.toFixed(2)}`
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  // Bar — income vs expense
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById('bar-chart'), {
    type: 'bar',
    data: {
      labels: ['Income', 'Expenses'],
      datasets: [{
        data: [sum.income, sum.expense],
        backgroundColor: ['rgba(72,199,142,0.75)', 'rgba(248,113,113,0.75)'],
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${CUR}${ctx.parsed.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
        y: {
          ticks: { color: '#94a3b8', callback: v => CUR + v },
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true
        }
      }
    }
  });
}

// ── HTML escaping (prevents stored XSS) ──────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Transaction list ──────────────────────────────────────────
function renderList(data) {
  const el = document.getElementById('tx-list');
  if (!data.length) {
    el.innerHTML = '<div class="empty">No transactions this month.</div>';
    return;
  }
  el.innerHTML = data.map(t => `
    <div class="tx-item">
      <div class="tx-icon ${esc(t.type)}">${ICONS[esc(t.category)] || '📦'}</div>
      <div class="tx-info">
        <div class="tx-title">${esc(t.title)}</div>
        <div class="tx-meta">${esc(t.category)} · ${esc(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</div>
      </div>
      <span class="tx-amount ${esc(t.type)}">
        ${t.type === 'income' ? '+' : '-'}${CUR}${parseFloat(t.amount).toFixed(2)}
      </span>
      <button class="tx-del" onclick="deleteTx(${parseInt(t.id, 10)})" title="Delete">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');
}

// ── Search ────────────────────────────────────────────────────
document.getElementById('search-tx').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  renderList(allTx.filter(t =>
    t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)
  ));
});

// ── Add transaction ───────────────────────────────────────────
document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title:    document.getElementById('f-title').value.trim(),
    amount:   parseFloat(document.getElementById('f-amount').value),
    type:     document.getElementById('f-type').value,
    category: document.getElementById('f-category').value,
    date:     document.getElementById('f-date').value,
    note:     document.getElementById('f-note').value.trim()
  };
  if (!body.title || isNaN(body.amount) || !body.date) return;
  try {
    const res = await fetch(`${API}/expenses`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showFormAlert(err.error || 'Could not save transaction.', 'error');
      return;
    }
    e.target.reset();
    document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    loadAll();
  } catch {
    showFormAlert('Network error. Could not save transaction.', 'error');
  }
});

// ── Delete ────────────────────────────────────────────────────
async function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  try {
    const res = await fetch(`${API}/expenses/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) { alert('Could not delete. Please try again.'); return; }
    loadAll();
  } catch {
    alert('Network error. Could not delete transaction.');
  }
}

// ── Init ──────────────────────────────────────────────────────
document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
loadAll();