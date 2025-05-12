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

interface FileContext<T = void> {
  filepath: string
  read: () => Promise<string>
  write: (content: string, savepath?: string) => Promise<T>
}

type FileProcessor<T = void> = (context: FileContext) => Promise<T> | T

interface ProgressEventOptions extends WalkOptions {
  processed: number
  total: number
  success: number
  failed: number
}

interface WalkEvents {
  before: (options: WalkOptions) => void
  after: (options: WalkOptions) => void
  progress: (options: ProgressEventOptions) => void
}

export class Walk {
  private options: Required<WalkOptions>
  private hooks = new Map<keyof WalkEvents, Array<(...args: any[]) => void>>()

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

  on<K extends keyof WalkEvents>(event: K, callback: WalkEvents[K]): void {
    let hooks = this.hooks.get(event)
    if (!hooks)
      this.hooks.set(event, hooks = [])
    hooks.push(callback)
  }

  private async triggerHooks<K extends keyof WalkEvents>(
    event: K,
    options: K extends 'progress' ? ProgressEventOptions : WalkOptions,
  ): Promise<void> {
    const hooks = this.hooks.get(event) || []
    await Promise.all(hooks.map(hook => hook(options)))
  }

  private createFileContext(filepath: string): FileContext {
    const ctx = {
      filepath,
      read: async () => {
        const content = await fs.readFile(filepath, 'utf-8')
        return content
      },
      write: async (content: string, savepath?: string) => {
        await fs.writeFile(savepath || filepath, content)
      },
    }

    return ctx
  }

  async run<T = void>(processor: FileProcessor<T>): Promise<T[]> {
    const files = await this.getFiles()

    // 进度统计
    const totalFiles = files.length
    let scussessCount = 0
    let failedCount = 0

    const queue = new PQueue({ concurrency: this.options.concurrency })

    const results = await queue.addAll(files.map(file => async () => {
      try {
        if (this.shouldIgnore(file))
          return

        const ctx = this.createFileContext(file)
        const result = await processor(ctx)
        scussessCount++
        return result
      }
      catch (error) {
        // console.error(`Error processing file ${file}:`, error)
        failedCount++
        throw error
      }
    }))

    await this.triggerHooks('progress', {
      ...this.options,
      processed: scussessCount,

      total: totalFiles,
      success: scussessCount,
      failed: failedCount,
    })

    return results.filter(Boolean) as T[]
  }
}

type WalkOptionsWithProgress = WalkOptions & {
  progress?: (options: ProgressEventOptions) => void
}

interface WalkOptionsWithExec<T = void> extends WalkOptionsWithProgress {
  exec?: FileProcessor<T>
}

export async function walk<T = void>(options: WalkOptionsWithExec<T>): Promise<T[]>
export async function walk<T = void>(options: WalkOptionsWithProgress, exec: FileProcessor<T>): Promise<T[]>
export async function walk<T = void>(options: WalkOptionsWithProgress & { exec?: FileProcessor<T> } = {}, exec?: FileProcessor<T>): Promise<T[]> {
  const callback = exec || options.exec
  if (!callback)
    throw new Error('Missing callback')

  const walker = new Walk(options)

  options.progress && walker.on('progress', options.progress)

  return await walker.run(callback)
}
