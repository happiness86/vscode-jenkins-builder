import type { JenkinsClient } from '../jenkins/client'

const channels = new Map<string, ReturnType<typeof createLogSession>>()

function channelKey(buildUrl: string): string {
  return buildUrl.replace(/\/?$/, '/')
}

function createLogSession(client: JenkinsClient, buildUrl: string) {
  let timer: ReturnType<typeof setInterval> | undefined
  let start = 0

  return {
    startStreaming(
      append: (text: string) => void,
      onDone: () => void,
    ) {
      if (timer)
        clearInterval(timer)

      const tick = async () => {
        try {
          const { chunk, nextStart, more } = await client.fetchProgressiveLog(buildUrl, start)
          if (chunk)
            append(chunk)
          start = nextStart
          if (!more) {
            if (timer)
              clearInterval(timer)
            timer = undefined
            onDone()
          }
        }
        catch {
          if (timer)
            clearInterval(timer)
          timer = undefined
          onDone()
        }
      }

      void tick()
      timer = setInterval(() => void tick(), 1500)
    },
    dispose() {
      if (timer)
        clearInterval(timer)
      timer = undefined
    },
  }
}

export function streamBuildLog(
  client: JenkinsClient,
  buildUrl: string,
  append: (text: string) => void,
  onDone: () => void,
): void {
  const key = channelKey(buildUrl)
  const existing = channels.get(key)
  if (existing)
    existing.dispose()

  const session = createLogSession(client, buildUrl)
  channels.set(key, session)
  session.startStreaming(append, () => {
    channels.get(key)?.dispose()
    channels.delete(key)
    onDone()
  })
}

export function disposeAllLogSessions(): void {
  for (const s of channels.values())
    s.dispose()
  channels.clear()
}
