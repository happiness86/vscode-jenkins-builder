import type { TreeViewNode } from 'reactive-vscode'
import type { JenkinsClient } from '../jenkins/client'
import type { JenkinsBuildRef, JenkinsJobRef } from '../jenkins/types'
import {
  ThemeColor,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState,
} from 'vscode'
import { isFolderJob } from '../jenkins/types'

export interface JenkinsTreeNode extends TreeViewNode {
  id: string
  /** Present on leaf build nodes — used by context-menu commands. */
  buildUrl?: string
  buildLabel?: string
}

const ROOT_JOB_CAP = 200

export function jobColorIcon(color?: string): ThemeIcon {
  if (!color)
    return new ThemeIcon('circle-outline')
  const c = color.toLowerCase()
  if (c.includes('blue_anime') || c.includes('grey_anime') || c.includes('red_anime'))
    return new ThemeIcon('sync~spin', new ThemeColor('charts.yellow'))
  if (c.includes('blue'))
    return new ThemeIcon('pass', new ThemeColor('testing.iconPassed'))
  if (c.includes('red'))
    return new ThemeIcon('error', new ThemeColor('testing.iconFailed'))
  if (c.includes('yellow') || c.includes('aborted'))
    return new ThemeIcon('warning', new ThemeColor('charts.orange'))
  return new ThemeIcon('circle-outline')
}

export function buildTreeNode(jobFullName: string, b: JenkinsBuildRef): JenkinsTreeNode {
  const running = Boolean(b.building)
  const result = b.result ?? (running ? 'RUNNING' : '—')
  const ti = new TreeItem(
    `#${b.number}  ${result}`,
    TreeItemCollapsibleState.None,
  )
  ti.description = b.duration ? `${Math.round(b.duration / 1000)}s` : undefined
  ti.contextValue = running ? 'jenkinsBuildRunning' : 'jenkinsBuild'
  ti.iconPath = running
    ? new ThemeIcon('sync~spin')
    : b.result === 'SUCCESS'
      ? new ThemeIcon('pass', new ThemeColor('testing.iconPassed'))
      : b.result === 'FAILURE'
        ? new ThemeIcon('error', new ThemeColor('testing.iconFailed'))
        : new ThemeIcon('warning')

  const label = `${jobFullName} #${b.number}`
  ti.command = {
    command: 'jenkinsBuilder.viewBuildLog',
    title: 'View log',
    arguments: [b.url, label],
  }
  return {
    id: `build:${b.url}`,
    buildUrl: b.url,
    buildLabel: label,
    treeItem: ti,
  }
}

export function jobWithBuildsNode(
  job: JenkinsJobRef,
  client: JenkinsClient,
  buildLimit: number,
): JenkinsTreeNode {
  const ti = new TreeItem(
    job.fullName,
    TreeItemCollapsibleState.Expanded,
  )
  ti.iconPath = jobColorIcon(job.color)

  return {
    id: `job:${job.fullName}`,
    treeItem: ti,
    children: (async () => {
      const builds = await client.getRecentBuilds(job.fullName, buildLimit)
      return builds.map(b => buildTreeNode(job.fullName, b))
    })(),
  }
}

export function folderJobNode(
  job: JenkinsJobRef,
  client: JenkinsClient,
  buildLimit: number,
): JenkinsTreeNode {
  const ti = new TreeItem(
    job.name,
    TreeItemCollapsibleState.Collapsed,
  )
  ti.iconPath = new ThemeIcon('folder')

  return {
    id: `folder:${job.fullName}`,
    treeItem: ti,
    children: (async () => {
      const jobs = await client.listChildJobs(job.fullName, ROOT_JOB_CAP)
      return jobs.map((j) => {
        if (isFolderJob(j))
          return folderJobNode(j, client, buildLimit)
        return jobWithBuildsNode(j, client, buildLimit)
      })
    })(),
  }
}

export async function loadAllJobsRoots(
  client: JenkinsClient,
  buildLimit: number,
): Promise<JenkinsTreeNode[]> {
  const jobs = await client.listRootJobs(ROOT_JOB_CAP)
  const nodes: JenkinsTreeNode[] = jobs.map((j) => {
    if (isFolderJob(j))
      return folderJobNode(j, client, buildLimit)
    return jobWithBuildsNode(j, client, buildLimit)
  })
  if (jobs.length >= ROOT_JOB_CAP) {
    nodes.push({
      id: 'hint:truncate',
      treeItem: (() => {
        const t = new TreeItem(
          'List truncated — use Search in the view title',
          TreeItemCollapsibleState.None,
        )
        t.iconPath = new ThemeIcon('info')
        return t
      })(),
    })
  }
  return nodes
}

export function signInTreeNode(): JenkinsTreeNode {
  const ti = new TreeItem('Sign in to Jenkins…', TreeItemCollapsibleState.None)
  ti.iconPath = new ThemeIcon('key')
  ti.command = { command: 'jenkinsBuilder.signIn', title: 'Sign in' }
  return { id: 'action:signin', treeItem: ti }
}

export function bindJobTreeNode(): JenkinsTreeNode {
  const ti = new TreeItem('Bind Jenkins Job…', TreeItemCollapsibleState.None)
  ti.iconPath = new ThemeIcon('link')
  ti.command = { command: 'jenkinsBuilder.bindJob', title: 'Bind' }
  return { id: 'action:bind', treeItem: ti }
}

export function errorTreeNode(message: string): JenkinsTreeNode {
  const ti = new TreeItem(message, TreeItemCollapsibleState.None)
  ti.iconPath = new ThemeIcon('error')
  return { id: `error:${message.slice(0, 40)}`, treeItem: ti }
}
