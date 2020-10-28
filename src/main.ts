import * as fs from "fs"
import * as path from "path"
import { SFTPOpts, openSFTP, closeSFTP } from "./sftp"
import { startWatchman, closeWatchman, Change } from "./watchman"


type Config = SFTPOpts & {
  localDir: string
  remoteDir: string
}


const localStat = async (localDir): Promise<fs.Stats> => {
  return new Promise<fs.Stats>((resolve, reject) => {
    fs.stat(localDir, (err, stat) => {
      return err ? reject(err) : resolve(stat)
    })
  })
}


const sizeStr = (size: number): string => {
  let unit
  for (unit of ["b", "kB", 'MB', "GB", "TB"]) {
    if (size < 1024) break
    size /= 1024
  }
  return size.toFixed(unit == "b" ? 0 : 1) + unit
}


const main = async (opts: Config) => {
  const { localDir, remoteDir } = opts

  const localDirStat = await localStat(localDir)
  if (!localDirStat.isDirectory()) throw new Error(`local directory is not directory`)

  const sftp = await openSFTP(opts)

  const remoteDirStat = await sftp.stat(remoteDir)
  if (remoteDirStat == null) {
    await sftp.mkdir(remoteDir, localDirStat.mode)
  } else if (!remoteDirStat.isDirectory()) {
    throw new Error(`remote directory is not directory`)
  }

  const localize = (name: string) => path.resolve(localDir, name)
  const remoteize = (name: string) => path.join(remoteDir, name)

  const progress = (totalSize: number) => (transferred: number) => {
    console.log(`      ${ sizeStr(transferred) } (${ (transferred / totalSize * 100).toFixed(0) }%)`)
  }

  const onChanges = async (changes: Change[]) => {
    console.log(`changes: ${ changes.length } files changed:`)
    for (const { name, type, mode, size, exists } of changes) {
      console.log("   ", name, exists ? "add" : "remove", type, sizeStr(size))
      if (exists) {
        if (type === "f") await sftp.send(localize(name), remoteize(name), mode, progress(size))
        if (type === "d") await sftp.mkdir(remoteize(name), mode)
      } else {
        if (type === "f") await sftp.rm(localize(name))
        if (type === "d") await sftp.rmdir(remoteize(name))
      }
    }
    console.log(`   total:`)
  }

  await startWatchman(path.resolve(localDir), onChanges)
}


process.on("SIGUSR2", () => {
  console.log("nodemon sent SIGUSR2")
  process.exit(0)
})


process.on("exit", () => {
  console.log("exit")
  closeWatchman()
  closeSFTP()
})


const readPrivateKey = (keyName: string): Buffer => {
  if (keyName.startsWith("~/")) {
    keyName = path.resolve(process.env.HOME || process.env.HOMEPATH || "", keyName.substring(2))
  }
  return fs.readFileSync(keyName)
}


const opts: Config = {
  host: process.env.ROBIN_REMOTE_HOST || "",
  port: Number.parseInt(process.env.ROBIN_REMOTE_PORT || "22"),
  username: process.env.ROBIN_REMOTE_USERNAME || "ec2-user",
  privateKey: readPrivateKey(process.env.ROBIN_PRIVATE_KEY || ""),
  remoteDir: process.env.ROBIN_REMOTE_DIR || process.env.ROBIN_LOCAL_DIR || ".",
  localDir: process.env.ROBIN_LOCAL_DIR || ".",
}


main(opts).catch(err => console.error(err))
