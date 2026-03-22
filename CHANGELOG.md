# Changelog
## **WORK IN PROGRESS**

## 0.2.1 (2026-03-22)
* Address ioBroker adapter review feedback (reviewer McM1957)
* Migrate to ESLint 9 flat config with @iobroker/eslint-config v2.2.0
* MQTT password now stored encrypted (encryptedNative/protectedNative) -- users must re-enter password once after updating
* Fix object hierarchy: `devices` container changed from channel to folder
* Fix 12+ state roles to match ioBroker standards (level.timer, level.brightness, text, switch.light, button with read:false)
* Replace native setTimeout/setInterval with adapter.setTimeout/setInterval
* Consolidate i18n translations to flat JSON files only
* Remove unused admin/jsonConfig-complexversion.json
* Move admin/i18n.js to scripts/i18n.js (not delivered to users)

## 0.2.0 (2026-02-27)
* Fix release-script npm commands to use positional arguments

## 0.1.9 (2026-02-26)
* Rewrite GETTING-STARTED.md with full installation instructions for adapter and mcdu-client

## 0.1.8 (2026-02-26)
* Remove unpublished news entries (0.1.5, 0.1.6) from io-package.json
* Add missing responsive size attributes (xs, lg, xl) to Admin UI jsonConfig

## 0.1.7 (2026-02-25)
* Fix package test for titleLang (title field was deprecated)

## 0.1.6 (2026-02-25)
* Re-add mocha as direct devDependency (needed for CI)

## 0.1.5 (2026-02-25)
* Fix ioBroker repository checker errors and warnings

## 0.1.4 (2026-02-25)
* Switch to npm trusted publishing (OIDC) for automated releases

## 0.1.3 (2026-02-25)
* Added NPM_TOKEN with mfa to GitHub Actions deploy workflow

## 0.1.2 (2026-02-25)
* Added NPM_TOKEN to GitHub Actions deploy workflow

## 0.1.1 (2026-02-25)
* Updated README with project backstory
* Added research docs and UX concept overview

## 0.1.0
* Initial release
