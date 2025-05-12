import path from 'node:path'
import fs from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { walk, Walk } from '../../src/core/walk'

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

    const content = await fs.readFile(path.join(testDir, 'test1.txt'), 'utf-8')
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

  it('应支持progress回调', async () => {
    let progressData: any

    await walk({
      root: testDir,
      progress: (data) => {
        progressData = data
      },
      exec: async () => {
        // 空处理器
      },
    })

    expect(progressData).toMatchObject({
      processed: 1,
      success: 1,
      failed: 0,
    })
  })

  it('应正确处理异常情况', async () => {
    let errorCount = 0

    try {
      await walk({
        exec: async () => {
          throw new Error('模拟错误')
        },
      })
    }
    catch (e) {
      errorCount = (e as Error).message.split('\n').length
    }

    expect(errorCount).toBeGreaterThan(0)
  })
})
