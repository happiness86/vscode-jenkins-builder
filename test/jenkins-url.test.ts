import { describe, expect, it } from 'vitest'
import {
  fullNameToUrlPath,
  jobWebUrl,
  normalizeBaseUrl,
  progressiveTextUrl,
} from '../src/jenkins/url'

describe('normalizeBaseUrl', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  https://jenkins.example.com///  ')).toBe('https://jenkins.example.com')
  })

  it('handles empty-ish input', () => {
    expect(normalizeBaseUrl('')).toBe('')
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('fullNameToUrlPath', () => {
  it('escapes segments and skips empty path parts', () => {
    expect(fullNameToUrlPath('team/folder/job')).toBe('job/team/job/folder/job/job')
    expect(fullNameToUrlPath('a//b')).toBe('job/a/job/b')
    expect(fullNameToUrlPath('name with space')).toBe('job/name%20with%20space')
  })

  it('returns empty string for empty fullName', () => {
    expect(fullNameToUrlPath('')).toBe('')
    expect(fullNameToUrlPath('   ')).toBe('')
  })
})

describe('jobWebUrl', () => {
  it('joins normalized base with encoded job path', () => {
    expect(jobWebUrl('https://j.example.com/', 'x/y')).toBe('https://j.example.com/job/x/job/y/')
  })
})

describe('progressiveTextUrl', () => {
  it('appends progressive log endpoint with start offset', () => {
    expect(progressiveTextUrl('https://j/job/x/1', 100)).toBe(
      'https://j/job/x/1/logText/progressiveText?start=100',
    )
    expect(progressiveTextUrl('https://j/job/x/1/', 0)).toBe(
      'https://j/job/x/1/logText/progressiveText?start=0',
    )
  })
})
