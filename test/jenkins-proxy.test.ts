import { describe, expect, it } from 'vitest'
import {
  buildDispatcher,
  maskProxyUrl,
  parseNoProxy,
  resolveProxy,
  shouldBypassProxy,
} from '../src/jenkins/proxy'

describe('resolveProxy', () => {
  it('returns none when nothing is configured', () => {
    const r = resolveProxy({ env: {} })
    expect(r.proxyUrl).toBeUndefined()
    expect(r.source).toBe('none')
    expect(r.strictSSL).toBe(true)
  })

  it('extension override beats vscode setting and env', () => {
    const r = resolveProxy({
      extensionProxy: 'http://ext.example:1',
      vscodeProxy: 'http://vsc.example:2',
      env: { HTTPS_PROXY: 'http://env.example:3' },
    })
    expect(r).toMatchObject({ proxyUrl: 'http://ext.example:1', source: 'extension' })
  })

  it('vscode http.proxy beats env', () => {
    const r = resolveProxy({
      vscodeProxy: 'http://vsc.example:2',
      env: { HTTPS_PROXY: 'http://env.example:3' },
    })
    expect(r).toMatchObject({ proxyUrl: 'http://vsc.example:2', source: 'vscode' })
  })

  it('falls back to env variables in priority order', () => {
    expect(resolveProxy({ env: { HTTPS_PROXY: 'http://a:1' } })).toMatchObject({ proxyUrl: 'http://a:1', source: 'env' })
    expect(resolveProxy({ env: { https_proxy: 'http://b:1' } })).toMatchObject({ proxyUrl: 'http://b:1', source: 'env' })
    expect(resolveProxy({ env: { HTTP_PROXY: 'http://c:1' } })).toMatchObject({ proxyUrl: 'http://c:1', source: 'env' })
    expect(resolveProxy({ env: { http_proxy: 'http://d:1' } })).toMatchObject({ proxyUrl: 'http://d:1', source: 'env' })
  })

  it('treats blank strings as unset', () => {
    const r = resolveProxy({
      extensionProxy: '   ',
      vscodeProxy: '',
      env: { HTTPS_PROXY: '  ' },
    })
    expect(r.source).toBe('none')
  })

  it('extension strictSSL overrides vscode strictSSL', () => {
    expect(resolveProxy({ extensionStrictSSL: false, vscodeStrictSSL: true, env: {} }).strictSSL).toBe(false)
    expect(resolveProxy({ vscodeStrictSSL: false, env: {} }).strictSSL).toBe(false)
    expect(resolveProxy({ env: {} }).strictSSL).toBe(true)
  })
})

describe('parseNoProxy', () => {
  it('parses comma-separated NO_PROXY and normalizes leading dot/case', () => {
    expect(parseNoProxy({ NO_PROXY: '.Example.com, internal.svc , ,LOCAL' })).toEqual([
      'example.com',
      'internal.svc',
      'local',
    ])
  })

  it('falls back to lowercase no_proxy', () => {
    expect(parseNoProxy({ no_proxy: 'foo.bar' })).toEqual(['foo.bar'])
  })

  it('returns empty when neither is set', () => {
    expect(parseNoProxy({})).toEqual([])
  })
})

describe('shouldBypassProxy', () => {
  it('returns false when noProxy is empty', () => {
    expect(shouldBypassProxy('https://jenkins.corp', [])).toBe(false)
  })

  it('matches exact host and suffix', () => {
    expect(shouldBypassProxy('https://jenkins.corp', ['jenkins.corp'])).toBe(true)
    expect(shouldBypassProxy('https://ci.jenkins.corp/job', ['jenkins.corp'])).toBe(true)
    expect(shouldBypassProxy('https://other.com', ['jenkins.corp'])).toBe(false)
  })

  it('respects wildcard', () => {
    expect(shouldBypassProxy('https://anything', ['*'])).toBe(true)
  })

  it('returns false for malformed URLs', () => {
    expect(shouldBypassProxy('not a url', ['anything'])).toBe(false)
  })
})

describe('maskProxyUrl', () => {
  it('hides credentials and reports (none) when empty', () => {
    expect(maskProxyUrl(undefined)).toBe('(none)')
    expect(maskProxyUrl('http://user:secret@p.corp:8080')).toBe('http://***@p.corp:8080')
    expect(maskProxyUrl('http://p.corp:8080')).toBe('http://p.corp:8080')
  })

  it('passes through unparseable input', () => {
    expect(maskProxyUrl('not a url')).toBe('not a url')
  })
})

describe('buildDispatcher', () => {
  class FakeProxyAgent {
    constructor(public opts: any) {}
  }
  class FakeAgent {
    constructor(public opts: any) {}
  }
  const fakeLoader = () => ({ ProxyAgent: FakeProxyAgent as any, Agent: FakeAgent as any })

  it('returns undefined when no proxy and strictSSL is true', () => {
    const d = buildDispatcher({ proxyUrl: undefined, source: 'none', strictSSL: true, noProxy: [] }, fakeLoader)
    expect(d).toBeUndefined()
  })

  it('constructs a ProxyAgent when proxy is set', () => {
    const d = buildDispatcher(
      { proxyUrl: 'http://proxy.test:8080', source: 'env', strictSSL: false, noProxy: [] },
      fakeLoader,
    )
    expect(d).toBeInstanceOf(FakeProxyAgent)
    expect((d as FakeProxyAgent).opts).toMatchObject({
      uri: 'http://proxy.test:8080',
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
  })

  it('constructs a plain Agent when no proxy but strictSSL is false', () => {
    const d = buildDispatcher(
      { proxyUrl: undefined, source: 'none', strictSSL: false, noProxy: [] },
      fakeLoader,
    )
    expect(d).toBeInstanceOf(FakeAgent)
    expect((d as FakeAgent).opts).toMatchObject({
      connect: { rejectUnauthorized: false },
    })
  })

  it('returns undefined when loader yields nothing (proxy case)', () => {
    const d = buildDispatcher(
      { proxyUrl: 'http://proxy.test:8080', source: 'env', strictSSL: true, noProxy: [] },
      () => undefined,
    )
    expect(d).toBeUndefined()
  })

  it('returns undefined when loader yields nothing (no-proxy strictSSL=false case)', () => {
    const d = buildDispatcher(
      { proxyUrl: undefined, source: 'none', strictSSL: false, noProxy: [] },
      () => undefined,
    )
    expect(d).toBeUndefined()
  })
})
