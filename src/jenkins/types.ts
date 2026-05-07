export interface JenkinsJobRef {
  name: string
  fullName: string
  url: string
  color?: string
  _class?: string
}

export interface JenkinsBuildRef {
  number: number
  url: string
  result: string | null
  duration: number
  timestamp: number
  building?: boolean
}

export class JenkinsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'JenkinsError'
  }
}

export class UnauthorizedError extends JenkinsError {
  constructor(message = 'Unauthorized (401)') {
    super(message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends JenkinsError {
  constructor(message = 'Forbidden (403)') {
    super(message, 403)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends JenkinsError {
  constructor(message = 'Not found (404)') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}

export class TimeoutError extends JenkinsError {
  constructor(message = 'Request timeout') {
    super(message, 408)
    this.name = 'TimeoutError'
  }
}

export class NetworkError extends JenkinsError {
  constructor(message = 'Network error') {
    super(message)
    this.name = 'NetworkError'
  }
}

export function isFolderJob(job: JenkinsJobRef): boolean {
  return Boolean(job._class?.includes('Folder') || job._class?.includes('folder'))
}
