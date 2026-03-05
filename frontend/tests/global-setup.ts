import { request, expect } from '@playwright/test';

async function globalSetup() {
  const urls = [
    { url: 'http://localhost:4000', name: 'Frontend' },
    { url: 'http://localhost:4001/api/health', name: 'Backend Health' }
  ];
  const maxRetries = 30;
  const interval = 1000;

  console.log('[*] Waiting for servers to be ready...');

  for (const item of urls) {
    let ready = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        // @ts-ignore - fetch is available in Node 18+
        const response = await fetch(item.url);
        if (response.ok) {
          console.log(`[+] ${item.name} (${item.url}) is ready!`);
          ready = true;
          break;
        }
      } catch (e) {
        // ignore connection errors
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    if (!ready) {
      throw new Error(`[-] ${item.name} (${item.url}) failed to become ready after ${maxRetries} seconds.`);
    }
  }
}

export default globalSetup;
