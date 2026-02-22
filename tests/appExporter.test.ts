import { describe, it, expect, afterAll } from 'vitest'
import { AppExporter } from '../backend/src/services/appExporter'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

const exporter = new AppExporter()

// Clean up test exports after all tests
afterAll(() => {
  const dir = exporter.getExportDir()
  for (const name of ['Test_App.json', 'App_With_Specials.json', 'Hello_World.json']) {
    const p = join(dir, name)
    if (existsSync(p)) rmSync(p)
  }
})

describe('AppExporter', () => {
  it('exports HQ JSON to the correct path', () => {
    const hqJson = { doc_type: 'Application', name: 'Test App', modules: [] }
    const path = exporter.exportForHQSync('Test App', hqJson)
    expect(existsSync(path)).toBe(true)
    expect(path).toContain('Test App.json')
  })

  it('writes valid JSON content', () => {
    const hqJson = { doc_type: 'Application', name: 'Hello World', modules: [{ name: 'Mod' }] }
    const path = exporter.exportForHQSync('Hello World', hqJson)
    const content = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.doc_type).toBe('Application')
    expect(parsed.modules).toHaveLength(1)
  })

  it('sanitizes special characters from filename', () => {
    const hqJson = { doc_type: 'Application', name: 'App' }
    const path = exporter.exportForHQSync('App/With\\Specials!', hqJson)
    expect(path).not.toContain('/')
    expect(path).not.toContain('\\\\')
    expect(path).not.toContain('!')
    expect(existsSync(path)).toBe(true)
  })

  it('creates export directory if it does not exist', () => {
    const dir = exporter.getExportDir()
    expect(existsSync(dir)).toBe(true)
  })
})
