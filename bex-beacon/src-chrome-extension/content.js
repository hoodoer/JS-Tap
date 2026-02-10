(function() {
  if (typeof document === 'undefined') {
    return;
  }

  console.log("BEX Beacon Running: Observer initialized.");

  function removeCspMetaTag(node) {
    if (node.nodeType === 1 && node.tagName === 'META' && node.httpEquiv === 'Content-Security-Policy' && node.parentNode) {
      node.parentNode.removeChild(node);
      console.log("CSP meta tag removed via MutationObserver.");
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        removeCspMetaTag(node);
        if (node.children) {
          for (const child of node.children) {
            removeCspMetaTag(child);
          }
        }
      }
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.disconnect();
    console.log("BEX Beacon: MutationObserver disconnected.");
  });
})();
