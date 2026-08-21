# Changelog

## [0.7.0](https://github.com/danstis/team-dash/compare/v0.6.0...v0.7.0) (2026-08-21)


### Features

* **refresh:** ship FreshnessBanner + offline-disabled Refresh (BSOD-304, T050) ([#148](https://github.com/danstis/team-dash/issues/148)) ([ac8b4b2](https://github.com/danstis/team-dash/commit/ac8b4b23af4da54edabf70ac4378e3b668a18b76))


### Bug fixes

* **router:** refresh outdated PlaceholderRoute copy (BSOD-363) ([#152](https://github.com/danstis/team-dash/issues/152)) ([b2ef3df](https://github.com/danstis/team-dash/commit/b2ef3df6573efc4d97b13eb90dc6fd454c53f53f))

## [0.6.0](https://github.com/danstis/team-dash/compare/v0.5.0...v0.6.0) (2026-08-02)


### Features

* add Team Dash logo icons (BSOD-358) ([#145](https://github.com/danstis/team-dash/issues/145)) ([b06c85f](https://github.com/danstis/team-dash/commit/b06c85f34ba6ddbf085969ed206abf5d6c4a7bd5))
* add Team Dash logo icons for BSOD-358 ([b06c85f](https://github.com/danstis/team-dash/commit/b06c85f34ba6ddbf085969ed206abf5d6c4a7bd5))
* **BSOD-356:** add Asana-adjacent light/dark theme for team-dash ([7c095f2](https://github.com/danstis/team-dash/commit/7c095f2986954cb70408ad778a6026fb2448b9f5))


### Bug fixes

* **docker-release:** trigger on release-please workflow_run (BSOD-357) ([#142](https://github.com/danstis/team-dash/issues/142)) ([f82540e](https://github.com/danstis/team-dash/commit/f82540ebdaf385b4ec2645c176296a8193182947))

## [0.5.0](https://github.com/danstis/team-dash/compare/v0.4.0...v0.5.0) (2026-08-02)


### Features

* **app:** wire route guard blocking reporting routes until token+workspace ready (BSOD-174) ([#111](https://github.com/danstis/team-dash/issues/111)) ([a0c9684](https://github.com/danstis/team-dash/commit/a0c9684375c2a548ace9591806b0ee73be4faab5))
* **asana:** add pagination + events-since client contract and implementation (BSOD-302) ([#126](https://github.com/danstis/team-dash/issues/126)) ([e6f4ef7](https://github.com/danstis/team-dash/commit/e6f4ef7b1fce4494cdf046adb996999d5226149c))
* **refresh:** ship RefreshControls + success/partial-failure OutcomeBanner (BSOD-303, T049) ([#134](https://github.com/danstis/team-dash/issues/134)) ([0ac557c](https://github.com/danstis/team-dash/commit/0ac557c0b01e10cf3833652fc25f9729eecc25eb))
* **shared:** add MaskedToken shared component (BSOD-172) ([#108](https://github.com/danstis/team-dash/issues/108)) ([c7a0a6d](https://github.com/danstis/team-dash/commit/c7a0a6da33afebdea7c3968ff08729e06c707aa6))
* **storage:** add CacheRepository contract and implementation (BSOD-308) ([#118](https://github.com/danstis/team-dash/issues/118)) ([f462b50](https://github.com/danstis/team-dash/commit/f462b503cb0d2b7766f2e4f9d7f02cb20f3f4ea8))
* **storage:** add RefreshStagingRepository contract and implementation (BSOD-301) ([#125](https://github.com/danstis/team-dash/issues/125)) ([44066ae](https://github.com/danstis/team-dash/commit/44066ae0214c1afb17e9c8e65be260533cceb047))


### Bug fixes

* **asana:** accept live /workspaces response shape (BSOD-355) ([#135](https://github.com/danstis/team-dash/issues/135)) ([84fa2c6](https://github.com/danstis/team-dash/commit/84fa2c6c8fd34ea19bf273a7eafd6fb4f6cedea2))
* **credentials:** name the rate-limit ms-per-second constant (BSOD-353) ([#132](https://github.com/danstis/team-dash/issues/132)) ([11cad76](https://github.com/danstis/team-dash/commit/11cad766e760167362906711124c8db4cbdc7647))
* **datetime:** name MS_PER_DAY unit-conversion constant (BSOD-326) ([#121](https://github.com/danstis/team-dash/issues/121)) ([3ecb463](https://github.com/danstis/team-dash/commit/3ecb463750bd1d8038dd68f9a9d6896a33be6df7))
* handle Asana token response envelope (BSOD-354) ([#133](https://github.com/danstis/team-dash/issues/133)) ([0aee62d](https://github.com/danstis/team-dash/commit/0aee62d91a6f7d9ce0a2e875dbe4832b24fd31a9))
* **router:** compose first-run UI components (BSOD-347) ([#130](https://github.com/danstis/team-dash/issues/130)) ([809245a](https://github.com/danstis/team-dash/commit/809245a91c63c079f67979a523c9b8898d4fc895))

## [0.4.0](https://github.com/danstis/team-dash/compare/v0.3.0...v0.4.0) (2026-07-31)


### Features

* **credentials:** add CredentialRepository (BSOD-168) ([#92](https://github.com/danstis/team-dash/issues/92)) ([bf552cd](https://github.com/danstis/team-dash/commit/bf552cd687fc5c422bb01a4bf12b38570f074869))
* **credentials:** add storage mode selector (BSOD-170) ([#97](https://github.com/danstis/team-dash/issues/97)) ([fd532b8](https://github.com/danstis/team-dash/commit/fd532b894a7ee34b935f9ae451634f54b3c56d37))
* **credentials:** add TokenEntryForm and TestTokenButton (BSOD-169) ([#94](https://github.com/danstis/team-dash/issues/94)) ([8de117d](https://github.com/danstis/team-dash/commit/8de117d19b85e7d9b710828cca17e00ce429f64f))
* **credentials:** add WorkspaceSelector (BSOD-171) ([#102](https://github.com/danstis/team-dash/issues/102)) ([a400f27](https://github.com/danstis/team-dash/commit/a400f2748d92d899bdc4d19f83cb7b5f7b9e4c28))


### Bug fixes

* **asana-client:** name MS_PER_SECOND unit-conversion constant (BSOD-291) ([#95](https://github.com/danstis/team-dash/issues/95)) ([eb70e4f](https://github.com/danstis/team-dash/commit/eb70e4f0c77e2dff7353d51e409c5d8e8a17671f))
* **credentials:** name MS_PER_SECOND unit-conversion constant (BSOD-293) ([#105](https://github.com/danstis/team-dash/issues/105)) ([3d9ad9e](https://github.com/danstis/team-dash/commit/3d9ad9e42a4d8724ba8c922c8e814065e81f6a48))

## [0.3.0](https://github.com/danstis/team-dash/compare/v0.2.0...v0.3.0) (2026-07-28)


### Features

* add task list for Asana Team Performance & Workload Dashboard ([e90befb](https://github.com/danstis/team-dash/commit/e90befb23b13217de65b08f55d95b9699e9dcd83))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([70df99a](https://github.com/danstis/team-dash/commit/70df99a7856e8cfdd72bfc12ede8b0f11f59ea52))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([#30](https://github.com/danstis/team-dash/issues/30)) ([ea7f957](https://github.com/danstis/team-dash/commit/ea7f9574d41efc3f74dfd0731aa0b5da5f5385c3))
* **asana:** add MSW handlers and small Asana fixture dataset (BSOD-157) ([#65](https://github.com/danstis/team-dash/issues/65)) ([9b51b61](https://github.com/danstis/team-dash/commit/9b51b61a77fad8f2732d2bffb00aeb068b85c47a))
* **asana:** define AsanaClientResult&lt;T&gt; outcome union (BSOD-152) ([#58](https://github.com/danstis/team-dash/issues/58)) ([b4f76d9](https://github.com/danstis/team-dash/commit/b4f76d9a1609b6851328bfe970a8bfcb61e5ec89))
* **asana:** define Zod resource schemas (BSOD-151) ([#59](https://github.com/danstis/team-dash/issues/59)) ([2026479](https://github.com/danstis/team-dash/commit/20264792e0087830ed8bd2feaea7cd218a32b599))
* **asana:** implement base Asana HTTP client (BSOD-153) ([#61](https://github.com/danstis/team-dash/issues/61)) ([90dde45](https://github.com/danstis/team-dash/commit/90dde459d569bb9a4a38d0e053fed8cd8fd431d7))
* **asana:** implement testToken and listWorkspaces (BSOD-167) ([#85](https://github.com/danstis/team-dash/issues/85)) ([c947a14](https://github.com/danstis/team-dash/commit/c947a140db456f52e0d84978149a56f726dda7eb))
* **credentials:** add Settings credentials panel + wire FR-005a/FR-007 (BSOD-173) ([#86](https://github.com/danstis/team-dash/issues/86)) ([b80b4fd](https://github.com/danstis/team-dash/commit/b80b4fd60e35a4d2385706e82219c0c17092afd3))
* **crypto:** add token encrypt/decrypt via Web Crypto AES-GCM (BSOD-155) ([#62](https://github.com/danstis/team-dash/issues/62)) ([faadc60](https://github.com/danstis/team-dash/commit/faadc60d510e2e68af2e24ea76e3a54f7c1a8485))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([d17d871](https://github.com/danstis/team-dash/commit/d17d8714d6285034253529707685d049ed5fc1fd))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([#32](https://github.com/danstis/team-dash/issues/32)) ([e5e145f](https://github.com/danstis/team-dash/commit/e5e145f5c86c515f9c81c6ade3f2276ae90754bd))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([e721400](https://github.com/danstis/team-dash/commit/e721400d5df8ffa4ef5553ad67d9f73786fb0d61))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([#35](https://github.com/danstis/team-dash/issues/35)) ([c69f359](https://github.com/danstis/team-dash/commit/c69f359e78b684d54c94a341df13668930f745e9))
* **docker:** publish image on GitHub Release (BSOD-258) ([#37](https://github.com/danstis/team-dash/issues/37)) ([667a715](https://github.com/danstis/team-dash/commit/667a715b8d3fda57e5a15ddb6e8aaad85665b161))
* **domain:** implement datetime helpers (BSOD-146) ([#54](https://github.com/danstis/team-dash/issues/54)) ([efa97f5](https://github.com/danstis/team-dash/commit/efa97f5b6aa1bdf67f0929b2ee3b4e5a6f8b433c))
* **domain:** implement dedupeByGid helper (BSOD-145) ([#52](https://github.com/danstis/team-dash/issues/52)) ([9b277a9](https://github.com/danstis/team-dash/commit/9b277a9e50e4a63a14cface0b94190611827e665))
* **eslint:** configure ESLint 10 flat config with boundaries rule (BSOD-134) ([#14](https://github.com/danstis/team-dash/issues/14)) ([30198d3](https://github.com/danstis/team-dash/commit/30198d352ef6b6ea27a71cc317146994c206e8d5))
* **format:** add shared formatting helpers (BSOD-161) ([#76](https://github.com/danstis/team-dash/issues/76)) ([736d945](https://github.com/danstis/team-dash/commit/736d945a96f64618e1cd1f570b561609a04d906c))
* **mocks:** wire the MSW server for dev and tests (BSOD-158) ([#66](https://github.com/danstis/team-dash/issues/66)) ([ed0683b](https://github.com/danstis/team-dash/commit/ed0683be723c321125997d88d81ed1332378f5e1))
* **prettier:** configure Prettier 3 with .editorconfig alignment (BSOD-135) ([#18](https://github.com/danstis/team-dash/issues/18)) ([d812272](https://github.com/danstis/team-dash/commit/d812272cdc652d34a7bd804897827fcd799bb3bd))
* **pwa:** configure Vite PWA manifest (BSOD-133) ([#10](https://github.com/danstis/team-dash/issues/10)) ([5ecc08d](https://github.com/danstis/team-dash/commit/5ecc08dc64e9b537eb5dda69e515bad70c9cd0ff))
* **release:** adopt release-please for semver versioning (BSOD-257) ([#15](https://github.com/danstis/team-dash/issues/15)) ([d86c981](https://github.com/danstis/team-dash/commit/d86c9810eb2f80a9e6a81f331ba4005752cf9811))
* **shared:** implement ViewState-driven UI primitives (BSOD-160) ([#75](https://github.com/danstis/team-dash/issues/75)) ([6cef0a9](https://github.com/danstis/team-dash/commit/6cef0a90a91863ffaa976667eab82f2c66fe7541))
* **shell:** implement app shell with credential/workspace providers (BSOD-159) ([#67](https://github.com/danstis/team-dash/issues/67)) ([e7e9bbf](https://github.com/danstis/team-dash/commit/e7e9bbf4f0aab5f75d22c6ac8e846a184c7ea530))
* **storage:** define Dexie schema (BSOD-149) ([#55](https://github.com/danstis/team-dash/issues/55)) ([bcdb0c5](https://github.com/danstis/team-dash/commit/bcdb0c537b511548ddc91f33b1d61d5c534f780c))


### Bug fixes

* **asana-client:** name parseRetryAfter minimum-retry constant (BSOD-273) ([#87](https://github.com/danstis/team-dash/issues/87)) ([7eb4b13](https://github.com/danstis/team-dash/commit/7eb4b1308510b6a7f65f1f2d6fb2849fef50a7eb))
* **datetime:** surface offending preset in exhaustive-check error message (BSOD-272) ([#80](https://github.com/danstis/team-dash/issues/80)) ([012feff](https://github.com/danstis/team-dash/commit/012feffb471649f59d9f14f6ec5307daa0bee079))
* **deps:** clear BSOD-275 npm audit advisories ([#89](https://github.com/danstis/team-dash/issues/89)) ([6fa95a2](https://github.com/danstis/team-dash/commit/6fa95a22487b8786d0ee47d214b67446aed0769a))
* **deps:** update dependency react-router to v8 ([#28](https://github.com/danstis/team-dash/issues/28)) ([9e88bb4](https://github.com/danstis/team-dash/commit/9e88bb4adf9682dc5934210d782b2e5ed1ea5025))
* **deps:** update dependency recharts to 3.10 ([#20](https://github.com/danstis/team-dash/issues/20)) ([98c19d6](https://github.com/danstis/team-dash/commit/98c19d6c0cc67cd7f67eacdb09e0b43b0f20655a))
* **docker:** copy only build-required files into the build stage (BSOD-139) ([f850064](https://github.com/danstis/team-dash/commit/f850064deb9c9a46d0e88f1f0b228d058a3b4230))
* **docker:** harden Dockerfile for Sonar (BSOD-139) ([50383be](https://github.com/danstis/team-dash/commit/50383beb165f6029b009080da2d2aaeae78f743c))
* **lint,format:** repair baseline ESLint + Prettier drift so CI gate goes green (BSOD-259) ([#46](https://github.com/danstis/team-dash/issues/46)) ([f022a1c](https://github.com/danstis/team-dash/commit/f022a1cac33102a3609286181722611581d90a03))
* **nginx:** harden SPA responses with CSP, frame, referrer, and permissions headers (BSOD-263) ([#56](https://github.com/danstis/team-dash/issues/56)) ([248d6e6](https://github.com/danstis/team-dash/commit/248d6e645f0b6ea5d11b22eb228589ede6bceb5b))
* **release:** honour feat commits as minor bumps in release-please (BSOD-267) ([#69](https://github.com/danstis/team-dash/issues/69)) ([6193ff3](https://github.com/danstis/team-dash/commit/6193ff3f583f2ec2d1ed0f473be0632a26248cdb))
* **release:** switch release-please to squash strategy ([970b46b](https://github.com/danstis/team-dash/commit/970b46b17e293c920c196f2a52e9f95350a17120))
* **security:** add CSP fallback for static hosts ([#88](https://github.com/danstis/team-dash/issues/88)) ([3df5ca7](https://github.com/danstis/team-dash/commit/3df5ca743950b95b3594a1a54f574f440d476c39))
* **shared-states:** name formatRetryAfter unit-conversion constants (BSOD-277) ([#91](https://github.com/danstis/team-dash/issues/91)) ([c96e9bc](https://github.com/danstis/team-dash/commit/c96e9bcf69445763711be2303b48e4299bb94385))

## [0.1.1](https://github.com/danstis/team-dash/compare/v0.1.0...v0.1.1) (2026-07-21)


### Features

* add task list for Asana Team Performance & Workload Dashboard ([e90befb](https://github.com/danstis/team-dash/commit/e90befb23b13217de65b08f55d95b9699e9dcd83))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([70df99a](https://github.com/danstis/team-dash/commit/70df99a7856e8cfdd72bfc12ede8b0f11f59ea52))
* **app:** add Vite entry document and React shell bootstrap (BSOD-138) ([#30](https://github.com/danstis/team-dash/issues/30)) ([ea7f957](https://github.com/danstis/team-dash/commit/ea7f9574d41efc3f74dfd0731aa0b5da5f5385c3))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([d17d871](https://github.com/danstis/team-dash/commit/d17d8714d6285034253529707685d049ed5fc1fd))
* **docker:** add multi-stage Dockerfile (BSOD-139) ([#32](https://github.com/danstis/team-dash/issues/32)) ([e5e145f](https://github.com/danstis/team-dash/commit/e5e145f5c86c515f9c81c6ade3f2276ae90754bd))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([e721400](https://github.com/danstis/team-dash/commit/e721400d5df8ffa4ef5553ad67d9f73786fb0d61))
* **docker:** add nginx config with SPA fallback and PWA cache policy (BSOD-140) ([#35](https://github.com/danstis/team-dash/issues/35)) ([c69f359](https://github.com/danstis/team-dash/commit/c69f359e78b684d54c94a341df13668930f745e9))
* **eslint:** configure ESLint 10 flat config with boundaries rule (BSOD-134) ([#14](https://github.com/danstis/team-dash/issues/14)) ([30198d3](https://github.com/danstis/team-dash/commit/30198d352ef6b6ea27a71cc317146994c206e8d5))
* **prettier:** configure Prettier 3 with .editorconfig alignment (BSOD-135) ([#18](https://github.com/danstis/team-dash/issues/18)) ([d812272](https://github.com/danstis/team-dash/commit/d812272cdc652d34a7bd804897827fcd799bb3bd))
* **pwa:** configure Vite PWA manifest (BSOD-133) ([#10](https://github.com/danstis/team-dash/issues/10)) ([5ecc08d](https://github.com/danstis/team-dash/commit/5ecc08dc64e9b537eb5dda69e515bad70c9cd0ff))
* **release:** adopt release-please for semver versioning (BSOD-257) ([#15](https://github.com/danstis/team-dash/issues/15)) ([d86c981](https://github.com/danstis/team-dash/commit/d86c9810eb2f80a9e6a81f331ba4005752cf9811))


### Bug fixes

* **deps:** update dependency react-router to v8 ([#28](https://github.com/danstis/team-dash/issues/28)) ([9e88bb4](https://github.com/danstis/team-dash/commit/9e88bb4adf9682dc5934210d782b2e5ed1ea5025))
* **deps:** update dependency recharts to 3.10 ([#20](https://github.com/danstis/team-dash/issues/20)) ([98c19d6](https://github.com/danstis/team-dash/commit/98c19d6c0cc67cd7f67eacdb09e0b43b0f20655a))
* **docker:** copy only build-required files into the build stage (BSOD-139) ([f850064](https://github.com/danstis/team-dash/commit/f850064deb9c9a46d0e88f1f0b228d058a3b4230))
* **docker:** harden Dockerfile for Sonar (BSOD-139) ([50383be](https://github.com/danstis/team-dash/commit/50383beb165f6029b009080da2d2aaeae78f743c))
* **release:** switch release-please to squash strategy ([970b46b](https://github.com/danstis/team-dash/commit/970b46b17e293c920c196f2a52e9f95350a17120))
