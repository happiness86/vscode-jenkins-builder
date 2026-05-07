import type { JenkinsClient } from '../jenkins/client'
import { env, Uri, window } from 'vscode'
import { JenkinsError } from '../jenkins/types'

export type NotifyMode = 'always' | 'failureOnly' | 'off'

export interface BuildTrackerDeps {
  getClient: () => JenkinsClient | null
  getNotifyMode: () => NotifyMode
  openLog: (buildUrl: string, label: string) => void
  /** Called as soon as the build leaves `building` (before notifications, which may block on user input). */
  onBuildFinished?: () => void | Promise<void>
}

function formatDuration(ms: number): string {
  if (ms <= 0)
    return '0s'
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m${r}s` : `${r}s`
}

export class BuildTracker {
  private readonly tracked = new Map<string, { notified: boolean }>()
  private readonly deps: BuildTrackerDeps

  constructor(deps: BuildTrackerDeps) {
    this.deps = deps
  }

  track(buildUrl: string, jobFullName: string, buildNumber: number): void {
    const key = `${buildUrl.replace(/\/?$/, '/')}`
    this.tracked.set(key, { notified: false })

    const poll = async () => {
      try {
        const cli = this.deps.getClient()
        if (!cli)
          return
        const info = await cli.getBuildApi(buildUrl)
        if (info.building) {
          setTimeout(poll, 2000)
          return
        }

        const entry = this.tracked.get(key)
        if (!entry || entry.notified)
          return
        entry.notified = true

        await this.deps.onBuildFinished?.()

        const result = (info.result ?? 'UNKNOWN').toUpperCase()
        const label = `${jobFullName} #${buildNumber}`
        const dur = formatDuration(info.duration)
        const msg = `Jenkins ${label} · ${result} · ${dur}`

        const mode = this.deps.getNotifyMode()
        if (mode === 'off')
          return

        const shouldNotify
          = mode === 'always'
            || (mode === 'failureOnly' && result !== 'SUCCESS')

        if (!shouldNotify)
          return

        const actions = ['View Log']
        if (result === 'FAILURE' || result === 'UNSTABLE')
          actions.push('Open in Browser')

        const pick = result === 'SUCCESS' || result === 'ABORTED'
          ? await window.showInformationMessage(msg, ...actions)
          : await window.showErrorMessage(msg, ...actions)

        if (pick === 'View Log')
          this.deps.openLog(buildUrl, `${jobFullName} #${buildNumber}`)
        if (pick === 'Open in Browser')
          await env.openExternal(Uri.parse(buildUrl))
      }
      catch (e) {
        if (e instanceof JenkinsError) {
          void window.showWarningMessage(`Jenkins build tracker: ${e.message}`)
        }
      }
    }

    void poll()
  }

  dispose(): void {
    this.tracked.clear()
  }
}
