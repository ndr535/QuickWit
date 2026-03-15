#!/usr/bin/env node
/**
 * Syncs the iOS build number from Info.plist (written by `eas build:version:sync`)
 * into the Xcode project's CURRENT_PROJECT_VERSION, then sets Info.plist to use
 * $(CURRENT_PROJECT_VERSION) so Xcode has a single source of truth.
 *
 * Run after: eas build:version:sync -p ios -e production
 */

const { execSync, spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const plistPath = path.join(projectRoot, 'ios', 'QuickWit', 'Info.plist');
const pbxprojPath = path.join(projectRoot, 'ios', 'QuickWit.xcodeproj', 'project.pbxproj');

function getPlistKey(key) {
  const out = execSync(
    `/usr/libexec/PlistBuddy -c "Print :${key}" "${plistPath}"`,
    { encoding: 'utf8' }
  );
  return out.trim();
}

function setPlistKey(key, value) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

let buildNumber = getPlistKey('CFBundleVersion');
if (buildNumber === '$(CURRENT_PROJECT_VERSION)') {
  const pbx = fs.readFileSync(pbxprojPath, 'utf8');
  const m = pbx.match(/CURRENT_PROJECT_VERSION = (\d+);/);
  if (m) {
    buildNumber = m[1];
    console.log('Info.plist already uses $(CURRENT_PROJECT_VERSION); project has', buildNumber);
  } else {
    console.error('Could not read CURRENT_PROJECT_VERSION from project.pbxproj');
    process.exit(1);
  }
}

const pbx = fs.readFileSync(pbxprojPath, 'utf8');
const updated = pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
if (updated === pbx) {
  console.log('project.pbxproj already has CURRENT_PROJECT_VERSION =', buildNumber);
} else {
  fs.writeFileSync(pbxprojPath, updated);
  console.log('Updated CURRENT_PROJECT_VERSION to', buildNumber, 'in project.pbxproj');
}

setPlistKey('CFBundleVersion', '$(CURRENT_PROJECT_VERSION)');
console.log('Set Info.plist CFBundleVersion to $(CURRENT_PROJECT_VERSION)');
console.log('Done. Xcode and EAS are in sync at build', buildNumber);
