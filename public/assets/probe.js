export function probeUrl(domain) {
  const path = String(domain.healthPath ?? '').trim();
  return new URL(path || '/', domain.url).toString();
}

export function probeStatus(domain) {
  if (!domain.browserError && domain.browserLatencyMs === null) {
    return {
      className: 'chip',
      text: '正在检测'
    };
  }

  if (domain.available || domain.browserReachable) {
    return {
      className: 'chip ok',
      text: `浏览器可达 ${domain.browserLatencyMs}ms`
    };
  }

  if (domain.browserError === 'network error') {
    return {
      className: 'chip',
      text: '无法自动确认，可手动打开'
    };
  }

  return {
    className: 'chip bad',
    text: '当前网络不可达'
  };
}
