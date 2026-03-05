const { execSync } = require('child_process');
try {
  execSync('npx playwright test tests/final_human_sim.spec.js --project=chromium', { stdio: 'inherit' });
} catch(e){}
