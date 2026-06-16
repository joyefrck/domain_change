import { rankDomains } from './domainSelection.js';
import { probeStatus, probeUrl } from './probe.js';

const HERO_TITLE = '网站可用性检测';

const state = {
  domains: [],
  settings: { siteName: 'Domain Entry' },
  browserResults: new Map(),
  checking: false
};

const nodes = {
  recommendation: document.querySelector('#recommendation'),
  domainList: document.querySelector('#domainList'),
  refreshButton: document.querySelector('#refreshButton'),
  checkingStatus: document.querySelector('#checkingStatus'),
  summaryTotal: document.querySelector('#summaryTotal'),
  summaryChecked: document.querySelector('#summaryChecked'),
  summaryAvailable: document.querySelector('#summaryAvailable'),
  siteName: document.querySelector('[data-site-name]'),
  siteTitle: document.querySelector('[data-site-title]'),
  brandMark: document.querySelector('.brand-mark'),
  toast: document.querySelector('#toast')
};

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.remove('hidden');
  setTimeout(() => nodes.toast.classList.add('hidden'), 2800);
}

async function probeDomain(domain) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(probeUrl(domain), {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json,text/plain,*/*' }
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const result = {
      ok: response.ok,
      latencyMs,
      error: response.ok ? '' : `HTTP ${response.status}`
    };
    await postProbeResult(domain.id, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error.name === 'AbortError' ? 'timeout' : 'network error'
    };
    await postProbeResult(domain.id, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function postProbeResult(domainId, result) {
  try {
    await fetch('/api/probe-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domainId, ...result })
    });
  } catch {
    // Probe telemetry must never block the user-facing selection flow.
  }
}

function tags(domain) {
  return (domain.tags || []).map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusChip(domain) {
  const status = probeStatus(domain);
  return `<span class="${status.className}">${escapeHtml(status.text)}</span>`;
}

function render() {
  const ranked = rankDomains(state.domains, state.browserResults);
  const availableCount = ranked.filter((domain) => domain.available).length;
  const checkedCount = state.browserResults.size;
  const recommended = ranked.find((domain) => domain.recommended);

  document.title = `路线检测 - ${state.settings.siteName}`;
  nodes.siteName.textContent = state.settings.siteName;
  nodes.siteTitle.textContent = HERO_TITLE;
  nodes.brandMark.textContent = state.settings.siteName.trim().charAt(0).toUpperCase() || 'D';
  nodes.summaryTotal.textContent = `候选域名 ${state.domains.length}`;
  nodes.summaryChecked.textContent = `已检测 ${checkedCount}`;
  nodes.summaryAvailable.textContent = `可用 ${availableCount}`;
  nodes.checkingStatus.textContent = state.checking ? '正在从当前浏览器网络检测' : '检测完成，结果仅代表当前网络';

  if (recommended) {
    nodes.recommendation.className = 'primary-card';
    nodes.recommendation.innerHTML = `
      <div class="domain-name">${escapeHtml(recommended.name)}</div>
      <div class="domain-url">${escapeHtml(recommended.url)}</div>
      <div class="domain-meta">
        <span class="chip ok">推荐</span>
        ${statusChip(recommended)}
        ${tags(recommended)}
      </div>
      <div class="actions">
        <a class="button primary" href="${escapeHtml(recommended.url)}" target="_blank" rel="noopener">进入推荐入口</a>
        <button class="button" type="button" data-copy="${escapeHtml(recommended.url)}">复制地址</button>
      </div>
    `;
  } else if (state.domains.length === 0) {
    nodes.recommendation.className = 'empty';
    nodes.recommendation.textContent = '暂无候选域名，请先进入管理后台添加登录入口。';
  } else {
    nodes.recommendation.className = 'empty';
    nodes.recommendation.textContent = '未能自动确认可用入口，请手动打开下方地址尝试。';
  }

  nodes.domainList.innerHTML = ranked.length ? ranked.map((domain) => `
    <article class="domain-row">
      <div>
        <div class="domain-name">${escapeHtml(domain.name)}</div>
        <div class="domain-url compact">${escapeHtml(domain.url)}</div>
        <div class="domain-meta">
          ${statusChip(domain)}
          ${tags(domain)}
        </div>
      </div>
      <div class="actions">
        <a class="button small" href="${escapeHtml(domain.url)}" target="_blank" rel="noopener">打开</a>
        <button class="button small" type="button" data-copy="${escapeHtml(domain.url)}">复制</button>
      </div>
    </article>
  `).join('') : '<div class="empty">暂无候选域名。</div>';
}

async function loadDomains() {
  const [settingsResponse, domainsResponse] = await Promise.all([
    fetch('/api/settings', { cache: 'no-store' }),
    fetch('/api/domains', { cache: 'no-store' })
  ]);
  if (!settingsResponse.ok || !domainsResponse.ok) {
    throw new Error('无法加载域名清单');
  }
  state.settings = await settingsResponse.json();
  const data = await domainsResponse.json();
  state.domains = data.domains || [];
}

async function runChecks() {
  state.browserResults = new Map();
  state.checking = true;
  render();

  await Promise.all(state.domains.map(async (domain) => {
    const result = await probeDomain(domain);
    state.browserResults.set(domain.id, result);
    render();
  }));

  state.checking = false;
  render();
}

document.addEventListener('click', async (event) => {
  const copyTarget = event.target.closest('[data-copy]');
  if (!copyTarget) {
    return;
  }
  await navigator.clipboard.writeText(copyTarget.dataset.copy);
  showToast('地址已复制');
});

nodes.refreshButton.addEventListener('click', async () => {
  try {
    await loadDomains();
    await runChecks();
  } catch (error) {
    showToast(error.message);
  }
});

try {
  await loadDomains();
  await runChecks();
} catch (error) {
  nodes.checkingStatus.textContent = error.message;
  render();
}
