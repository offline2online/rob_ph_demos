'use strict';
// Chromium for the UI suite. PW_CHROMIUM wins; otherwise Playwright's own build (what CI installs); and when that
// build isn't on disk, the cloud sandbox's preinstalled Chromium. The sandbox ships a different Playwright from the
// one this folder pins, so without the fallback every launch there failed with "Executable doesn't exist": build
// sessions took it for "no browser here", handed back patches with the UI suite never run, and CI failed them.
const fs = require('fs');
const { chromium } = require('playwright');

const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';

async function launchChromium() {
  if (process.env.PW_CHROMIUM) return chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  try {
    return await chromium.launch();
  } catch (e) {
    if (!fs.existsSync(SANDBOX_CHROMIUM)) throw e;
    return chromium.launch({ executablePath: SANDBOX_CHROMIUM });
  }
}

module.exports = { launchChromium };
