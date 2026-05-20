import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JenkinsClient } from '../src/jenkins/client'
import {
  ForbiddenError,
  JenkinsError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnauthorizedError,
} from '../src/jenkins/types'

function jsonResponse(data: unknown, init: { ok?: boolean, status?: number, headers?: Headers } = {}): Response {
  const ok = init.ok ?? true
  const status = init.status ?? (ok ? 200 : 500)
  const headers = init.headers ?? new Headers({ 'content-type': 'application/json' })
  const body = JSON.stringify(data)
  return {
    ok,
    status,
    headers,
    json: async () => data,
    text: async () => body,
  } as Response
}

function textResponse(text: string, init: { ok?: boolean, status?: number, headers?: Headers } = {}): Response {
  const ok = init.ok ?? true
  const status = init.status ?? (ok ? 200 : 500)
  const headers = init.headers ?? new Headers({ 'content-type': 'text/plain' })
  return {
    ok,
    status,
    headers,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as Response
}

describe('jenkinsClient', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function client() {
    return new JenkinsClient({ baseUrl: 'https://jenkins.test', username: 'u', apiToken: 't' })
  }

  it('sends Basic auth on requests', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: [] }))
    await client().listRootJobs(1)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
    })
  })

  it('validateMe calls /me/api/json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await client().validateMe()
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jenkins.test/me/api/json')
  })

  it('listRootJobs requests tree and returns jobs array or default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: [{ name: 'a', fullName: 'a', url: 'u' }] }))
    const jobs = await client().listRootJobs(2)
    expect(jobs).toHaveLength(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/json?tree=')

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    expect(await client().listRootJobs()).toEqual([])
  })

  it('listChildJobs builds folder api path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ jobs: [] }))
    await client().listChildJobs('team/folder', 3)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('https://jenkins.test/job/team/job/folder/api/json')
  })

  it('getRecentBuilds returns builds or default', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ builds: [{ number: 1, url: 'x', result: 'SUCCESS', duration: 1, timestamp: 1 }] }),
    )
    expect(await client().getRecentBuilds('j', 5)).toHaveLength(1)

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    expect(await client().getRecentBuilds('j', 5)).toEqual([])
  })

  it('getJobColor returns color field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ color: 'blue' }))
    expect(await client().getJobColor('j')).toBe('blue')
  })

  it('getLastBuildBrief maps lastBuild and handles nullish', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ lastBuild: { building: true, number: 9 } }))
    expect(await client().getLastBuildBrief('j')).toEqual({ building: true, number: 9 })

    fetchMock.mockResolvedValueOnce(jsonResponse({ lastBuild: null }))
    expect(await client().getLastBuildBrief('j')).toBeNull()

    fetchMock.mockResolvedValueOnce(jsonResponse({ lastBuild: { building: false } }))
    expect(await client().getLastBuildBrief('j')).toBeNull()
  })

  it('fetchJson throws typed errors for common HTTP statuses', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('nope', { ok: false, status: 401 }))
    await expect(client().validateMe()).rejects.toBeInstanceOf(UnauthorizedError)

    fetchMock.mockResolvedValueOnce(textResponse('nope', { ok: false, status: 403 }))
    await expect(client().validateMe()).rejects.toBeInstanceOf(ForbiddenError)

    fetchMock.mockResolvedValueOnce(textResponse('missing', { ok: false, status: 404 }))
    await expect(client().validateMe()).rejects.toBeInstanceOf(NotFoundError)

    fetchMock.mockResolvedValueOnce(textResponse('oops', { ok: false, status: 418 }))
    await expect(client().validateMe()).rejects.toBeInstanceOf(JenkinsError)
  })

  it('triggerParameterizedBuild uses empty fallback body when reading error text rejects', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => Promise.reject(new Error('read')),
    } as Response)
    await expect(client().triggerParameterizedBuild('j', 'BRANCH', 'x')).rejects.toBeInstanceOf(JenkinsError)
  })

  it('maps fetch failures to TimeoutError or NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(client().validateMe()).rejects.toBeInstanceOf(TimeoutError)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    await expect(client().validateMe()).rejects.toBeInstanceOf(NetworkError)
  })

  it('triggerParameterizedBuild posts and resolves absolute Location URLs', async () => {
    const headers = new Headers()
    headers.set('location', 'https://jenkins.test/queue/item/123/')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers,
      json: async () => ({}),
      text: async () => '',
    } as Response)
    const queue = await client().triggerParameterizedBuild('team/service', 'BRANCH', 'main')
    expect(queue).toBe('https://jenkins.test/queue/item/123/')
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/buildWithParameters?BRANCH=main')

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers,
      json: async () => ({}),
      text: async () => '',
    } as Response)
    await expect(client().triggerParameterizedBuild('team/service', 'BRANCH', 'main')).resolves.toBeTruthy()
  })

  it('triggerParameterizedBuild throws without Location header', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '',
    } as Response)
    await expect(client().triggerParameterizedBuild('j', 'P', 'v')).rejects.toBeInstanceOf(JenkinsError)
  })

  it('triggerParameterizedBuild surfaces non-success responses', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('bad token', { ok: false, status: 401 }))
    await expect(client().triggerParameterizedBuild('j', 'P', 'v')).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('fetchText throws JenkinsError when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('nope', { ok: false, status: 500 }))
    await expect(client().fetchText('https://jenkins.test/job/x/consoleText')).rejects.toBeInstanceOf(JenkinsError)
  })

  it('pollQueueUntilExecutable resolves when executable is ready', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      executable: { number: 3, url: 'https://jenkins.test/job/foo/3/' },
    }))
    await expect(client().pollQueueUntilExecutable('https://jenkins.test/queue/item/77/')).resolves.toEqual({
      number: 3,
      url: 'https://jenkins.test/job/foo/3/',
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jenkins.test/queue/item/77/api/json')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      executable: { number: 9, url: '/job/foo/9/' },
    }))
    await expect(client().pollQueueUntilExecutable('https://jenkins.test/queue/item/77/api/json')).resolves.toEqual({
      number: 9,
      url: 'https://jenkins.test/job/foo/9/',
    })

    fetchMock.mockResolvedValueOnce(jsonResponse({
      executable: { number: 7, url: 'https://jenkins.test/job/foo/99' },
    }))
    await expect(client().pollQueueUntilExecutable('https://jenkins.test/queue/z')).resolves.toEqual({
      number: 7,
      url: 'https://jenkins.test/job/foo/99/',
    })
  })

  it('pollQueueUntilExecutable rejects on cancelled queue item', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ cancelled: true }))
    await expect(client().pollQueueUntilExecutable('https://jenkins.test/q/1/')).rejects.toThrow(
      'cancelled in queue',
    )
  })

  it('pollQueueUntilExecutable times out when never executable', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(jsonResponse({}))
      const pending = client().pollQueueUntilExecutable('https://jenkins.test/q/1/')
      const assertion = expect(pending).rejects.toThrow('Timed out waiting for Jenkins queue')
      for (let i = 0; i < 250; i++)
        await vi.advanceTimersByTimeAsync(500)
      await assertion
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('getBuildApi appends trailing slash segment', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ building: false, result: null, duration: 0, number: 1, url: 'u' }))
    await client().getBuildApi('https://jenkins.test/job/x/9')
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jenkins.test/job/x/9/api/json')
  })

  it('stopBuild treats 302 like success even if ok is false', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers(), text: async () => '' } as Response)
    await expect(client().stopBuild('https://jenkins.test/job/x/1')).resolves.toBeUndefined()
  })

  it('stopBuild throws on unexpected errors', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('no', { ok: false, status: 403 }))
    await expect(client().stopBuild('https://jenkins.test/job/x/1')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('fetchProgressiveLog parses headers for continuation', async () => {
    const headers = new Headers({ 'content-type': 'text/plain', 'x-text-size': '10', 'x-more-data': 'true' })
    fetchMock.mockResolvedValueOnce(textResponse('hello', { headers }))
    const r = await client().fetchProgressiveLog('https://jenkins.test/job/x/1', 0)
    expect(r).toEqual({ chunk: 'hello', nextStart: 10, more: true })

    const h2 = new Headers({ 'content-type': 'text/plain' })
    fetchMock.mockResolvedValueOnce(textResponse('ok', { headers: h2 }))
    const r2 = await client().fetchProgressiveLog('https://jenkins.test/job/x/1/', 5)
    expect(r2.nextStart).toBe(5 + 'ok'.length)
    expect(r2.more).toBe(false)
  })

  it('searchSuggest returns [] for blank query', async () => {
    await expect(client().searchSuggest('   ')).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searchSuggest parses array or suggestions objects and tolerates failures', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(['a', 'b']))
    await expect(client().searchSuggest('svc')).resolves.toEqual(['a', 'b'])

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ suggestions: [{ name: 'one' }, 'two'] }),
    )
    await expect(client().searchSuggest('svc')).resolves.toEqual(['one', 'two'])

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers(), json: async () => ({}), text: async () => '' } as Response)
    await expect(client().searchSuggest('svc')).resolves.toEqual([])

    fetchMock.mockRejectedValueOnce(new Error('down'))
    await expect(client().searchSuggest('svc')).resolves.toEqual([])

    fetchMock.mockResolvedValueOnce(jsonResponse({ notSuggest: true }))
    await expect(client().searchSuggest('other')).resolves.toEqual([])
  })

  it('accepts absolute URLs in fetch helpers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hello: 1 }))
    await expect(client().fetchJson('https://other.example/x')).resolves.toEqual({ hello: 1 })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://other.example/x')
  })

  it('joins relative API paths against the normalized base URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ tree: 1 }))
    await expect(client().fetchJson('api/json?tree=x')).resolves.toEqual({ tree: 1 })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://jenkins.test/api/json?tree=x')
  })

  it('passes dispatcher through to fetch when configured', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const dispatcher = { __marker: 'dispatcher' }
    const c = new JenkinsClient({
      baseUrl: 'https://jenkins.test',
      username: 'u',
      apiToken: 't',
      dispatcher,
    })
    await c.validateMe()
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBe(dispatcher)
  })

  it('omits dispatcher when target host is in noProxy', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const dispatcher = { __marker: 'dispatcher' }
    const c = new JenkinsClient({
      baseUrl: 'https://jenkins.test',
      username: 'u',
      apiToken: 't',
      dispatcher,
      noProxy: ['jenkins.test'],
    })
    await c.validateMe()
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBeUndefined()
  })

  it('expands fetch error cause for easier troubleshooting', async () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:8080' },
    })
    fetchMock.mockRejectedValueOnce(err)
    await expect(client().validateMe()).rejects.toThrowError(/ECONNREFUSED/)
  })

  it('respects custom timeoutMs', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          })
        })
      })
      const c = new JenkinsClient({
        baseUrl: 'https://jenkins.test',
        username: 'u',
        apiToken: 't',
        timeoutMs: 5_000,
      })
      const pending = c.validateMe()
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError)
      await vi.advanceTimersByTimeAsync(5_000)
      await assertion
    }
    finally {
      vi.useRealTimers()
    }
  })
})
