import process from 'node:process'
import fs from 'fs-extra'
import PQueue from 'p-queue'
import glob from 'tiny-glob'

interface WalkOptions {
  /**
   * 根目录
   *
   * @default process.cwd()
   */
  root?: string

  /**
   * tiny-glob
   */
  pattern?: string

  /**
   * 并发处理文件数
   *
   * @default 1
   */
  concurrency?: number

  /**
   * 文件忽略规则（优先级高于 `pattern`）
   * - 正则表达式：匹配文件路径
   * - 函数：返回 `true` 时忽略该文件
   *
   * @default /node_modules/
   *
   * @example
   * ignore: /node_modules/
   */
  ignore?: RegExp | ((filepath: string) => boolean)
}

interface FileContext {
  filepath: string
  read: () => Promise<string>
  write: (content: string, savepath?: string) => Promise<void>
}

interface WalkProgress {
  success: number
  failed: number
  total: number
}

interface WalkContext<T extends Record<string, any> = Record<string, any>>
  extends FileContext {
  ins: Walk<T>
}

type FileProcessor<T = void> = (ctx: WalkContext) => Promise<T> | T

type WalkHook = (ins: WalkContext['ins']) => void
type WalkHooks = Map<string, WalkHook[]>

export class Walk<T extends Record<string, any> = Record<string, any>> {
  protected options: Required<WalkOptions>
  protected hooks: WalkHooks = new Map()

  /**
   * 自定义扩展
   */
  data: T = {} as T

  progress: WalkProgress = {
    success: 0,
    failed: 0,
    total: 0,
  }

  constructor(options: WalkOptions = {}) {
    this.options = {
      root: process.cwd(),
      pattern: '**/*',
      concurrency: 1,
      ignore: /node_modules/,
      ...options,
    }
  }

  private async getFiles(): Promise<string[]> {
    return await glob(this.options.pattern, {
      cwd: this.options.root,
      absolute: true,
      dot: true,
      filesOnly: true,
    })
  }

  private shouldIgnore(filepath: string): boolean {
    if (typeof this.options.ignore === 'function') {
      return this.options.ignore(filepath)
    }
    if (this.options.ignore instanceof RegExp) {
      return this.options.ignore.test(filepath)
    }
    return false
  }

  onHook(name: 'start' | 'end', callback: WalkHook): Walk {
    let hooks = this.hooks.get(name)
    if (!hooks) {
      this.hooks.set(name, hooks = [])
    }
    hooks.push(callback)
    return this
  }

  onStart(callback: WalkHook): Walk {
    return this.onHook('start', callback)
  }

  onEnd(callback: WalkHook): Walk {
    return this.onHook('end', callback)
  }

  private async triggerHooks(
    event: string,
  ): Promise<void> {
    const hooks = this.hooks.get(event)
    hooks && await Promise.all(hooks.map(hook => hook(this)))
  }

  private createContext(filepath: string): WalkContext {
    const ctx = {
      filepath,
      read: async () => {
        const content = await fs.readFile(filepath, 'utf-8')
        return content
      },
      write: async (content: string, savepath?: string) => {
        await fs.writeFile(savepath || filepath, content)
      },
      ins: this,
    }

    return ctx
  }

  async run<T = void>(processor: FileProcessor<T>): Promise<T[]> {
    const files = await this.getFiles()

    // 进度统计
    this.progress.total = files.length

    // start
    await this.triggerHooks('start')

    const queue = new PQueue({ concurrency: this.options.concurrency })
    const results = await queue.addAll(files.map(file => async () => {
      try {
        if (this.shouldIgnore(file)) {
          return
        }

        const ctx = this.createContext(file)
        const result = await processor(ctx)
        this.progress.success++
        return result
      }
      catch {
        this.progress.failed++
      }
    }))

    // end
    await this.triggerHooks('end')

    return results.filter(Boolean) as T[]
  }
}

interface WalkOptionsWithExec<T = void> extends WalkOptions {
  exec?: FileProcessor<T>
  onStart?: WalkHook
  onEnd?: WalkHook
}

export async function walk<T>(
  options: WalkOptionsWithExec<T>,
): Promise<T[]>
export async function walk<T>(
  options: WalkOptionsWithExec<T>,
  exec: FileProcessor<T>,
): Promise<T[]>
export async function walk<T>(
  options: WalkOptionsWithExec & { exec?: FileProcessor<T> } = {},
  exec?: FileProcessor<T>,
): Promise<T[]> {
  const callback = exec || options.exec
  if (!callback) {
    throw new Error('Missing callback')
  }

  const walker = new Walk(options)

  options.onStart && walker.onStart(options.onStart)
  options.onEnd && walker.onEnd(options.onEnd)

  return await walker.run(callback)
}
