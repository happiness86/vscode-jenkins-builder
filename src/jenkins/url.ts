/**
 * @see docs/TECHNICAL_DESIGN.md
 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function fullNameToUrlPath(fullName: string): string {
  return fullName
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `job/${encodeURIComponent(s)}`)
    .join('/')
}

export function jobWebUrl(baseUrl: string, fullName: string): string {
  const b = normalizeBaseUrl(baseUrl)
  return `${b}/${fullNameToUrlPath(fullName)}/`
}

export function progressiveTextUrl(buildUrl: string, start: number): string {
  const u = buildUrl.endsWith('/') ? buildUrl : `${buildUrl}/`
  return `${u}logText/progressiveText?start=${start}`
}
