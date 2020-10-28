import * as watchman from "fb-watchman"


export type Change = {
  name: string
  type: string
  mode: number
  size: number
  exists: boolean
}

export type OnChanges = (changes: Change[]) => void


const client = new watchman.Client()


const capabilityCheck = async (): Promise<void> => {
  const capabilies = {
    optional: [],
    required: ["relative_root"],
  }
  return new Promise<void>((resolve, reject) => {
    client.capabilityCheck(capabilies, (err) => err ? reject(err) : resolve())
  })
}


const watchProject = async (remoteDir: string): Promise<{ watch: any, relativePath: string }> => {
  return new Promise((resolve, reject) => {
    client.command(["watch-project", remoteDir], (err, resp) => {
      return err ? reject(err) : resolve({ watch: resp.watch, relativePath: resp.relative_path })
    })
  })
}


const subscribe = async ({ watch, relativePath }: { watch: any, relativePath: string }, onChanges: OnChanges): Promise<void> => {
  const subscriptionName = "robin"
  const subscribe = ["subscribe", watch, subscriptionName, {
    expression: ["allof",
      ["match", "**/*", "wholename", {"includedotfiles": true}],
      // TODO: SHould have .robinignore
      ["not", ["dirname", ".git"]],
      ["not", ["match", ".git", "wholename"]],
      ["not", ["dirname", ".idea"]],
      ["not", ["match", ".idea", "wholename"]],
      // TODO: Should be configurable:
      ["not", ["dirname", "node_modules"]],
      ["not", ["match", "node_modules", "wholename"]],
      ["not", ["dirname", "dist"]],
      ["not", ["match", "dist", "wholename"]],
    ],
    fields: ["name", "type", "mode", "size", "exists"],
    relative_root: relativePath,
  }]

  return new Promise<void>((resolve, reject) => {
    client.command(subscribe, (err) => {
      if (err) return reject(err)

      client.on("subscription", (resp) => {
        if (resp.subscription === subscriptionName) onChanges(resp.files)
      })

      resolve()
    })
  })
}


export const startWatchman = async (remoteDir: string, onChanges: OnChanges): Promise<void> => {
  await capabilityCheck()
  await subscribe(await watchProject(remoteDir), onChanges)
}


export const closeWatchman = () => {
  client.end()
}
