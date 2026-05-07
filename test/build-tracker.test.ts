import type { JenkinsClient } from '../src/jenkins/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JenkinsError } from '../src/jenkins/types'
import { BuildTracker } from '../src/services/build-tracker'

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showWarningMessage: vi.fn(),
}))

vi.mock('vscode', () => ({
  Uri: {
    parse: (s: string) => ({
      fsPath: s,
      toString: () => s,
    }),
  },
  env: { openExternal: mocks.openExternal },
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
    showWarningMessage: mocks.showWarningMessage,
  },
}))

const {
  openExternal,
  showErrorMessage,
  showInformationMessage,
  showWarningMessage,
} = mocks

describe('buildTracker', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  function clientFrom(getBuildApi: JenkinsClient['getBuildApi']): JenkinsClient {
    return { getBuildApi } as JenkinsClient
  }

  it('waits until the build stops then opens log when prompted', async () => {
    vi.useFakeTimers()
    showInformationMessage.mockResolvedValueOnce('View Log' as any)

    const getBuildApi = vi.fn()
      .mockResolvedValueOnce({
        building: true,
        result: null,
        duration: 0,
        number: 9,
        url: 'u',
      })
      .mockResolvedValueOnce({
        building: false,
        result: 'SUCCESS',
        duration: 65_000,
        number: 9,
        url: 'https://jenkins.test/job/foo/9/',
      })

    const openLog = vi.fn()
    const onBuildFinished = vi.fn()
    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog,
      onBuildFinished,
    })

    tracker.track('https://jenkins.test/job/foo/9/', 'foo', 9)
    await vi.advanceTimersByTimeAsync(1)
    expect(getBuildApi).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    await vi.advanceTimersByTimeAsync(1)
    expect(getBuildApi).toHaveBeenCalledTimes(2)
    await vi.runOnlyPendingTimersAsync()

    expect(onBuildFinished).toHaveBeenCalledTimes(1)
    expect(showInformationMessage).toHaveBeenCalledTimes(1)
    expect(openLog).toHaveBeenCalledWith(
      'https://jenkins.test/job/foo/9/',
      'foo #9',
    )
  })

  it('shows error toast for failures with optional browser action', async () => {
    vi.useFakeTimers()
    showErrorMessage.mockResolvedValueOnce('Open in Browser' as any)
    const getBuildApi = vi.fn().mockResolvedValueOnce({
      building: false,
      result: 'FAILURE',
      duration: 6100,
      number: 3,
      url: 'https://jenkins/job/x/3/',
    })

    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })

    tracker.track('https://jenkins/job/x/3/', 'x', 3)
    await vi.runOnlyPendingTimersAsync()
    expect(showErrorMessage).toHaveBeenCalled()
    await vi.runOnlyPendingTimersAsync()

    expect(openExternal).toHaveBeenCalledTimes(1)
  })

  it('routes error dialog "View Log" to openLog for failed builds', async () => {
    vi.useFakeTimers()
    showErrorMessage.mockResolvedValueOnce('View Log' as any)
    const getBuildApi = vi.fn().mockResolvedValueOnce({
      building: false,
      result: 'FAILURE',
      duration: 900,
      number: 77,
      url: 'u',
    })

    const openLog = vi.fn()
    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog,
    })
    tracker.track('https://jenkins/job/fail/77/', 'fail', 77)
    await vi.runOnlyPendingTimersAsync()
    expect(openLog).toHaveBeenCalledWith('https://jenkins/job/fail/77/', 'fail #77')
  })

  it('ignores late poll updates after dispose()', async () => {
    vi.useFakeTimers()
    let release!: (v: Record<string, unknown>) => void
    const gate = new Promise<Record<string, unknown>>((resolve) => {
      release = resolve
    })

    const getBuildApi = vi.fn().mockImplementationOnce(async () => {
      const info = await gate
      return info
    })

    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })

    tracker.track('https://jenkins/job/d/1/', 'd', 1)
    await vi.runOnlyPendingTimersAsync()
    tracker.dispose()
    release({
      building: false,
      result: 'SUCCESS',
      duration: 0,
      number: 1,
      url: 'u',
    })
    await vi.runOnlyPendingTimersAsync()
    expect(showInformationMessage).not.toHaveBeenCalled()
  })

  it('skips toast when notifications are off or failures-only mode observes success', async () => {
    vi.useFakeTimers()
    showInformationMessage.mockReset()
    const success = vi.fn().mockResolvedValueOnce({
      building: false,
      result: 'SUCCESS',
      duration: 0,
      number: 1,
      url: 'u',
    })

    const off = new BuildTracker({
      getClient: () => clientFrom(success),
      getNotifyMode: () => 'off',
      openLog: vi.fn(),
    })
    off.track('https://jenkins/job/off/1/', 'off', 1)
    await vi.runOnlyPendingTimersAsync()
    expect(showInformationMessage).not.toHaveBeenCalled()

    const failureOnly = new BuildTracker({
      getClient: () => clientFrom(success),
      getNotifyMode: () => 'failureOnly',
      openLog: vi.fn(),
    })
    failureOnly.track('https://jenkins/job/off/2/', 'off', 2)
    await vi.runOnlyPendingTimersAsync()
    expect(showInformationMessage).not.toHaveBeenCalled()
    expect(showErrorMessage).not.toHaveBeenCalled()
  })

  it('fires failure toast in failure-only mode', async () => {
    vi.useFakeTimers()
    const getBuildApi = vi.fn().mockResolvedValueOnce({
      building: false,
      result: 'UNSTABLE',
      duration: 2000,
      number: 2,
      url: 'u',
    })

    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'failureOnly',
      openLog: vi.fn(),
    })
    tracker.track('https://jenkins/job/u/2/', 'u', 2)
    await vi.runOnlyPendingTimersAsync()
    expect(showErrorMessage).toHaveBeenCalledTimes(1)
  })

  it('uses information toast for ABORTED results', async () => {
    vi.useFakeTimers()
    const getBuildApi = vi.fn().mockResolvedValueOnce({
      building: false,
      result: 'ABORTED',
      duration: -1,
      number: 4,
      url: 'u',
    })

    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })
    tracker.track('https://jenkins/job/ab/4/', 'ab', 4)
    await vi.runOnlyPendingTimersAsync()
    expect(showInformationMessage).toHaveBeenCalledTimes(1)
  })

  it('shows warning when polling fails with JenkinsError', async () => {
    vi.useFakeTimers()
    const getBuildApi = vi.fn().mockRejectedValueOnce(new JenkinsError('broken'))
    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })
    tracker.track('https://jenkins/job/err/9/', 'err', 9)
    await vi.runOnlyPendingTimersAsync()
    expect(showWarningMessage).toHaveBeenCalled()
  })

  it('silently exits when Jenkins client disappears', async () => {
    vi.useFakeTimers()
    const tracker = new BuildTracker({
      getClient: () => null,
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })
    tracker.track('https://jenkins/job/missing/', 'missing', 1)
    await vi.runOnlyPendingTimersAsync()
    expect(showInformationMessage).not.toHaveBeenCalled()
  })

  it('ignores non-Jenkins errors quietly', async () => {
    vi.useFakeTimers()
    const getBuildApi = vi.fn().mockRejectedValueOnce(new Error('boom'))
    const tracker = new BuildTracker({
      getClient: () => clientFrom(getBuildApi),
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })
    tracker.track('https://jenkins/job/g/11/', 'g', 11)
    await vi.runOnlyPendingTimersAsync()
    expect(showWarningMessage).not.toHaveBeenCalled()
  })

  it('dispose is safe when called multiple times', () => {
    const tracker = new BuildTracker({
      getClient: () => null,
      getNotifyMode: () => 'always',
      openLog: vi.fn(),
    })
    tracker.dispose()
    tracker.dispose()
  })
})
