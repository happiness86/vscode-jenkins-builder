import type { ExtensionContext } from 'vscode'
import type { NotifyMode } from './services/build-tracker'
import type { JenkinsTreeNode } from './tree/helpers'
import {
  computed,
  defineExtension,
  defineLogger,
  ref,
  shallowRef,
  useCommand,
  useStatusBarItem,
  useTreeView,
} from 'reactive-vscode'
import {
  commands,
  ConfigurationTarget,
  env,
  StatusBarAlignment,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
} from 'vscode'
import { SECRET_API_TOKEN_KEY } from './constants'
import { getCurrentGitBranch } from './git-branch'
import { JenkinsClient } from './jenkins/client'
import {
  JenkinsError,
  UnauthorizedError,
} from './jenkins/types'
import { BuildTracker } from './services/build-tracker'
import { disposeAllLogSessions, streamBuildLog } from './services/log-stream'
import { bindJobTreeNode, buildTreeNode, errorTreeNode, jobColorIcon, loadAllJobsRoots, signInTreeNode } from './tree/helpers'

const logger = defineLogger('Jenkins Builder')

export const { activate, deactivate } = defineExtension((context: ExtensionContext) => {
  const clientRef = shallowRef<JenkinsClient | null>(null)
  const usernameRef = ref('')
  const currentProjectRoots = ref<JenkinsTreeNode[]>([signInTreeNode()])
  const allJobsRoots = ref<JenkinsTreeNode[]>([])
  const triggerBusy = ref(false)
  const triggerLabel = ref('')
  const triggerInProgress = ref(false)

  const wf = workspace.workspaceFolders?.[0]

  function getCfg(resource = wf?.uri) {
    return workspace.getConfiguration('jenkinsBuilder', resource)
  }

  async function setSignedIn(v: boolean) {
    await commands.executeCommand('setContext', 'jenkinsBuilder.signedIn', v)
  }

  async function setHasProjectJob(v: boolean) {
    await commands.executeCommand('setContext', 'jenkinsBuilder.hasProjectJob', v)
  }

  async function refreshProjectJobContext() {
    const job = getCfg().get<string>('projectJob', '').trim()
    await setHasProjectJob(Boolean(job))
  }

  async function createClient(): Promise<JenkinsClient | null> {
    const cfg = getCfg()
    const baseUrl = cfg.get<string>('baseUrl', '').trim()
    const username = cfg.get<string>('username', '').trim()
    const token = await context.secrets.get(SECRET_API_TOKEN_KEY)
    if (!baseUrl || !username || !token)
      return null
    return new JenkinsClient({ baseUrl, username, apiToken: token })
  }

  function openBuildLog(buildUrl: string, label: string) {
    const c = clientRef.value
    if (!c)
      return
    const ch = window.createOutputChannel(`Jenkins: ${label}`)
    ch.clear()
    ch.show(true)
    streamBuildLog(c, buildUrl, t => ch.append(t), () => {
      logger.debug(`Log stream finished for ${label}`)
    })
    context.subscriptions.push({ dispose: () => ch.dispose() })
  }

  async function refreshClientFromSecrets() {
    const c = await createClient()
    clientRef.value = c
    usernameRef.value = c ? getCfg().get('username', '') : ''
    await setSignedIn(Boolean(c))
    await refreshProjectJobContext()
  }

  async function validateAndRefresh() {
    const c = await createClient()
    if (!c) {
      clientRef.value = null
      await setSignedIn(false)
      return
    }
    try {
      await c.validateMe()
      clientRef.value = c
      await setSignedIn(true)
    }
    catch (e) {
      if (e instanceof UnauthorizedError) {
        await context.secrets.delete(SECRET_API_TOKEN_KEY)
        clientRef.value = null
        await setSignedIn(false)
        void window.showWarningMessage('Jenkins token invalid or expired. Please sign in again.')
      }
      else {
        void window.showErrorMessage(e instanceof Error ? e.message : 'Jenkins validation failed')
      }
    }
  }

  async function rebuildCurrentProject() {
    const c = clientRef.value
    if (!c) {
      currentProjectRoots.value = [signInTreeNode()]
      return
    }

    const job = getCfg().get<string>('projectJob', '').trim()
    if (!job) {
      currentProjectRoots.value = [bindJobTreeNode()]
      return
    }

    try {
      const limit = getCfg().get<number>('recentBuildCount', 10)
      const color = await c.getJobColor(job)
      const builds = await c.getRecentBuilds(job, limit)
      const jobItem = new TreeItem(job, TreeItemCollapsibleState.Expanded)
      jobItem.iconPath = jobColorIcon(color)
      currentProjectRoots.value = [{
        id: `pj:${job}`,
        treeItem: jobItem,
        children: builds.map(b => buildTreeNode(job, b)),
      }]
    }
    catch (e) {
      currentProjectRoots.value = [
        errorTreeNode(e instanceof Error ? e.message : 'Failed to load job'),
      ]
    }
  }

  async function rebuildAllJobs() {
    const c = clientRef.value
    if (!c) {
      allJobsRoots.value = [signInTreeNode()]
      return
    }
    try {
      const limit = getCfg().get<number>('recentBuildCount', 10)
      allJobsRoots.value = await loadAllJobsRoots(c, limit)
    }
    catch (e) {
      allJobsRoots.value = [
        errorTreeNode(e instanceof Error ? e.message : 'Failed to list jobs'),
      ]
    }
  }

  async function refreshAll() {
    await refreshProjectJobContext()
    await rebuildCurrentProject()
    await rebuildAllJobs()
  }

  const buildTracker = new BuildTracker({
    getClient: () => clientRef.value,
    getNotifyMode: () => getCfg().get<NotifyMode>('notifyOnFinish', 'always') ?? 'always',
    openLog: openBuildLog,
    async onBuildFinished() {
      await rebuildCurrentProject()
      await rebuildAllJobs()
    },
  })

  let pollTimer: ReturnType<typeof setInterval> | undefined
  function restartRefreshTimer() {
    if (pollTimer)
      clearInterval(pollTimer)
    pollTimer = undefined
    const sec = getCfg().get<number>('refreshIntervalSec', 30)
    if (sec <= 0)
      return
    pollTimer = setInterval(() => {
      void rebuildCurrentProject()
      void rebuildAllJobs()
    }, sec * 1000)
  }

  useTreeView('jenkinsBuilder.currentProject', currentProjectRoots, {
    showCollapseAll: true,
  })

  useTreeView('jenkinsBuilder.allJobs', allJobsRoots, {
    showCollapseAll: true,
  })

  useStatusBarItem({
    alignment: StatusBarAlignment.Left,
    priority: 80,
    text: computed(() =>
      clientRef.value
        ? `$(key) Jenkins (${usernameRef.value || 'signed in'})`
        : '$(key) Jenkins: Sign in',
    ),
    tooltip: 'Jenkins Builder account',
    command: computed(() =>
      clientRef.value ? 'jenkinsBuilder.signOut' : 'jenkinsBuilder.signIn',
    ),
  })

  let lastStatusBuild: { url: string, label: string } | null = null

  useStatusBarItem({
    id: 'jenkinsBuilder.trigger',
    alignment: StatusBarAlignment.Right,
    priority: 10000,
    text: triggerLabel,
    visible: triggerBusy,
    command: 'jenkinsBuilder.openLastStatusBuild',
  })

  useCommand('jenkinsBuilder.openLastStatusBuild', () => {
    if (lastStatusBuild)
      openBuildLog(lastStatusBuild.url, lastStatusBuild.label)
  })

  void (async () => {
    const token = await context.secrets.get(SECRET_API_TOKEN_KEY)
    if (token) {
      await setSignedIn(true)
      await validateAndRefresh().catch(() => {})
    }
    else {
      await setSignedIn(false)
    }
    await refreshProjectJobContext()
    restartRefreshTimer()
    await refreshAll()
  })()

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('jenkinsBuilder.refreshIntervalSec'))
        restartRefreshTimer()
      if (e.affectsConfiguration('jenkinsBuilder'))
        void refreshProjectJobContext().then(() => refreshAll())
    }),
  )

  useCommand('jenkinsBuilder.signIn', async () => {
    const baseUrl = await window.showInputBox({
      prompt: 'Jenkins base URL',
      placeHolder: 'https://jenkins.example.com',
      value: getCfg().get('baseUrl', ''),
    })
    if (baseUrl == null)
      return
    const username = await window.showInputBox({
      prompt: 'Jenkins username',
      value: getCfg().get('username', ''),
    })
    if (username == null)
      return
    const apiToken = await window.showInputBox({
      prompt: 'Jenkins API token',
      password: true,
      ignoreFocusOut: true,
    })
    if (apiToken == null)
      return

    await getCfg().update('baseUrl', baseUrl.trim(), ConfigurationTarget.Global)
    await getCfg().update('username', username.trim(), ConfigurationTarget.Global)
    await context.secrets.store(SECRET_API_TOKEN_KEY, apiToken)
    await refreshClientFromSecrets()
    const c = clientRef.value
    if (!c)
      return
    try {
      await c.validateMe()
      void window.showInformationMessage('Signed in to Jenkins.')
    }
    catch (e) {
      await context.secrets.delete(SECRET_API_TOKEN_KEY)
      clientRef.value = null
      await setSignedIn(false)
      void window.showErrorMessage(e instanceof Error ? e.message : 'Sign-in failed')
      return
    }
    await refreshAll()
  })

  useCommand('jenkinsBuilder.signOut', async () => {
    await context.secrets.delete(SECRET_API_TOKEN_KEY)
    clientRef.value = null
    await setSignedIn(false)
    usernameRef.value = ''
    await refreshAll()
  })

  useCommand('jenkinsBuilder.refreshViews', async () => {
    await validateAndRefresh()
    await refreshAll()
  })

  useCommand('jenkinsBuilder.bindJob', async () => {
    const c = clientRef.value
    if (!c) {
      void window.showWarningMessage('Sign in first.')
      return
    }
    const picked = await pickJobFullName(c)
    if (!picked)
      return
    await getCfg().update('projectJob', picked.trim(), ConfigurationTarget.Workspace)
    await refreshProjectJobContext()
    await rebuildCurrentProject()
    void window.showInformationMessage(`Bound workspace job to "${picked}".`)
  })

  useCommand('jenkinsBuilder.searchJobs', async () => {
    const c = clientRef.value
    if (!c) {
      void window.showWarningMessage('Sign in first.')
      return
    }
    const picked = await pickJobFullName(c)
    if (picked)
      void window.showInformationMessage(`Selected job: ${picked}`)
  })

  useCommand('jenkinsBuilder.viewBuildLog', async (...args: unknown[]) => {
    let buildUrl: string | undefined
    let label: string | undefined
    const a0 = args[0]
    if (typeof a0 === 'string' && typeof args[1] === 'string') {
      buildUrl = a0
      label = args[1] as string
    }
    else if (a0 && typeof a0 === 'object' && 'buildUrl' in a0) {
      const n = a0 as JenkinsTreeNode
      buildUrl = n.buildUrl
      label = n.buildLabel
    }
    if (typeof buildUrl === 'string' && typeof label === 'string')
      openBuildLog(buildUrl, label)
  })

  useCommand('jenkinsBuilder.stopBuild', async (...args: unknown[]) => {
    const a0 = args[0]
    let buildUrl: string | undefined
    if (typeof a0 === 'string')
      buildUrl = a0
    else if (a0 && typeof a0 === 'object' && 'buildUrl' in a0)
      buildUrl = (a0 as JenkinsTreeNode).buildUrl

    const c = clientRef.value
    if (!c || typeof buildUrl !== 'string')
      return
    try {
      await c.stopBuild(buildUrl)
      void window.showInformationMessage('Stop requested.')
      await refreshAll()
    }
    catch (e) {
      void window.showErrorMessage(e instanceof Error ? e.message : 'Stop failed')
    }
  })

  useCommand('jenkinsBuilder.openBuildInBrowser', async (...args: unknown[]) => {
    const u = args[0]
    if (typeof u === 'string')
      await env.openExternal(Uri.parse(u))
  })

  useCommand('jenkinsBuilder.triggerCurrentBranch', async () => {
    if (triggerInProgress.value || triggerBusy.value) {
      void window.showWarningMessage('当前已有一次 Jenkins 构建在进行中（排队或运行），请结束后再触发。')
      return
    }

    const c = clientRef.value
    if (!c) {
      void window.showWarningMessage('Sign in first.')
      return
    }
    const job = getCfg().get<string>('projectJob', '').trim()
    if (!job) {
      void window.showWarningMessage('Bind a Jenkins job to this workspace first.')
      return
    }

    triggerInProgress.value = true
    try {
      try {
        const last = await c.getLastBuildBrief(job)
        if (last?.building) {
          void window.showWarningMessage(
            `当前 Job 正在构建（#${last.number}），请待本次构建结束后再触发。`,
          )
          return
        }
      }
      catch (e) {
        void window.showErrorMessage(e instanceof Error ? e.message : '无法获取 Job 构建状态')
        return
      }

      let branch: string
      try {
        branch = await getCurrentGitBranch(context)
      }
      catch (e) {
        void window.showErrorMessage(e instanceof Error ? e.message : 'Git error')
        return
      }
      const param = getCfg().get<string>('branchParamName', 'BRANCH')
      try {
        const queueUrl = await c.triggerParameterizedBuild(job, param, branch)
        const exec = await c.pollQueueUntilExecutable(queueUrl)
        const label = `${job} #${exec.number}`
        void window.showInformationMessage(`Queued build ${label} (branch ${branch}).`)
        lastStatusBuild = { url: exec.url, label }
        openBuildLog(exec.url, label)
        buildTracker.track(exec.url, job, exec.number)
        triggerBusy.value = true
        triggerLabel.value = `$(sync~spin) ${label}`
        await rebuildCurrentProject()
        await rebuildAllJobs()
        const iv = setInterval(async () => {
          try {
            const info = await c.getBuildApi(exec.url)
            if (!info.building) {
              clearInterval(iv)
              triggerBusy.value = false
              triggerLabel.value = ''
              await rebuildCurrentProject()
              await rebuildAllJobs()
              return
            }
            await rebuildCurrentProject()
          }
          catch {
            clearInterval(iv)
            triggerBusy.value = false
            triggerLabel.value = ''
            await rebuildCurrentProject()
            await rebuildAllJobs()
          }
        }, 2000)
      }
      catch (e) {
        if (e instanceof UnauthorizedError) {
          void window.showWarningMessage('Unauthorized — sign in again.')
        }
        else if (e instanceof JenkinsError) {
          void window.showErrorMessage(e.message)
        }
        else {
          void window.showErrorMessage(e instanceof Error ? e.message : 'Trigger failed')
        }
      }
    }
    finally {
      triggerInProgress.value = false
    }
  })

  context.subscriptions.push({
    dispose: () => {
      if (pollTimer)
        clearInterval(pollTimer)
      disposeAllLogSessions()
      buildTracker.dispose()
    },
  })
})

async function pickJobFullName(c: JenkinsClient): Promise<string | undefined> {
  return new Promise((resolve) => {
    const qp = window.createQuickPick()
    let resolved = false
    const load = async (q: string) => {
      qp.busy = true
      try {
        const suggest = await c.searchSuggest(q)
        if (suggest.length) {
          qp.items = suggest.map(label => ({ label }))
          return
        }
        const roots = await c.listRootJobs(500)
        if (!q.trim()) {
          qp.items = roots.map(j => ({ label: j.fullName, description: j.name }))
          return
        }
        const qc = q.toLowerCase()
        qp.items = roots
          .filter(j => j.fullName.toLowerCase().includes(qc))
          .map(j => ({ label: j.fullName, description: j.name }))
      }
      finally {
        qp.busy = false
      }
    }

    qp.placeholder = 'Type to filter or search Jenkins jobs'
    qp.onDidChangeValue(v => void load(v))
    qp.onDidAccept(() => {
      resolved = true
      const v = qp.selectedItems[0]?.label
      qp.dispose()
      resolve(v)
    })
    qp.onDidHide(() => {
      if (!resolved)
        resolve(undefined)
    })
    void load('')
    qp.show()
  })
}
