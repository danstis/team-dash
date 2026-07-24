# Changelog

## [0.3.0](https://github.com/danstis/team-dash/compare/v0.2.0...v0.3.0) (2026-07-24)


### Features

* add task list for Asana Team Performance & Workload Dashboard ([e90befb](https://github.com/danstis/team-dash/commit/e90befb23b13217de65b08f55d95b9699e9dcd83))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([70df99a](https://github.com/danstis/team-dash/commit/70df99a7856e8cfdd72bfc12ede8b0f11f59ea52))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([#30](https://github.com/danstis/team-dash/issues/30)) ([ea7f957](https://github.com/danstis/team-dash/commit/ea7f9574d41efc3f74dfd0731aa0b5da5f5385c3))
* **asana:** add MSW handlers and small Asana fixture dataset (BSOD-157) ([#65](https://github.com/danstis/team-dash/issues/65)) ([9b51b61](https://github.com/danstis/team-dash/commit/9b51b61a77fad8f2732d2bffb00aeb068b85c47a))
* **asana:** define AsanaClientResult&lt;T&gt; outcome union (BSOD-152) ([#58](https://github.com/danstis/team-dash/issues/58)) ([b4f76d9](https://github.com/danstis/team-dash/commit/b4f76d9a1609b6851328bfe970a8bfcb61e5ec89))
* **asana:** define Zod resource schemas (BSOD-151) ([#59](https://github.com/danstis/team-dash/issues/59)) ([2026479](https://github.com/danstis/team-dash/commit/20264792e0087830ed8bd2feaea7cd218a32b599))
* **asana:** implement base Asana HTTP client (BSOD-153) ([#61](https://github.com/danstis/team-dash/issues/61)) ([90dde45](https://github.com/danstis/team-dash/commit/90dde459d569bb9a4a38d0e053fed8cd8fd431d7))
* **crypto:** add token encrypt/decrypt via Web Crypto AES-GCM (BSOD-155) ([#62](https://github.com/danstis/team-dash/issues/62)) ([faadc60](https://github.com/danstis/team-dash/commit/faadc60d510e2e68af2e24ea76e3a54f7c1a8485))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([d17d871](https://github.com/danstis/team-dash/commit/d17d8714d6285034253529707685d049ed5fc1fd))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([#32](https://github.com/danstis/team-dash/issues/32)) ([e5e145f](https://github.com/danstis/team-dash/commit/e5e145f5c86c515f9c81c6ade3f2276ae90754bd))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([e721400](https://github.com/danstis/team-dash/commit/e721400d5df8ffa4ef5553ad67d9f73786fb0d61))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([#35](https://github.com/danstis/team-dash/issues/35)) ([c69f359](https://github.com/danstis/team-dash/commit/c69f359e78b684d54c94a341df13668930f745e9))
* **docker:** publish image on GitHub Release (BSOD-258) ([#37](https://github.com/danstis/team-dash/issues/37)) ([667a715](https://github.com/danstis/team-dash/commit/667a715b8d3fda57e5a15ddb6e8aaad85665b161))
* **domain:** implement datetime helpers (BSOD-146) ([#54](https://github.com/danstis/team-dash/issues/54)) ([efa97f5](https://github.com/danstis/team-dash/commit/efa97f5b6aa1bdf67f0929b2ee3b4e5a6f8b433c))
* **domain:** implement dedupeByGid helper (BSOD-145) ([#52](https://github.com/danstis/team-dash/issues/52)) ([9b277a9](https://github.com/danstis/team-dash/commit/9b277a9e50e4a63a14cface0b94190611827e665))
* **eslint:** configure ESLint 10 flat config with boundaries rule (BSOD-134) ([#14](https://github.com/danstis/team-dash/issues/14)) ([30198d3](https://github.com/danstis/team-dash/commit/30198d352ef6b6ea27a71cc317146994c206e8d5))
* **mocks:** wire the MSW server for dev and tests (BSOD-158) ([#66](https://github.com/danstis/team-dash/issues/66)) ([ed0683b](https://github.com/danstis/team-dash/commit/ed0683be723c321125997d88d81ed1332378f5e1))
* **prettier:** configure Prettier 3 with .editorconfig alignment (BSOD-135) ([#18](https://github.com/danstis/team-dash/issues/18)) ([d812272](https://github.com/danstis/team-dash/commit/d812272cdc652d34a7bd804897827fcd799bb3bd))
* **pwa:** configure Vite PWA manifest (BSOD-133) ([#10](https://github.com/danstis/team-dash/issues/10)) ([5ecc08d](https://github.com/danstis/team-dash/commit/5ecc08dc64e9b537eb5dda69e515bad70c9cd0ff))
* **release:** adopt release-please for semver versioning (BSOD-257) ([#15](https://github.com/danstis/team-dash/issues/15)) ([d86c981](https://github.com/danstis/team-dash/commit/d86c9810eb2f80a9e6a81f331ba4005752cf9811))
* **shell:** implement app shell with credential/workspace providers (BSOD-159) ([#67](https://github.com/danstis/team-dash/issues/67)) ([e7e9bbf](https://github.com/danstis/team-dash/commit/e7e9bbf4f0aab5f75d22c6ac8e846a184c7ea530))
* **storage:** define Dexie schema (BSOD-149) ([#55](https://github.com/danstis/team-dash/issues/55)) ([bcdb0c5](https://github.com/danstis/team-dash/commit/bcdb0c537b511548ddc91f33b1d61d5c534f780c))


### Bug fixes

* **deps:** update dependency react-router to v8 ([#28](https://github.com/danstis/team-dash/issues/28)) ([9e88bb4](https://github.com/danstis/team-dash/commit/9e88bb4adf9682dc5934210d782b2e5ed1ea5025))
* **deps:** update dependency recharts to 3.10 ([#20](https://github.com/danstis/team-dash/issues/20)) ([98c19d6](https://github.com/danstis/team-dash/commit/98c19d6c0cc67cd7f67eacdb09e0b43b0f20655a))
* **docker:** copy only build-required files into the build stage (BSOD-139) ([f850064](https://github.com/danstis/team-dash/commit/f850064deb9c9a46d0e88f1f0b228d058a3b4230))
* **docker:** harden Dockerfile for Sonar (BSOD-139) ([50383be](https://github.com/danstis/team-dash/commit/50383beb165f6029b009080da2d2aaeae78f743c))
* **lint,format:** repair baseline ESLint + Prettier drift so CI gate goes green (BSOD-259) ([#46](https://github.com/danstis/team-dash/issues/46)) ([f022a1c](https://github.com/danstis/team-dash/commit/f022a1cac33102a3609286181722611581d90a03))
* **nginx:** harden SPA responses with CSP, frame, referrer, and permissions headers (BSOD-263) ([#56](https://github.com/danstis/team-dash/issues/56)) ([248d6e6](https://github.com/danstis/team-dash/commit/248d6e645f0b6ea5d11b22eb228589ede6bceb5b))
* **release:** honour feat commits as minor bumps in release-please (BSOD-267) ([#69](https://github.com/danstis/team-dash/issues/69)) ([6193ff3](https://github.com/danstis/team-dash/commit/6193ff3f583f2ec2d1ed0f473be0632a26248cdb))
* **release:** switch release-please to squash strategy ([970b46b](https://github.com/danstis/team-dash/commit/970b46b17e293c920c196f2a52e9f95350a17120))

## [0.1.1](https://github.com/danstis/team-dash/compare/v0.1.0...v0.1.1) (2026-07-21)

### Features

- add task list for Asana Team Performance & Workload Dashboard ([e90befb](https://github.com/danstis/team-dash/commit/e90befb23b13217de65b08f55d95b9699e9dcd83))
- **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([70df99a](https://github.com/danstis/team-dash/commit/70df99a7856e8cfdd72bfc12ede8b0f11f59ea52))
- **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([#30](https://github.com/danstis/team-dash/issues/30)) ([ea7f957](https://github.com/danstis/team-dash/commit/ea7f9574d41efc3f74dfd0731aa0b5da5f5385c3))
- **docker:** add multi-stage Dockerfile (BSOD-139) ([d17d871](https://github.com/danstis/team-dash/commit/d17d8714d6285034253529707685d049ed5fc1fd))
- **docker:** add multi-stage Dockerfile (BSOD-139) ([#32](https://github.com/danstis/team-dash/issues/32)) ([e5e145f](https://github.com/danstis/team-dash/commit/e5e145f5c86c515f9c81c6ade3f2276ae90754bd))
- **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([e721400](https://github.com/danstis/team-dash/commit/e721400d5df8ffa4ef5553ad67d9f73786fb0d61))
- **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([#35](https://github.com/danstis/team-dash/issues/35)) ([c69f359](https://github.com/danstis/team-dash/commit/c69f359e78b684d54c94a341df13668930f745e9))
- **eslint:** configure ESLint 10 flat config with boundaries rule (BSOD-134) ([#14](https://github.com/danstis/team-dash/issues/14)) ([30198d3](https://github.com/danstis/team-dash/commit/30198d352ef6b6ea27a71cc317146994c206e8d5))
- **prettier:** configure Prettier 3 with .editorconfig alignment (BSOD-135) ([#18](https://github.com/danstis/team-dash/issues/18)) ([d812272](https://github.com/danstis/team-dash/commit/d812272cdc652d34a7bd804897827fcd799bb3bd))
- **pwa:** configure Vite PWA manifest (BSOD-133) ([#10](https://github.com/danstis/team-dash/issues/10)) ([5ecc08d](https://github.com/danstis/team-dash/commit/5ecc08dc64e9b537eb5dda69e515bad70c9cd0ff))
- **release:** adopt release-please for semver versioning (BSOD-257) ([#15](https://github.com/danstis/team-dash/issues/15)) ([d86c981](https://github.com/danstis/team-dash/commit/d86c9810eb2f80a9e6a81f331ba4005752cf9811))

### Bug fixes

- **deps:** update dependency react-router to v8 ([#28](https://github.com/danstis/team-dash/issues/28)) ([9e88bb4](https://github.com/danstis/team-dash/commit/9e88bb4adf9682dc5934210d782b2e5ed1ea5025))
- **deps:** update dependency recharts to 3.10 ([#20](https://github.com/danstis/team-dash/issues/20)) ([98c19d6](https://github.com/danstis/team-dash/commit/98c19d6c0cc67cd7f67eacdb09e0b43b0f20655a))
- **docker:** copy only build-required files into the build stage (BSOD-139) ([f850064](https://github.com/danstis/team-dash/commit/f850064deb9c9a46d0e88f1f0b228d058a3b4230))
- **docker:** harden Dockerfile for Sonar (BSOD-139) ([50383be](https://github.com/danstis/team-dash/commit/50383beb165f6029b009080da2d2aaeae78f743c))
- **release:** switch release-please to squash strategy ([970b46b](https://github.com/danstis/team-dash/commit/970b46b17e293c920c196f2a52e9f95350a17120))
