import path from 'node:path'
import fs from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Walk, walk } from '../../src/core/walk'

describe('walk', () => {
  const testDir = path.join(__dirname, 'test-fixtures')

  beforeAll(async () => {
    // 创建测试目录结构
    await fs.ensureDir(testDir)
    await fs.writeFile(path.join(testDir, 'test1.txt'), 'foo')
    await fs.writeFile(path.join(testDir, 'test2.txt'), 'bar')
    await fs.ensureDir(path.join(testDir, 'sub'))
    await fs.writeFile(path.join(testDir, 'sub/test3.txt'), 'baz')
  })

  afterAll(async () => {
    await fs.remove(testDir)
  })

  it('应该找到所有txt文件', async () => {
    const walker = new Walk({
      root: testDir,
      pattern: '**/*.txt',
    })

    const files: string[] = []
    await walker.run(async (ctx) => {
      files.push(ctx.filepath)
    })

    expect(files).toHaveLength(3)
  })

  it('应该处理文件内容', async () => {
    const walker = new Walk({
      root: testDir,
      pattern: '*.txt',
    })

    await walker.run(async (ctx) => {
      const content = await ctx.read()
      await ctx.write(content.toUpperCase())
    })

    const content = await fs.readFile(
      path.join(testDir, 'test1.txt'),
      'utf-8',
    )
    expect(content).toBe('FOO')
  })
})

describe('walk function', () => {
  const testDir = path.join(__dirname, 'test-fixtures')

  beforeAll(async () => {
    await fs.ensureDir(testDir)
    await fs.writeFile(path.join(testDir, 'demo.txt'), 'test content')
  })

  afterAll(async () => {
    await fs.remove(testDir)
  })

  it('应支持直接传递processor参数', async () => {
    const results = await walk({
      root: testDir,
      pattern: '*.txt',
    }, async (ctx) => {
      return ctx.filepath
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toContain('demo.txt')
  })

  it('应支持options.exec方式调用', async () => {
    const results = await walk({
      root: testDir,
      pattern: '*.txt',
      exec: async (ctx) => {
        return ctx.filepath.toUpperCase()
      },
    })

    expect(results[0]).toMatch(/DEMO\.TXT$/i)
  })

  it('应正确处理异常情况', async () => {
    let errorCount = 0

    await walk({
      exec: async (ctx) => {
        errorCount = ctx.ins.progress.failed
        throw new Error('模拟错误')
      },
      onEnd: (ins) => {
        errorCount = ins.progress.failed
      },
    })

    expect(errorCount).toBeGreaterThan(0)
  })
})

describe('扩展功能测试', () => {
  const testDir = path.join(__dirname, 'test-fixtures')

  beforeAll(async () => {
    await fs.ensureDir(testDir)
    await fs.writeFile(path.join(testDir, 'demo.ts'), 'const a = 1')
  })

  it('应支持自定义数据扩展', async () => {
    const results = await walk({
      exec: async (ctx) => {
        ctx.ins.data.counter = (ctx.ins.data.counter || 0) + 1
        return ctx.ins.data.counter
      },
    })

    expect(results[0]).toBe(1)
  })

  it('应正确触发start/end钩子', async () => {
    let startCalled = false
    let endCalled = false

    await walk({
      onStart: () => startCalled = true,
      onEnd: () => endCalled = true,
      exec: async () => {},
    })

    expect(startCalled).toBeTruthy()
    expect(endCalled).toBeTruthy()
  })

  it('应正确处理大文件并发', async () => {
    const processOrder: number[] = []

    await walk({
      concurrency: 3,
      exec: async () => {
        processOrder.push(Date.now())
        await new Promise(r => setTimeout(r, 50))
      },
    })

    // 验证前3个任务几乎同时开始
    expect(processOrder[2] - processOrder[0]).toBeLessThan(50)
  })
})
