import type {
  JenkinsBuildRef,
  JenkinsJobRef,
} from './types'
import { Buffer } from 'node:buffer'
import {
  ForbiddenError,
  JenkinsError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnauthorizedError,
} from './types'
import { fullNameToUrlPath, normalizeBaseUrl, progressiveTextUrl } from './url'

export interface JenkinsClientOptions {
  baseUrl: string
  username: string
  apiToken: string
}

export interface QueueItemJson {
  executable?: { number: number, url: string }
  cancelled?: boolean
}

export interface BuildApiJson {
  building: boolean
  result: string | null
  duration: number
  number: number
  url: string
}

const JSON_ACCEPT = 'application/json'

export class JenkinsClient {
  private readonly base: string
  private readonly authHeader: string

  constructor(opts: JenkinsClientOptions) {
    this.base = normalizeBaseUrl(opts.baseUrl)
    const raw = `${opts.username}:${opts.apiToken}`
    this.authHeader = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
  }

  private mapStatus(status: number, fallbackMsg: string): JenkinsError {
    if (status === 401)
      return new UnauthorizedError()
    if (status === 403)
      return new ForbiddenError()
    if (status === 404)
      return new NotFoundError()
    return new JenkinsError(fallbackMsg, status)
  }

  private async fetchRaw(pathOrUrl: string, init: RequestInit = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    try {
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: this.authHeader,
          ...init.headers,
        },
      })
    }
    catch (e: any) {
      if (e?.name === 'AbortError')
        throw new TimeoutError()
      throw new NetworkError(e?.message ?? 'fetch failed')
    }
    finally {
      clearTimeout(timer)
    }
  }

  async fetchJson<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchRaw(pathOrUrl, {
      ...init,
      headers: {
        Accept: JSON_ACCEPT,
        ...init.headers,
      },
    })
    if (!res.ok)
      throw this.mapStatus(res.status, await res.text())

    return res.json() as Promise<T>
  }

  async fetchText(pathOrUrl: string, init: RequestInit = {}): Promise<{ text: string, res: Response }> {
    const res = await this.fetchRaw(pathOrUrl, init)
    if (!res.ok)
      throw this.mapStatus(res.status, await res.text())
    const text = await res.text()
    return { text, res }
  }

  async validateMe(): Promise<void> {
    await this.fetchJson(`${this.base}/me/api/json`)
  }

  async listRootJobs(limit = 200): Promise<JenkinsJobRef[]> {
    const tree = `jobs[name,fullName,url,color,_class]{0,${limit}}`
    const data = await this.fetchJson<{ jobs?: JenkinsJobRef[] }>(
      `${this.base}/api/json?tree=${encodeURIComponent(tree)}`,
    )
    return data.jobs ?? []
  }

  async listChildJobs(parentFullName: string, limit = 200): Promise<JenkinsJobRef[]> {
    const path = fullNameToUrlPath(parentFullName)
    const tree = `jobs[name,fullName,url,color,_class]{0,${limit}}`
    const data = await this.fetchJson<{ jobs?: JenkinsJobRef[] }>(
      `${this.base}/${path}/api/json?tree=${encodeURIComponent(tree)}`,
    )
    return data.jobs ?? []
  }

  async getRecentBuilds(jobFullName: string, limit: number): Promise<JenkinsBuildRef[]> {
    const path = fullNameToUrlPath(jobFullName)
    const tree = `builds[number,url,result,duration,timestamp,building]{0,${limit}}`
    const data = await this.fetchJson<{ builds?: JenkinsBuildRef[] }>(
      `${this.base}/${path}/api/json?tree=${encodeURIComponent(tree)}`,
    )
    return data.builds ?? []
  }

  async getJobColor(jobFullName: string): Promise<string | undefined> {
    const path = fullNameToUrlPath(jobFullName)
    const data = await this.fetchJson<{ color?: string }>(
      `${this.base}/${path}/api/json?tree=color`,
    )
    return data.color
  }

  /** Latest build on this job; `null` if the job has never run. */
  async getLastBuildBrief(jobFullName: string): Promise<{ building: boolean, number: number } | null> {
    const path = fullNameToUrlPath(jobFullName)
    const tree = 'lastBuild[building,number]'
    const data = await this.fetchJson<{ lastBuild?: { building?: boolean, number?: number } | null }>(
      `${this.base}/${path}/api/json?tree=${encodeURIComponent(tree)}`,
    )
    const lb = data.lastBuild
    if (lb == null || lb.number == null)
      return null
    return { building: Boolean(lb.building), number: lb.number }
  }

  async triggerParameterizedBuild(
    jobFullName: string,
    branchParam: string,
    branchValue: string,
  ): Promise<string> {
    const path = fullNameToUrlPath(jobFullName)
    const q = new URLSearchParams({ [branchParam]: branchValue })
    const url = `${this.base}/${path}/buildWithParameters?${q.toString()}`
    const res = await this.fetchRaw(url, { method: 'POST', headers: { Accept: '*/*' } })

    if (res.status === 201 || res.status === 200) {
      const loc = res.headers.get('location')
      if (!loc)
        throw new JenkinsError('No Location header from Jenkins after trigger', res.status)
      return this.resolveUrl(loc)
    }

    const body = await res.text().catch(() => '')
    throw this.mapStatus(res.status, body || 'Trigger failed')
  }

  async pollQueueUntilExecutable(queueItemUrl: string): Promise<{ number: number, url: string }> {
    const api = queueItemUrl.endsWith('/api/json')
      ? queueItemUrl
      : `${queueItemUrl.replace(/\/+$/, '')}/api/json`
    for (let i = 0; i < 240; i++) {
      const data = await this.fetchJson<QueueItemJson>(api)
      if (data.cancelled)
        throw new JenkinsError('Build was cancelled in queue')
      if (data.executable?.url && data.executable.number != null) {
        let u = data.executable.url
        if (!u.startsWith('http'))
          u = this.resolveUrl(u)
        return { number: data.executable.number, url: u.endsWith('/') ? u : `${u}/` }
      }
      await sleep(500)
    }
    throw new JenkinsError('Timed out waiting for Jenkins queue')
  }

  async getBuildApi(buildUrl: string): Promise<BuildApiJson> {
    const u = buildUrl.endsWith('/') ? buildUrl : `${buildUrl}/`
    return this.fetchJson<BuildApiJson>(`${u}api/json`)
  }

  async stopBuild(buildUrl: string): Promise<void> {
    const u = buildUrl.endsWith('/') ? buildUrl : `${buildUrl}/`
    const res = await this.fetchRaw(`${u}stop`, {
      method: 'POST',
      headers: { Accept: '*/*' },
    })
    if (!res.ok && res.status !== 302)
      throw this.mapStatus(res.status, await res.text())
  }

  async fetchProgressiveLog(buildUrl: string, start: number): Promise<{ chunk: string, nextStart: number, more: boolean }> {
    const url = progressiveTextUrl(buildUrl, start)
    const { text, res } = await this.fetchText(url, { headers: { Accept: 'text/plain' } })
    const nextHeader = res.headers.get('x-text-size')
    const more = res.headers.get('x-more-data') === 'true'
    const nextStart = nextHeader ? Number.parseInt(nextHeader, 10) : start + text.length
    return { chunk: text, nextStart, more }
  }

  async searchSuggest(query: string): Promise<string[]> {
    if (!query.trim())
      return []
    try {
      const url = `${this.base}/search/suggest?query=${encodeURIComponent(query)}`
      const res = await this.fetchRaw(url, { headers: { Accept: JSON_ACCEPT } })
      if (!res.ok)
        return []
      const data = await res.json() as unknown
      if (Array.isArray(data))
        return data.map(x => String(x)).filter(Boolean)

      if (data && typeof data === 'object' && Array.isArray((data as any).suggestions))
        return (data as any).suggestions.map((x: any) => String(x?.name ?? x)).filter(Boolean)
    }
    catch {
      /* suggest not available */
    }
    return []
  }

  private resolveUrl(location: string): string {
    try {
      return new URL(location).toString()
    }
    catch {
      return new URL(location, `${this.base}/`).toString()
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
