import { safeInvoke } from '../utils/tauri';
import type { AppConfig } from '../types';

export function getConfig(): Promise<AppConfig> {
  return safeInvoke<AppConfig>('get_config');
}

export function setConfig(config: AppConfig): Promise<void> {
  return safeInvoke<void>('set_config', { config });
}

export function resetConfig(): Promise<void> {
  return safeInvoke<void>('reset_config');
}
