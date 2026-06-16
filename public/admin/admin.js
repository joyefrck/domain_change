const nodes = {
  loginPanel: document.querySelector('#loginPanel'),
  loginForm: document.querySelector('#loginForm'),
  adminApp: document.querySelector('#adminApp'),
  settingsForm: document.querySelector('#settingsForm'),
  passwordForm: document.querySelector('#passwordForm'),
  domainForm: document.querySelector('#domainForm'),
  domainTable: document.querySelector('#domainTable'),
  formTitle: document.querySelector('#formTitle'),
  resetFormButton: document.querySelector('#resetFormButton'),
  logoutButton: document.querySelector('#logoutButton'),
  toast: document.querySelector('#toast')
};

let domains = [];
let settings = { siteName: 'Domain Entry' };

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.remove('hidden');
  setTimeout(() => nodes.toast.classList.add('hidden'), 2800);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(error.error || '请求失败');
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

function readForm() {
  const data = new FormData(nodes.domainForm);
  return {
    url: data.get('url'),
    name: data.get('name'),
    tags: data.get('tags'),
    weight: Number(data.get('weight')),
    enabled: data.get('enabled') === 'on',
    healthPath: data.get('healthPath'),
    notes: data.get('notes')
  };
}

function resetForm() {
  nodes.formTitle.textContent = '新增域名';
  nodes.domainForm.reset();
  nodes.domainForm.elements.id.value = '';
  nodes.domainForm.elements.healthPath.value = '';
  nodes.domainForm.elements.weight.value = '50';
  nodes.domainForm.elements.enabled.checked = true;
}

function editDomain(domain) {
  nodes.formTitle.textContent = `编辑 ${domain.name}`;
  nodes.domainForm.elements.id.value = domain.id;
  nodes.domainForm.elements.url.value = domain.url;
  nodes.domainForm.elements.name.value = domain.name;
  nodes.domainForm.elements.tags.value = (domain.tags || []).join(',');
  nodes.domainForm.elements.weight.value = domain.weight;
  nodes.domainForm.elements.healthPath.value = domain.healthPath || '';
  nodes.domainForm.elements.notes.value = domain.notes || '';
  nodes.domainForm.elements.enabled.checked = domain.enabled;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDomains() {
  nodes.domainTable.innerHTML = domains.length ? domains.map((domain) => {
    return `
      <article class="admin-row">
        <div>
          <strong>${escapeHtml(domain.name)} · ${escapeHtml(domain.url)}</strong>
          <div class="domain-meta">
            <span class="chip ${domain.enabled ? 'ok' : 'bad'}">${domain.enabled ? '启用' : '停用'}</span>
            <span class="chip">权重 ${domain.weight}</span>
            ${(domain.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}
          </div>
          ${domain.notes ? `<p class="panel-subtitle">${escapeHtml(domain.notes)}</p>` : ''}
        </div>
        <div class="admin-actions">
          <button class="button small" type="button" data-action="edit" data-id="${domain.id}">编辑</button>
          <button class="button small danger" type="button" data-action="delete" data-id="${domain.id}">删除</button>
        </div>
      </article>
    `;
  }).join('') : '<div class="empty">还没有域名。先添加一个候选登录入口。</div>';
}

async function loadDomains() {
  const [settingsData, data] = await Promise.all([
    api('/admin/api/settings'),
    api('/admin/api/domains')
  ]);
  settings = settingsData;
  nodes.settingsForm.elements.siteName.value = settings.siteName;
  domains = data.domains || [];
  renderDomains();
}

async function boot() {
  try {
    await api('/admin/api/me');
    nodes.loginPanel.classList.add('hidden');
    nodes.adminApp.classList.remove('hidden');
    nodes.logoutButton.classList.remove('hidden');
    await loadDomains();
  } catch {
    nodes.loginPanel.classList.remove('hidden');
    nodes.adminApp.classList.add('hidden');
    nodes.logoutButton.classList.add('hidden');
  }
}

nodes.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/admin/api/login', {
      method: 'POST',
      body: JSON.stringify({ password: new FormData(nodes.loginForm).get('password') })
    });
    nodes.loginForm.reset();
    await boot();
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-password-toggle]');
  if (!button) {
    return;
  }
  const input = button.closest('.password-field')?.querySelector('input');
  if (!input) {
    return;
  }
  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  button.setAttribute('aria-label', shouldShow ? '隐藏密码' : '显示密码');
  button.setAttribute('title', shouldShow ? '隐藏密码' : '显示密码');
});

nodes.domainForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = nodes.domainForm.elements.id.value;
  try {
    await api(id ? `/admin/api/domains/${id}` : '/admin/api/domains', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(readForm())
    });
    resetForm();
    await loadDomains();
    showToast('已保存');
  } catch (error) {
    showToast(error.message);
  }
});

nodes.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const siteName = new FormData(nodes.settingsForm).get('siteName');
    const data = await api('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ siteName })
    });
    settings = data.settings;
    nodes.settingsForm.elements.siteName.value = settings.siteName;
    showToast('站点设置已保存');
  } catch (error) {
    showToast(error.message);
  }
});

nodes.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const formData = new FormData(nodes.passwordForm);
    await api('/admin/api/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword: formData.get('newPassword')
      })
    });
    nodes.passwordForm.reset();
    nodes.loginPanel.classList.remove('hidden');
    nodes.adminApp.classList.add('hidden');
    nodes.logoutButton.classList.add('hidden');
    showToast('密码已修改，请重新登录');
  } catch (error) {
    showToast(error.message);
  }
});

nodes.logoutButton.addEventListener('click', async () => {
  try {
    await api('/admin/api/logout', { method: 'POST', body: '{}' });
  } catch {
    // Even if the server session already expired, the local UI should return to login.
  }
  nodes.loginPanel.classList.remove('hidden');
  nodes.adminApp.classList.add('hidden');
  nodes.logoutButton.classList.add('hidden');
  showToast('已退出登录');
});

nodes.domainTable.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }
  const id = Number(button.dataset.id);
  const domain = domains.find((item) => item.id === id);

  try {
    if (button.dataset.action === 'edit') {
      editDomain(domain);
    }
    if (button.dataset.action === 'delete') {
      if (!confirm(`删除 ${domain.url}？`)) {
        return;
      }
      await api(`/admin/api/domains/${id}`, { method: 'DELETE' });
      await loadDomains();
      showToast('已删除');
    }
  } catch (error) {
    showToast(error.message);
  }
});

nodes.resetFormButton.addEventListener('click', resetForm);

boot();
