function onHeadersReceived(details) {
  const headersToRemove = [
    'content-security-policy',
    'x-frame-options',
    'content-security-policy-report-only'
  ];

  const responseHeaders = details.responseHeaders.filter(header => {
    return !headersToRemove.includes(header.name.toLowerCase());
  });

  return { responseHeaders };
}

browser.webRequest.onHeadersReceived.addListener(
  onHeadersReceived,
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);
