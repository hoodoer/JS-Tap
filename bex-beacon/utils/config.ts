import rawConfig from '../config.json';

export const CONFIG = {
  serverUrl: `https://${rawConfig.js_tap_server.domain}:${rawConfig.js_tap_server.port}`,
  tag: "bex-default",
  clientType: "bex-beacon",
  domainScoping: rawConfig.domain_scoping,
  heartbeatInterval: rawConfig.heartbeat_interval || 60 // Default to 60s
};


