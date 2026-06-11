import { defineConfig } from 'wxt';
import rawConfig from './config.json';

const permissions = rawConfig.domain_scoping.whitelist_enabled
  ? rawConfig.domain_scoping.whitelist
  : ['<all_urls>'];

const ext = rawConfig.extension || {};
const extIds = (rawConfig as any).extension_ids || {};

// See https://wxt.dev/api/config.html
export default defineConfig({
  outDir: 'dist',
  manifest: {
    name: ext.name || 'bex-beacon',
    version: ext.version || '1.0.0',
    description: ext.description || '',
    ...(ext.short_name ? { short_name: ext.short_name } : {}),
    ...(ext.author ? { author: ext.author } : {}),
    ...(ext.homepage_url ? { homepage_url: ext.homepage_url } : {}),
    ...(extIds.chrome_key ? { key: extIds.chrome_key } : {}),
    permissions: [
      'storage',
      'alarms',
      'cookies',
      'webRequest',
      'declarativeNetRequest',
      'webNavigation',
      'scripting',
      ...(rawConfig.sidecar?.enabled ? ['nativeMessaging'] : []),
    ],
    host_permissions: permissions,
    declarative_net_request: {
      rule_resources: [
        {
          id: 'ruleset_1',
          enabled: true,
          path: 'rules.json',
        },
      ],
    },
  }
});


