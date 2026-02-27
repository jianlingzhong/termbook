import { test, expect } from '@playwright/test';

test('Gemini CLI integration test', async ({ page }) => {
  // Define a larger timeout for the whole test
  test.setTimeout(60000);

  console.log('Navigating to Termbook...');
  await page.goto('http://localhost:4000?new_session=true');
  
  // Wait for the app to load
  await expect(page).toHaveTitle(/TERMBOOK/i);
  
  // The input is inside .chat-input-wrapper
  console.log('Waiting for input field...');
  const input = page.locator('.chat-input-wrapper input');
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.click();

  // Run gemini --help
  console.log('Typing gemini command...');
  const command = '/opt/homebrew/bin/gemini --help';
  await input.fill(command);
  
  // Verify the value was filled
  await expect(input).toHaveValue(command);
  
  console.log('Pressing Enter...');
  await input.press('Enter');

  // Verify the output appears in a notebook cell
  // Based on index.css, cells have class .notebook-cell and output is in .cell-output
  console.log('Waiting for output...');
  const lastCell = page.locator('.notebook-cell').last();
  const output = lastCell.locator('.cell-output');
  
  // We look for 'Usage' which is common in --help outputs
  await expect(output).toContainText('Usage', { timeout: 20000 });
  console.log('Test Passed: Gemini output detected.');
});

