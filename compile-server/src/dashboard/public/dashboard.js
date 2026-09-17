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
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Não foi possível carregar o dashboard.');
  return data;
}

function fillTable(tableId, rows, columns) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of columns) {
      const td = document.createElement('td');
      td.textContent = row[column] ?? '—';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function maskIp(ip) {
  if (!ip) return '—';
  const value = String(ip).replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return value.split('.').slice(0, 2).join('.') + '.*.*';
  }
  if (value.includes(':')) {
    const prefix = value.split(':').slice(0, 2);
    return prefix.map(part => part || '*').concat(Array(6).fill('*')).join(':');
  }
  return '***';
}

function formatDuration(durationMs) {
  if (durationMs == null || !Number.isFinite(Number(durationMs)) || Number(durationMs) < 0) return '—';
  const ms = Number(durationMs);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} s`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)} h ` : ''}${minutes % 60} min ${seconds % 60} s`;
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

let repositoryChart = null;
function renderRepositoryChart(byRepository) {
  const data = {
    labels: byRepository.map(row => row.repository),
    datasets: [{ label: 'Jobs', data: byRepository.map(row => Number(row.count)), backgroundColor: '#34a853' }],
  };
  if (repositoryChart) {
    repositoryChart.data = data;
    repositoryChart.update();
  } else {
    repositoryChart = new Chart(document.getElementById('repositoryChart'), {
      type: 'bar', data,
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
  }
  fillTable('repositoryTable', byRepository, ['repository', 'count']);
}

let loadVersion = 0;
let activeFilters = new URLSearchParams();
let tableState = { page: 1, limit: 25, total: 0, totalPages: 0, sortBy: 'createdAt', sortOrder: 'DESC' };
let loading = false;

function updateTableControls() {
  const { page, limit, total, totalPages, sortBy, sortOrder } = tableState;
  document.getElementById('pageSize').value = String(limit);
  document.getElementById('pageSize').disabled = loading;
  document.getElementById('firstPage').disabled = loading || page <= 1;
  document.getElementById('previousPage').disabled = loading || page <= 1;
  document.getElementById('nextPage').disabled = loading || page >= totalPages;
  document.getElementById('lastPage').disabled = loading || page >= totalPages;
  document.getElementById('pageInfo').textContent = total
    ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total} jobs · Página ${page} de ${totalPages}`
    : '0 jobs · Nenhuma página';
  document.getElementById('jobsTable').setAttribute('aria-busy', String(loading));
  document.querySelectorAll('#jobsTable [data-sort]').forEach(button => {
    const selected = button.dataset.sort === sortBy;
    button.disabled = loading;
    button.closest('th').setAttribute('aria-sort', selected ? (sortOrder === 'ASC' ? 'ascending' : 'descending') : 'none');
    button.querySelector('span').textContent = selected ? (sortOrder === 'ASC' ? '↑' : '↓') : '↕';
  });
}

async function loadDashboard(nextState = tableState, filters = activeFilters) {
  const message = document.getElementById('dashboardMessage');
  const params = new URLSearchParams(filters);
  if (params.get('startDate') && params.get('endDate') && params.get('startDate') > params.get('endDate')) {
    message.className = 'error';
    message.textContent = 'A data inicial deve ser anterior ou igual à data final.';
    return;
  }
  const version = ++loadVersion;
  const jobsParams = new URLSearchParams(params);
  for (const key of ['page', 'limit', 'sortBy', 'sortOrder']) jobsParams.set(key, nextState[key]);
  loading = true;
  updateTableControls();
  message.className = '';
  message.textContent = 'Carregando…';
  try {
    const [metrics, jobsData] = await Promise.all([
      apiGet(`/api/dashboard/metrics?${params}`),
      apiGet(`/api/dashboard/jobs?${jobsParams}`),
    ]);
    if (version !== loadVersion || !metrics || !jobsData) return;
    document.getElementById('totalJobs').textContent = metrics.totalJobs;
    document.getElementById('totalFiles').textContent = metrics.totalFiles;
    document.getElementById('distinctMachines').textContent = metrics.distinctMachines;
    document.getElementById('avgFilesPerJob').textContent = Number(metrics.avgFilesPerJob).toFixed(2);
    document.getElementById('avgDuration').textContent = Math.round(metrics.avgDurationMs);
    renderStatusChart(metrics.byStatus);
    renderMachineChart(metrics.byMachine);
    renderDatabasesChart(metrics.byDatabase);
    renderRepositoryChart(metrics.byRepository);
    fillTable('statusTable', metrics.byStatus, ['status', 'count']);
    fillTable('machineTable', metrics.byMachine, ['machineName', 'count']);
    const jobs = jobsData.jobs.map(job => ({
      ...job,
      repository: job.repository?.trim() || 'Não informado',
      ip: maskIp(job.ip),
      duration: formatDuration(job.durationMs),
      createdAt: job.createdAt ? new Date(job.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—',
    }));
    fillTable('jobsTable', jobs, ['jobId', 'status', 'machineName', 'ip', 'filesCount', 'dbType', 'repository', 'duration', 'createdAt']);
    if (!jobs.length) {
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = 'Nenhum job encontrado para os filtros informados.';
      const tr = document.createElement('tr');
      tr.appendChild(td);
      document.querySelector('#jobsTable tbody').appendChild(tr);
    }
    const { page, limit, total, totalPages, sortBy, sortOrder } = jobsData;
    tableState = { page, limit, total, totalPages, sortBy, sortOrder };
    activeFilters = params;
    message.textContent = jobs.length ? '' : 'Nenhum job encontrado para os filtros informados.';
  } catch (error) {
    if (version !== loadVersion) return;
    message.className = 'error';
    message.textContent = `${error.message || 'Não foi possível carregar o dashboard.'} Os dados exibidos não foram atualizados.`;
  } finally {
    if (version === loadVersion) {
      loading = false;
      updateTableControls();
    }
  }
}

document.getElementById('filtersForm').addEventListener('submit', event => {
  event.preventDefault();
  const filters = new URLSearchParams();
  for (const [key, value] of new FormData(event.currentTarget)) {
    if (value.trim()) filters.set(key, value.trim());
  }
  loadDashboard({ ...tableState, page: 1 }, filters);
});
document.getElementById('filtersForm').addEventListener('reset', () => {
  loadDashboard({ ...tableState, page: 1 }, new URLSearchParams());
});
document.getElementById('pageSize').addEventListener('change', event => {
  loadDashboard({ ...tableState, page: 1, limit: Number(event.target.value) });
});
for (const [id, getPage] of [
  ['firstPage', () => 1], ['previousPage', () => tableState.page - 1],
  ['nextPage', () => tableState.page + 1], ['lastPage', () => tableState.totalPages],
]) {
  document.getElementById(id).addEventListener('click', () => {
    if (!loading) loadDashboard({ ...tableState, page: getPage() });
  });
}
document.querySelectorAll('#jobsTable [data-sort]').forEach(button => {
  button.addEventListener('click', () => {
    if (loading) return;
    const sortBy = button.dataset.sort;
    const sortOrder = sortBy === tableState.sortBy
      ? (tableState.sortOrder === 'ASC' ? 'DESC' : 'ASC')
      : (sortBy === 'createdAt' ? 'DESC' : 'ASC');
    loadDashboard({ ...tableState, page: 1, sortBy, sortOrder });
  });
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('dashboard_token');
  window.location.href = 'login.html';
});

loadDashboard();
