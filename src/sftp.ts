import * as fs from "fs"
import * as stream from "stream"
import { Client, SFTPStream } from "ssh2"


type Progress = (transferred: number) => void


export interface SFTP {
  send(localName: string, remoteName: string, mode: number, progress: Progress): Promise<void>

  rm(remoteName: string): Promise<void>

  mkdir(remoteName: string, mode: number): Promise<void>

  rmdir(remoteName: string): Promise<void>

  stat(remoteName: string): Promise<fs.Stats | null>
}


export class SFTPImpl implements SFTP {
  constructor(private sftp: SFTPStream) {
  }

  async send(localName, remoteName, mode, progress) {
    const reporter = (() => {
      let transferred = 0
      let lastReport = Date.now()
      return (chunk: Buffer) => {
        transferred += chunk.length
        const now = Date.now()
        if ((now - lastReport) > 1000) {
          progress(transferred)
          lastReport = now
        }
      }
    })()
    return new Promise<void>((resolve, reject) => {
      stream.pipeline(
          fs.createReadStream(localName),
          new stream.Transform({
            transform(chunk: Buffer, encoding: BufferEncoding, callback: stream.TransformCallback) {
              this.push(chunk)
              reporter(chunk)
              callback()
            },
          }),
          this.sftp.createWriteStream(remoteName, { mode }),
          (err) => err ? reject(err) : resolve())
    })
  }

  async rm(remoteName) {
    const stat = await this.stat(remoteName)
    if (!stat) {
      return
    }
    return new Promise<void>((resolve, reject) => {
      return this.sftp.unlink(remoteName, (err) => {
        return err ? reject(err) : resolve()
      })
    })
  }

  async mkdir(remoteName, mode) {
    const stat = await this.stat(remoteName)
    if (stat) {
      if (!stat.isDirectory()) {
        throw new Error(`trying to make directory ${ remoteName } but a file with same name exists`)
      }
      return this.setStat(remoteName, mode)
    }
    return new Promise<void>((resolve, reject) => {
      return this.sftp.mkdir(remoteName, { mode }, (err) => {
        if (err) console.log("rmdir; err.code", err.code, err.lang, Object.keys(err))
        return err ? reject(err) : resolve()
      })
    })
  }

  async rmdir(remoteName) {
    const stat = await this.stat(remoteName)
    if (!stat) {
      return
    }
    return new Promise<void>((resolve, reject) => {
      // TODO: Make this `rm -fr`
      return this.sftp.rmdir(remoteName, (err) => {
        return err ? reject(err) : resolve()
      })
    })
  }

  async stat(remoteName: string) {
    return new Promise<fs.Stats | null>((resolve, reject) => {
      return this.sftp.stat(remoteName, (err, stat) => {
        return err ? resolve(null) : resolve(stat)
      })
    })
  }

  async setStat(remoteName: string, mode: number) {
    return new Promise<void>((resolve, reject) => {
      return this.sftp.setstat(remoteName, { mode }, (err) => {
        return err ? reject(err) : resolve()
      })
    })
  }

}


const client = new Client()


export type SFTPOpts = {
  host: string
  port: number
  username: string
  privateKey: Buffer
}


export const openSFTP = async (opts: SFTPOpts): Promise<SFTP> => {
  return new Promise<SFTP>((resolve, reject) => {
    client.on("ready", () => {
      client.sftp((err, sftp) => err ? reject(err) : resolve(new SFTPImpl(sftp)))
    })
    client.connect(opts)
  })
}


export const closeSFTP = () => {
  client.end()
}
