const token = sessionStorage.getItem('dashboard_token');
if (!token) {
  window.location.href = 'login.html';
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    sessionStorage.removeItem('dashboard_token');
    window.location.href = 'login.html';
    return null;
  }
  return res.json();
}

function fillTable(tableId, rows, columns) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = columns.map(c => `<td>${row[c] ?? '-'}</td>`).join('');
    tbody.appendChild(tr);
  }
}

let statusChart = null;
let machineChart = null;
let databasesChart = null;

function renderStatusChart(byStatus) {
  const ctx = document.getElementById('statusChart');
  const data = {
    labels: byStatus.map(r => r.status ?? '-'),
    datasets: [{
      data: byStatus.map(r => Number(r.count)),
      backgroundColor: ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9c27b0'],
    }],
  };
  if (statusChart) {
    statusChart.data = data;
    statusChart.update();
  } else {
    statusChart = new Chart(ctx, { type: 'doughnut', data, options: { plugins: { legend: { position: 'bottom' } } } });
  }
}

function renderMachineChart(byMachine) {
  const ctx = document.getElementById('machineChart');
  const data = {
    labels: byMachine.map(r => r.machineName ?? 'desconhecido'),
    datasets: [{
      label: 'Jobs',
      data: byMachine.map(r => Number(r.count)),
      backgroundColor: '#1a73e8',
    }],
  };
  if (machineChart) {
    machineChart.data = data;
    machineChart.update();
  } else {
    machineChart = new Chart(ctx, { type: 'bar', data, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }
}

function renderDatabasesChart(byDatabase) {
  const ctx = document.getElementById('databasesChart');
  const data = {
    labels: byDatabase.map(r => r.dbType ?? '-'),
    datasets: [{
      data: byDatabase.map(r => Number(r.count)),
      backgroundColor: ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9c27b0'],
    }],
  };
  if (databasesChart) {
    databasesChart.data = data;
    databasesChart.update();
  } else {
    databasesChart = new Chart(ctx, { type: 'doughnut', data, options: { plugins: { legend: { position: 'bottom' } } } });
  }
}

async function loadDashboard() {
  const metrics = await apiGet('/api/dashboard/metrics');
  if (!metrics) return;

  document.getElementById('totalJobs').textContent = metrics.totalJobs;
  document.getElementById('totalFiles').textContent = metrics.totalFiles;
  document.getElementById('distinctMachines').textContent = metrics.distinctMachines;
  document.getElementById('avgFilesPerJob').textContent = Number(metrics.avgFilesPerJob).toFixed(2);
  document.getElementById('avgDuration').textContent = Math.round(metrics.avgDurationMs);

  renderStatusChart(metrics.byStatus);
  renderMachineChart(metrics.byMachine);
  renderDatabasesChart(metrics.byDatabase);

  fillTable('statusTable', metrics.byStatus, ['status', 'count']);
  fillTable('machineTable', metrics.byMachine, ['machineName', 'count']);

  const jobsData = await apiGet('/api/dashboard/jobs?limit=50');
  if (!jobsData) return;
  //formatar data para horário do brasil
  jobsData.jobs.forEach(job => {
    if (job.createdAt) {
      const date = new Date(job.createdAt);
      job.createdAt = date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    }
  });
  fillTable('jobsTable', jobsData.jobs, ['jobId', 'status', 'machineName', 'ip', 'filesCount', 'dbType', 'createdAt']);
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('dashboard_token');
  window.location.href = 'login.html';
});

loadDashboard();
