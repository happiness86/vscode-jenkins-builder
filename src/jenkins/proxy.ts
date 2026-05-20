/**
 * 代理解析与 undici dispatcher 构造。
 *
 * 背景：Electron 39+/Node 22 内置的全局 `fetch`（undici 实现）不读 VSCode 的
 * `http.proxy` 设置，也不读 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量；扩展必须显式
 * 注入 `dispatcher`，否则在企业代理环境下统一表现为 `fetch failed`。
 *
 * @see docs/TECHNICAL_DESIGN.md §4.1 代理
 */
import process from 'node:process'

export interface ProxyResolution {
  /** 解析后的代理 URL（含 schema），未配置时为 undefined */
  proxyUrl: string | undefined
  /** 来源，便于日志/排查 */
  source: 'extension' | 'vscode' | 'env' | 'none'
  /** 是否校验 TLS 证书；false 时禁用证书校验（仅对扩展 fetch 生效） */
  strictSSL: boolean
  /** 解析自 NO_PROXY 的主机后缀列表（小写、去点） */
  noProxy: string[]
}

export interface ProxyResolveInput {
  /** 扩展级覆盖，优先级最高（jenkinsBuilder.proxy） */
  extensionProxy?: string
  /** VSCode 全局 http.proxy */
  vscodeProxy?: string
  /** VSCode 全局 http.proxyStrictSSL，默认 true */
  vscodeStrictSSL?: boolean
  /** 扩展级 strictSSL 覆盖（undefined 表示沿用 VSCode） */
  extensionStrictSSL?: boolean
  /** 进程环境变量快照（便于测试） */
  env?: NodeJS.ProcessEnv
}

const ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

export function resolveProxy(input: ProxyResolveInput = {}): ProxyResolution {
  const env = input.env ?? (typeof process !== 'undefined' ? process.env : {})

  const strictSSL = input.extensionStrictSSL ?? input.vscodeStrictSSL ?? true

  const fromExt = trimOrUndefined(input.extensionProxy)
  if (fromExt)
    return { proxyUrl: fromExt, source: 'extension', strictSSL, noProxy: parseNoProxy(env) }

  const fromVscode = trimOrUndefined(input.vscodeProxy)
  if (fromVscode)
    return { proxyUrl: fromVscode, source: 'vscode', strictSSL, noProxy: parseNoProxy(env) }

  for (const key of ENV_KEYS) {
    const v = trimOrUndefined(env[key])
    if (v)
      return { proxyUrl: v, source: 'env', strictSSL, noProxy: parseNoProxy(env) }
  }

  return { proxyUrl: undefined, source: 'none', strictSSL, noProxy: parseNoProxy(env) }
}

function trimOrUndefined(v: string | undefined): string | undefined {
  if (typeof v !== 'string')
    return undefined
  const t = v.trim()
  return t || undefined
}

export function parseNoProxy(env: NodeJS.ProcessEnv): string[] {
  const raw = env.NO_PROXY ?? env.no_proxy ?? ''
  return raw
    .split(',')
    .map(s => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean)
}

/** 简化版 no_proxy 匹配：精确主机或主机后缀；`*` 视为全通配。 */
export function shouldBypassProxy(targetUrl: string, noProxy: string[]): boolean {
  if (!noProxy.length)
    return false
  let host: string
  try {
    host = new URL(targetUrl).hostname.toLowerCase()
  }
  catch {
    return false
  }
  for (const rule of noProxy) {
    if (rule === '*')
      return true
    if (host === rule)
      return true
    if (host.endsWith(`.${rule}`))
      return true
  }
  return false
}

/** 隐藏代理 URL 中的凭证，便于日志输出。 */
export function maskProxyUrl(url: string | undefined): string {
  if (!url)
    return '(none)'
  try {
    const u = new URL(url)
    if (u.username || u.password) {
      u.username = '***'
      u.password = ''
    }
    return u.toString().replace(/\/+$/, '')
  }
  catch {
    return url
  }
}

export interface UndiciLike {
  ProxyAgent: new (opts: {
    uri: string
    requestTls?: { rejectUnauthorized?: boolean }
    proxyTls?: { rejectUnauthorized?: boolean }
  }) => unknown
  Agent: new (opts: {
    connect?: { rejectUnauthorized?: boolean }
  }) => unknown
}

export type UndiciLoader = () => UndiciLike | undefined

/**
 * 根据解析结果构造一个 undici Dispatcher。
 *
 * - 有代理 → ProxyAgent（requestTls/proxyTls 均按 strictSSL 配置）
 * - 无代理但 strictSSL=false → 普通 Agent（connect.rejectUnauthorized=false），
 *   保证直连自签/内部 CA 的 Jenkins 时也能跳过证书校验
 * - 无代理且 strictSSL=true → undefined（使用默认 fetch 行为）
 *
 * 默认通过动态 require 加载（运行时由 Electron/Node 内置提供），测试可注入 loader。
 */
export function buildDispatcher(res: ProxyResolution, loader: UndiciLoader = defaultLoadUndici): unknown | undefined {
  if (res.proxyUrl) {
    const undici = loader()
    if (!undici)
      return undefined
    return new undici.ProxyAgent({
      uri: res.proxyUrl,
      requestTls: { rejectUnauthorized: res.strictSSL },
      proxyTls: { rejectUnauthorized: res.strictSSL },
    })
  }

  if (!res.strictSSL) {
    const undici = loader()
    if (!undici)
      return undefined
    return new undici.Agent({
      connect: { rejectUnauthorized: false },
    })
  }

  return undefined
}

// 绕过 rolldown/tsdown 的静态分析，防止 require('undici') 被 tree-shake 或内联
const _require: NodeRequire = typeof globalThis.require === 'function'
  ? globalThis.require

  : require

function defaultLoadUndici(): UndiciLike | undefined {
  for (const id of ['undici', 'node:undici']) {
    try {
      return _require(id) as UndiciLike
    }
    catch { /* continue */ }
  }
  return undefined
}
