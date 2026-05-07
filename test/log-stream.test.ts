import type { JenkinsClient } from '../src/jenkins/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeAllLogSessions, streamBuildLog } from '../src/services/log-stream'

describe('log-stream', () => {
  afterEach(() => {
    disposeAllLogSessions()
    vi.useRealTimers()
  })

  function makeClient(fetchProgressiveLog: JenkinsClient['fetchProgressiveLog']): JenkinsClient {
    return { fetchProgressiveLog } as JenkinsClient
  }

  it('streams progressive chunks then stops', async () => {
    vi.useFakeTimers()
    const fetchProgressiveLog = vi.fn()
      .mockResolvedValueOnce({ chunk: 'a', nextStart: 1, more: true })
      .mockResolvedValueOnce({ chunk: 'b', nextStart: 2, more: false })
    const append = vi.fn()
    const done = vi.fn()
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/1/', append, done)

    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(append).toHaveBeenCalledWith('a')

    await vi.advanceTimersByTimeAsync(1500)
    await Promise.resolve()
    expect(append).toHaveBeenCalledWith('b')
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('ends the stream when fetch throws', async () => {
    vi.useFakeTimers()
    const fetchProgressiveLog = vi.fn().mockRejectedValue(new Error('net'))
    const done = vi.fn()
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/2/', vi.fn(), done)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('skips appending empty chunks but keeps streaming', async () => {
    vi.useFakeTimers()
    const fetchProgressiveLog = vi.fn()
      .mockResolvedValueOnce({ chunk: '', nextStart: 20, more: true })
      .mockResolvedValueOnce({ chunk: 'visible', nextStart: 30, more: false })
    const append = vi.fn()
    const done = vi.fn()
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/8/', append, done)

    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(append).not.toHaveBeenCalledWith('')

    await vi.advanceTimersByTimeAsync(1500)
    await Promise.resolve()
    expect(append).toHaveBeenCalledWith('visible')
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('replaces an in-flight session for the same canonical build URL', async () => {
    vi.useFakeTimers()
    const fetchProgressiveLog = vi.fn()
    fetchProgressiveLog.mockReturnValueOnce(new Promise(() => {}) as Promise<any>)
    fetchProgressiveLog.mockResolvedValueOnce({ chunk: '', nextStart: 0, more: false })

    const done1 = vi.fn()
    const done2 = vi.fn()
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/9', vi.fn(), done1)
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/9/', vi.fn(), done2)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()
    expect(done1).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    await Promise.resolve()
    expect(done2).toHaveBeenCalledTimes(1)
  })

  it('disposeAllLogSessions clears active polling timers', () => {
    vi.useFakeTimers()
    const fetchProgressiveLog = vi.fn().mockImplementation(() => new Promise(() => {}))
    streamBuildLog(makeClient(fetchProgressiveLog), 'https://jenkins.test/job/x/4/', vi.fn(), vi.fn())
    vi.runOnlyPendingTimers()
    expect(fetchProgressiveLog).toHaveBeenCalled()
    disposeAllLogSessions()
    expect(() => disposeAllLogSessions()).not.toThrow()
  })
})
