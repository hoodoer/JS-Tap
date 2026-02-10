import { defineConfig } from 'wxt';
import rawConfig from './config.json';

const permissions = rawConfig.domain_scoping.whitelist_enabled
  ? rawConfig.domain_scoping.whitelist
  : ['<all_urls>'];

// See https://wxt.dev/api/config.html
export default defineConfig({
  outDir: 'dist',
  manifest: {
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


