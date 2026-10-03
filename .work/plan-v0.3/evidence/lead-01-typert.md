# lead-01 — Typert Remote во внешнем (не-DSH) репозитории

## Факты

- Корень генератора обязан содержать `tsconfig.host.json` и `tsconfig.client.json` — `packages/typert/generator/src/analyzer.ts:301-302`; членство в face берётся ТОЛЬКО из их `projectReferences` — `analyzer.ts:485-489`.
- Регистрация пакета создаётся, лишь если его корень внутри `<root>/packages` (`vendor` — только при `includeVendor`) — `analyzer.ts:488`. Пакеты из `node_modules` в модель не попадают вообще.
- `isTypeMetaSymbol` (`analyzer.ts:1975-1990`): `@Remote`, `RemoteScope`, `TypertRemoteService`, `bindTypertRemote`, `RemoteStream`, `TypertLookup`, `TypertContext` распознаются, только если пакет `@deepseek-ai/dsh-typert-protocol` зарегистрирован по (1), ЛИБО объявление лежит внутри `declare module '@deepseek-ai/dsh-typert-protocol' {…}`.
- Манифест контрибьютора (`packages/typert/generator/src/workspace.ts:96-114`): `exports["./typert"]` строго `{types:"./lib/typert.host.d.ts", default:"./lib/typert.host.js"}`; client-face — `./client/typert` → `./lib/typert.client.{d.ts,js}`; `files` обязан включать эти файлы.
- Host с Remote-методами (`workspace.ts:116-147`): `exports["./remote"]` строго `{types:"./lib/typert.remote-client.d.ts", default:"./lib/typert.remote-client.js"}` + оба в `files`; без Remote-методов публикация этих файлов = ошибка (`workspace.ts:133`).
- Ошибки при несгенерированных артефактах (класс `TypertAnalysisError`, `analyzer.ts:55`): `<pkg> must export "./typert" as {…}` (`workspace.ts:106`), `<pkg> package files must include lib/typert.host.js` (`workspace.ts:112`), `<pkg> must export ./remote as {…}` (`workspace.ts:140`).
- Runtime без артефакта: loader молча считает пакет не-контрибьютором, если его нет в `packages` конфига (`packages/typert/loader/src/index.ts:356`); если есть — `configured package "<pkg>" does not export "./typert"` (`:363`) либо `exports "./typert" but importing <path> failed: …` (`:376-378`). Конфиг: `packages?: string[]` (`:48-50`).
- Кукбук есть и публичный: `docs/cookbook/adding-a-remote-api.md` (5 шагов; `exports` — :94-103, регенерация `pnpm run build:lib` — :105, потребление на клиенте — :109-118).
- БЛОКЕР на клиенте: сборка `@deepseek-ai/dsh-api-remotes/client` монтирует ЖЁСТКО ЗАШИТЫЙ список 23 контрибьюций — `packages/api/remotes/src/client/index.ts:4-26` и `:177-185`. Динамического обнаружения внешних контрибьюций нет.
- Обход существует: `$mount(contribution)` — публичный метод `TypertClientRemote` (`packages/typert/protocol/src/types.ts:432,438`), реализация `packages/api/gateway/src/client/index.ts:202`; клиентская половина плагина может смонтировать свой `./remote` сама при `inject: ['remote']`.
- Генератор опубликован: `@deepseek-ai/dsh-typert-generator`, dist-tag `latest` = `0.1.7-rc.2`, `publishConfig.access=public`, peer `@deepseek-ai/cordis ~4.0.4`, dep `typescript ^6.0.3` (web_fetch `registry.npmjs.org/@deepseek-ai%2Fdsh-typert-generator`, HTTP 200).
- Пакеты DSH публикуют только `lib/**`: `packages/typert/protocol/package.json` → `files: ["lib/index.js","lib/types/**/*.js","lib/types/**/*.d.ts"]`; `./src/*` в `exports` есть, но `src` в `files` нет.
- Готовый внешний шаблон = фикстура `packages/typert/generator/tests/fixtures/remote-model/`: корневой `package.json`, `tsconfig.base.json` с `paths`, `tsconfig.host.json` (`files: []` + `references`), рукописный `typert-protocol.d.ts` (146 строк, ambient `declare module`), `packages/domain`, `packages/remote`; прогоняется тестом `tests/remote-model.spec.ts:10,65,287`.
- Что писать в `lib/`: `ModelEmitResult { js, dts, remote?: { js, dts, dtsMap } }` — `packages/typert/generator/src/emitter.ts:33-46`.
- Сам репозиторий использует генератор программно как гейт: `scripts/verify-package-dependencies.ts:339`.

## Опровержения/неожиданное

- «Достаточно `npm i -D @deepseek-ai/dsh-typert-generator`» — нет: нужен `<root>/packages/*` + face-агрегаты, иначе регистраций нет и Remote-методы не находятся (тихая деградация, не ошибка).
- 146-строчный рукописный `typert-protocol.d.ts` — не хак, а путь из фикстуры: генератору реальный пакет протокола не нужен вовсе (ветка `declare module`). Но это ручное зеркало контракта, которое надо синхронизировать.
- Исходники DSH не нужны (npm отдаёт только `lib`), но и достать их из npm нельзя: `./src/*` объявлен, `src` в `files` нет.
- Главный блокер не в генераторе, а на клиенте: браузерная половина получает namespace только через статический список в монорепо DSH.
- Одних полей `package.json` мало: пакету нужен свой `tsconfig.json` с `composite: true` и `references`, иначе программа face не строится.

## Не проверено

- Прогон `WorkspaceTypertGenerator` на фикстуре/внешнем репо не выполнялся (запрет install/build) — вывод о работоспособности следует из фикстурного теста, а не из моего запуска.
- Нет теста, где `@deepseek-ai/dsh-typert-protocol` резолвится из `node_modules` как `.d.ts`; фикстура использует ambient-шим. Поведение «через node_modules» не подтверждено.
- Можно ли написать `lib/typert.host.js` руками без генератора: валидатор loader'а прочитан, но не запускался; полный shape `TYPERT` (model.services/events/objects, invocations, codecs) велик, минимального рукописного примера в репо нет.
- Загружается ли клиентский код внешнего плагина в браузер (путь client-модулей / plugin-manager) — не трассировал.
- `typertPlugin()` (tsdown) вне монорепо: `packages/typert/generator/src/tsdown-plugin.ts:86,97` использует тот же корень, отдельно не проверял.
- `AbortSignal`-отмена и `uplink`/`RemoteStreamHandle` — только по `packages/typert/protocol/README.md:49`; рантайм не проверял.

## Что это значит для плана

1. Технически возможно и без исходников DSH: генератор есть в npm, шаблон — фикстура `remote-model`; ориентир ≈ 6–8 файлов (root `package.json`, `tsconfig.base.json`, `tsconfig.host.json`, шим протокола ~146 строк, `packages/<p>/{package.json,tsconfig.json,src/*}`, build-скрипт ~30 строк) + вечная синхронизация шима.
2. Настоящая цена — не сборка, а транспорт на клиент: либо патч DSH `packages/api/remotes/src/client/index.ts`, либо self-mount `ctx.remote.$mount` в клиентской половине плагина. Выбрать ДО начала работ.
3. Внешний репозиторий обязан имитировать форму монорепо (`packages/<name>/` + face-агрегаты в корне); плоская раскладка даёт молчаливый ноль артефактов.
4. Проверять надо не «сгенерировалось ли», а «смонтировался ли namespace в браузере» — это единственный непокрытый тестом шаг.
