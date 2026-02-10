import { defineConfig } from 'wxt';
import rawConfig from './config.json';

const permissions = rawConfig.domain_scoping.mode === 'whitelist' 
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


