import type { ExtensionContext } from 'vscode'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentGitBranch } from '../src/git-branch'

const mockGetExtension = vi.fn()

vi.mock('vscode', () => ({
  extensions: {
    getExtension: (...args: unknown[]) => mockGetExtension(...args),
  },
}))

const fakeCtx = {} as ExtensionContext

describe('getCurrentGitBranch', () => {
  beforeEach(() => {
    mockGetExtension.mockReset()
  })

  it('reads branch name from active git extension exports', async () => {
    mockGetExtension.mockReturnValue({
      isActive: true,
      exports: {
        getAPI: (_v: number) => ({
          repositories: [{ state: { HEAD: { name: 'feature/x' } } }],
        }),
      },
    })

    await expect(getCurrentGitBranch(fakeCtx)).resolves.toBe('feature/x')
    expect(mockGetExtension).toHaveBeenCalledWith('vscode.git')
  })

  it('activates the git extension when needed', async () => {
    mockGetExtension.mockReturnValue({
      isActive: false,
      activate: vi.fn(async () => ({
        getAPI: (_v: number) => ({
          repositories: [{ state: { HEAD: { name: 'activated' } } }],
        }),
      })),
      exports: undefined,
    })
    await expect(getCurrentGitBranch(fakeCtx)).resolves.toBe('activated')
  })

  it('falls back to short SHA when detached HEAD has no symbolic name', async () => {
    mockGetExtension.mockReturnValue({
      isActive: true,
      exports: {
        getAPI: (_v: number) => ({
          repositories: [{ state: { HEAD: { commit: 'abcdef0123456789abcd' } } }],
        }),
      },
    })

    await expect(getCurrentGitBranch(fakeCtx)).resolves.toBe('abcdef0')
  })

  it.each([
    {
      exports: {},
      msg: /Git API/u,
      label: 'missing getAPI',
    },
    {
      exports: {
        getAPI: () => ({ repositories: [] }),
      },
      msg: /No Git repository/u,
      label: 'no repositories',
    },
    {
      exports: {
        getAPI: () => ({
          repositories: [{ state: { HEAD: {} } }],
        }),
      },
      msg: /Cannot determine/u,
      label: 'bare HEAD metadata',
    },
  ])('throws descriptive errors ($label)', async ({ exports: ext, msg }) => {
    mockGetExtension.mockReturnValue({ isActive: true, exports: ext })
    await expect(getCurrentGitBranch(fakeCtx)).rejects.toThrow(msg)
  })

  it('throws when vscode.git is unavailable', async () => {
    mockGetExtension.mockReturnValue(undefined)
    await expect(getCurrentGitBranch(fakeCtx)).rejects.toThrow(/Built-in Git extension/u)
  })
})
