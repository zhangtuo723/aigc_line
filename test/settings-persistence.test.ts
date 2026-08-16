import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  directory: `${process.cwd()}/test-results/settings-persistence-${process.pid}`,
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, ''),
  },
}))

vi.mock('../electron/main/services/project.store', () => ({
  getAppDataDir: () => fixture.directory,
}))

vi.mock('../electron/main/services/google-network.service', () => ({
  fetchGoogleApi: vi.fn(),
  normalizeGoogleProxyUrl: (value: string) => value.trim().replace(/\/+$/, ''),
}))

import { getAppSettingsView, saveAppSettings } from '../electron/main/services/settings.service'

describe('settings secret persistence', () => {
  afterAll(async () => {
    await fs.rm(fixture.directory, { recursive: true, force: true })
  })

  it('persists and reloads the Seedream API key as local plaintext', async () => {
    const request = {
      comfyuiBaseUrl: 'http://127.0.0.1:8188',
      agentBaseUrl: '',
      qwenBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      defaultImageWorkflowId: 'seedream-5.0-pro',
      googleAiProxyUrl: '',
      seedreamBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      seedreamApiKey: 'ark-test-secret',
    }

    const saved = await saveAppSettings(request)
    expect(saved.seedreamApiKeyConfigured).toBe(true)
    expect(saved.seedreamApiKey).toBe('ark-test-secret')

    const reloaded = await getAppSettingsView()
    expect(reloaded.seedreamApiKeyConfigured).toBe(true)
    expect(reloaded.seedreamApiKey).toBe('ark-test-secret')

    const stored = await fs.readFile(path.join(fixture.directory, 'settings.json'), 'utf8')
    expect(stored).toContain('"seedreamApiKey": "ark-test-secret"')
    expect(stored).not.toContain('encryptedSeedreamApiKey')
  })
})
