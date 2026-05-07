import { describe, expect, it } from 'vitest'
import {
  ForbiddenError,
  isFolderJob,
  JenkinsError,
  NetworkError,
  NotFoundError,
  TimeoutError,
  UnauthorizedError,
} from '../src/jenkins/types'

describe('jenkins errors', () => {
  it('constructs JenkinsError with optional status', () => {
    const e = new JenkinsError('x', 500)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('x')
    expect(e.status).toBe(500)
    expect(e.name).toBe('JenkinsError')
  })

  it('unauthorizedError defaults message and sets 401', () => {
    const e = new UnauthorizedError()
    expect(e.status).toBe(401)
    expect(e.name).toBe('UnauthorizedError')
    expect(e.message).toContain('401')
  })

  it('specialized errors extend JenkinsError', () => {
    expect(new ForbiddenError()).toBeInstanceOf(JenkinsError)
    expect(new NotFoundError()).toBeInstanceOf(JenkinsError)
    expect(new TimeoutError()).toBeInstanceOf(JenkinsError)
    expect(new NetworkError()).toBeInstanceOf(JenkinsError)
  })
})

describe('isFolderJob', () => {
  it('detects Jenkins folder-ish _class markers', () => {
    expect(isFolderJob({ name: '', fullName: '', url: '', _class: 'com.cloudbees.hudson.plugins.folder.Folder' })).toBe(true)
    expect(isFolderJob({ name: '', fullName: '', url: '', _class: 'some.folder.type' })).toBe(true)
  })

  it('returns false when _class absent or unrelated', () => {
    expect(isFolderJob({ name: '', fullName: '', url: '' })).toBe(false)
    expect(isFolderJob({ name: '', fullName: '', url: '', _class: 'WorkflowJob' })).toBe(false)
  })
})
