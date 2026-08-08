import path from 'node:path';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';

const BUILTIN_PLUGIN_DIR = 'claude-plugin';

export interface BuiltinPluginPathOptions {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

/** Resolve the app-owned Claude plugin without writing into a project. */
export function resolveBuiltinPluginPath(options: BuiltinPluginPathOptions): string {
  return options.isPackaged
    ? path.join(options.resourcesPath, BUILTIN_PLUGIN_DIR)
    : path.join(options.appPath, 'resources', BUILTIN_PLUGIN_DIR);
}

export function createBuiltinPluginConfig(pluginPath: string): SdkPluginConfig {
  return {
    type: 'local',
    path: pluginPath,
    // Canvas MCP is owned by the host application, not by the plugin.
    skipMcpDiscovery: true,
  };
}
