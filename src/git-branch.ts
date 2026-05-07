import type { ExtensionContext } from 'vscode'
import { extensions } from 'vscode'

export async function getCurrentGitBranch(_ctx: ExtensionContext): Promise<string> {
  const ext = extensions.getExtension('vscode.git')
  if (!ext)
    throw new Error('Built-in Git extension is not available.')

  const git = ext.isActive ? ext.exports : await ext.activate()
  const api = git?.getAPI?.(1)
  if (!api)
    throw new Error('Could not access Git API.')

  const repo = api.repositories[0]
  if (!repo)
    throw new Error('No Git repository in this workspace.')

  const name = repo.state?.HEAD?.name
  if (name)
    return name
  const commit = repo.state?.HEAD?.commit?.slice(0, 7)
  if (commit)
    return commit
  throw new Error('Cannot determine current Git revision.')
}
