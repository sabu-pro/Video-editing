import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',
  timeout:60000,
  fullyParallel:false,
  workers:1,
  use:{baseURL:'http://localhost:3000',viewport:{width:1440,height:1000},headless:true,channel:'chrome',acceptDownloads:true,launchOptions:{args:['--autoplay-policy=no-user-gesture-required']}},
  reporter:'list',
  webServer:{command:'node server.js',url:'http://localhost:3000',reuseExistingServer:true}
});
