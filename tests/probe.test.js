import { describe, expect, it } from 'vitest';
import { probeStatus, probeUrl } from '../public/assets/probe.js';

describe('probeUrl', () => {
  it('uses the domain root path when no health path is configured', () => {
    expect(probeUrl({ url: 'https://login.example.com', healthPath: '' })).toBe('https://login.example.com/');
    expect(probeUrl({ url: 'https://login.example.com' })).toBe('https://login.example.com/');
  });

  it('uses the configured health path when present', () => {
    expect(probeUrl({ url: 'https://login.example.com', healthPath: '/healthz' })).toBe('https://login.example.com/healthz');
    expect(probeUrl({ url: 'https://login.example.com', healthPath: 'healthz' })).toBe('https://login.example.com/healthz');
  });
});

describe('probeStatus', () => {
  it('labels domains without a browser result as pending', () => {
    expect(probeStatus({
      available: false,
      browserReachable: false,
      browserLatencyMs: null,
      browserError: ''
    })).toEqual({
      className: 'chip',
      text: '正在检测'
    });
  });

  it('labels browser-readable domains as reachable', () => {
    expect(probeStatus({
      available: true,
      browserReachable: true,
      browserLatencyMs: 120
    })).toEqual({
      className: 'chip ok',
      text: '浏览器可达 120ms'
    });
  });

  it('labels CORS-style network errors as unconfirmed instead of unreachable', () => {
    expect(probeStatus({
      available: false,
      browserReachable: false,
      browserLatencyMs: 420,
      browserError: 'network error'
    })).toEqual({
      className: 'chip',
      text: '无法自动确认，可手动打开'
    });
  });

  it('keeps timeouts as unreachable', () => {
    expect(probeStatus({
      available: false,
      browserReachable: false,
      browserLatencyMs: 5000,
      browserError: 'timeout'
    })).toEqual({
      className: 'chip bad',
      text: '当前网络不可达'
    });
  });
});
