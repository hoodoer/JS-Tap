import rawConfig from '../config.json';

export const CONFIG = {
  serverUrl: `https://${rawConfig.js_tap_server.domain}:${rawConfig.js_tap_server.port}`,
  tag: "bex-default",
  clientType: "bex-beacon",
  domainScoping: {
    whitelistEnabled: rawConfig.domain_scoping.whitelist_enabled,
    whitelist: rawConfig.domain_scoping.whitelist,
  },
  heartbeat: {
    baseInterval: rawConfig.heartbeat.base_interval || 60,
    jitterPercent: rawConfig.heartbeat.jitter_percent ?? 30,
  },
  sidecar: rawConfig.sidecar || { enabled: false, host_name: "com.jstap.sidecar" },
};

/**
 * Check if a URL is allowed under the current whitelist configuration.
 * Returns true if whitelisting is disabled (all domains allowed) or if the URL matches a whitelist pattern.
 */
export function isUrlWhitelisted(url: string): boolean {
  if (!CONFIG.domainScoping.whitelistEnabled) return true;
  return CONFIG.domainScoping.whitelist.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return regex.test(url);
  });
}

/**
 * Check if a domain (hostname) is allowed under the current whitelist configuration.
 * Constructs test URLs with both https and http schemes to match against whitelist patterns.
 */
export function isDomainWhitelisted(domain: string): boolean {
  if (!CONFIG.domainScoping.whitelistEnabled) return true;
  return isUrlWhitelisted(`https://${domain}/`) || isUrlWhitelisted(`http://${domain}/`);
}
