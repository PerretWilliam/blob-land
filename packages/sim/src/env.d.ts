// The one platform API the sim uses: Web Crypto, which both the desktop webview
// and the Worker have. Declared here rather than pulling in the DOM or Node
// types, so nothing else platform-specific slips into the sim.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
};
