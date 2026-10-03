# foundation-15 — что DSH требует от клиентской (браузерной) половины плагина

ПОДТВЕРЖДЕНО
Q1: docs/cookbook/adding-a-settings-card.md:58 «it attaches a package's half to the Loader row whose specifier is the bare package name. A row mounted from a subpath export never carries a half».
Q1: packages/bundle/web-app/cordis.patch.yml:88-89 (переанкорено 2026-10-03: было `:69-70`) — строка браузерной половины: `- id: ui-open-in-app` / `name: '@deepseek-ai/dsh-client-ui-open-in-app'`; ключ строки — `name:`, ключа `client:` в патче нет.
Q1: живой cordis.patch.yml установленного плагина, строки 4-8: «The row is a bare plugin by package name: the node half (exports ".") runs in the host process … the `dsh.client` declaration in package.json makes the browser half (exports "./client") load».
Q2: packages/client/modules/src/client/manifest.ts:161-181 parseDshClient — обязателен только `platform` (string); принимаются ровно platform/inject/external/immediately.
Q2: packages/client/AGENTS.md:144 «platform: 'web' always, and the declaration requires a ./client export (the scan throws without one); immediately: true only for stage-one-prefetch infrastructure rows… inject … informational only».
Q2: docs/subsystems/client-modules.md:80 «declaring `dsh.client` (`platform: 'web'`, optional `inject` edges, optional `immediately`)»; packages/client/modules/README.md:34 добавляет `external`.
Q2: `bundle` живёт в другом ключе — docs/user/develop/basic/publish.md:42 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`.
Q3: scripts/publint-all.ts:183 «`lib/client.js` is evaluated by the page module system as a classic script» — не ESM.
Q3: packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/client.js:1-3 `window.__ModuleLoader__.load({ id: '@local/my-decoration', factory(require) {…} })` — lazy-CJS factory.
Q3: живой lib/client.js (head, exit 0): `window.__ModuleLoader__.load({ id: "@linxin666/dsh-client-ui-task-board", factory: (require) => {`.
Q3: docs/cookbook/adding-a-settings-card.md:66 `"./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }`; packages/client/modules/src/index.ts:847 «declares dsh.client but exports no "./client" bundle».
Q3: `lib/client.js` как имя — конвенция репо (scripts/check-workspace-constraints.ts:273-276); рантайму нужен резолвящийся `exports["./client"]`; сборка обязана существовать — packages/client/modules/README.md:50.
Q4: packages/boot/app-boot/src/package-meta.ts:163 `icon = …iconOf(manifest?.icon, manifestPath)`; :137-138 «manifest-relative SVG, PNG, JPEG, or WebP files of at most 256 KiB, contained in the manifest directory after realpath resolution».
Q4: packages/util/package-manifest/src/types.ts:16 `icon?: string`; пример packages/experimental/inspector/package.json:5 `"icon": "./icon.svg"` — рядом с name/version, вне `dsh`.
Q5: ровно два data-dsh-* в коде DSH: packages/client/ui-renderer/src/client/index.ts:66 `'data-dsh-boot': ''` и packages/client/ui-primitives/src/focus.ts:24 `setAttribute('data-dsh-automatic-focus', '')`; плюс `[data-dsh-boot-spinner]` packages/client/web/tests/boot.client.spec.ts:69.
Q5: живой плагин держит собственный неймспейс: data-dsh-taskboard-board/-view, data-dsh-plugin/-part (Select-String по lib/client.js, exit 0) — его конвенция, не контракт DSH.
Q-REF (@linxin666/dsh-client-ui-task-board/package.json, дословно): name "@linxin666/dsh-client-ui-task-board"; version "0.4.3"; main "lib/index.js"; icon "icon.svg"; type "module".
Q-REF exports: "." → {types "./lib/types/index.d.ts", default "./lib/index.js"}; "./invariant" → {types "./lib/types/invariant.d.ts", default "./lib/invariant.js"}; "./client" → {types "./lib/types/client/index.d.ts", default "./lib/client.js"}; "./src/*" → "./src/*"; "./package.json" → "./package.json".
Q-REF files: ["lib/**/*.js","lib/**/*.js.map","lib/**/*.d.ts","lib/**/*.d.ts.map","src","cordis.patch.yml","icon.svg"].
Q-REF dsh: engines {dsh ">=0.1.7-rc.2"}; bundle {patch "./cordis.patch.yml"}; client {platform "web", inject [8: @deepseek-ai/dsh-client-connection, -ui-settings, -ui-renderer, -ui-layout, dsh-api-session-controller, dsh-api-workspace-controller, dsh-api-remotes, dsh-client-ui-workspace]}.
Q-REF peerDependencies: {"@deepseek-ai/dsh": ">=0.1.7-rc.2", "react": "^18.2.0"}.

ОПРОВЕРГНУТО / УТОЧНЕНО
- `dsh.client.entry` и `dsh.client.bundle` не существуют: manifest.ts:161-181 и boot-wire manifest.ts:100-123 (id/url/initialUrl/rev/inject/external; id/inject/immediately) их не знают; все `dsh.client.*` в docs+code — external, inject, provide, причём provide только чтобы отвергнуть (packages/client/AGENTS.md:81 «There is no `dsh.client.provide` alias protocol»).
- «bare-имя» = спецификатор строки ровно равный имени пакета (manifest.ts:189-195 exactPackageSpecifier), а не отдельный ключ в патче.
- `immediately` узкое — только stage-one prefetch инфраструктурных строк (packages/client/AGENTS.md:144), не «всегда для клиентской половины».
- «требуется lib/client.js» уточнено: templates/decoration/package.json:6 отдаёт "./client" → "./client.js" в корне пакета и это валидно; lib/ — конвенция репо.

НЕ ПРОВЕРЕНО
- `icon` не документирован в docs/: Select-String по icon в docs/user/develop/basic/publish.md — 7 совпадений, все про dsh.profile/dsh.bundle/files/dsh (exit 0), поля icon нет.
- Семантика `immediately`: в packages/client/modules/README.md этого слова нет (grep: 1 совпадение — лишь ссылка на client/hmr prefetch); описание только AGENTS.md:144 и packages/test-support/client-runtime/src/assembly/roster.ts:18.
- Не запускал тесты/сборку; живой бандл читал только head-строкой, не исполнял.
- Не проверял end-to-end рендер icon из data: URI (только код package-meta.ts и тесты packages/boot/app-boot/tests/package-meta.spec.ts:167-276).
- Остальные файлы профиля C:\Users\Dmitry\.dsh\profiles\web (кроме пакета плагина) не читал.

WRITTEN: H:\Repo\DSH-MyWork\.work\plan-v0.3\evidence\foundation-15-client-manifest.md