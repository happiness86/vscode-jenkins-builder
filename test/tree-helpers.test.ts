import type { JenkinsClient } from '../src/jenkins/client'

import { describe, expect, it, vi } from 'vitest'
import {
  bindJobTreeNode,
  buildTreeNode,
  errorTreeNode,
  folderJobNode,
  jobColorIcon,
  jobWithBuildsNode,
  loadAllJobsRoots,
  signInTreeNode,
} from '../src/tree/helpers'

vi.mock('vscode', () => {
  class ThemeIcon {
    constructor(public id: string, public color?: unknown) {}
  }
  class ThemeColor {
    constructor(public id: string) {}
  }
  class TreeItem {
    iconPath?: unknown
    description?: string
    contextValue?: string
    command?: { command: string, title: string, arguments?: unknown[] }
    constructor(
      public label: string,
      public collapsibleState: number,
    ) {}
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 }
  return { ThemeIcon, ThemeColor, TreeItem, TreeItemCollapsibleState }
})

describe('tree/helpers', () => {
  describe('jobColorIcon', () => {
    it('maps Jenkinscolor strings to theme icons', () => {
      expect(jobColorIcon(undefined).id).toBe('circle-outline')
      expect(jobColorIcon('BLUE_anime').id).toBe('sync~spin')
      expect(jobColorIcon('grey_anime').id).toBe('sync~spin')
      expect(jobColorIcon('red_anime').id).toBe('sync~spin')
      expect(jobColorIcon('blue').id).toBe('pass')
      expect(jobColorIcon('red').id).toBe('error')
      expect(jobColorIcon('yellow').id).toBe('warning')
      expect(jobColorIcon('aborted').id).toBe('warning')
      expect(jobColorIcon('NOTABLOCK').id).toBe('circle-outline')
    })
  })

  describe('buildTreeNode', () => {
    it('renders running vs finished builds', () => {
      const running = buildTreeNode('job/a', {
        number: 2,
        url: 'http://z',
        result: null,
        duration: 0,
        timestamp: 1,
        building: true,
      })
      expect(running.treeItem.contextValue).toBe('jenkinsBuildRunning')
      expect(running.treeItem.description).toBeUndefined()

      const ok = buildTreeNode('job/a', {
        number: 3,
        url: 'http://z',
        result: 'SUCCESS',
        duration: 3500,
        timestamp: 1,
      })
      expect(ok.treeItem.description).toBe('4s')
      expect(ok.buildLabel).toBe('job/a #3')
    })

    it('uses failure and warning visuals for unsuccessful builds', () => {
      const bad = buildTreeNode('job/a', {
        number: 10,
        url: 'u',
        result: 'FAILURE',
        duration: 999,
        timestamp: 0,
      })
      expect(bad.treeItem.contextValue).toBe('jenkinsBuild')
      expect((bad.treeItem.iconPath as { id: string }).id).toBe('error')

      const flaky = buildTreeNode('job/a', {
        number: 11,
        url: 'u',
        result: 'UNSTABLE',
        duration: 1,
        timestamp: 0,
      })
      expect((flaky.treeItem.iconPath as { id: string }).id).toBe('warning')
    })
  })

  describe('loadAllJobsRoots', () => {
    it('shows truncation hint after hitting job cap', async () => {
      const jobs = Array.from({ length: 200 }, (_, i) => ({
        name: `n${i}`,
        fullName: `n${i}`,
        url: 'u',
      }))
      const listRootJobs = vi.fn(async () => jobs)
      const getRecentBuilds = vi.fn(async () => [])
      const client = { listRootJobs, listChildJobs: vi.fn(), getRecentBuilds } as unknown as JenkinsClient

      const roots = await loadAllJobsRoots(client, 3)
      expect(roots.some(n => n.id === 'hint:truncate')).toBe(true)
      expect(listRootJobs).toHaveBeenCalledTimes(1)
    })

    it('instantiates folders at the root and nests folder children', async () => {
      const folderJob = {
        name: 'root',
        fullName: 'root',
        url: '',
        _class: 'Folder',
      }
      const listRootJobs = vi.fn(async () => [folderJob])
      const listChildJobs = vi.fn(async (fullName: string) => {
        if (fullName === 'root') {
          return [{
            name: 'nested',
            fullName: 'root/nested',
            url: '',
            _class: 'com.cloudbees.hudson.plugins.folder.Folder',
          }]
        }
        return [{
          name: 'svc',
          fullName: `root/nested/svc`,
          url: '',
          _class: 'WorkflowJob',
        }]
      })
      const getRecentBuilds = vi.fn(async () => [])
      const client = { listRootJobs, listChildJobs, getRecentBuilds } as unknown as JenkinsClient

      const roots = await loadAllJobsRoots(client, 3)
      const rootFolder = roots.find(node => node.id.startsWith('folder:root'))
      expect(rootFolder?.id).toBe('folder:root')
      const nested = await rootFolder?.children
      expect(nested).toHaveLength(1)
      const leafOrFolder = nested?.[0]
      expect(leafOrFolder?.id).toBe('folder:root/nested')
      const leaves = await leafOrFolder?.children
      expect(leaves).toHaveLength(1)
      expect(getRecentBuilds).toHaveBeenCalledWith('root/nested/svc', 3)
    })
  })

  describe('jobWithBuildsNode + folderJobNode', () => {
    it('lazy-loads builds for leaf jobs', async () => {
      const getRecentBuilds = vi.fn(async () => [
        { number: 1, url: 'u', result: 'SUCCESS', duration: 0, timestamp: 0 },
      ])
      const client = { listRootJobs: vi.fn(), listChildJobs: vi.fn(), getRecentBuilds } as unknown as JenkinsClient
      const node = jobWithBuildsNode({ name: 'svc', fullName: 'svc', url: 'u', color: 'blue' }, client, 10)
      const kids = await node.children
      expect(kids).toHaveLength(1)
      expect(getRecentBuilds).toHaveBeenCalledWith('svc', 10)
    })

    it('recurses into folder jobs', async () => {
      const listChildJobs = vi.fn(async (fn: string) => {
        if (fn === 'root')
          return [{ name: 'leaf', fullName: 'root/leaf', url: 'u', _class: 'WorkflowJob' }]
        return []
      })
      const getRecentBuilds = vi.fn(async () => [])
      const client = { listRootJobs: vi.fn(), listChildJobs, getRecentBuilds } as unknown as JenkinsClient
      const folder = folderJobNode(
        { name: 'root', fullName: 'root', url: 'u', _class: 'com.cloudbees.hudson.plugins.folder.Folder' },
        client,
        5,
      )
      const kids = await folder.children
      expect(kids).toHaveLength(1)
      expect(listChildJobs).toHaveBeenCalledWith('root', 200)
    })
  })

  describe('action + error nodes', () => {
    it('exposes sign-in / bind / error tree items', () => {
      expect(signInTreeNode().treeItem.command?.command).toBe('jenkinsBuilder.signIn')
      expect(bindJobTreeNode().treeItem.command?.command).toBe('jenkinsBuilder.bindJob')
      expect(errorTreeNode('boom').treeItem.label).toBe('boom')
    })
  })
})
